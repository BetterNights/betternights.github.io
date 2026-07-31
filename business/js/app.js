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
  let planningAhead = false;
  let infoUnlocked = false;
  let infoPinDraft = '';
  let mapReady = false;
  let eventMapReady = false;
  let scheduledOccurrences = [];
  let unitAmountCents = 799;
  let calCursor = new Date();
  calCursor.setDate(1);
  calCursor.setHours(12, 0, 0, 0);
  let previewWindows = [];
  let pendingSeriesId = null;
  let customScheduleDates = [];
  let scheduledExpanded = false;
  let realtimeClient = null;

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
    // If tonight's default window is already over, roll to tomorrow.
    const endProbe = new Date(start.getTime() + 5 * 60 * 60 * 1000);
    if (endProbe.getTime() <= Date.now()) {
      start.setDate(start.getDate() + 1);
    }
    const end = new Date(start.getTime() + 5 * 60 * 60 * 1000);
    $('ev-start').value = toLocalInput(start);
    $('ev-end').value = toLocalInput(end);
  }

  function appPathClean() {
    return portalHref('app.html');
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
    if (name === 'overview' || name === 'schedule') name = 'map';
    document.querySelectorAll('.app-nav button[data-tab]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
    if (name === 'map' && map) {
      setTimeout(() => {
        map.resize();
        updateMapMarkers({ fit: false });
      }, 80);
      refreshNearbyParties();
    }
    if (name === 'event' && eventMap) {
      setTimeout(() => {
        eventMap.resize();
        syncEventMapMarkers();
      }, 80);
    }
    if (name === 'event') {
      renderScheduledSection();
    }
    if (name === 'info' && !infoUnlocked) {
      infoPinDraft = '';
      renderInfoPinDots();
    }
  }

  document.querySelectorAll('.app-nav button[data-tab]').forEach((b) => {
    b.addEventListener('click', () => setTab(b.getAttribute('data-tab')));
  });

  async function refreshOverview() {
    try {
      const h = await BN.api('/api/health?detailed=1');
      $('stat-parties').textContent = String(h.parties != null ? h.parties : '—');
      $('stat-hazards').textContent = String(h.hazards != null ? h.hazards : '—');
      showMsg($('overview-msg'), '', true);
      if ($('overview-msg')) $('overview-msg').className = 'msg';
    } catch (err) {
      if ($('stat-parties').textContent === '—' || $('stat-hazards').textContent === '—') {
        showMsg($('overview-msg'), 'Live activity is unavailable right now.', false);
      }
    }
  }

  function setLiveFeedStatus(healthy) {
    const el = $('live-feed-status');
    if (!el) return;
    el.textContent = healthy ? 'Live updates on' : 'Connecting live updates…';
    el.classList.toggle('is-live', !!healthy);
  }

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
      $('btn-schedule-pay').classList.remove('hidden');
      $('schedule-box').classList.remove('hidden');
      $('btn-save-edit').classList.add('hidden');
      $('editor-title').textContent = 'New event';
      editingLive = false;
      planningAhead = false;
      return;
    }
    $('event-live').classList.remove('hidden');
    $('live-headline').textContent = livePromo.headline || 'Live event';
    $('live-body').textContent = livePromo.body || '';
    const start = livePromo.startAt ? new Date(livePromo.startAt).toLocaleString() : '';
    const end = livePromo.endAt ? new Date(livePromo.endAt).toLocaleString() : '';
    $('live-meta').textContent = [start, end].filter(Boolean).join(' → ');
    if (planningAhead) {
      $('event-editor').classList.remove('hidden');
      $('btn-start-event').classList.add('hidden');
      $('btn-save-edit').classList.add('hidden');
      $('btn-schedule-pay').classList.remove('hidden');
      $('schedule-box').classList.remove('hidden');
      $('editor-title').textContent = 'Schedule upcoming nights';
      return;
    }
    if (!editingLive) {
      $('event-editor').classList.add('hidden');
    }
  }

  function money(cents) {
    const n = Number(cents);
    if (!Number.isFinite(n)) return '$—';
    return '$' + (n / 100).toFixed(2);
  }

  function scheduleDraftKey() {
    return 'promoScheduleDraft';
  }

  function maxCountForRecurrence(recurrence) {
    if (recurrence === 'weekly') return 52;
    if (recurrence === 'monthly') return 24;
    if (recurrence === 'annually') return 5;
    if (recurrence === 'custom') return 10;
    return 1;
  }

  function addMonthsClamped(date, months) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d;
  }

  function parseCustomDateLines(text, startIso, endIso) {
    // Legacy fallback if a string is passed; prefer customScheduleDates.
    void text;
    return buildCustomWindows(startIso, endIso);
  }

  function ymdLocal(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function buildCustomWindows(startIso, endIso) {
    const start0 = new Date(startIso);
    const end0 = new Date(endIso);
    if (Number.isNaN(start0.getTime()) || Number.isNaN(end0.getTime()) || end0 <= start0) return [];
    const durationMs = end0.getTime() - start0.getTime();
    const localParts = String($('ev-start') && $('ev-start').value ? $('ev-start').value : '').match(
      /T(\d{2}):(\d{2})/
    );
    const hour = localParts ? Number(localParts[1]) : start0.getHours();
    const minute = localParts ? Number(localParts[2]) : start0.getMinutes();
    const out = [];
    const seen = new Set();
    for (const dayStr of customScheduleDates) {
      const m = String(dayStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) continue;
      const localStart = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute, 0, 0);
      if (Number.isNaN(localStart.getTime())) continue;
      const iso = localStart.toISOString();
      if (seen.has(iso)) continue;
      seen.add(iso);
      out.push({
        startAt: iso,
        endAt: new Date(localStart.getTime() + durationMs).toISOString()
      });
      if (out.length >= 10) break;
    }
    return out;
  }

  function renderCustomDatesEditor() {
    const list = $('ev-custom-dates-list');
    if (!list) return;
    list.innerHTML = '';
    customScheduleDates.forEach((day, index) => {
      const row = document.createElement('div');
      row.className = 'custom-date-row';
      const input = document.createElement('input');
      input.type = 'date';
      input.value = day;
      input.addEventListener('change', () => {
        customScheduleDates[index] = input.value;
        updateSchedulePreview();
      });
      row.appendChild(input);
      if (customScheduleDates.length > 1) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn btn-ghost btn-inline';
        rm.textContent = 'Remove';
        rm.addEventListener('click', () => {
          customScheduleDates.splice(index, 1);
          renderCustomDatesEditor();
          updateSchedulePreview();
        });
        row.appendChild(rm);
      }
      list.appendChild(row);
    });
  }

  function ensureCustomDatesSeeded() {
    if (!customScheduleDates.length) {
      const startAt = safeIsoFromInput($('ev-start'));
      const d = startAt ? new Date(startAt) : new Date();
      customScheduleDates = [ymdLocal(Number.isNaN(d.getTime()) ? new Date() : d)];
    }
    renderCustomDatesEditor();
  }

  function expandLocalWindows(startIso, endIso, recurrence, count, customWindows) {
    if (recurrence === 'custom') {
      return Array.isArray(customWindows) ? customWindows.slice(0, 10) : [];
    }
    const start0 = new Date(startIso);
    const end0 = new Date(endIso);
    if (Number.isNaN(start0.getTime()) || Number.isNaN(end0.getTime()) || end0 <= start0) {
      return [];
    }
    const durationMs = end0.getTime() - start0.getTime();
    const rec = recurrence === 'once' ? 'once' : recurrence;
    const max = maxCountForRecurrence(rec);
    const n = Math.min(Math.max(1, Math.floor(Number(count) || 1)), max);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      let start;
      if (i === 0) start = new Date(start0.getTime());
      else if (rec === 'weekly') {
        start = new Date(start0.getTime());
        start.setDate(start.getDate() + 7 * i);
      } else if (rec === 'monthly') start = addMonthsClamped(start0, i);
      else if (rec === 'annually') start = addMonthsClamped(start0, i * 12);
      else break;
      out.push({
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + durationMs).toISOString()
      });
    }
    return out;
  }

  function formatWindowLabel(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function updateSchedulePreview() {
    const repeatEl = $('ev-repeat');
    const countEl = $('ev-count');
    const countWrap = $('ev-count-wrap');
    const customWrap = $('ev-custom-dates-wrap');
    if (!repeatEl || !countEl) return;
    const recurrence = repeatEl.value || 'once';
    const max = maxCountForRecurrence(recurrence);
    const isCustom = recurrence === 'custom';
    if (countWrap) countWrap.hidden = isCustom;
    if (customWrap) customWrap.hidden = !isCustom;
    if (isCustom) ensureCustomDatesSeeded();
    countEl.max = String(max);
    if (recurrence === 'once' || isCustom) {
      countEl.disabled = true;
      countEl.value = '1';
    } else {
      countEl.disabled = false;
      let n = Math.floor(Number(countEl.value) || 1);
      if (n < 1) n = 1;
      if (n > max) n = max;
      countEl.value = String(n);
    }
    const startAt = safeIsoFromInput($('ev-start'));
    const endAt = safeIsoFromInput($('ev-end'));
    const customWindows = isCustom && startAt && endAt ? buildCustomWindows(startAt, endAt) : null;
    const count = isCustom ? (customWindows ? customWindows.length : 0) : Number(countEl.value) || 1;

    // Prefer server expand so client/server stay aligned.
    if (startAt && endAt && (!isCustom || (customWindows && customWindows.length))) {
      BN.api('/api/web/promotions/schedule/preview', {
        method: 'POST',
        body: {
          startAt,
          endAt,
          recurrence,
          count: Math.max(1, count),
          windows: customWindows || undefined
        },
        timeoutMs: 12000
      })
        .then((res) => {
          if (res.unitAmountCents != null) unitAmountCents = Number(res.unitAmountCents) || unitAmountCents;
          previewWindows = Array.isArray(res.windows) ? res.windows : [];
          renderSchedulePreviewUi(res.firstWindowValid !== false, res.firstWindowError || '', isCustom);
        })
        .catch(() => {
          previewWindows = expandLocalWindows(startAt, endAt, recurrence, count, customWindows);
          renderSchedulePreviewUi(true, '', isCustom);
        });
      return;
    }
    previewWindows = [];
    renderSchedulePreviewUi(true, isCustom ? 'Add at least one custom date.' : '', isCustom);
  }

  function shortPreviewChip(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric' });
  }

  function renderSchedulePreviewUi(firstOk, firstErr, isCustom) {
    const count =
      isCustom
        ? previewWindows.length || customScheduleDates.length || 1
        : previewWindows.length || Number(($('ev-count') && $('ev-count').value) || 1);
    const total = unitAmountCents * Math.max(1, count);
    $('schedule-price-hint').textContent =
      count +
      ' event' +
      (count === 1 ? '' : 's') +
      ' × ' +
      money(unitAmountCents) +
      ' = ' +
      money(total) +
      (count > 1 ? ' · paid up front' : '');
    const preview = $('schedule-preview');
    preview.innerHTML = '';
    if (isCustom) {
      if (!firstOk && firstErr) {
        const warn = document.createElement('p');
        warn.className = 'hint';
        warn.style.color = '#ffb4af';
        warn.textContent = firstErr;
        preview.appendChild(warn);
      }
      return;
    }
    if (!previewWindows.length) {
      preview.innerHTML = '<p class="hint">Pick valid start and end times to preview dates.</p>';
      return;
    }
    if (!firstOk && firstErr) {
      const warn = document.createElement('p');
      warn.className = 'hint';
      warn.style.color = '#ffb4af';
      warn.textContent = firstErr;
      preview.appendChild(warn);
    }
    const strip = document.createElement('div');
    strip.className = 'sched-pill-strip';
    previewWindows.slice(0, 10).forEach((w) => {
      const pill = document.createElement('span');
      pill.className = 'sched-pill';
      pill.textContent = shortPreviewChip(w.startAt);
      strip.appendChild(pill);
    });
    if (previewWindows.length > 10) {
      const more = document.createElement('span');
      more.className = 'sched-pill sched-pill-more';
      more.textContent = '+' + (previewWindows.length - 10);
      strip.appendChild(more);
    }
    preview.appendChild(strip);
  }

  function validatePromoForPay(promo) {
    if (!promo.headline) {
      showMsg($('event-msg'), 'Add a headline.', false);
      return false;
    }
    if (!eventPinPlaced || !eventPinCoords()) {
      showMsg(
        $('event-msg'),
        'Place the party on the map below (tap to set the lavender pin). Your location (blue) and business (green) should also be visible.',
        false
      );
      return false;
    }
    if (promo.latitude == null || promo.longitude == null) {
      showMsg($('event-msg'), 'Event map pin is missing. Tap the map to place the party.', false);
      return false;
    }
    return true;
  }

  async function refreshSchedule() {
    try {
      const res = await BN.api('/api/web/promotions/schedule');
      scheduledOccurrences = Array.isArray(res.occurrences) ? res.occurrences : [];
      if (res.unitAmountCents != null) unitAmountCents = Number(res.unitAmountCents) || unitAmountCents;
      renderScheduledSection();
      updateSchedulePreview();
      showMsg($('schedule-msg'), '', true);
      if ($('schedule-msg')) $('schedule-msg').className = 'msg';
    } catch (err) {
      showMsg($('schedule-msg'), (err && err.message) || 'Could not load schedule.', false);
    }
  }

  function upcomingScheduled() {
    return scheduledOccurrences
      .filter((o) => o && (o.status === 'scheduled' || o.status === 'live'))
      .slice()
      .sort((a, b) => String(a.startAt || '').localeCompare(String(b.startAt || '')));
  }

  function renderScheduledSection() {
    const section = $('scheduled-events-section');
    const body = $('scheduled-events-body');
    const countEl = $('scheduled-count');
    const bar = $('btn-toggle-scheduled');
    const upcoming = upcomingScheduled();
    if (!section) return;
    if (!upcoming.length) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    if (countEl) countEl.textContent = String(upcoming.length);
    if (body) body.classList.toggle('hidden', !scheduledExpanded);
    if (bar) {
      bar.setAttribute('aria-expanded', scheduledExpanded ? 'true' : 'false');
      bar.classList.toggle('is-open', scheduledExpanded);
    }
    renderCalendar();
    renderScheduleList();
  }

  function renderScheduleList() {
    const el = $('schedule-list');
    if (!el) return;
    el.innerHTML = '';
    const upcoming = upcomingScheduled();
    if (!upcoming.length) {
      el.innerHTML = '';
      return;
    }
    upcoming.forEach((o) => {
      const card = document.createElement('div');
      card.className = 'schedule-item';
      const status = String(o.status || 'scheduled');
      card.innerHTML =
        '<div class="si-top"><span class="si-title"></span><span class="si-status ' +
        status +
        '"></span></div><p class="si-meta"></p>';
      card.querySelector('.si-title').textContent = o.headline || 'Event';
      card.querySelector('.si-status').textContent = status;
      card.querySelector('.si-meta').textContent =
        formatWindowLabel(o.startAt) + (o.endAt ? ' → ' + formatWindowLabel(o.endAt) : '');
      if (status === 'scheduled') {
        const actions = document.createElement('div');
        actions.className = 'si-actions btn-row';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-ghost btn-inline';
        cancel.textContent = 'Cancel this night';
        cancel.addEventListener('click', async () => {
          if (!window.confirm('Cancel this scheduled night? Payment is not refunded automatically.')) return;
          try {
            await BN.api('/api/web/promotions/schedule/' + encodeURIComponent(o.id), {
              method: 'DELETE'
            });
            await refreshSchedule();
            showMsg($('schedule-msg'), 'Night cancelled.', true);
          } catch (err) {
            showMsg($('schedule-msg'), (err && err.message) || 'Could not cancel.', false);
          }
        });
        actions.appendChild(cancel);
        card.appendChild(actions);
      }
      el.appendChild(card);
    });
  }

  function renderCalendar() {
    const grid = $('cal-grid');
    const label = $('cal-month-label');
    if (!grid || !label) return;
    const year = calCursor.getFullYear();
    const month = calCursor.getMonth();
    label.textContent = calCursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    grid.innerHTML = '';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => {
      const h = document.createElement('div');
      h.className = 'cal-dow';
      h.textContent = d;
      grid.appendChild(h);
    });
    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const byDay = {};
    scheduledOccurrences.forEach((o) => {
      if (!o || !o.startAt) return;
      const d = new Date(o.startAt);
      if (Number.isNaN(d.getTime())) return;
      if (d.getFullYear() !== year || d.getMonth() !== month) return;
      const key = d.getDate();
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(o);
    });
    for (let i = 0; i < startPad; i += 1) {
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      grid.appendChild(cell);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell in-month';
      if (
        today.getFullYear() === year &&
        today.getMonth() === month &&
        today.getDate() === day
      ) {
        cell.classList.add('today');
      }
      const events = byDay[day] || [];
      if (events.length) cell.classList.add('has-events');
      let primary = '';
      events.forEach((e) => {
        const s = String(e.status || 'scheduled');
        if (!primary) primary = s;
        else if (s === 'live') primary = 'live';
      });
      if (primary === 'live') cell.classList.add('mark-live');
      else if (primary === 'scheduled') cell.classList.add('mark-scheduled');
      else if (events.length) cell.classList.add('mark-done');
      const dayNum = document.createElement('span');
      dayNum.className = 'cal-day-num';
      dayNum.textContent = String(day);
      cell.appendChild(dayNum);
      if (events.length) {
        cell.title = events
          .map((e) => (e.headline || 'Event') + ' (' + (e.status || '') + ')')
          .join('\n');
        cell.addEventListener('click', () => {
          const lines = events
            .map(
              (e) =>
                '• ' +
                (e.headline || 'Event') +
                ' — ' +
                formatWindowLabel(e.startAt) +
                ' (' +
                (e.status || '') +
                ')'
            )
            .join('\n');
          showMsg($('schedule-msg'), lines, true);
        });
      }
      grid.appendChild(cell);
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
        $('btn-schedule-pay').classList.remove('hidden');
        $('schedule-box').classList.remove('hidden');
        $('btn-save-edit').classList.add('hidden');
        setTab('event');
        updateSchedulePreview();
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
    if (!validatePromoForPay(promo)) return;
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
          body: { promotionId: promo.id, businessName: promo.businessName, quantity: 1 },
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

  $('btn-schedule-pay').addEventListener('click', async () => {
    updateSchedulePreview();
    // Give preview a tick to refresh from server when possible.
    await new Promise((r) => setTimeout(r, 80));
    const promo = buildPromoFromForm();
    if (!validatePromoForPay(promo)) return;
    const recurrence = ($('ev-repeat') && $('ev-repeat').value) || 'once';
    const startAt = promo.startAt;
    const endAt = promo.endAt;
    const customWindows = recurrence === 'custom' ? buildCustomWindows(startAt, endAt) : null;
    const count =
      recurrence === 'custom'
        ? (customWindows && customWindows.length) || 0
        : Number(($('ev-count') && $('ev-count').value) || 1);
    let windows = previewWindows.slice();
    if (!windows.length) {
      windows = expandLocalWindows(startAt, endAt, recurrence, count, customWindows);
    }
    if (!windows.length) {
      showMsg(
        $('event-msg'),
        recurrence === 'custom'
          ? 'Add at least one custom date.'
          : 'Pick valid start/end times for the schedule.',
        false
      );
      return;
    }
    const seriesId = BN.uuid();
    pendingSeriesId = seriesId;
    const promoForServer = Object.assign({}, promo, { id: seriesId });
    const scheduleDraft = {
      seriesId,
      recurrence,
      count: windows.length,
      windows,
      startAt: promo.startAt,
      endAt: promo.endAt,
      promotion: (() => {
        const slim = Object.assign({}, promoForServer);
        delete slim.inviteImageBase64;
        return slim;
      })()
    };
    try {
      BN.storeSet(scheduleDraftKey(), scheduleDraft);
      BN.storeSet(draftKey(), scheduleDraft.promotion);
    } catch (_) {}

    $('btn-schedule-pay').disabled = true;
    showMsg(
      $('event-msg'),
      'Starting checkout for ' + windows.length + ' event' + (windows.length === 1 ? '' : 's') + '…',
      true
    );
    try {
      let checkout = null;
      try {
        checkout = await BN.api('/api/web/promotions/checkout', {
          method: 'POST',
          body: {
            promotionId: seriesId,
            seriesId,
            businessName: promo.businessName,
            quantity: windows.length,
            kind: 'business_promotion_schedule',
            recurrence,
            startAt: promo.startAt,
            endAt: promo.endAt,
            promotion: promoForServer
          },
          timeoutMs: 20000
        });
      } catch (err) {
        const stripeMissing =
          err && (err.code === 'STRIPE_NOT_CONFIGURED' || err.status === 503);
        if (stripeMissing && BN.cfg && BN.cfg.isLocalApi) {
          checkout = null;
        } else if (stripeMissing) {
          showMsg(
            $('event-msg'),
            'Card checkout is not set up on the API yet. Add STRIPE_SECRET_KEY on the server, then redeploy.',
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
      const created = await BN.api('/api/web/promotions/schedule', {
        method: 'POST',
        body: {
          seriesId,
          promotion: promoForServer,
          recurrence,
          count: windows.length,
          startAt: promo.startAt,
          endAt: promo.endAt,
          windows: recurrence === 'custom' ? windows : undefined
        }
      });
      BN.storeRemove(scheduleDraftKey());
      scheduledOccurrences =
        (created.all && created.all.occurrences) || created.occurrences || [];
      planningAhead = false;
      await loadLiveFromServer();
      setTab('event');
      scheduledExpanded = true;
      renderScheduledSection();
      showMsg(
        $('event-msg'),
        'Scheduled ' + windows.length + ' night(s)' + (BN.cfg && BN.cfg.isLocalApi ? ' (local unpaid).' : '.'),
        true
      );
    } catch (err) {
      showMsg($('event-msg'), err.message || 'Could not schedule events.', false);
    } finally {
      $('btn-schedule-pay').disabled = false;
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

  async function finishScheduleCheckout(sessionId) {
    const draft = BN.storeGet(scheduleDraftKey(), null);
    const seriesId = (draft && draft.seriesId) || BN.storeGet('pendingPublishId', '') || '';
    let promotion = draft && draft.promotion ? Object.assign({}, draft.promotion) : null;
    // Re-attach venue image stripped from localStorage draft.
    if (promotion) {
      const img = profile().businessImageBase64;
      if (img && !promotion.inviteImageBase64) promotion.inviteImageBase64 = img;
    }
    try {
      const body = {
        seriesId: seriesId || (promotion && promotion.id) || undefined,
        stripeCheckoutSessionId: sessionId,
        recurrence: draft && draft.recurrence,
        count: draft && draft.count,
        startAt: draft && draft.startAt,
        endAt: draft && draft.endAt,
        windows: draft && draft.windows
      };
      if (promotion) body.promotion = promotion;
      const created = await BN.api('/api/web/promotions/schedule', {
        method: 'POST',
        body
      });
      BN.storeRemove(scheduleDraftKey());
      scheduledOccurrences =
        (created.all && created.all.occurrences) || created.occurrences || [];
      planningAhead = false;
      await loadLiveFromServer();
      const n = (created.occurrences && created.occurrences.length) || (draft && draft.count) || 0;
      showMsg(
        $('event-msg'),
        'Payment received — ' + n + ' night' + (n === 1 ? '' : 's') + ' scheduled.',
        true
      );
      setTab('event');
      scheduledExpanded = true;
      renderScheduledSection();
    } catch (err) {
      showMsg(
        $('event-msg'),
        err.message || 'Paid, but scheduling failed. Try again or contact support.',
        false
      );
      setTab('event');
    }
  }

  $('btn-edit-live').addEventListener('click', () => {
    if (!livePromo) return;
    editingLive = true;
    planningAhead = false;
    fillFormFromPromo(livePromo);
    $('event-editor').classList.remove('hidden');
    $('btn-start-event').classList.add('hidden');
    $('btn-schedule-pay').classList.add('hidden');
    $('schedule-box').classList.add('hidden');
    $('btn-save-edit').classList.remove('hidden');
    $('editor-title').textContent = 'Edit live event';
  });

  function openPlanAheadEditor() {
    planningAhead = true;
    editingLive = false;
    if (livePromo) fillFormFromPromo(livePromo);
    defaultTimes();
    // Nudge first night to next week so it doesn't collide with a live pin tonight.
    const start = new Date();
    start.setDate(start.getDate() + 7);
    start.setMinutes(0, 0, 0);
    start.setHours(21);
    const end = new Date(start.getTime() + 5 * 60 * 60 * 1000);
    $('ev-start').value = toLocalInput(start);
    $('ev-end').value = toLocalInput(end);
    if ($('ev-repeat')) $('ev-repeat').value = 'weekly';
    if ($('ev-count')) {
      $('ev-count').disabled = false;
      $('ev-count').value = '4';
    }
    renderLive();
    updateSchedulePreview();
    setTab('event');
  }

  if ($('btn-plan-ahead')) {
    $('btn-plan-ahead').addEventListener('click', openPlanAheadEditor);
  }

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
      geolocate: true,
      // Allow wheel zoom without holding ⌘/Ctrl (MapLibre default cooperative gestures).
      cooperativeGestures: false
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
    // View-only: party pin moves only on the Event editor map (iOS Map tab parity).
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
      livePromo = mine || null;
      if (mine && mine.latitude != null && mine.longitude != null) {
        setEventPin(Number(mine.latitude), Number(mine.longitude), { silent: true });
      }
      renderLive();
      updateMapMarkers();
      syncEventMapMarkers();
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
    await refreshSchedule();
    renderPast();
    renderLive();
    updateSchedulePreview();

    if (window.BNRealtime && BNRealtime.createRealtime) {
      realtimeClient = BNRealtime.createRealtime({
        onStatus: setLiveFeedStatus,
        onFeedChanged: async () => {
          await refreshOverview();
          await refreshNearbyParties();
          updateMapMarkers({ fit: false });
        }
      });
      realtimeClient.start();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      refreshOverview();
      refreshSchedule();
      if (realtimeClient) realtimeClient.start();
    });

    if ($('btn-toggle-scheduled')) {
      $('btn-toggle-scheduled').addEventListener('click', () => {
        scheduledExpanded = !scheduledExpanded;
        renderScheduledSection();
      });
    }
    if ($('btn-add-custom-date')) {
      $('btn-add-custom-date').addEventListener('click', () => {
        if (customScheduleDates.length >= 10) return;
        const last = customScheduleDates[customScheduleDates.length - 1];
        let next = new Date();
        if (last) {
          const m = String(last).match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (m) next = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1);
        }
        customScheduleDates.push(ymdLocal(next));
        renderCustomDatesEditor();
        updateSchedulePreview();
      });
    }

    ['ev-start', 'ev-end', 'ev-repeat', 'ev-count'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', updateSchedulePreview);
      el.addEventListener('input', updateSchedulePreview);
    });
    if ($('btn-cal-prev')) {
      $('btn-cal-prev').addEventListener('click', () => {
        calCursor.setMonth(calCursor.getMonth() - 1);
        renderCalendar();
      });
    }
    if ($('btn-cal-next')) {
      $('btn-cal-next').addEventListener('click', () => {
        calCursor.setMonth(calCursor.getMonth() + 1);
        renderCalendar();
      });
    }
    if ($('btn-goto-new-schedule')) {
      $('btn-goto-new-schedule').addEventListener('click', () => {
        if (livePromo) openPlanAheadEditor();
        else {
          planningAhead = false;
          editingLive = false;
          renderLive();
          $('event-editor').classList.remove('hidden');
          setTab('event');
        }
      });
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success' && params.get('session_id')) {
      await finishCheckoutPublish(params.get('session_id'));
      history.replaceState({}, '', appPathClean());
    } else if (params.get('checkout') === 'schedule_success' && params.get('session_id')) {
      await finishScheduleCheckout(params.get('session_id'));
      history.replaceState({}, '', appPathClean());
    } else if (params.get('checkout') === 'cancel' || params.get('checkout') === 'schedule_cancel') {
      showMsg($('event-msg'), 'Checkout canceled. Your draft is still saved.', false);
      setTab('event');
      history.replaceState({}, '', appPathClean());
    }
  })();
})();
