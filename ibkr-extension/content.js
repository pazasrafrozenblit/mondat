// IBKR Option Chain Enhancer - content.js
// Fixes overlay bounds + adds Expected Yield (EY) score badges
// Version 1.0

(function() {
  'use strict';

  function waitForOverlays(callback) {
    const check = setInterval(() => {
      const yieldOverlay = document.getElementById('ibkr-annual-yield-overlay');
      const popOverlay = document.getElementById('ibkr-pop-overlay');
      if (yieldOverlay && popOverlay) {
        clearInterval(check);
        callback(yieldOverlay, popOverlay);
      }
    }, 500);
    setTimeout(() => clearInterval(check), 60000);
  }

  function initEnhancer(yieldOverlay, popOverlay) {
    if (!document.getElementById('ibkr-overlay-fix')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'ibkr-overlay-fix';
      document.head.appendChild(styleEl);
    }

    function updateClipBounds() {
      const el = document.querySelector('.opt-lbl-con');
      const top = el ? Math.round(el.getBoundingClientRect().top) : 510;
      const fix = document.getElementById('ibkr-overlay-fix');
      if (fix) {
        fix.textContent = `
          #ibkr-annual-yield-overlay { clip-path: inset(${top}px 0px 0px 0px) !important; }
          #ibkr-pop-overlay { clip-path: inset(${top}px 0px 0px 0px) !important; }
          #ibkr-score-overlay { clip-path: inset(${top}px 0px 0px 0px) !important; }
        `;
      }
    }
    updateClipBounds();
    window.addEventListener('resize', updateClipBounds);

    function ensureScoreOverlay() {
      if (!document.getElementById('ibkr-score-overlay')) {
        const s = document.createElement('div');
        s.id = 'ibkr-score-overlay';
        s.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:99997;';
        document.body.appendChild(s);
      }
      return document.getElementById('ibkr-score-overlay');
    }
    ensureScoreOverlay();

    window._updateScoreBadges = function() {
      const yOvr = document.getElementById('ibkr-annual-yield-overlay');
      const pOvr = document.getElementById('ibkr-pop-overlay');
      const sOvr = ensureScoreOverlay();
      if (!yOvr || !pOvr || !sOvr) return;

      const getVal = (el, regex) => {
        const m = (el.getAttribute('style') || '').match(regex);
        return m ? parseFloat(m[1]) : null;
      };

      const yieldBadges = Array.from(yOvr.children).map(c => {
        const m = c.textContent.trim().match(/Ann\.\s*Yield:\s*([\d.]+)%/);
        if (!m) return null;
        const left = getVal(c, /left:\s*([\d.]+)px/) || 0;
        return { top: getVal(c, /top:\s*([\d.]+)px/), left, width: getVal(c, /width:\s*([\d.]+)px/) || 200, value: parseFloat(m[1]), side: left > 400 ? 'puts' : 'calls' };
      }).filter(Boolean);

      const popBadges = Array.from(pOvr.children).map(c => {
        const m = c.textContent.trim().match(/PoP:\s*(\d+)%/);
        if (!m) return null;
        const left = getVal(c, /left:\s*([\d.]+)px/) || 0;
        return { top: getVal(c, /top:\s*([\d.]+)px/), left, value: parseInt(m[1]), side: left > 400 ? 'puts' : 'calls' };
      }).filter(Boolean);

      const pairs = yieldBadges.map(yb => {
        const pb = popBadges.find(p => p.side === yb.side && Math.abs(p.top - (yb.top - 29)) < 10);
        return pb ? { ...yb, pop: pb.value, score: yb.value * pb.value / 100 } : null;
      }).filter(Boolean);

      if (!pairs.length) return;
      const maxScore = Math.max(...pairs.map(p => p.score));
      sOvr.innerHTML = '';

      pairs.forEach(pair => {
        const pct = pair.score / maxScore;
        const hue = Math.round(120 * pct);
        const isBest = pct > 0.92;
        const s = pair.score >= 100 ? pair.score.toFixed(0) : pair.score.toFixed(1);
        const badge = document.createElement('div');
        badge.style.cssText = `position:absolute;left:${pair.left}px;top:${pair.top+13}px;width:${pair.width}px;height:12px;font-size:8.5px;font-weight:800;color:white;background:hsla(${hue},70%,30%,0.92);display:flex;align-items:center;justify-content:center;pointer-events:none;border-radius:2px;border:1px solid ${isBest?'gold':'transparent'};letter-spacing:-0.2px`;
        badge.textContent = isBest ? `\u2605 EY: ${s}%` : `EY: ${s}%`;
        badge.title = `Expected Yield = Ann.Yield x PoP = ${pair.value.toFixed(1)}% x ${pair.pop}% = ${pair.score.toFixed(1)}%`;
        sOvr.appendChild(badge);
      });
    };

    if (window._scoreMutationObserver) window._scoreMutationObserver.disconnect();
    window._scoreMutationObserver = new MutationObserver(() => {
      clearTimeout(window._scoreUpdateTimeout);
      window._scoreUpdateTimeout = setTimeout(window._updateScoreBadges, 50);
    });
    window._scoreMutationObserver.observe(yieldOverlay, { childList: true, attributes: true, subtree: true });

    if (window._bodyMutationObserver) window._bodyMutationObserver.disconnect();
    window._bodyMutationObserver = new MutationObserver(() => {
      if (!document.getElementById('ibkr-score-overlay')) { ensureScoreOverlay(); window._updateScoreBadges(); }
    });
    window._bodyMutationObserver.observe(document.body, { childList: true });

    window._updateScoreBadges();
  }

  waitForOverlays(initEnhancer);
})();