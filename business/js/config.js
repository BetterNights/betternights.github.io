/**
 * Business portal config. Override BN_API_BASE before loading api.js if needed.
 * Never put secrets here — only the public API origin.
 *
 * Query params:
 *   ?api=local|proxy                    → same-origin /api proxy (Serve-Business-Portal.command)
 *   ?api=https://api.betternights.app   → direct production (broken while Cloudflare drops OPTIONS)
 *   ?api=http://127.0.0.1:3001          → local API (saved)
 *   ?api=clear|prod|production          → production hostname (avoid from local portal)
 */
(function () {
  const PRODUCTION = 'https://api.betternights.app';
  const params = new URLSearchParams(window.location.search);
  const fromQuery = String(params.get('api') || '').trim();
  const pageOrigin = String(window.location.origin || '');
  const onLocalPortal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(pageOrigin);

  function saveApi(base) {
    try {
      localStorage.setItem('bn_biz_apiBase', base);
    } catch (_) {}
  }
  function clearApi() {
    try {
      localStorage.removeItem('bn_biz_apiBase');
    } catch (_) {}
  }
  function readSaved() {
    try {
      return localStorage.getItem('bn_biz_apiBase');
    } catch {
      return null;
    }
  }

  function isLoopbackApi(base) {
    return /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?$/i.test(
      String(base || '').replace(/^https?:\/\//i, '').split('/')[0]
    );
  }

  let apiBase = PRODUCTION;
  let isSameOriginProxy = false;

  if (typeof window.BN_API_BASE === 'string' && window.BN_API_BASE) {
    apiBase = window.BN_API_BASE.replace(/\/$/, '');
  } else if (/^(local|proxy|same)$/i.test(fromQuery)) {
    apiBase = pageOrigin;
    isSameOriginProxy = onLocalPortal;
    saveApi('__same_origin__');
  } else if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(fromQuery)) {
    apiBase = fromQuery.replace(/\/$/, '');
    saveApi(apiBase);
  } else if (/^(clear|prod|production)$/i.test(fromQuery)) {
    clearApi();
    // From a local portal, production hostname still needs the proxy (Cloudflare OPTIONS hang).
    if (onLocalPortal) {
      apiBase = pageOrigin;
      isSameOriginProxy = true;
      saveApi('__same_origin__');
    } else {
      apiBase = PRODUCTION;
    }
  } else if (/^https?:\/\//i.test(fromQuery)) {
    apiBase = fromQuery.replace(/\/$/, '');
    saveApi(apiBase);
  } else if (onLocalPortal) {
    // ALWAYS use same-origin proxy on local portal — ignore saved production URL.
    const saved = readSaved();
    if (saved && isLoopbackApi(saved) && saved !== '__same_origin__') {
      apiBase = saved.replace(/\/$/, '');
    } else {
      apiBase = pageOrigin;
      isSameOriginProxy = true;
      saveApi('__same_origin__');
    }
  } else {
    const saved = readSaved();
    if (saved === '__same_origin__') {
      apiBase = pageOrigin;
      isSameOriginProxy = true;
    } else if (saved && /^https?:\/\//i.test(saved)) {
      apiBase = saved.replace(/\/$/, '');
    }
  }

  if (onLocalPortal && apiBase === pageOrigin) isSameOriginProxy = true;

  window.BN_CONFIG = Object.freeze({
    apiBase: apiBase || pageOrigin,
    clientId: 'bn-business-web',
    storagePrefix: 'bn_biz_',
    isLocalApi: isLoopbackApi(apiBase) && !isSameOriginProxy,
    isSameOriginProxy
  });
})();
