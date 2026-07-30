(function () {
  const cfg = window.BN_CONFIG || { apiBase: 'https://api.betternights.app', clientId: 'bn-business-web' };
  let csrfToken = '';
  /** Serialize mutating calls so double-clicks cannot race. */
  let mutateChain = Promise.resolve();

  function readCsrfCookie() {
    const m = document.cookie.match(/(?:^|;\s*)bn_csrf=([^;]*)/);
    if (!m) return '';
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1] || '';
    }
  }

  function setCsrf(token) {
    if (token) csrfToken = String(token);
  }

  function getCsrf() {
    return csrfToken || readCsrfCookie();
  }

  function isFileProtocol() {
    return String(window.location.protocol || '').toLowerCase() === 'file:';
  }

  function friendlyNetworkError(err) {
    if (isFileProtocol()) {
      return (
        'Open this portal over http:// (not as a file). Run: ' +
        'python3 -m http.server 5500 --directory /Users/williamcleaves/Desktop/Better-Nights-main/web ' +
        '→ then visit http://127.0.0.1:5500/business/'
      );
    }
    const msg = String((err && err.message) || err || '');
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      return (
        'Could not reach ' +
        cfg.apiBase +
        '. Check your connection, or open via a local http server (not file://). ' +
        'If the API sets CORS_ORIGIN, include this page’s origin (e.g. http://127.0.0.1:5500).'
      );
    }
    return msg || 'Request failed.';
  }

  async function api(path, options) {
    if (isFileProtocol()) {
      const err = new Error(friendlyNetworkError());
      err.code = 'FILE_PROTOCOL';
      throw err;
    }

    const opts = options || {};
    const method = String(opts.method || 'GET').toUpperCase();
    const isMutating = method !== 'GET' && method !== 'HEAD';

    const run = async () => {
      const headers = Object.assign(
        {
          Accept: 'application/json',
          'X-Client-ID': cfg.clientId
        },
        opts.headers || {}
      );
      if (opts.body != null && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      if (isMutating) {
        const csrf = getCsrf();
        if (csrf) headers['X-CSRF-Token'] = csrf;
      }

      let res;
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 25000;
        const timer =
          ctrl &&
          setTimeout(() => {
            try {
              ctrl.abort();
            } catch (_) {}
          }, timeoutMs);
        try {
          res = await fetch(cfg.apiBase + path, {
            method,
            headers,
            credentials: 'include',
            signal: ctrl ? ctrl.signal : undefined,
            body:
              opts.body == null
                ? undefined
                : typeof opts.body === 'string'
                  ? opts.body
                  : JSON.stringify(opts.body)
          });
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch (networkErr) {
        const aborted =
          networkErr &&
          (networkErr.name === 'AbortError' || /aborted/i.test(String(networkErr.message || '')));
        const err = new Error(
          aborted
            ? 'Request timed out. Hard-refresh and use http://127.0.0.1:5500/business/?api=local (Serve-Business-Portal.command).'
            : friendlyNetworkError(networkErr)
        );
        err.code = aborted ? 'TIMEOUT' : 'NETWORK';
        err.cause = networkErr;
        throw err;
      }

      let data = null;
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { ok: false, error: text.slice(0, 200) };
        }
      }
      if (data && data.csrfToken) setCsrf(data.csrfToken);

      if (!res.ok) {
        const retryHeader = res.headers.get('Retry-After');
        const retryAfterSec = Math.max(
          0,
          parseInt(
            (data && data.retryAfterSec) || retryHeader || (res.status === 429 ? '30' : '0'),
            10
          ) || 0
        );
        const err = new Error((data && (data.error || data.message)) || res.statusText || 'Request failed');
        err.status = res.status;
        err.code = data && data.code;
        err.data = data;
        err.retryAfterSec = retryAfterSec;
        throw err;
      }
      return data;
    };

    if (isMutating) {
      // Don't let a hung prior call block Start Event forever — race the chain wait.
      const gate = Promise.race([
        mutateChain.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 100))
      ]);
      const next = gate.then(run, run);
      mutateChain = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    }
    return run();
  }

  function storeGet(key, fallback) {
    try {
      const raw = localStorage.getItem((cfg.storagePrefix || 'bn_biz_') + key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function storeSet(key, value) {
    try {
      localStorage.setItem((cfg.storagePrefix || 'bn_biz_') + key, JSON.stringify(value));
      return true;
    } catch (err) {
      // Most callers ignore failures; draft save rethrows via opts or checks return.
      if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
        throw err;
      }
      return false;
    }
  }

  function storeRemove(key) {
    try {
      localStorage.removeItem((cfg.storagePrefix || 'bn_biz_') + key);
    } catch (_) {}
  }

  function digits10(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    return d.length === 10 ? d : d.slice(0, 10);
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  window.BN = {
    api,
    setCsrf,
    getCsrf,
    storeGet,
    storeSet,
    storeRemove,
    digits10,
    uuid,
    cfg,
    isFileProtocol,
    friendlyNetworkError
  };
})();
