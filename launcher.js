/* MERCHANT VISIT ACTIVITY - LAUNCHER
   1. Opens the Apps Script form (config.js) inside this page with Telegram's verified sign-in data.
   2. Watches the loading: a slow or lost connection shows "Try again" instead of a blank screen.
   3. "Use my location" (POS & Sound Box): the form runs inside Google's frames and cannot hear Telegram,
      so it asks this page; this page asks Telegram (8.0 or later) and passes the answer back.
   4. Light / Dark mode: the form tells this page its colours, and Telegram's top bar (the clock area) follows; wherever
      the page runs under the clock (Telegram full-screen, Safari, Home Screen) the form's navy header grows to cover it.
   5. While the form loads: the sign-in page's own logo breathes softly (no plain spinner), then glides into the sign-in
      page's logo when the form is ready (an older form: it fades out).
   6. (v16) Saves this page on the phone (sw.js) so the next open shows the logo at once, even on a weak connection.
      Only this page's own files and Telegram's script are kept; the form itself (Google) is never stored. */
(function () {
  'use strict';
  var cfg = window.MV_CONFIG || {}, start = window.MV_START || { search: '', hash: '' };
  var APP_URL = String(cfg.APP_URL || '').trim();
  var frame = document.getElementById('app');
  if (!/^https:\/\/script\.google\.com\/(a\/macros\/[^\/]+\/|macros\/)s\/[\w-]+\/exec$/.test(APP_URL)) {
    frame.parentNode.removeChild(frame);
    document.getElementById('ld').className = 'hidden';
    var d = document.createElement('div'); d.className = 'msg';
    var b = document.createElement('b'); b.textContent = 'Setup needed';
    d.appendChild(b); d.appendChild(document.createElement('br'));
    d.appendChild(document.createTextNode('Open config.js and paste your Web app link (ending with /exec) into APP_URL.'));
    document.body.appendChild(d);
    return;
  }
  // only the parts of the address the form needs: ?t=… (one-time link) and Telegram's data
  var search = '';
  try {
    var q = new URLSearchParams(start.search), keep = new URLSearchParams();
    ['t', 'tgWebAppStartParam'].forEach(function (k) { var v = q.get(k); if (v && v.length <= 800) keep.set(k, v); });
    search = keep.toString() ? '?' + keep.toString() : '';
  } catch (e) { search = ''; }
  var hash = /^#tgWebApp/.test(start.hash) ? start.hash : '';
  var tg = window.Telegram && window.Telegram.WebApp;
  try {
    if (tg && tg.initData) {                                             // signed by Telegram; checked again by the server
      hash = '#tgWebAppData=' + encodeURIComponent(tg.initData) +
        '&tgWebAppVersion=' + encodeURIComponent(tg.version || '') +
        '&tgWebAppPlatform=' + encodeURIComponent(tg.platform || '');
    }
    if (tg) { tg.ready(); tg.expand(); }
    try { var last = JSON.parse(localStorage.getItem('mva_bars') || 'null'); if (last) setBars(last.bar, last.bg); else setBars('#0B3D5C', '#F2F5F8'); } catch (e) { setBars('#0B3D5C', '#F2F5F8'); }
  } catch (e) { /* not opened inside Telegram - the form still works with Staff ID + PIN */ }
  var SRC = APP_URL + search + hash;

  // ---- Telegram's top bar (clock area) and background in the form's colours: navy in Light mode, graphite in Dark mode
  function setBars(bar, bg) {
    var HEX = /^#[0-9A-Fa-f]{6}$/;
    if (!HEX.test(bar || '') || !HEX.test(bg || '')) return;
    document.documentElement.style.background = bg; document.body.style.background = bg;     // (v11) behind the form: the page colour (the form's own header covers the clock area)
    var lb = document.getElementById('ldbg'); if (lb) lb.style.background = bg;      // the loading screen in the form's colour
    var lum = parseInt(bg.substr(1, 2), 16) * .299 + parseInt(bg.substr(3, 2), 16) * .587 + parseInt(bg.substr(5, 2), 16) * .114;
    document.documentElement.classList.toggle('dk', lum < 100);       // the loading logo's text follows Light / Dark
    try { localStorage.setItem('mva_bars', JSON.stringify({ bar: bar, bg: bg })); } catch (e) { /* private mode */ }
    if (!tg) return;
    try { if (tg.setHeaderColor) tg.setHeaderColor(bar); } catch (e) { /* older Telegram */ }
    try { if (tg.setBackgroundColor) tg.setBackgroundColor(bg); } catch (e) { /* older Telegram */ }
    var btm = lum < 100 ? '#15191E' : '#FFFFFF';
    try { if (tg.setBottomBarColor && tg.isVersionAtLeast && tg.isVersionAtLeast('7.10')) tg.setBottomBarColor(btm); } catch (e) { /* older Telegram */ }
  }

  // ---- loading watch: no blank screen when the connection is slow or lost
  var loaded = false, timer = 0, SLOW_MS = Number(cfg.SLOW_MS) || 20000;
  var nt = document.getElementById('nt'), ntT = document.getElementById('ntT'), ntS = document.getElementById('ntS');
  function notice(kind) {
    if (!kind) { nt.className = 'nt hidden'; return; }
    ntT.textContent = kind === 'offline' ? 'No internet connection' : 'Taking longer than usual';
    ntS.textContent = kind === 'offline' ? 'Connect to Wi-Fi or mobile data. The form opens by itself when you are back online.'
      : 'The form is still loading. Check the internet connection, then try again.';
    nt.className = 'nt';
  }
  function open() {
    loaded = false; clearTimeout(timer);
    timer = setTimeout(function () { if (!loaded) notice(navigator.onLine === false ? 'offline' : 'slow'); }, SLOW_MS);
    frame.src = SRC;
  }
  // ---- the hand-over: the loading logo stays above the form until the form says it is ready, then morphs into the
  // sign-in page's own logo (same place, same size) while the page appears around it. An older form (no "ready"),
  // or no answer in time: the logo simply fades out as before – it can never stay stuck on the screen.
  var T0 = Date.now(), MIN_MS = 380, MORPH_MS = 460,   // (v16) quicker: the logo only waits to finish springing in
      handed = false, morphApp = false, fallTimer = 0;
  function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function fadeOut() {
    if (handed) return; handed = true; clearTimeout(fallTimer);
    var ld = document.getElementById('ld');
    if (ld && ld.className.indexOf('hidden') < 0) { ld.className = 'ld out'; setTimeout(function () { ld.className = 'hidden'; }, 380); }
  }
  // (v9) the breathing settles back to rest while the logo glides, so it arrives exactly as the sign-in logo looks
  function settle(el, ms) {
    if (!el || !el.animate) return;
    var cs = getComputedStyle(el), tf = cs.transform && cs.transform !== 'none' ? cs.transform : 'matrix(1,0,0,1,0,0)', op = cs.opacity;
    el.style.animation = 'none'; el.style.transform = tf; el.style.opacity = op;
    el.animate([{ transform: tf, opacity: op }, { transform: 'matrix(1,0,0,1,0,0)', opacity: 1 }], { duration: ms, easing: 'cubic-bezier(.33,0,.2,1)', fill: 'forwards' });
  }
  function morphTo(r, vw, vh) {                                          // r: the sign-in logo's box in the form's window
    if (handed) return 0; handed = true; clearTimeout(fallTimer);
    var ld = document.getElementById('ld'), lg = document.getElementById('lg'), bg = document.getElementById('ldbg');
    var wait = Math.max(0, T0 + MIN_MS - Date.now());                     // the logo has faded in and taken a breath first
    if (!r || !lg || !lg.animate || reduced()) { setTimeout(fadeOut2, wait); return wait; }
    setTimeout(function () {
      ['tile', 'h1', 'h2'].forEach(function (id) { settle(document.getElementById(id), MORPH_MS); });
      lg.style.animation = 'none';
      var a = lg.getBoundingClientRect(), offY = (window.innerHeight - (vh || window.innerHeight)), offX = (window.innerWidth - (vw || window.innerWidth)) / 2;
      var tx = r.x + offX + r.w / 2 - (a.left + a.width / 2), ty = r.y + offY + r.h / 2 - (a.top + a.height / 2), k = r.w / a.width;
      if (!(k > .5 && k < 2)) k = 1;
      ld.className = 'ld morph';
      lg.animate([{ transform: 'translate3d(0,0,0) scale(1)' }, { transform: 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + k + ')' }],
        { duration: MORPH_MS, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'forwards' });
      bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MORPH_MS - 120, delay: 80, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
      setTimeout(function () {                                           // landed: the form's own logo appears underneath (identical),
        lg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'linear', fill: 'forwards' });   // then this one leaves
        setTimeout(function () { ld.className = 'hidden'; }, 150);
      }, MORPH_MS + 70);
    }, wait);
    return wait;
    function fadeOut2() { handed = false; fadeOut(); }
  }
  frame.addEventListener('load', function () {
    if (!frame.src || frame.src === 'about:blank') return;
    loaded = true; clearTimeout(timer); notice(null);
    // a form that knows the hand-over says hello first; otherwise (an older form) the logo fades out after a moment
    if (!morphApp) { clearTimeout(fallTimer); fallTimer = setTimeout(function () { if (!morphApp) fadeOut(); }, 3500); }
  });
  document.getElementById('ntBtn').addEventListener('click', function () { notice(null); open(); });
  window.addEventListener('offline', function () { if (!loaded) notice('offline'); });
  window.addEventListener('online', function () { if (!loaded) { notice(null); open(); } });
  if (navigator.onLine === false) notice('offline');
  open();

  // ---- (v8) Telegram full-screen: the form runs under the clock and Telegram's buttons – tell it how high they are,
  // so its navy header covers them (normal mode: 0, nothing changes)
  var appWin = null, appOrigin = '';
  var probe = null;
  function envTop() {                                                    // how far this page really runs under the clock (0 when iOS already keeps it below)
    try {
      if (!probe) { probe = document.createElement('div'); probe.style.position = 'fixed'; probe.style.top = '0'; probe.style.left = '0'; probe.style.width = '1px'; probe.style.visibility = 'hidden'; probe.style.pointerEvents = 'none'; probe.style.height = 'env(safe-area-inset-top, 0px)'; document.body.appendChild(probe); }
      return probe.getBoundingClientRect().height;
    } catch (e) { return -1; }
  }
  // (v10) every way the page can end up under the clock: Telegram full-screen, Safari's edge-to-edge page (iOS 26),
  // a Home Screen app. Normal Telegram (its own top bar above the page): the page is not under the clock → 0.
  function topInset() {
    try {
      var e = Math.max(0, envTop());
      if (tg) {
        if (!tg.isFullscreen) return 0;
        var a = tg.safeAreaInset || {}, c = tg.contentSafeAreaInset || {};
        return Math.round(Math.max(e, Number(a.top) || 0) + (Number(c.top) || 0));   // the clock + Telegram's own buttons row
      }
      return Math.round(e);
    } catch (e2) { return 0; }
  }
  function pushInsets() { if (appWin) try { appWin.postMessage({ mva: 1, type: 'insets', top: topInset() }, appOrigin); } catch (e) { /* form closed */ } }
  try { if (tg && tg.onEvent) ['fullscreenChanged', 'safeAreaChanged', 'contentSafeAreaChanged'].forEach(function (e) { tg.onEvent(e, pushInsets); }); } catch (e) { /* older Telegram */ }
  var lastTop = -1, rsz = 0;                                             // (v10) the phone turned, Safari's bars changed
  function insetsChanged() { clearTimeout(rsz); rsz = setTimeout(function () { var t = topInset(); if (t !== lastTop) { lastTop = t; pushInsets(); } }, 120); }
  window.addEventListener('resize', insetsChanged); window.addEventListener('orientationchange', insetsChanged);

  // ---- Telegram location for the form
  var FORM_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(googleusercontent\.com|script\.google\.com)$/;
  var lm = tg && tg.LocationManager;
  var canTg = false;
  try { canTg = !!(lm && tg.isVersionAtLeast && tg.isVersionAtLeast('8.0')); } catch (e) { canTg = false; }
  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (!m || typeof m !== 'object' || m.mva !== 1 || !ev.source || !FORM_ORIGIN.test(ev.origin)) return;   // only Google's frames of the form
    var sent = false;
    var reply = function (o) {
      if (sent) return;
      sent = true; o.mva = 1; o.id = m.id; o.type = m.type;
      try { ev.source.postMessage(o, ev.origin); } catch (e) { /* form closed */ }
    };
    if (m.type === 'hello') {
      if (m.morph) { morphApp = true; clearTimeout(fallTimer); fallTimer = setTimeout(fadeOut, 9000); }   // never stuck: 9 s at most
      appWin = ev.source; appOrigin = ev.origin;                           // (v8) for Telegram full-screen updates
      lastTop = topInset();
      return reply({ location: canTg, launcher: 18, morph: !handed, top: lastTop });
    }
    if (m.type === 'ready') {                                             // the form is on screen: hand over
      var box = m.logo && typeof m.logo.x === 'number' ? m.logo : null;
      if (handed) return reply({ go: true, start: 0, land: 0 });
      var start = box ? morphTo(box, m.vw, m.vh) : (function () { var w = Math.max(0, T0 + MIN_MS - Date.now()); setTimeout(fadeOut, w); return w; })();
      return reply({ go: true, start: start, land: box ? start + MORPH_MS : start + 200 });
    }
    if (m.type === 'location') {
      if (!canTg) return reply({ error: 'NO_TG' });
      var ask = function () {
        if (sent) return;
        try {
          if (!lm.isLocationAvailable) return reply({ error: 'NO_TG' });      // e.g. Telegram Desktop
          lm.getLocation(function (d) {                                       // Telegram asks the user the first time
            if (d && typeof d.latitude === 'number') return reply({ lat: d.latitude, lng: d.longitude, acc: d.horizontal_accuracy });
            reply({ error: lm.isAccessRequested && !lm.isAccessGranted ? 'DENIED' : 'NO_FIX' });
          });
        } catch (e) { reply({ error: 'NO_TG' }); }
      };
      try {
        if (lm.isInited) ask();
        else { setTimeout(function () { if (!lm.isInited) reply({ error: 'NO_TG' }); }, 8000); lm.init(ask); }   // no answer: the phone's GPS is used
      } catch (e) { reply({ error: 'NO_TG' }); }
      return;
    }
    if (m.type === 'theme') { setBars(m.bar, m.bg); return; }          // the form's Light / Dark mode: Telegram's top bar follows
    if (m.type === 'location_settings') {                                   // "Open settings" in the form
      try { lm.openSettings(); }
      catch (e) { try { window.Telegram.WebView.postEvent('web_app_open_location_settings', false); } catch (e2) { /* not available */ } }
    }
  });

  // ---- (v16) keep this page on the phone for a faster next open (Android, desktop browsers; where Telegram does not
  // allow it, e.g. some iPhone versions, nothing changes). Registered after the form has started loading, never before.
  try {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      setTimeout(function () { navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () { /* not allowed here */ }); }, 1500);
    }
  } catch (e) { /* not available */ }
})();
