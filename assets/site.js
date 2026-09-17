/* Rory site — waitlist capture + gentle scroll reveal.
   The waitlist form POSTs straight to Supabase PostgREST with the PUBLISHABLE (anon) key. That key is
   public by design — it also ships in the app — and the `waitlist` table's RLS is INSERT-only, so this
   key can add a signup but can never read the list back, enumerate emails, or edit anything.
   (Migration: supabase/migrations/0007_waitlist.sql in the app repo.) */

(function () {
  'use strict';

  var SUPABASE_URL = 'https://qvfpfxqygvschrobammn.supabase.co';
  var ANON_KEY = 'sb_publishable_0M93dPYeyzVkuqFFwA6w_A_4b6QkzyU';
  var ENDPOINT = SUPABASE_URL + '/rest/v1/waitlist';

  function emailLooksValid(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
  }

  function wire(form) {
    var input = form.querySelector('input[type=email]');
    var android = form.querySelector('input[type=checkbox]');
    var button = form.querySelector('button');
    var msg = form.querySelector('.msg');
    var source = form.getAttribute('data-source') || 'site';

    function say(text, kind) {
      if (!msg) return;
      msg.textContent = text;
      msg.className = 'msg' + (kind ? ' ' + kind : '');
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (input && input.value || '').trim();
      if (!emailLooksValid(email)) {
        say('Enter a valid email address.', 'err');
        if (input) input.focus();
        return;
      }
      if (button) button.disabled = true;
      say('One moment.', '');

      fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': 'Bearer ' + ANON_KEY,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          email: email,
          android_interest: !!(android && android.checked),
          source: source,
          user_agent: (navigator && navigator.userAgent || '').slice(0, 300)
        })
      })
        .then(function (res) {
          // 201 = added. 409 = already on the list (unique email) — treat as success, not an error.
          if (res.ok || res.status === 409) {
            form.classList.add('done');
            say('You are on the list. We write when there is something worth saying.', 'ok');
            return;
          }
          return res.text().then(function (t) {
            throw new Error(t || ('HTTP ' + res.status));
          });
        })
        .catch(function () {
          if (button) button.disabled = false;
          say('That did not go through. Try again, or email support@rorypoints.com.', 'err');
        });
    });
  }

  function init() {
    var forms = document.querySelectorAll('form.capture');
    for (var i = 0; i < forms.length; i++) wire(forms[i]);

    // Scroll reveal — subtle fade-up. Written to be fail-safe: content is only ever hidden while JS is
    // running (CSS gates the hidden state on html.js), and every path ends with the element revealed.
    var reveals = [].slice.call(document.querySelectorAll('.reveal'));
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reveals.length) return;

    if (reduce) { reveals.forEach(function (el) { el.classList.add('in'); }); return; }

    function revealInView() {
      var h = window.innerHeight || document.documentElement.clientHeight;
      for (var i = reveals.length - 1; i >= 0; i--) {
        var el = reveals[i];
        var top = el.getBoundingClientRect().top;
        if (top < h * 0.92) { el.classList.add('in'); reveals.splice(i, 1); }
      }
    }
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () { revealInView(); ticking = false; });
    }
    revealInView();                       // reveal whatever is already in view on load
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Safety net: nothing stays invisible for more than 1.5s regardless of scroll/JS timing.
    window.setTimeout(function () { reveals.forEach(function (el) { el.classList.add('in'); }); }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
