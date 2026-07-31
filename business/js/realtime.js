/**
 * Browser WebSocket client for /ws/v1 (feed.changed → refresh map stats / parties).
 */
(function () {
  const PRODUCTION_WS = 'wss://api.betternights.app';

  function wsBaseFromConfig(cfg) {
    if (!cfg) return PRODUCTION_WS;
    if (cfg.isSameOriginProxy) return PRODUCTION_WS;
    if (cfg.isLocalApi) {
      return String(cfg.apiBase || '').replace(/^http/, 'ws');
    }
    const base = String(cfg.apiBase || PRODUCTION_WS).replace(/\/$/, '');
    if (/^https:\/\//i.test(base)) return base.replace(/^https/i, 'wss');
    if (/^http:\/\//i.test(base)) return base.replace(/^http/i, 'ws');
    return PRODUCTION_WS;
  }

  function createRealtime(opts) {
    const onFeedChanged = typeof opts.onFeedChanged === 'function' ? opts.onFeedChanged : null;
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;
    let ws = null;
    let stopped = false;
    let reconnectAttempt = 0;
    let reconnectTimer = null;
    let healthy = false;

    function setHealthy(v) {
      healthy = !!v;
      if (onStatus) onStatus(healthy);
    }

    function clearReconnect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect() {
      if (stopped) return;
      clearReconnect();
      const delay = Math.min(30_000, 1000 * Math.pow(2, Math.min(reconnectAttempt, 5)));
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        start().catch(() => {});
      }, delay);
    }

    async function fetchAccessToken() {
      const BN = window.BN;
      if (!BN || !BN.api) throw new Error('API not ready');
      const res = await BN.api('/api/web/realtime-token', { method: 'GET', timeoutMs: 12000 });
      const token = res && res.accessToken;
      if (!token) throw new Error('No realtime token');
      return String(token);
    }

    async function start() {
      stopped = false;
      clearReconnect();
      try {
        if (ws) {
          try {
            ws.close();
          } catch (_) {}
          ws = null;
        }
        const token = await fetchAccessToken();
        const base = wsBaseFromConfig(window.BN_CONFIG || (window.BN && window.BN.cfg));
        const url = base.replace(/\/$/, '') + '/ws/v1';
        ws = new WebSocket(url);
        ws.addEventListener('open', () => {
          try {
            ws.send(JSON.stringify({ type: 'auth', accessToken: token, clientId: 'bn-business-web' }));
            ws.send(JSON.stringify({ type: 'subscribe', channels: ['feed'] }));
          } catch (_) {
            setHealthy(false);
          }
        });
        ws.addEventListener('message', (ev) => {
          let msg = null;
          try {
            msg = JSON.parse(String(ev.data || ''));
          } catch (_) {
            return;
          }
          if (!msg || typeof msg !== 'object') return;
          const type = String(msg.type || '');
          if (type === 'subscribed' || type === 'auth.ok' || type === 'ready') {
            reconnectAttempt = 0;
            setHealthy(true);
            return;
          }
          if (type === 'error') {
            if (String(msg.code || '') === 'AUTH_REQUIRED' || String(msg.code || '') === 'UNAUTHORIZED') {
              setHealthy(false);
            }
            return;
          }
          if (type === 'feed.changed') {
            setHealthy(true);
            if (onFeedChanged) onFeedChanged(msg);
          }
        });
        ws.addEventListener('close', () => {
          setHealthy(false);
          ws = null;
          scheduleReconnect();
        });
        ws.addEventListener('error', () => {
          setHealthy(false);
        });
      } catch (_) {
        setHealthy(false);
        scheduleReconnect();
      }
    }

    function stop() {
      stopped = true;
      clearReconnect();
      setHealthy(false);
      if (ws) {
        try {
          ws.close();
        } catch (_) {}
        ws = null;
      }
    }

    return {
      start,
      stop,
      isHealthy: () => healthy
    };
  }

  window.BNRealtime = { createRealtime, wsBaseFromConfig };
})();
