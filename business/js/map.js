/**
 * Same basemap as the iOS app: MapLibre + Protomaps PMTiles on S3.
 * Pin colors match BusinessEventsMapSurface / MapLibreMapSurface.pinImage:
 *   business = green, party/event = lavender, user = blue.
 */
(function () {
  const STYLE_URL = 'map/style-dark.json';
  const FALLBACK_CENTER = [-123.0863, 44.0517];
  const MARKER_BUSINESS = '#34C759';
  const MARKER_PARTY = '#C89BD4';
  const MARKER_USER = '#007AFF';
  const MARKER_VENUE = MARKER_BUSINESS;
  const MARKER_EVENT = MARKER_PARTY;

  let protocolReady = false;

  function ensurePmtilesProtocol() {
    if (protocolReady) return true;
    if (typeof maplibregl === 'undefined') return false;
    if (typeof pmtiles === 'undefined' || !pmtiles.Protocol) {
      console.warn('[BN map] pmtiles library missing');
      return false;
    }
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    protocolReady = true;
    return true;
  }

  function createMap(containerId, opts) {
    const options = opts || {};
    ensurePmtilesProtocol();
    const el = document.getElementById(containerId);
    if (!el || typeof maplibregl === 'undefined') return null;

    const center = options.center || FALLBACK_CENTER;
    // Always allow wheel / trackpad zoom without ⌘/Ctrl unless explicitly opted in.
    const wantCoop = options.cooperativeGestures === true;
    const map = new maplibregl.Map({
      container: containerId,
      style: STYLE_URL,
      center: center,
      zoom: options.zoom != null ? options.zoom : 14,
      attributionControl: true,
      cooperativeGestures: wantCoop,
      maxTileCacheSize: 80,
      refreshExpiredTiles: false
    });

    if (!wantCoop) {
      try {
        if (map.scrollZoom && typeof map.scrollZoom.enable === 'function') {
          map.scrollZoom.enable();
        }
      } catch (_) {}
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // Built-in locate control — clicking it is a user gesture, so the browser shows the permission popup.
    if (options.geolocate !== false && typeof maplibregl.GeolocateControl === 'function') {
      const geo = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true, timeout: 15000 },
        trackUserLocation: true,
        showUserHeading: false,
        showAccuracyCircle: true,
        showUserLocation: true
      });
      map.addControl(geo, 'top-right');
      map._bnGeolocate = geo;
      geo.on('geolocate', (e) => {
        const c = e && e.coords;
        if (!c) return;
        map.fire('bnuserlocation', {
          lat: c.latitude,
          lng: c.longitude,
          accuracy: c.accuracy
        });
      });
      geo.on('error', (e) => {
        map.fire('bnuserlocationerror', { error: e && e.message ? e.message : 'Location error' });
      });
    }

    map.on('error', (e) => {
      try {
        console.warn('[BN map]', e && e.error ? e.error.message : e);
      } catch (_) {}
    });
    return map;
  }

  /** Trigger the MapLibre geolocate control (shows the browser permission dialog). */
  function triggerLocate(map) {
    if (!map || !map._bnGeolocate) return false;
    try {
      map._bnGeolocate.trigger();
      return true;
    } catch (_) {
      return false;
    }
  }

  function pinElement(kind, title) {
    const color =
      kind === 'user' ? MARKER_USER : kind === 'party' ? MARKER_PARTY : MARKER_BUSINESS;
    const wrap = document.createElement('div');
    wrap.className = 'bn-map-pin bn-map-pin-' + (kind || 'business');
    wrap.title = title || '';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', title || kind || 'pin');
    wrap.innerHTML =
      '<span class="bn-map-pin-halo" style="--bn-pin:' +
      color +
      '"></span><span class="bn-map-pin-core" style="--bn-pin:' +
      color +
      '"></span>';
    return wrap;
  }

  function marker(colorOrKind, title) {
    if (colorOrKind === 'business' || colorOrKind === 'party' || colorOrKind === 'user') {
      return new maplibregl.Marker({
        element: pinElement(colorOrKind, title),
        anchor: 'center'
      });
    }
    return new maplibregl.Marker({ color: colorOrKind || MARKER_BUSINESS });
  }

  function requestUserLocation(opts) {
    const options = opts || {};
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.isSecureContext) {
        reject(
          new Error(
            'Location needs a secure page (http://127.0.0.1 or https://). Don’t open the portal as a file.'
          )
        );
        return;
      }
      if (!navigator.geolocation) {
        reject(new Error('Location is not supported in this browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        },
        (err) => {
          const code = err && err.code;
          let msg = 'Could not get your location.';
          if (code === 1) {
            msg =
              'Location permission denied. Click the lock/info icon in the address bar → allow Location, then try again.';
          } else if (code === 2) {
            msg = 'Location unavailable. Check system Location Services and try again.';
          } else if (code === 3) {
            msg = 'Location timed out. Try again.';
          }
          const e = new Error(msg);
          e.code = code;
          reject(e);
        },
        {
          enableHighAccuracy: options.enableHighAccuracy !== false,
          timeout: options.timeout != null ? options.timeout : 15000,
          maximumAge: options.maximumAge != null ? options.maximumAge : 5000
        }
      );
    });
  }

  window.BNMap = {
    STYLE_URL,
    FALLBACK_CENTER,
    MARKER_BUSINESS,
    MARKER_PARTY,
    MARKER_USER,
    MARKER_VENUE,
    MARKER_EVENT,
    ensurePmtilesProtocol,
    createMap,
    marker,
    pinElement,
    requestUserLocation,
    triggerLocate
  };
})();
