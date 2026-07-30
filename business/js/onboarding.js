(function () {
  const $ = (id) => document.getElementById(id);
  let lat = 0;
  let lng = 0;
  let pinPlaced = false;
  let imageBase64 = '';
  let pin = '';
  let map;
  let marker;
  let userMarker;

  function showMsg(el, text, ok) {
    el.textContent = text || '';
    el.className = 'msg show ' + (ok ? 'ok' : 'error');
  }

  function showStep(id) {
    ['step-setup', 'step-verify', 'step-pin'].forEach((s) => {
      $(s).classList.toggle('hidden', s !== id);
    });
  }

  function portalHref(page) {
    if (BN.cfg && BN.cfg.isSameOriginProxy) {
      return page + (page.indexOf('?') >= 0 ? '&' : '?') + 'api=local';
    }
    return page;
  }

  async function requireSession() {
    try {
      const me = await BN.api('/api/web/auth/me');
      if (me.csrfToken) BN.setCsrf(me.csrfToken);
      return me;
    } catch {
      window.location.href = portalHref('index.html');
      return null;
    }
  }

  function setVenuePin(nextLat, nextLng) {
    lat = Number(nextLat);
    lng = Number(nextLng);
    pinPlaced = Number.isFinite(lat) && Number.isFinite(lng) && !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);
    if (!map || !pinPlaced) return;
    if (!marker) {
      marker = BNMap.marker('business', 'Your business').setLngLat([lng, lat]).addTo(map);
    } else {
      marker.setLngLat([lng, lat]);
    }
    $('coord-hint').textContent =
      'Business pin set: ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ' — street address still required below.';
  }

  function setUserPin(uLat, uLng) {
    if (!map || !Number.isFinite(uLat) || !Number.isFinite(uLng)) return;
    if (!userMarker) {
      userMarker = BNMap.marker('user', 'You').setLngLat([uLng, uLat]).addTo(map);
    } else {
      userMarker.setLngLat([uLng, uLat]);
    }
  }

  function initMap() {
    map = BNMap.createMap('map-pick', {
      center: [-123.0863, 44.0517],
      zoom: 13,
      cooperativeGestures: false,
      geolocate: true
    });
    if (!map) return;
    map.on('click', (e) => {
      setVenuePin(e.lngLat.lat, e.lngLat.lng);
      showMsg($('setup-msg'), 'Business pin placed. Make sure your street address is filled in too.', true);
    });
    map.on('bnuserlocation', (e) => {
      setUserPin(e.lat, e.lng);
      if (!pinPlaced) {
        map.easeTo({ center: [e.lng, e.lat], zoom: 14 });
      }
      showMsg($('setup-msg'), 'Showing your location (blue). Tap the map to place your business pin (green).', true);
    });
    map.on('bnuserlocationerror', (e) => {
      showMsg($('setup-msg'), e.error || 'Could not get your location.', false);
    });
    map.on('load', () => {
      map.resize();
    });
  }

  $('biz-about').addEventListener('input', () => {
    $('about-count').textContent = String($('biz-about').value.trim().length);
  });

  $('biz-photo').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 1_200_000) {
      showMsg($('setup-msg'), 'Image is too large. Use a smaller photo.', false);
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    imageBase64 = 'data:' + file.type + ';base64,' + btoa(binary);
  });

  function collectProfile() {
    const about = $('biz-about').value.trim();
    const name = $('biz-name').value.trim();
    const address = $('biz-address').value.trim();
    const phone = BN.digits10($('biz-phone').value);
    if (!name) {
      return { error: 'Business name is required.' };
    }
    if (!address || address.length < 8) {
      return { error: 'Street address is required (full street address, not just a city).' };
    }
    // Require something that looks like a street address (number + street text).
    if (!/\d/.test(address) || !/[a-zA-Z]{2,}/.test(address)) {
      return {
        error: 'Enter a full street address (e.g. 123 Main St). Map pin alone is not enough.'
      };
    }
    if (phone.length !== 10) {
      return { error: 'A valid 10-digit contact phone is required.' };
    }
    if (about.length < 100 || about.length > 250) {
      return { error: 'About your spot must be 100–250 characters.' };
    }
    if (!pinPlaced) {
      return {
        error: 'Tap the map to place your business pin. Address alone is not enough — both are required.'
      };
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { error: 'Business map pin is missing. Tap the map to place it.' };
    }
    return {
      profile: {
        accountType: 'business',
        displayName: name,
        businessName: name,
        businessCategory: $('biz-category').value,
        businessDescription: about,
        businessStreetAddress: address,
        businessLatitude: lat,
        businessLongitude: lng,
        businessContactPhone: phone,
        businessContactEmail: $('biz-email').value.trim(),
        businessWebsite: $('biz-website').value.trim(),
        businessInstagram: $('biz-ig').value.trim(),
        businessHoursOpen: $('biz-open').value,
        businessHoursClose: $('biz-close').value,
        businessImageBase64: imageBase64 || undefined
      }
    };
  }

  if ($('btn-locate-onboard')) {
    $('btn-locate-onboard').addEventListener('click', async () => {
      showMsg($('setup-msg'), 'Requesting your location… allow it in the browser popup.', true);
      const triggered = BNMap.triggerLocate(map);
      if (triggered) return;
      try {
        const loc = await BNMap.requestUserLocation();
        setUserPin(loc.lat, loc.lng);
        map.easeTo({ center: [loc.lng, loc.lat], zoom: 14 });
        showMsg($('setup-msg'), 'Showing your location (blue). Tap the map for your business pin (green).', true);
      } catch (err) {
        showMsg($('setup-msg'), err.message || 'Could not get location.', false);
      }
    });
  }

  $('btn-to-verify').addEventListener('click', async () => {
    const collected = collectProfile();
    if (collected.error) {
      showMsg($('setup-msg'), collected.error, false);
      return;
    }
    $('btn-to-verify').disabled = true;
    try {
      await BN.api('/api/users/profile', { method: 'PUT', body: collected.profile });
      Object.keys(collected.profile).forEach((k) => BN.storeSet(k, collected.profile[k]));
      showStep('step-verify');
    } catch (err) {
      showMsg($('setup-msg'), err.message || 'Could not save profile.', false);
    } finally {
      $('btn-to-verify').disabled = false;
    }
  });

  $('btn-request-verify').addEventListener('click', async () => {
    if (!$('did-follow').checked) {
      showMsg($('verify-msg'), 'Confirm you followed @bttrnghts first.', false);
      return;
    }
    try {
      await BN.api('/api/businesses/verification/request-follow', {
        method: 'POST',
        body: { businessName: BN.storeGet('businessName', '') }
      });
      BN.storeSet('businessVerificationStatus', 'pending');
      showMsg($('verify-msg'), 'Verification requested.', true);
    } catch (err) {
      showMsg($('verify-msg'), err.message || 'Request failed.', false);
    }
  });

  $('btn-to-pin').addEventListener('click', () => showStep('step-pin'));

  function renderDots() {
    $('pin-dots').querySelectorAll('span').forEach((d, i) => {
      d.classList.toggle('filled', i < pin.length);
    });
    $('btn-finish').disabled = pin.length !== 4;
  }

  function buildPad() {
    const pad = $('pin-pad');
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
        if (k === '⌫') pin = pin.slice(0, -1);
        else if (pin.length < 4) pin += k;
        renderDots();
      });
      pad.appendChild(b);
    });
  }

  $('btn-finish').addEventListener('click', async () => {
    if (pin.length !== 4) return;
    BN.storeSet('businessPin', pin);
    BN.storeSet('onboardingComplete', true);
    try {
      const collected = collectProfile();
      if (collected.profile) {
        await BN.api('/api/users/profile', {
          method: 'PUT',
          body: Object.assign({}, collected.profile, { businessPinSet: true })
        });
      }
    } catch (_) {}
    window.location.href = portalHref('app.html');
  });

  (async function init() {
    const me = await requireSession();
    if (!me) return;
    if (BN.storeGet('onboardingComplete', false) && BN.storeGet('businessName', '')) {
      window.location.href = portalHref('app.html');
      return;
    }
    buildPad();
    initMap();
    try {
      const prof = await BN.api('/api/users/profile');
      const p = (prof && prof.profile) || {};
      if (p.businessName) $('biz-name').value = p.businessName;
      if (p.businessStreetAddress) $('biz-address').value = p.businessStreetAddress;
      if (p.businessContactPhone) $('biz-phone').value = p.businessContactPhone;
      if (p.businessContactEmail) $('biz-email').value = p.businessContactEmail;
      if (p.businessWebsite) $('biz-website').value = p.businessWebsite;
      if (p.businessInstagram) $('biz-ig').value = p.businessInstagram;
      if (p.businessDescription) {
        $('biz-about').value = p.businessDescription;
        $('about-count').textContent = String(p.businessDescription.trim().length);
      }
      if (p.businessLatitude && p.businessLongitude) {
        map.once('load', () => {
          map.setCenter([Number(p.businessLongitude), Number(p.businessLatitude)]);
          setVenuePin(p.businessLatitude, p.businessLongitude);
        });
      }
    } catch (_) {}
  })();
})();
