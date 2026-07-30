(function () {
  const $ = (id) => document.getElementById(id);
  const msg = $('auth-msg');
  let phoneVerificationToken = '';
  /** Keep the last auth error visible; don't let cooldown "wait" text wipe it. */
  let stickyError = '';

  function showMsg(text, ok) {
    msg.textContent = text || '';
    msg.className = 'msg show ' + (ok ? 'ok' : 'error');
    if (!ok && text) stickyError = text;
    if (ok) stickyError = '';
  }
  function clearMsg() {
    msg.className = 'msg';
    msg.textContent = '';
    stickyError = '';
  }

  function showFileBannerIfNeeded() {
    const banner = $('file-banner');
    if (!banner || !BN.isFileProtocol()) return;
    banner.classList.remove('hidden');
    banner.innerHTML =
      '<strong>Open over http://</strong> — browsers block API calls from <code>file://</code>. ' +
      'Run <code>Serve-Business-Portal.command</code> in the repo.';
  }

  function applyServerBackoff(err, kind) {
    // Don't start client cooldowns on plain bad password — that was overwriting the error.
    if (err && (err.code === 'INVALID_CREDENTIALS' || err.code === 'BUSINESS_REQUIRED')) return;
    if (err && err.retryAfterSec > 0 && window.BNAbuse) {
      BNAbuse.startCooldown(kind, err.retryAfterSec * 1000);
      return;
    }
    if (err && (err.status === 429 || err.code === 'ACCOUNT_LOCKED' || err.code === 'IP_LOCKED')) {
      if (window.BNAbuse) BNAbuse.bumpFailStreak(kind);
    }
  }

  function fillLocalDevLogin() {
    if (!(BN.cfg && BN.cfg.isLocalApi)) return;
    const phoneEl = $('login-phone');
    const passEl = $('login-password');
    if (phoneEl && !String(phoneEl.value || '').trim()) phoneEl.value = '5551234567';
    if (passEl && !String(passEl.value || '').trim()) passEl.value = 'betterlocal1';
    showMsg(
      'Local server ready — phone and password are filled in. Hit Sign in (Stripe works here).',
      true
    );
  }

  function portalHref(page) {
    if (BN.cfg && BN.cfg.isSameOriginProxy) {
      return page + (page.indexOf('?') >= 0 ? '&' : '?') + 'api=local';
    }
    return page;
  }

  async function bootstrap() {
    showFileBannerIfNeeded();
    if (BN.isFileProtocol()) return;
    // Stuck cooldowns from earlier attempts were blocking login + wiping errors.
    if (window.BNAbuse && BN.cfg && BN.cfg.isLocalApi) {
      BNAbuse.clearFailStreak('login');
      BNAbuse.clearFailStreak('signup');
      BNAbuse.clearFailStreak('otp');
      BNAbuse.clearLoggedOutProbe();
    }
    fillLocalDevLogin();
    if (window.BNAbuse && BNAbuse.shouldSkipMeProbe()) return;
    try {
      const me = await BN.api('/api/web/auth/me');
      if (me && me.ok) {
        if (window.BNAbuse) BNAbuse.clearLoggedOutProbe();
        const onboarded = BN.storeGet('onboardingComplete', false);
        window.location.href = portalHref(onboarded ? 'app.html' : 'onboarding.html');
      }
    } catch (err) {
      if (err && (err.status === 401 || err.status === 403)) {
        if (window.BNAbuse) BNAbuse.markLoggedOutProbe();
      }
    }
  }

  $('tab-login').addEventListener('click', () => {
    $('tab-login').classList.add('active');
    $('tab-signup').classList.remove('active');
    $('tab-login').setAttribute('aria-selected', 'true');
    $('tab-signup').setAttribute('aria-selected', 'false');
    $('form-login').classList.remove('hidden');
    $('form-signup').classList.add('hidden');
    clearMsg();
    fillLocalDevLogin();
  });
  $('tab-signup').addEventListener('click', () => {
    $('tab-signup').classList.add('active');
    $('tab-login').classList.remove('active');
    $('tab-signup').setAttribute('aria-selected', 'true');
    $('tab-login').setAttribute('aria-selected', 'false');
    $('form-signup').classList.remove('hidden');
    $('form-login').classList.add('hidden');
    clearMsg();
  });

  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg();
    if (BN.isFileProtocol()) {
      showMsg(BN.friendlyNetworkError(), false);
      return;
    }
    const phone = BN.digits10($('login-phone').value);
    const password = $('login-password').value;
    if (phone.length !== 10) {
      showMsg('Enter a valid 10-digit phone number.', false);
      return;
    }

    await BNAbuse.guardedAction(
      'login',
      $('login-submit'),
      async () => {
        try {
          const data = await BN.api('/api/web/auth/login', {
            method: 'POST',
            body: { phone, password }
          });
          if (data.csrfToken) BN.setCsrf(data.csrfToken);
          BNAbuse.clearFailStreak('login');
          BNAbuse.clearLoggedOutProbe();
          BN.storeSet('phone', phone);
          const onboarded = BN.storeGet('onboardingComplete', false);
          window.location.href = portalHref(onboarded ? 'app.html' : 'onboarding.html');
        } catch (err) {
          applyServerBackoff(err, 'login');
          let text = err.message || 'Sign in failed.';
          if (err.code === 'BUSINESS_REQUIRED') {
            text =
              'This phone is not a business account. Create a business account, or use a business login from the iOS app.';
          } else if (err.code === 'INVALID_CREDENTIALS' && BN.cfg && BN.cfg.isLocalApi) {
            text =
              'Wrong phone/password for the LOCAL server. Use the filled demo login (5551234567 / betterlocal1), or Create account. Your real Bttr Nghts password only works with ?api=production (Stripe needs local).';
          } else if (err.status === 429 || err.code === 'ACCOUNT_LOCKED' || err.code === 'IP_LOCKED') {
            const wait = err.retryAfterSec
              ? err.retryAfterSec + ' seconds'
              : BNAbuse.formatWait(BNAbuse.cooldownRemaining('login'));
            text = (err.message || 'Too many attempts.') + ' Try again in ' + wait + '.';
          }
          showMsg(text, false);
        }
      },
      (waitMs) => {
        // Keep the real error on screen; only note wait if there isn't one.
        if (stickyError) {
          msg.textContent = stickyError + ' (wait ' + BNAbuse.formatWait(waitMs) + ')';
          msg.className = 'msg show error';
          return;
        }
        showMsg('Please wait ' + BNAbuse.formatWait(waitMs) + ' before trying again.', false);
      }
    );
  });

  $('btn-send-otp').addEventListener('click', async () => {
    clearMsg();
    const phone = BN.digits10($('signup-phone').value);
    if (phone.length !== 10) {
      showMsg('Enter a valid 10-digit phone number.', false);
      return;
    }
    await BNAbuse.guardedAction(
      'otp',
      $('btn-send-otp'),
      async () => {
        try {
          await BN.api('/api/auth/request-otp', { method: 'POST', body: { phone } });
          BNAbuse.clearFailStreak('otp');
          BNAbuse.startCooldown('otp', 30_000);
          showMsg('Code sent. Check your texts. You can resend in 30 seconds.', true);
        } catch (err) {
          applyServerBackoff(err, 'otp');
          showMsg(err.message || 'Could not send code.', false);
        }
      },
      (waitMs) => {
        if (stickyError) return;
        showMsg('Please wait ' + BNAbuse.formatWait(waitMs) + ' before resending.', false);
      }
    );
  });

  $('form-signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg();
    const phone = BN.digits10($('signup-phone').value);
    const password = $('signup-password').value;
    const otp = String($('signup-otp').value || '').trim();
    if (phone.length !== 10) {
      showMsg('Enter a valid 10-digit phone number.', false);
      return;
    }
    if (password.length < 8) {
      showMsg('Password must be at least 8 characters.', false);
      return;
    }

    await BNAbuse.guardedAction(
      'signup',
      $('signup-submit'),
      async () => {
        try {
          // Local API: phone verification is off — skip OTP when token not required.
          if (!phoneVerificationToken && !(BN.cfg && BN.cfg.isLocalApi)) {
            const verified = await BN.api('/api/auth/verify-otp', {
              method: 'POST',
              body: { phone, code: otp }
            });
            phoneVerificationToken =
              (verified && (verified.phoneVerificationToken || verified.token)) || '';
            if (!phoneVerificationToken) {
              throw new Error('Phone verification did not return a token. Try sending the code again.');
            }
          }
          const data = await BN.api('/api/web/auth/create', {
            method: 'POST',
            body: {
              phone,
              password,
              phoneVerificationToken: phoneVerificationToken || undefined,
              accountType: 'business'
            }
          });
          if (data.csrfToken) BN.setCsrf(data.csrfToken);
          BNAbuse.clearFailStreak('signup');
          BNAbuse.clearLoggedOutProbe();
          BN.storeSet('phone', phone);
          BN.storeSet('onboardingComplete', false);
          window.location.href = portalHref('onboarding.html');
        } catch (err) {
          phoneVerificationToken = '';
          applyServerBackoff(err, 'signup');
          showMsg(err.message || 'Could not create account.', false);
        }
      },
      (waitMs) => {
        if (stickyError) return;
        showMsg('Please wait ' + BNAbuse.formatWait(waitMs) + ' before trying again.', false);
      }
    );
  });

  bootstrap();
})();
