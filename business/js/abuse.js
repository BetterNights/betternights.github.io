/**
 * Client-side anti-spam for the business portal.
 * Server rate limits are authoritative; this reduces accidental / UX abuse and backs off on 429.
 */
(function () {
  const PREFIX = 'bn_biz_abuse_';

  function now() {
    return Date.now();
  }

  function read(key, fallback) {
    try {
      const raw = sessionStorage.getItem(PREFIX + key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (_) {}
  }

  function cooldownRemaining(kind) {
    const until = Number(read(kind + '_until', 0)) || 0;
    return Math.max(0, until - now());
  }

  function startCooldown(kind, ms) {
    write(kind + '_until', now() + Math.max(0, ms));
  }

  function failStreak(kind) {
    return Math.max(0, Number(read(kind + '_streak', 0)) || 0);
  }

  function bumpFailStreak(kind) {
    const n = failStreak(kind) + 1;
    write(kind + '_streak', n);
    // Exponential backoff: 2s, 4s, 8s… capped at 60s (survives reload via sessionStorage).
    const ms = Math.min(60_000, 1000 * Math.pow(2, Math.min(n, 6)));
    startCooldown(kind, ms);
    return { streak: n, ms };
  }

  function clearFailStreak(kind) {
    write(kind + '_streak', 0);
    write(kind + '_until', 0);
  }

  /** Skip /me spam on rapid reloads for a short window after a known logged-out state. */
  function shouldSkipMeProbe() {
    return cooldownRemaining('me_skip') > 0;
  }

  function markLoggedOutProbe() {
    startCooldown('me_skip', 12_000);
  }

  function clearLoggedOutProbe() {
    write('me_skip_until', 0);
  }

  function formatWait(ms) {
    const s = Math.ceil(ms / 1000);
    return s <= 1 ? '1 second' : s + ' seconds';
  }

  /**
   * Wrap a button action: blocks double-submit + respects cooldown.
   * onWait(ms) optional UI hook.
   */
  async function guardedAction(kind, button, run, onWait) {
    if (button && button.dataset.bnBusy === '1') return;
    const wait = cooldownRemaining(kind);
    if (wait > 0) {
      if (typeof onWait === 'function') onWait(wait);
      return;
    }
    if (button) {
      button.dataset.bnBusy = '1';
      button.disabled = true;
    }
    try {
      return await run();
    } finally {
      if (button) {
        button.dataset.bnBusy = '0';
        const left = cooldownRemaining(kind);
        button.disabled = left > 0;
        if (left > 0) {
          const t = setInterval(() => {
            const rem = cooldownRemaining(kind);
            if (rem <= 0) {
              clearInterval(t);
              button.disabled = false;
            } else if (typeof onWait === 'function') {
              onWait(rem);
            }
          }, 250);
        }
      }
    }
  }

  window.BNAbuse = {
    cooldownRemaining,
    startCooldown,
    failStreak,
    bumpFailStreak,
    clearFailStreak,
    shouldSkipMeProbe,
    markLoggedOutProbe,
    clearLoggedOutProbe,
    formatWait,
    guardedAction
  };
})();
