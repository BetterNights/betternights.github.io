(function () {
  const $ = (id) => document.getElementById(id);
  let map;
  let eventMap;
  let venueMarker;
  let eventMarker;
  let eventMapVenueMarker;
  let eventMapPartyMarker;
  let eventMapUserMarker;
  let userMarker;
  let partyMarkers = [];
  let livePromo = null;
  let nearbyParties = [];
  let userLocation = null;
  let eventPinPlaced = false;
  let editingLive = false;
  let infoUnlocked = false;
  let infoPinDraft = '';
  let mapReady = false;
  let eventMapReady = false;

  function showMsg(el, text, ok) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'msg show ' + (ok ? 'ok' : 'error');
  }

  function profile() {
    return {
      businessName: BN.storeGet('businessName', ''),
      businessCategory: BN.storeGet('businessCategory', ''),
      businessDescription: BN.storeGet('businessDescription', ''),
      businessStreetAddress: BN.storeGet('businessStreetAddress', ''),
      businessLatitude: Number(BN.storeGet('businessLatitude', 0)) || 0,
      businessLongitude: Number(BN.storeGet('businessLongitude', 0)) || 0,
      businessContactPhone: BN.storeGet('businessContactPhone', ''),
      businessContactEmail: BN.storeGet('businessContactEmail', ''),
      businessWebsite: BN.storeGet('businessWebsite', ''),
      businessInstagram: BN.storeGet('businessInstagram', ''),
      businessHoursOpen: BN.storeGet('businessHoursOpen', '21:00'),
      businessHoursClose: BN.storeGet('businessHoursClose', '02:00'),
      businessImageBase64: BN.storeGet('businessImageBase64', ''),
      businessPin: BN.storeGet('businessPin', ''),
      businessVerificationStatus: BN.storeGet('businessVerificationStatus', '')
    };
  }

  function draftKey() {
    return 'promoDraft';
  }

  function pastKey() {
    return 'promoPast';
  }

  function toLocalInput(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      'T' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes())
    );
  }

  function defaultTimes() {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(21);
    const end = new Date(start.getTime() + 5 * 60 * 60 * 1000);
    $('ev-start').value = toLocalInput(start);
    $('ev-end').value = toLocalInput(end);
  }

  function portalHref(page) {
    // Keep local portal on the API proxy after redirects (Cloudflare OPTIONS is broken).
    if (BN.cfg && BN.cfg.isSameOriginProxy) {
      return page + (page.indexOf('?') >= 0 ? '&' : '?') + 'api=local';
    }
    return page;
  }

  async function requireSession() {
    try {
      const me = await BN.api('/api/web/auth/me');
      if (me.csrfToken) BN.setCsrf(me.csrfToken);
      if (!BN.storeGet('onboardingComplete', false) || !BN.storeGet('businessName', '')) {
        window.location.href = portalHref('onboarding.html');
        return null;
      }
      return me;
    } catch {
      window.location.href = portalHref('index.html');
      return null;
    }
  }

  function setTab(name) {
    document.querySelectorAll('.nav-bottom button').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
    if (name === 'map' && map) {
      setTimeout(() => {
        map.resize();
        updateMapMarkers({ fit: false });
      }, 50);
      refreshNearbyParties();
    }
    if (name === 'event' && eventMap) {
      setTimeout(() => {
        eventMap.resize();
        syncEventMapMarkers();
      }, 50);
    }
    if (name === 'info' && !infoUnlocked) {
      infoPinDraft = '';
      renderInfoPinDots();
    }
  }

  document.querySelectorAll('.nav-bottom button').forEach((b) => {
    b.addEventListener('click', () => setTab(b.getAttribute('data-tab')));
  });

  async function refreshOverview() {
    if (window.BNAbuse) {
      const wait = BNAbuse.cooldownRemaining('overview');
      if (wait > 0) {
        showMsg($('overview-msg'), 'Refreshing too fast — wait a moment.', false);
        return;
      }
      BNAbuse.startCooldown('overview', 4000);
    }
    try {
      const h = await BN.api('/api/health?detailed=1');
      $('stat-parties').textContent = String(h.parties != null ? h.parties : '—');
      $('stat-hazards').textContent = String(h.hazards != null ? h.hazards : '—');
      $('stat-users').textContent = String(h.connectedUsers != null ? h.connectedUsers : '—');
      showMsg($('overview-msg'), '', true);
      $('overview-msg').className = 'msg';
    } catch (err) {
      if (err && err.status === 429) {
        showMsg($('overview-msg'), err.message || 'Rate limited. Try again shortly.', false);
        if (window.BNAbuse && err.retryAfterSec) {
          BNAbuse.startCooldown('overview', err.retryAfterSec * 1000);
        }
        return;
      }
      showMsg($('overview-msg'), 'Live activity is unavailable right now.', false);
    }
  }
  $('btn-refresh-overview').addEventListener('click', refreshOverview);

  async function refreshVerificationChip() {
    const p = profile();
    const name = p.businessName;
    let status = String(p.businessVerificationStatus || '').toLowerCase();
    try {
      const res = await BN.api(
        '/api/businesses/verification/status?businessName=' + encodeURIComponent(name)
      );
      status = String((res && (res.status || res.verificationStatus)) || status).toLowerCase();
      if (status) BN.storeSet('businessVerificationStatus', status);
    } catch (_) {}
    const chip = $('verify-chip');
    chip.className = 'chip-status';
    if (status === 'approved' || status === 'verified') {
      chip.textContent = 'VERIFIED';
      chip.classList.add('verified');
    } else if (status === 'pending' || status === 'pending_review') {
      chip.textContent = 'PENDING REVIEW';
      chip.classList.add('pending');
    } else {
      chip.textContent = 'UNVERIFIED';
      chip.classList.add('unverified');
    }
  }

  function safeIsoFromInput(el) {
    const raw = el && el.value ? String(el.value).trim() : '';
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function buildPromoFromForm(existingId) {
    const p = profile();
    const startAt = safeIsoFromInput($('ev-start')) || new Date().toISOString();
    const endAt =
      safeIsoFromInput($('ev-end')) ||
      new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const isFree = $('ev-free').value === '1';
    const pin = eventPinCoords();
    const pinLat = pin ? pin.lat : null;
    const pinLng = pin ? pin.lng : null;
    const existing = existingId || (BN.storeGet(draftKey(), null) || {}).id;
    return {
      id: existing || BN.uuid(),
      headline: $('ev-headline').value.trim(),
      body: $('ev-body').value.trim(),
      businessName: p.businessName,
      category: p.businessCategory,
      streetAddress: $('ev-address').value.trim() || p.businessStreetAddress,
      latitude: pinLat,
      longitude: pinLng,
      vibe: $('ev-vibe').value.trim(),
      lookingFor: $('ev-looking').value.trim(),
      isFree,
      coverCharge: isFree ? 0 : Number($('ev-cover').value) || 0,
      isFull: $('ev-full').value === '1',
      minimumAge: $('ev-age').value ? Number($('ev-age').value) : null,
      startAt,
      endAt,
      createdAtMs: Date.now(),
      businessPhone: p.businessContactPhone,
      runId: existingId ? livePromo && livePromo.runId : BN.uuid(),
      inviteImageBase64: p.businessImageBase64 || undefined,
      pinPlaced: !!eventPinPlaced
    };
  }

  function fillFormFromPromo(promo) {
    if (!promo) return;
    $('ev-headline').value = promo.headline || '';
    $('ev-body').value = promo.body || '';
    $('ev-address').value = promo.streetAddress || '';
    $('ev-vibe').value = promo.vibe || '';
    $('ev-looking').value = promo.lookingFor || '';
    $('ev-free').value = promo.isFree === false ? '0' : '1';
    $('ev-cover').value = String(promo.coverCharge || 0);
    $('ev-full').value = promo.isFull ? '1' : '0';
    $('ev-age').value = promo.minimumAge != null ? String(promo.minimumAge) : '';
    if (promo.startAt) {
      const d = new Date(promo.startAt);
      if (!Number.isNaN(d.getTime())) $('ev-start').value = toLocalInput(d);
    }
    if (promo.endAt) {
      const d = new Date(promo.endAt);
      if (!Number.isNaN(d.getTime())) $('ev-end').value = toLocalInput(d);
    }
    if (promo.latitude != null && promo.longitude != null) {
      setEventPin(Number(promo.latitude), Number(promo.longitude), { silent: true });
    }
  }

  function renderLive() {
    if (!livePromo) {
      $('event-live').classList.add('hidden');
      $('event-editor').classList.remove('hidden');
      $('btn-start-event').classList.remove('hidden');
      $('btn-save-edit').classList.add('hidden');
      $('editor-title').textContent = 'New event';
      editingLive = false;
      return;
    }
    $('event-live').classList.remove('hidden');
    $('live-headline').textContent = livePromo.headline || 'Live event';
    $('live-body').textContent = livePromo.body || '';
    const start = livePromo.startAt ? new Date(livePromo.startAt).toLocaleString() : '';
    const end = livePromo.endAt ? new Date(livePromo.endAt).toLocaleString() : '';
    $('live-meta').textContent = [start, end].filter(Boolean).join(' → ');
    if (!editingLive) {
      $('event-editor').classList.add('hidden');
    }
  }

  function renderPast() {
    const list = BN.storeGet(pastKey(), []) || [];
    const el = $('past-list');
    el.innerHTML = '';
    if (!list.length) {
      el.innerHTML = '<p class="hint">No past events yet.</p>';
      return;
    }
    list.forEach((item, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = (item.headline || 'Event') + ' — reuse';
      b.addEventListener('click', () => {
        fillFormFromPromo(item);
        editingLive = false;
        $('event-editor').classList.remove('hidden');
        $('btn-start-event').classList.remove('hidden');
        $('btn-save-edit').classList.add('hidden');
        setTab('event');
      });
      el.appendChild(b);
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete from archive';
      del.addEventListener('click', () => {
        const next = list.slice();
        next.splice(idx, 1);
        BN.storeSet(pastKey(), next);
        renderPast();
      });
      el.appendChild(del);
    });
  }

  $('btn-save-draft').addEventListener('click', () => {
    try {
      const promo = buildPromoFromForm();
      // Don't bloat localStorage with venue photo on every draft.
      const slim = Object.assign({}, promo);
      delete slim.inviteImageBase64;
      try {
        BN.storeSet(draftKey(), slim);
      } catch (quotaErr) {
        // Retry without optional fields if storage is full.
        delete slim.body;
        BN.storeSet(draftKey(), slim);
      }
      if (promo.latitude != null && promo.longitude != null) {
        BN.storeSet('eventPinLatitude', promo.latitude);
        BN.storeSet('eventPinLongitude', promo.longitude);
      }
      const label = promo.headline ? '"' + promo.headline + '"' : 'Untitled';
      showMsg(
        $('event-msg'),
        'Draft saved on this device (' + label + '). It reloads when you open this page again.',
        true
      );
    } catch (err) {
      showMsg(
        $('event-msg'),
        (err && err.name === 'QuotaExceededError'
          ? 'Browser storage is full — clear site data or shorten the event text.'
          : (err && err.message) || 'Could not save draft.'),
        false
      );
    }
  });

  $('btn-start-event').addEventListener('click', async () => {
    const promo = buildPromoFromForm();
    if (!promo.headline) {
      showMsg($('event-msg'), 'Add a headline.', false);
      return;
    }
    if (!eventPinPlaced || !eventPinCoords()) {
      showMsg(
        $('event-msg'),
        'Place the party on the map below (tap to set the lavender pin). Your location (blue) and business (green) should also be visible.',
        false
      );
      return;
    }
    if (promo.latitude == null || promo.longitude == null) {
      showMsg($('event-msg'), 'Event map pin is missing. Tap the map to place the party.', false);
      return;
    }
    try {
      const slim = Object.assign({}, promo);
      delete slim.inviteImageBase64;
      BN.storeSet(draftKey(), slim);
      BN.storeSet('pendingPublishId', promo.id);
    } catch (_) {
      try {
        BN.storeSet('pendingPublishId', promo.id);
      } catch (_) {}
    }
    $('btn-start-event').disabled = true;
    showMsg($('event-msg'), 'Starting checkout…', true);
    try {
      let checkout = null;
      try {
        checkout = await BN.api('/api/web/promotions/checkout', {
          method: 'POST',
          body: { promotionId: promo.id, businessName: promo.businessName },
          timeoutMs: 20000
        });
      } catch (err) {
        const stripeMissing =
          err && (err.code === 'STRIPE_NOT_CONFIGURED' || err.status === 503);
        // Only the empty local API may publish without Stripe (dev). Production must Checkout.
        if (stripeMissing && BN.cfg && BN.cfg.isLocalApi) {
          checkout = null;
        } else if (stripeMissing) {
          showMsg(
            $('event-msg'),
            'Card checkout is not set up on the API yet. Add STRIPE_SECRET_KEY (and webhook secret) on the server, then redeploy.',
            false
          );
          return;
        } else {
          throw err;
        }
      }
      if (checkout && checkout.url) {
        showMsg($('event-msg'), 'Redirecting to Stripe…', true);
        window.location.href = checkout.url;
        return;
      }
      if (!(BN.cfg && BN.cfg.isLocalApi)) {
        showMsg($('event-msg'), 'Could not start Stripe Checkout. Try again in a moment.', false);
        return;
      }
      // Local/dev fallback when Stripe env is unset on the empty local API.
      const published = await BN.api('/api/promotions/publish', {
        method: 'POST',
        body: { promotion: promo }
      });
      livePromo = published.promotion || promo;
      BN.storeRemove(draftKey());
      BN.storeRemove('pendingPublishId');
      renderLive();
      updateMapMarkers();
      showMsg($('event-msg'), 'Event is live (local unpaid).', true);
    } catch (err) {
      showMsg($('event-msg'), err.message || 'Could not start event.', false);
    } finally {
      $('btn-start-event').disabled = false;
    }
  });

  async function finishCheckoutPublish(sessionId) {
    const draft = BN.storeGet(draftKey(), null);
    const pendingId = BN.storeGet('pendingPublishId', '');
    if (!draft) {
      showMsg($('event-msg'), 'Draft missing after payment. Re-enter event details and contact support if charged.', false);
      return;
    }
    const promo = Object.assign({}, draft, { id: pendingId || draft.id });
    try {
      const published = await BN.api('/api/promotions/publish', {
        method: 'POST',
        body: { promotion: promo, stripeCheckoutSessionId: sessionId }
      });
      livePromo = published.promotion || promo;
      BN.storeRemove(draftKey());
      BN.storeRemove('pendingPublishId');
      renderLive();
      updateMapMarkers();
      showMsg($('event-msg'), 'Payment received — event is live.', true);
      setTab('event');
    } catch (err) {
      showMsg($('event-msg'), err.message || 'Paid, but publish failed. Try again or contact support.', false);
    }
  }

  $('btn-edit-live').addEventListener('click', () => {
    if (!livePromo) return;
    editingLive = true;
    fillFormFromPromo(livePromo);
    $('event-editor').classList.remove('hidden');
    $('btn-start-event').classList.add('hidden');
    $('btn-save-edit').classList.remove('hidden');
    $('editor-title').textContent = 'Edit live event';
  });

  $('btn-save-edit').addEventListener('click', async () => {
    if (!livePromo) return;
    const promo = buildPromoFromForm(livePromo.id);
    promo.runId = livePromo.runId;
    try {
      const published = await BN.api('/api/promotions/publish', {
        method: 'POST',
        body: { promotion: promo }
      });
      livePromo = published.promotion || promo;
      editingLive = false;
      renderLive();
      updateMapMarkers();
      showMsg($('event-msg'), 'Live event updated.', true);
    } catch (err) {
      showMsg($('event-msg'), err.message || 'Update failed.', false);
    }
  });

  $('btn-end-live').addEventListener('click', async () => {
    if (!livePromo) return;
    const name = livePromo.businessName || profile().businessName;
    try {
      await BN.api('/api/promotions/mine?businessName=' + encodeURIComponent(name), {
        method: 'DELETE'
      });
      const past = BN.storeGet(pastKey(), []) || [];
      past.unshift(livePromo);
      BN.storeSet(pastKey(), past.slice(0, 30));
      livePromo = null;
      renderLive();
      renderPast();
      updateMapMarkers();
      defaultTimes();
      showMsg($('event-msg'), 'Event ended.', true);
    } catch (err) {
      showMsg($('event-msg'), err.message || 'Could not end event.', false);
    }
  });

  $('btn-live-stats').addEventListener('click', async () => {
    const name = (livePromo && livePromo.businessName) || profile().businessName;
    try {
      const stats = await BN.api(
        '/api/promotions/stats?businessName=' + encodeURIComponent(name)
      );
      const opens = stats.opens != null ? stats.opens : stats.openCount;
      $('stats-box').textContent =
        'Opens: ' +
        (opens != null ? opens : '—') +
        (stats.runId ? ' · run ' + stats.runId : '');
    } catch (err) {
      $('stats-box').textContent = err.message || 'Stats unavailable.';
    }
  });

  function partyCoords(row) {
    if (!row || typeof row !== 'object') return null;
    const lat = Number(
      row.partyLatitude != null
        ? row.partyLatitude
        : row.latitude != null
          ? row.latitude
          : row.lat
    );
    const lng = Number(
      row.partyLongitude != null
        ? row.partyLongitude
        : row.longitude != null
          ? row.longitude
          : row.lng
    );
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return null;
    return { lat, lng };
  }

  function clearPartyMarkers() {
    partyMarkers.forEach((m) => {
      try {
        m.remove();
      } catch (_) {}
    });
    partyMarkers = [];
  }

  function updateMapMarkers(opts) {
    if (!map || !mapReady) return;
    const options = opts || {};
    const p = profile();
    const vLat = p.businessLatitude || 44.0517;
    const vLng = p.businessLongitude || -123.0863;
    const bounds = [];

    if (!venueMarker) {
      venueMarker = BNMap.marker('business', p.businessName || 'Your business')
        .setLngLat([vLng, vLat])
        .addTo(map);
    } else {
      venueMarker.setLngLat([vLng, vLat]);
    }
    bounds.push([vLng, vLat]);

    // Party / event pin (lavender) — live promo, draft, or map-placed pin.
    const partyPin = eventPinCoords();
    if (partyPin) {
      const title = (livePromo && livePromo.headline) || 'Your event';
      if (!eventMarker) {
        eventMarker = BNMap.marker('party', title).setLngLat([partyPin.lng, partyPin.lat]).addTo(map);
      } else {
        eventMarker.setLngLat([partyPin.lng, partyPin.lat]);
      }
      bounds.push([partyPin.lng, partyPin.lat]);
    } else if (eventMarker) {
      eventMarker.remove();
      eventMarker = null;
    }

    // Nearby community parties (same feed as the app).
    clearPartyMarkers();
    const liveId = livePromo && livePromo.id ? String(livePromo.id) : '';
    nearbyParties.forEach((party) => {
      const c = partyCoords(party);
      if (!c) return;
      const id = String(party.id || party.inviteCode || '');
      // Avoid double-drawing if live promo somehow appears in parties list.
      if (liveId && id && id === liveId) return;
      const title = party.title || party.host || party.location || 'Party';
      const m = BNMap.marker('party', title).setLngLat([c.lng, c.lat]).addTo(map);
      partyMarkers.push(m);
      bounds.push([c.lng, c.lat]);
    });

    if (userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng)) {
      if (!userMarker) {
        userMarker = BNMap.marker('user', 'You').setLngLat([userLocation.lng, userLocation.lat]).addTo(map);
      } else {
        userMarker.setLngLat([userLocation.lng, userLocation.lat]);
      }
      bounds.push([userLocation.lng, userLocation.lat]);
    } else if (userMarker) {
      userMarker.remove();
      userMarker = null;
    }

    if (options.fit !== false && bounds.length > 1 && typeof maplibregl !== 'undefined') {
      try {
        const b = new maplibregl.LngLatBounds(bounds[0], bounds[0]);
        bounds.forEach((pt) => b.extend(pt));
        map.fitBounds(b, { padding: 56, maxZoom: 15, duration: 600 });
      } catch (_) {
        map.setCenter([vLng, vLat]);
      }
    } else if (options.centerOnUser && userLocation) {
      map.easeTo({ center: [userLocation.lng, userLocation.lat], zoom: Math.max(map.getZoom(), 14) });
    } else if (options.recenterVenue) {
      map.setCenter([vLng, vLat]);
    }
  }

  async function refreshNearbyParties() {
    try {
      const feed = await BN.api('/api/feed');
      const parties = (feed && feed.parties) || (Array.isArray(feed) ? feed : []);
      nearbyParties = Array.isArray(parties) ? parties : [];
      updateMapMarkers({ fit: false });
    } catch (err) {
      // Fallback: promotions-only map still works.
      if (err && err.status !== 401) {
        showMsg($('map-msg'), 'Could not load nearby parties right now.', false);
      }
    }
  }

  function eventPinCoords() {
    const pinLat = Number(BN.storeGet('eventPinLatitude', 0));
    const pinLng = Number(BN.storeGet('eventPinLongitude', 0));
    if (
      eventPinPlaced &&
      Number.isFinite(pinLat) &&
      Number.isFinite(pinLng) &&
      (Math.abs(pinLat) > 1e-6 || Math.abs(pinLng) > 1e-6)
    ) {
      return { lat: pinLat, lng: pinLng };
    }
    if (livePromo && livePromo.latitude != null && livePromo.longitude != null) {
      const lat = Number(livePromo.latitude);
      const lng = Number(livePromo.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng) && (Math.abs(lat) > 1e-6 || Math.abs(lng) > 1e-6)) {
        return { lat, lng };
      }
    }
    return null;
  }

  function setEventPin(lat, lng, opts) {
    const options = opts || {};
    BN.storeSet('eventPinLatitude', lat);
    BN.storeSet('eventPinLongitude', lng);
    eventPinPlaced = true;
    if (livePromo) {
      livePromo = Object.assign({}, livePromo, { latitude: lat, longitude: lng });
    }
    syncEventMapMarkers();
    updateMapMarkers({ fit: false });
    if ($('event-pin-hint')) {
      $('event-pin-hint').textContent =
        'Event pin: ' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5);
    }
    if (!options.silent) {
      showMsg($('event-msg'), 'Party location set on the map.', true);
      showMsg($('map-msg'), 'Event pin updated.', true);
    }
  }

  function syncEventMapMarkers() {
    if (!eventMap || !eventMapReady) return;
    const p = profile();
    const vLat = p.businessLatitude || 44.0517;
    const vLng = p.businessLongitude || -123.0863;

    if (!eventMapVenueMarker) {
      eventMapVenueMarker = BNMap.marker('business', p.businessName || 'Your business')
        .setLngLat([vLng, vLat])
        .addTo(eventMap);
    } else {
      eventMapVenueMarker.setLngLat([vLng, vLat]);
    }

    const pin = eventPinCoords();
    if (pin) {
      if (!eventMapPartyMarker) {
        eventMapPartyMarker = BNMap.marker('party', 'This event')
          .setLngLat([pin.lng, pin.lat])
          .addTo(eventMap);
      } else {
        eventMapPartyMarker.setLngLat([pin.lng, pin.lat]);
      }
    }

    if (userLocation) {
      if (!eventMapUserMarker) {
        eventMapUserMarker = BNMap.marker('user', 'You')
          .setLngLat([userLocation.lng, userLocation.lat])
          .addTo(eventMap);
      } else {
        eventMapUserMarker.setLngLat([userLocation.lng, userLocation.lat]);
      }
    }
  }

  function applyUserLocation(loc, opts) {
    const options = opts || {};
    if (!loc) return;
    userLocation = loc;
    updateMapMarkers({ fit: false, centerOnUser: !!options.centerOnUser });
    syncEventMapMarkers();
    if (options.centerEventMap && eventMap && eventMapReady) {
      eventMap.easeTo({ center: [loc.lng, loc.lat], zoom: Math.max(eventMap.getZoom(), 14) });
    }
  }

  async function ensureUserLocation(opts) {
    const options = opts || {};
    const targetMap = options.map || map;
    showMsg(
      options.msgEl || $('map-msg'),
      'Requesting your location… allow it in the browser popup if asked.',
      true
    );
    // Prefer MapLibre control (user-gesture friendly).
    if (targetMap && BNMap.triggerLocate(targetMap)) {
      return null;
    }
    try {
      const loc = await BNMap.requestUserLocation();
      applyUserLocation(loc, {
        centerOnUser: !options.silent,
        centerEventMap: options.centerEventMap
      });
      if (!options.silent) {
        showMsg(options.msgEl || $('map-msg'), 'Showing your location.', true);
      }
      return loc;
    } catch (err) {
      showMsg(options.msgEl || $('map-msg'), (err && err.message) || 'Could not get location.', false);
      return null;
    }
  }

  function initMap() {
    const p = profile();
    map = BNMap.createMap('map', {
      center: [p.businessLongitude || -123.0863, p.businessLatitude || 44.0517],
      zoom: 14,
      geolocate: true
    });
    if (!map) return;
    map.on('bnuserlocation', (e) => {
      applyUserLocation({ lat: e.lat, lng: e.lng, accuracy: e.accuracy }, { centerOnUser: true });
      showMsg($('map-msg'), 'Showing your location.', true);
    });
    map.on('bnuserlocationerror', (e) => {
      showMsg($('map-msg'), e.error || 'Could not get location.', false);
    });
    map.on('load', () => {
      mapReady = true;
      updateMapMarkers({ recenterVenue: true });
      refreshNearbyParties();
    });
    map.on('click', (e) => {
      if (!e || !e.lngLat) return;
      setEventPin(e.lngLat.lat, e.lngLat.lng);
    });
  }

  function initEventMap() {
    const p = profile();
    const el = $('map-event');
    if (!el) return;
    eventMap = BNMap.createMap('map-event', {
      center: [p.businessLongitude || -123.0863, p.businessLatitude || 44.0517],
      zoom: 14,
      cooperativeGestures: false,
      geolocate: true
    });
    if (!eventMap) return;
    eventMap.on('bnuserlocation', (e) => {
      applyUserLocation(
        { lat: e.lat, lng: e.lng, accuracy: e.accuracy },
        { centerEventMap: true }
      );
      showMsg($('event-msg'), 'Showing your location on the event map.', true);
    });
    eventMap.on('bnuserlocationerror', (e) => {
      showMsg($('event-msg'), e.error || 'Could not get location.', false);
    });
    eventMap.on('load', () => {
      eventMapReady = true;
      eventMap.resize();
      // Default party pin to venue so the event is always visible on the map (iOS parity).
      if (!eventPinPlaced && p.businessLatitude && p.businessLongitude) {
        setEventPin(p.businessLatitude, p.businessLongitude, { silent: true });
      } else {
        syncEventMapMarkers();
      }
    });
    eventMap.on('click', (e) => {
      if (!e || !e.lngLat) return;
      setEventPin(e.lngLat.lat, e.lngLat.lng);
    });
  }

  if ($('btn-locate-me')) {
    $('btn-locate-me').addEventListener('click', async () => {
      $('btn-locate-me').disabled = true;
      await ensureUserLocation({ map: map, msgEl: $('map-msg') });
      $('btn-locate-me').disabled = false;
    });
  }
  if ($('btn-locate-event')) {
    $('btn-locate-event').addEventListener('click', async () => {
      $('btn-locate-event').disabled = true;
      await ensureUserLocation({
        map: eventMap,
        msgEl: $('event-msg'),
        centerEventMap: true
      });
      $('btn-locate-event').disabled = false;
    });
  }
  if ($('btn-refresh-map')) {
    $('btn-refresh-map').addEventListener('click', async () => {
      $('btn-refresh-map').disabled = true;
      await refreshNearbyParties();
      updateMapMarkers({ fit: true });
      showMsg($('map-msg'), 'Map refreshed.', true);
      $('btn-refresh-map').disabled = false;
    });
  }

  function renderInfoPinDots() {
    $('info-pin-dots').querySelectorAll('span').forEach((d, i) => {
      d.classList.toggle('filled', i < infoPinDraft.length);
    });
  }

  function buildInfoPad() {
    const pad = $('info-pin-pad');
    pad.innerHTML = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    keys.forEach((k) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (!k) {
        b.style.visibility = 'hidden';
        pad.appendChild(b);
        return;
      }
      b.textContent = k;
      b.addEventListener('click', () => {
        if (k === '⌫') infoPinDraft = infoPinDraft.slice(0, -1);
        else if (infoPinDraft.length < 4) infoPinDraft += k;
        renderInfoPinDots();
        if (infoPinDraft.length === 4) {
          const expected = String(profile().businessPin || '');
          if (infoPinDraft === expected) {
            infoUnlocked = true;
            $('info-lock').classList.add('hidden');
            $('info-body').classList.remove('hidden');
            $('info-pin-msg').className = 'msg';
          } else {
            showMsg($('info-pin-msg'), 'Incorrect PIN.', false);
            infoPinDraft = '';
            renderInfoPinDots();
          }
        }
      });
      pad.appendChild(b);
    });
  }

  $('btn-lock-info').addEventListener('click', () => {
    infoUnlocked = false;
    infoPinDraft = '';
    $('info-body').classList.add('hidden');
    $('info-lock').classList.remove('hidden');
    renderInfoPinDots();
  });

  $('btn-logout').addEventListener('click', async () => {
    try {
      await BN.api('/api/web/auth/logout', { method: 'POST', body: {} });
    } catch (_) {}
    window.location.href = portalHref('index.html');
  });

  $('btn-edit-profile').addEventListener('click', () => {
    const p = profile();
    $('edit-name').value = p.businessName;
    $('edit-address').value = p.businessStreetAddress;
    $('edit-phone').value = p.businessContactPhone;
    $('edit-about').value = p.businessDescription;
    $('profile-edit').classList.toggle('hidden');
    $('verify-panel').classList.add('hidden');
  });

  $('btn-save-profile').addEventListener('click', async () => {
    const body = {
      accountType: 'business',
      displayName: $('edit-name').value.trim(),
      businessName: $('edit-name').value.trim(),
      businessStreetAddress: $('edit-address').value.trim(),
      businessContactPhone: BN.digits10($('edit-phone').value),
      businessDescription: $('edit-about').value.trim(),
      businessLatitude: profile().businessLatitude,
      businessLongitude: profile().businessLongitude,
      businessCategory: profile().businessCategory,
      businessHoursOpen: profile().businessHoursOpen,
      businessHoursClose: profile().businessHoursClose
    };
    try {
      await BN.api('/api/users/profile', { method: 'PUT', body });
      Object.keys(body).forEach((k) => BN.storeSet(k, body[k]));
      $('venue-title').textContent = body.businessName || 'Business Dashboard';
      showMsg($('profile-msg'), 'Profile saved.', true);
    } catch (err) {
      showMsg($('profile-msg'), err.message || 'Save failed.', false);
    }
  });

  $('btn-get-verified').addEventListener('click', () => {
    $('verify-panel').classList.toggle('hidden');
    $('profile-edit').classList.add('hidden');
  });

  $('btn-request-verify-info').addEventListener('click', async () => {
    if (!$('info-did-follow').checked) {
      showMsg($('verify-info-msg'), 'Confirm you followed @bttrnghts.', false);
      return;
    }
    try {
      await BN.api('/api/businesses/verification/request-follow', {
        method: 'POST',
        body: { businessName: profile().businessName }
      });
      BN.storeSet('businessVerificationStatus', 'pending');
      await refreshVerificationChip();
      showMsg($('verify-info-msg'), 'Request submitted.', true);
    } catch (err) {
      showMsg($('verify-info-msg'), err.message || 'Request failed.', false);
    }
  });

  async function loadLiveFromServer() {
    try {
      const list = await BN.api('/api/promotions');
      const rows = Array.isArray(list) ? list : list.list || list.promotions || [];
      const name = String(profile().businessName || '').toLowerCase();
      const mine = rows.find(
        (r) => r && String(r.businessName || '').toLowerCase() === name
      );
      if (mine) {
        livePromo = mine;
        if (mine.latitude != null && mine.longitude != null) {
          setEventPin(Number(mine.latitude), Number(mine.longitude), { silent: true });
        }
        renderLive();
        updateMapMarkers();
        syncEventMapMarkers();
      }
    } catch (_) {}
  }

  (async function init() {
    const me = await requireSession();
    if (!me) return;
    const p = profile();
    $('venue-title').textContent = p.businessName || 'Business Dashboard';
    $('venue-sub').textContent = [p.businessCategory, p.businessStreetAddress].filter(Boolean).join(' · ');
    $('ev-address').value = p.businessStreetAddress || '';
    defaultTimes();
    const savedPinLat = Number(BN.storeGet('eventPinLatitude', 0));
    const savedPinLng = Number(BN.storeGet('eventPinLongitude', 0));
    if (
      Number.isFinite(savedPinLat) &&
      Number.isFinite(savedPinLng) &&
      (Math.abs(savedPinLat) > 1e-6 || Math.abs(savedPinLng) > 1e-6)
    ) {
      eventPinPlaced = true;
    }
    const draft = BN.storeGet(draftKey(), null);
    if (draft) fillFormFromPromo(draft);
    buildInfoPad();
    initMap();
    initEventMap();
    await refreshOverview();
    await refreshVerificationChip();
    await loadLiveFromServer();
    renderPast();
    renderLive();

    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success' && params.get('session_id')) {
      await finishCheckoutPublish(params.get('session_id'));
      history.replaceState({}, '', 'app.html');
    } else if (params.get('checkout') === 'cancel') {
      showMsg($('event-msg'), 'Checkout canceled. Your draft is still saved.', false);
      setTab('event');
      history.replaceState({}, '', 'app.html');
    }
  })();
})();
