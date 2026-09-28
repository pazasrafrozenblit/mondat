// IBKR Close Worthiness - close-worthiness.js
// Panel: is it worth buying back a winning short option before expiry? (case A)
// Self-contained: runs as its own extension or dropped into IBKR Option Chain Enhancer.
// Version 1.0

(function() {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const STORE_POSITIONS = 'cw_positions';
  const STORE_SETTINGS = 'cw_settings';
  const DEFAULT_SETTINGS = { feePerShare: 0.02, open: false };

  // Epoch ms of a wall-clock time in New York (US options expire 16:00 ET).
  function nyDateTime(dateStr, hour, minute) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, hour, minute);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    return guess - (asUtc - guess);
  }

  // Case A: holding to expiry = re-selling the option now at its current price.
  // ratio = (% of premium left, incl. cost to close) / (% of time left).
  // ratio < 1 -> the position now earns less per day than it did when opened.
  // Prices are per share, times are epoch ms.
  function closeWorthiness(p) {
    const { openPremium, currentPrice, openTime, expiryTime, now, strike } = p;
    const contracts = p.contracts || 1;
    const feePerShare = p.feePerShare || 0;
    const totalDays = (expiryTime - openTime) / DAY_MS;
    const daysLeft = (expiryTime - now) / DAY_MS;
    if (!(openPremium > 0) || !(strike > 0) || !(totalDays > 0)) return { status: 'invalid' };
    if (daysLeft <= 0) return { status: 'expired', totalDays };

    const timeLeft = Math.min(daysLeft / totalDays, 1);
    const base = {
      daysLeft, totalDays, timeLeft,
      thresholdPrice: openPremium * timeLeft - feePerShare,
      openYield: openPremium / strike * 365 / totalDays
    };
    if (!Number.isFinite(currentPrice) || currentPrice < 0) return { status: 'no-price', ...base };
    if (currentPrice >= openPremium) return { status: 'losing', ...base };

    const premiumLeft = (currentPrice + feePerShare) / openPremium;
    const ratio = premiumLeft / timeLeft;
    return {
      ...base,
      status: ratio < 0.9 ? 'close' : ratio <= 1.1 ? 'borderline' : 'hold',
      ratio, premiumLeft,
      remainingYield: currentPrice / strike * 365 / daysLeft,
      lockedProfit: (openPremium - currentPrice) * 100 * contracts,
      leftOnTable: currentPrice * 100 * contracts
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { closeWorthiness, nyDateTime };
  if (typeof document === 'undefined') return;

  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const store = {
    get(key, fallback) {
      if (hasChromeStorage) {
        return new Promise(resolve => chrome.storage.local.get(key, r => resolve(r[key] !== undefined ? r[key] : fallback)));
      }
      try {
        const v = JSON.parse(localStorage.getItem(key));
        return Promise.resolve(v !== null ? v : fallback);
      } catch (e) {
        return Promise.resolve(fallback);
      }
    },
    set(key, value) {
      if (hasChromeStorage) return new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve));
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
      return Promise.resolve();
    }
  };

  const STATUS = {
    close: { label: 'כדאי לסגור', color: '#1f8f4e' },
    borderline: { label: 'גבולי', color: '#b7791f' },
    hold: { label: 'להחזיק', color: '#3b5b8c' },
    losing: { label: "בהפסד – מקרה ב'", color: '#b83b3b' },
    'no-price': { label: 'הזן מחיר נוכחי', color: '#4a5568' },
    expired: { label: 'פקעה', color: '#4a5568' },
    invalid: { label: 'נתונים חסרים', color: '#4a5568' }
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI", Arial, sans-serif; }
    .toggle { position: fixed; bottom: 16px; left: 16px; z-index: 2147483000; background: #1f2633; color: #e6eaf2;
      border: 1px solid #3a4558; border-radius: 18px; padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.35); }
    .toggle:hover { background: #283144; }
    .panel { position: fixed; bottom: 60px; left: 16px; z-index: 2147483000; width: 360px; max-height: 72vh; overflow-y: auto;
      background: #151a23; color: #e6eaf2; border: 1px solid #2c3546; border-radius: 10px; padding: 12px;
      box-shadow: 0 6px 24px rgba(0,0,0,.45); font-size: 13px; line-height: 1.45; }
    .panel[hidden] { display: none; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .head h2 { font-size: 15px; margin: 0; }
    .x { background: none; border: none; color: #9aa5b8; font-size: 18px; cursor: pointer; padding: 0 4px; }
    .card { background: #1f2633; border: 1px solid #2c3546; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .title { font-weight: 700; font-size: 14px; }
    .badge { color: #fff; border-radius: 10px; padding: 2px 10px; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .muted { color: #9aa5b8; font-size: 12px; }
    .big { font-size: 13px; margin-top: 6px; }
    .big b { font-size: 15px; }
    .kv { margin-top: 3px; }
    .n { unicode-bidi: isolate; direction: ltr; display: inline-block; }
    label { display: block; color: #9aa5b8; font-size: 12px; margin-top: 6px; }
    input, select { width: 100%; background: #0f131a; color: #e6eaf2; border: 1px solid #3a4558; border-radius: 6px;
      padding: 5px 7px; font-size: 13px; margin-top: 2px; }
    input.price { width: 110px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
    .btn { background: #2f6fd0; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; font-size: 13px;
      font-weight: 600; cursor: pointer; margin-top: 10px; }
    .btn.secondary { background: #2c3546; }
    .del { background: none; border: none; color: #9aa5b8; font-size: 12px; cursor: pointer; text-decoration: underline; padding: 0; }
    details { margin-top: 10px; }
    summary { cursor: pointer; color: #c9d2e3; font-weight: 600; }
    .formula { margin-top: 10px; padding-top: 8px; border-top: 1px solid #2c3546; color: #9aa5b8; font-size: 12px; }
    .err { color: #f08a8a; font-size: 12px; margin-top: 6px; }
  `;

  let positions = [];
  let settings = { ...DEFAULT_SETTINGS };
  let host, root, panel, list;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => `<span class="n">${esc(v)}</span>`;
  const usd = v => num('$' + v.toFixed(2));
  const pct = (v, d = 0) => num((v * 100).toFixed(d) + '%');
  const shortDate = ms => new Date(ms).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  const localInputValue = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  function build() {
    host = document.createElement('div');
    host.id = 'ibkr-close-worthiness';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${CSS}</style>
      <button class="toggle" type="button" dir="rtl">⚖ כדאיות סגירה</button>
      <div class="panel" dir="rtl" hidden>
        <div class="head">
          <h2>כדאיות סגירה – פוזיציה ברווח</h2>
          <button class="x" type="button" title="סגור">×</button>
        </div>
        <div class="list"></div>
        <details class="add">
          <summary>+ הוסף פוזיציה</summary>
          <div class="grid">
            <div><label>טיקר<input name="ticker" placeholder="AAPL"></label></div>
            <div><label>סוג<select name="right"><option value="P">Put</option><option value="C">Call</option></select></label></div>
            <div><label>סטרייק<input name="strike" type="number" step="0.5" min="0" inputmode="decimal"></label></div>
            <div><label>חוזים<input name="contracts" type="number" step="1" min="1" value="1"></label></div>
            <div><label>פרמיה שקיבלתי (למניה)<input name="premium" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.50"></label></div>
            <div><label>תאריך פקיעה<input name="expiry" type="date"></label></div>
          </div>
          <label>נפתחה ב- (שעון מקומי)<input name="opened" type="datetime-local"></label>
          <div class="err" hidden></div>
          <button class="btn add-btn" type="button">הוסף</button>
        </details>
        <details class="settings">
          <summary>הגדרות</summary>
          <label>עמלה למניה – סגירה + פתיחה מחדש ($)<input name="fee" type="number" step="0.005" min="0" inputmode="decimal"></label>
        </details>
        <div class="formula">
          מדד כדאיות = (מחיר נוכחי + עמלה) ÷ פרמיה בפתיחה, חלקי (זמן שנשאר ÷ זמן כולל).
          מתחת ל-1: להחזיק עד הפקיעה מרוויח לך פחות ליום ממה שהסכמת לקבל כשפתחת, ועדיף לסגור.
          הזמן נמדד בימים קלנדריים עד 16:00 שעון ניו יורק ביום הפקיעה.
        </div>
      </div>`;

    panel = root.querySelector('.panel');
    list = root.querySelector('.list');
    root.querySelector('.toggle').addEventListener('click', () => setOpen(panel.hidden));
    root.querySelector('.x').addEventListener('click', () => setOpen(false));
    root.querySelector('.add-btn').addEventListener('click', addPosition);

    const fee = root.querySelector('input[name=fee]');
    fee.value = settings.feePerShare;
    fee.addEventListener('input', () => {
      const v = parseFloat(fee.value);
      if (Number.isFinite(v) && v >= 0) {
        settings.feePerShare = v;
        store.set(STORE_SETTINGS, settings);
        render();
      }
    });

    list.addEventListener('input', e => {
      if (!e.target.matches('input.price')) return;
      const pos = positions.find(p => p.id === e.target.dataset.id);
      if (!pos) return;
      const v = parseFloat(e.target.value);
      pos.currentPrice = Number.isFinite(v) ? v : null;
      pos.priceTime = Date.now();
      store.set(STORE_POSITIONS, positions);
      renderCard(pos);
    });
    list.addEventListener('click', e => {
      if (!e.target.matches('.del')) return;
      positions = positions.filter(p => p.id !== e.target.dataset.id);
      store.set(STORE_POSITIONS, positions);
      render();
    });

    root.querySelector('input[name=opened]').value = localInputValue(new Date());
    panel.hidden = !settings.open;
    document.body.appendChild(host);
  }

  function setOpen(open) {
    panel.hidden = !open;
    settings.open = open;
    store.set(STORE_SETTINGS, settings);
    if (open) render();
  }

  function addPosition() {
    const f = name => root.querySelector(`[name=${name}]`);
    const err = root.querySelector('.err');
    const strike = parseFloat(f('strike').value);
    const premium = parseFloat(f('premium').value);
    const contracts = parseInt(f('contracts').value, 10) || 1;
    const expiry = f('expiry').value;
    const openTime = new Date(f('opened').value).getTime();
    const expiryTime = expiry ? nyDateTime(expiry, 16, 0) : NaN;

    let msg = '';
    if (!(strike > 0)) msg = 'חסר סטרייק';
    else if (!(premium > 0)) msg = 'חסרה פרמיה';
    else if (!expiry) msg = 'חסר תאריך פקיעה';
    else if (!Number.isFinite(openTime) || openTime >= expiryTime) msg = 'זמן הפתיחה חייב להיות לפני הפקיעה';
    err.hidden = !msg;
    err.textContent = msg;
    if (msg) return;

    positions.push({
      id: String(Date.now()),
      ticker: f('ticker').value.trim().toUpperCase() || '?',
      right: f('right').value,
      strike, contracts, premium, openTime, expiryTime,
      currentPrice: null, priceTime: null
    });
    store.set(STORE_POSITIONS, positions);
    ['ticker', 'strike', 'premium', 'expiry'].forEach(n => { f(n).value = ''; });
    f('contracts').value = 1;
    f('opened').value = localInputValue(new Date());
    render();
  }

  function evaluate(pos) {
    return closeWorthiness({
      openPremium: pos.premium, currentPrice: pos.currentPrice, openTime: pos.openTime,
      expiryTime: pos.expiryTime, now: Date.now(), strike: pos.strike,
      contracts: pos.contracts, feePerShare: settings.feePerShare
    });
  }

  // Static part of a card; the price box lives here so typing never loses focus.
  function cardSkeleton(pos) {
    const name = num(`${pos.ticker} ${pos.strike}${pos.right}${pos.contracts > 1 ? ' ×' + pos.contracts : ''}`);
    const priceVal = Number.isFinite(pos.currentPrice) ? pos.currentPrice : '';
    return `
      <div class="row"><span class="title">${name}</span><span class="badge"></span></div>
      <div class="muted kv meta"></div>
      <label>מחיר נוכחי לקנייה חזרה (Ask)</label>
      <div class="row"><input class="price" type="number" step="0.01" min="0" inputmode="decimal" data-id="${esc(pos.id)}" value="${esc(priceVal)}"><span class="muted note"></span></div>
      <div class="out"></div>
      <div class="row kv"><span></span><button class="del" type="button" data-id="${esc(pos.id)}">מחק</button></div>`;
  }

  function fillCard(card, pos) {
    const r = evaluate(pos);
    const st = STATUS[r.status];
    const badge = card.querySelector('.badge');
    badge.textContent = st.label;
    badge.style.background = st.color;

    card.querySelector('.meta').innerHTML = r.daysLeft !== undefined
      ? `פקיעה ${num(shortDate(pos.expiryTime))} · נשארו ${num(r.daysLeft.toFixed(1))} ימים מתוך ${num(r.totalDays.toFixed(1))}`
      : `פקיעה ${num(shortDate(pos.expiryTime))}`;
    card.querySelector('.note').innerHTML = pos.priceTime && Number.isFinite(pos.currentPrice)
      ? `מחיר מ-${num(new Date(pos.priceTime).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }))}`
      : '';

    let out = '';
    if (r.thresholdPrice !== undefined) {
      out += `<div class="big">סגור אם המחיר מתחת ל-<b>${usd(Math.max(r.thresholdPrice, 0))}</b></div>`;
    }
    if (r.ratio !== undefined) {
      out += `<div class="kv">מדד כדאיות: <b>${num(r.ratio.toFixed(2))}</b> <span class="muted">(פרמיה שנשארה ${pct(r.premiumLeft)} מול זמן שנשאר ${pct(r.timeLeft)})</span></div>`;
      out += `<div class="kv">תשואה שנתית: נשאר ${pct(r.remainingYield, 1)} <span class="muted">· בפתיחה ${pct(r.openYield, 1)}</span></div>`;
      out += `<div class="kv">אם תסגור: ננעל ${usd(r.lockedProfit)} <span class="muted">· מוותר על ${usd(r.leftOnTable)}</span></div>`;
    } else if (r.status === 'losing') {
      out += `<div class="kv muted">המחיר גבוה מהפרמיה שקיבלת. זה כבר לא מקרה א' – צריך תוכנית יציאה: הקצאה, גלגול או סגירה בהפסד.</div>`;
    } else if (r.status === 'expired') {
      out += `<div class="kv muted">הפוזיציה פקעה. אפשר למחוק אותה.</div>`;
    }
    card.querySelector('.out').innerHTML = out;
  }

  function renderCard(pos) {
    const card = Array.from(list.querySelectorAll('.card')).find(c => c.dataset.id === pos.id);
    if (card) fillCard(card, pos);
  }

  function render() {
    if (!list || panel.hidden) return;
    if (!positions.length) {
      list.innerHTML = '<div class="muted">אין פוזיציות. הוסף פוזיציה שמכרת כדי לראות מתי כדאי לסגור אותה.</div>';
      return;
    }
    positions.sort((a, b) => a.expiryTime - b.expiryTime);
    list.innerHTML = positions.map(p => `<div class="card" data-id="${esc(p.id)}">${cardSkeleton(p)}</div>`).join('');
    list.querySelectorAll('.card').forEach(card => fillCard(card, positions.find(p => p.id === card.dataset.id)));
  }

  async function init() {
    positions = await store.get(STORE_POSITIONS, []);
    settings = { ...DEFAULT_SETTINGS, ...(await store.get(STORE_SETTINGS, {})) };
    build();
    render();
    // Time decay moves the threshold, so refresh every minute (in place, keeps focus).
    setInterval(() => {
      if (!panel.hidden) positions.forEach(renderCard);
    }, 60000);
    // IBKR is a single-page app; put the panel back if the page wipes the body.
    setInterval(() => {
      if (!document.body.contains(host)) document.body.appendChild(host);
    }, 2000);
  }

  if (!document.getElementById('ibkr-close-worthiness')) init();
})();
