/* TUSSEN. Eén script, geen framework. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (p, e0, e1) => { const t = clamp((p - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const RM = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- open of dicht, in Amsterdamse tijd ---------- */
const HOURS = { 0: [9, 16], 1: [8, 16], 2: [8, 16], 3: [8, 16], 4: [8, 16], 5: [8, 16], 6: [9, 16] };
const hh = h => String(h).padStart(2, '0') + ':00';
function amsNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return { day: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')], mins: (+get('hour') % 24) * 60 + +get('minute') };
}
function openStatus() {
  const { day, mins } = amsNow();
  const [o, c] = HOURS[day];
  if (mins >= o * 60 && mins < c * 60) return { open: true, bar: 'Nu open tot ' + hh(c), line: 'Nu open, nog tot ' + hh(c) + '.' };
  if (mins < o * 60) return { open: false, bar: 'Nu dicht, vandaag vanaf ' + hh(o), line: 'Nu dicht. Vandaag vanaf ' + hh(o) + '.' };
  const n = HOURS[(day + 1) % 7][0];
  return { open: false, bar: 'Nu dicht, morgen vanaf ' + hh(n), line: 'Nu dicht. Morgen vanaf ' + hh(n) + '.' };
}
let lastBar = '';
function applyStatus() {
  const s = openStatus();
  if (s.bar === lastBar) return;
  lastBar = s.bar;
  $('#announce').classList.toggle('open', s.open);
  $('#announceText').innerHTML = s.bar + '<span class="addr">&nbsp;&nbsp;&middot;&nbsp;&nbsp;Haarlemmerdijk 62, Amsterdam</span>';
  $('#now').classList.toggle('open', s.open);
  $('#nowText').textContent = s.line;
}
applyStatus();
setInterval(applyStatus, 60000);

/* ---------- menu ---------- */
const drawer = $('#drawer'), burger = $('#burger');
let lastFocus = null;
function setDrawer(open) {
  drawer.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', String(open));
  document.documentElement.style.overflow = open ? 'hidden' : '';
  if (open) { lastFocus = document.activeElement; setTimeout(() => $('.close', drawer).focus(), 60); }
  else if (lastFocus) lastFocus.focus();
}
burger.addEventListener('click', () => setDrawer(true));
$$('[data-close]', drawer).forEach(b => b.addEventListener('click', () => setDrawer(false)));
$$('nav a', drawer).forEach(a => a.addEventListener('click', () => setDrawer(false)));
addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.classList.contains('open')) setDrawer(false); });
drawer.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const f = $$('button, a', $('.panel', drawer)), first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* ---------- tekst splitsen, één keer bij het laden, met vaste 'toeval' ---------- */
function splitWords(el, seed, spread, cls) {
  const text = el.textContent.trim(), words = text.split(/\s+/), r = rng(seed);
  el.textContent = '';
  const sr = document.createElement('span'); sr.className = 'vh'; sr.textContent = text; el.appendChild(sr);
  const vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true');
  words.forEach((w, i) => {
    const s = document.createElement('span'); s.className = cls; s.textContent = w;
    s.style.setProperty('--th', ((i / Math.max(1, words.length)) * spread + r() * 0.04).toFixed(3));
    s.style.setProperty('--i', i);
    vis.appendChild(s);
    if (i < words.length - 1) vis.appendChild(document.createTextNode(' '));
  });
  el.appendChild(vis);
}
$$('.band .big[data-split]').forEach((el, i) => splitWords(el, 11 + i * 7, 0.42, 'w'));
$$('[data-words]').forEach((el, i) => splitWords(el, 40 + i, 0, 'w'));

/* ---------- de hero: scroll bestuurt de video ---------- */
const hero = $('#top'), stage = $('#stage'), video = $('#hero'), posterEl = $('#poster');
const failEnd = $('#failEnd'), overlap = $('#overlap');
let ring = $('#ring');
const VIDEO_URL = 'assets/hero-scrub.mp4';
const VIDEO_BYTES = 6576684;   // echte grootte na de encode, als Content-Length ontbreekt
const POSTER = 'assets/hero-poster.jpg', ENDING = 'assets/hero-ending.jpg';
const RAMPS = [0.04, 0.04, 0.04, 0.06];   // woorden staan na ongeveer 20vh scroll
const FADE = 0.02;                        // in- en uitfaden van een band, ongeveer 10vh
const bands = $$('.band').map((el, i) => ({ el, i, a: +el.dataset.a, b: +el.dataset.b, ramp: RAMPS[i], op: -1, k: -1, vis: null }));
let target = 0, shown = 0, rafId = null, lastTick = 0, heroOnScreen = true, scrubOn = false;
let loadT = 0, loadStart = 0, atEnd = null, lastOv = null;
let heroTop = 0, heroH = 1, stageH = 1, hdrPx = 94;

function measureHero() {
  hdrPx = parseFloat(getComputedStyle(stage).top) || 0;
  heroTop = hero.getBoundingClientRect().top + scrollY;
  heroH = hero.offsetHeight;
  stageH = stage.offsetHeight;
}
function heroProgress() { return clamp((scrollY + hdrPx - heroTop) / Math.max(1, heroH - stageH), 0, 1); }

function updateCaptions(p) {
  const last = bands.length - 1;
  for (const B of bands) {
    const f = Math.min(FADE, (B.b - B.a) / 3);
    let op = (B.i === 0 ? 1 : smoothstep(p, B.a, B.a + f)) * (B.i === last ? 1 : 1 - smoothstep(p, B.b - f, B.b));
    op = Math.round(op * 1000) / 1000;
    let k = clamp((p - B.a) / B.ramp, 0, 1);
    if (B.i === 0) k = Math.max(k, 1 - Math.pow(1 - loadT, 3));
    if (op !== B.op) {
      B.op = op; B.el.style.opacity = op;
      const v = op > 0.01;
      if (v !== B.vis) { B.vis = v; B.el.style.visibility = v ? 'visible' : 'hidden'; }
    }
    if (Math.abs(k - B.k) > 0.008 || (k === 1 && B.k !== 1) || (k === 0 && B.k !== 0)) { B.k = k; B.el.style.setProperty('--k', k.toFixed(3)); }
  }
  const e = p > 0.74;
  if (e !== atEnd) { atEnd = e; stage.classList.toggle('at-end', e); }
  const ov = Math.round((24 - 64 * p) * 2) / 2;
  if (ov !== lastOv) { lastOv = ov; overlap.style.setProperty('--ov', ov + 'px'); }
}

let seekBusy = false, pendingTime = null;
function requestSeek(t) {
  if (!video.duration || !isFinite(t)) return;
  if (seekBusy) { pendingTime = t; return; }
  if (Math.abs(video.currentTime - t) < 0.001) return;
  seekBusy = true;
  video.currentTime = t;
}
video.addEventListener('seeked', () => {
  seekBusy = false;
  if (pendingTime !== null) { const t = pendingTime; pendingTime = null; requestSeek(t); }
});
video.addEventListener('error', () => { seekBusy = false; pendingTime = null; if (!stage.classList.contains('video-ready')) failVideo(); });

function tick(now) {
  const dt = Math.min(100, now - (lastTick || now));
  lastTick = now;
  if (loadT < 1) loadT = clamp((now - loadStart) / 1200, 0, 1);
  shown += (target - shown) * (1 - Math.pow(1 - 0.16, dt / 16.667));
  if (Math.abs(target - shown) < 0.0005 && loadT >= 1) { shown = target; rafId = null; lastTick = 0; }
  else rafId = requestAnimationFrame(tick);
  requestSeek(shown * (video.duration || 0));
  updateCaptions(shown);
}
function onScroll() {
  target = heroProgress();
  if (rafId === null && heroOnScreen && scrubOn) rafId = requestAnimationFrame(tick);
}
new IntersectionObserver(es => { heroOnScreen = es[0].isIntersecting; if (heroOnScreen) onScroll(); }).observe(hero);

let started = false, heroInited = false;
function startBlobFetch() { if (started) return; started = true; loadHeroBlob().catch(failVideo); }
function initHeroOnce() {
  if (heroInited) return;
  heroInited = true;
  posterEl.style.backgroundImage = "url('" + POSTER + "')";
  const img = new Image();
  img.onload = startBlobFetch; img.onerror = startBlobFetch;
  img.src = POSTER;
  setTimeout(startBlobFetch, 4000);
}
async function loadHeroBlob() {
  const ctrl = new AbortController();
  let watchdog = setTimeout(() => ctrl.abort(), 20000);
  const res = await fetch(VIDEO_URL, { priority: 'low', signal: ctrl.signal });
  if (!res.ok || !res.body) throw new Error('video ' + res.status);
  const total = Number(res.headers.get('Content-Length')) || VIDEO_BYTES;
  const reader = res.body.getReader(), chunks = [];
  let got = 0, lastRing = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    clearTimeout(watchdog);
    watchdog = setTimeout(() => ctrl.abort(), 20000);
    chunks.push(value);
    got += value.length;
    const frac = Math.min(1, got / total), now = performance.now();
    if (ring && (now - lastRing > 100 || frac === 1)) { lastRing = now; ring.style.setProperty('--ld', Math.round(126 * (1 - frac))); }
  }
  clearTimeout(watchdog);
  if (ring) ring.style.setProperty('--ld', 0);
  video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
  video.load();
  video.addEventListener('canplay', () => {
    requestSeek(heroProgress() * video.duration);
    stage.classList.add('video-ready');
  }, { once: true });
}
function failVideo() {
  if (stage.classList.contains('video-failed')) return;
  if (ring) {
    const cue = document.createElement('div');
    cue.className = 'cue'; cue.setAttribute('aria-hidden', 'true');
    cue.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 6l5 5 5-5" fill="none" stroke="#111" stroke-width="1.8"/></svg>';
    ring.replaceWith(cue); ring = null;
  }
  failEnd.style.backgroundImage = "url('" + ENDING + "')";
  stage.classList.add('video-failed');
}

/* de vijf gates, letter voor letter gelijk aan modes.css en de <source media> */
const GATES = [
  '(max-width: 720px)',
  '(orientation: portrait) and (max-width: 1024px)',
  '(orientation: portrait) and (pointer: coarse)',
  '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
  '(prefers-reduced-motion: reduce)'
];
const MQLS = GATES.map(q => matchMedia(q));
function enableScrub() {
  if (scrubOn) return;
  scrubOn = true;
  if (!heroInited) loadStart = performance.now();
  initHeroOnce();
  measureHero();
  addEventListener('scroll', onScroll, { passive: true });
  bands.forEach(B => { B.op = -1; B.k = -1; B.vis = null; });
  atEnd = null; lastOv = null;
  target = shown = heroProgress();
  updateCaptions(shown);
  onScroll();
  if (rafId === null) rafId = requestAnimationFrame(tick);
}
function disableScrub() {
  if (!scrubOn) return;
  scrubOn = false;
  removeEventListener('scroll', onScroll);
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}
function applyHeroMode() { if (MQLS.some(m => m.matches)) disableScrub(); else enableScrub(); }
MQLS.forEach(m => m.addEventListener('change', applyHeroMode));

/* ---------- entrees en pauzes ---------- */
const io = new IntersectionObserver(es => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('in');
    io.unobserve(e.target);
    setTimeout(() => e.target.classList.add('done'), 1800);
  }
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.06 });
$$('[data-io]').forEach(s => io.observe(s));
const ioAnim = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('anim-off', !e.isIntersecting)), { rootMargin: '10% 0px' });
$$('.announce, .feature, .collage, .peek, .langs').forEach(s => ioAnim.observe(s));
document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused', document.hidden));

/* ---------- bloem op fluisterniveau ---------- */
const flour = $('#flour');
if (flour) {
  const r = rng(5);
  for (let i = 0; i < 16; i++) {
    const d = document.createElement('i');
    d.style.left = (r() * 100).toFixed(1) + '%';
    d.style.animationDuration = (18 + r() * 16).toFixed(1) + 's';
    d.style.animationDelay = (-r() * 34).toFixed(1) + 's';
    d.style.setProperty('--dx', ((r() - 0.5) * 90).toFixed(0) + 'px');
    d.style.transform = 'scale(' + (0.6 + r() * 0.8).toFixed(2) + ')';
    flour.appendChild(d);
  }
}

/* ---------- parallax van de collage ---------- */
const tiles = $$('.tile').map(el => ({ el, speed: +el.dataset.speed, top: 0, h: 0, y: 0 }));
function measureTiles() {
  for (const t of tiles) { const r = t.el.getBoundingClientRect(); t.top = r.top + scrollY - t.y; t.h = r.height; }
}
let pxRaf = null;
function parallax() {
  pxRaf = null;
  if (RM.matches) return;
  const vh = innerHeight, y0 = scrollY;
  for (const t of tiles) {
    const top = t.top - y0;
    if (top > vh + 300 || top + t.h < -300) continue;
    const y = Math.round(-(top + t.h / 2 - vh / 2) * t.speed * 2) / 2;
    if (y !== t.y) { t.y = y; t.el.style.setProperty('--py', y + 'px'); }
  }
}
addEventListener('scroll', () => { if (pxRaf === null) pxRaf = requestAnimationFrame(parallax); }, { passive: true });

/* ---------- kijk ertussen: vasthouden tilt het brood op ---------- */
const peek = $('#ertussen'), hold = $('#hold');
let open = 0, holding = false, holdRaf = null, holdLast = 0, opened = false;
const FILL_MS = 1600, DRAIN_MS = 900;
function writeOpen() {
  peek.style.setProperty('--open', open.toFixed(3));
  peek.style.setProperty('--done', clamp((open - 0.9) / 0.1, 0, 1).toFixed(3));
}
function finish() {
  opened = true; holding = false; open = 1; writeOpen();
  hold.classList.add('is-done'); hold.setAttribute('aria-disabled', 'true');
}
function holdTick(now) {
  const dt = Math.min(64, now - (holdLast || now));
  holdLast = now;
  if (holding) open = Math.min(1, open + dt / FILL_MS);
  else open = Math.max(0, open - dt / DRAIN_MS);
  writeOpen();
  if (open >= 1) { finish(); holdRaf = null; return; }
  if (holding || open > 0) holdRaf = requestAnimationFrame(holdTick);
  else { holdRaf = null; holdLast = 0; }
}
function kick() { if (holdRaf === null) { holdLast = 0; holdRaf = requestAnimationFrame(holdTick); } }
function startHold(e) {
  if (opened) return;
  holding = true;
  if (e && e.pointerId !== undefined && hold.setPointerCapture) hold.setPointerCapture(e.pointerId);
  kick();
}
function endHold() { if (!holding) return; holding = false; kick(); }
hold.addEventListener('pointerdown', e => { e.preventDefault(); startHold(e); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => hold.addEventListener(t, endHold));
hold.addEventListener('contextmenu', e => e.preventDefault());
hold.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startHold(); } });
hold.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); endHold(); } });
hold.addEventListener('click', e => e.preventDefault());

function pinToFinalStates() {
  if (holdRaf !== null) { cancelAnimationFrame(holdRaf); holdRaf = null; }
  finish();
  tiles.forEach(t => { t.y = 0; t.el.style.setProperty('--py', '0px'); });
}
function unpinFinalStates() {
  open = 0; opened = false; writeOpen();
  hold.classList.remove('is-done'); hold.removeAttribute('aria-disabled');
  measureTiles(); parallax();
}
RM.addEventListener('change', e => { if (e.matches) pinToFinalStates(); else unpinFinalStates(); applyHeroMode(); });

/* ---------- twijfels ---------- */
$$('.faq .q').forEach(q => q.addEventListener('click', () => {
  const isOpen = q.getAttribute('aria-expanded') !== 'true';
  q.setAttribute('aria-expanded', String(isOpen));
  $('#' + q.getAttribute('aria-controls')).classList.toggle('open', isOpen);
}));

/* ---------- de kaart: pijlen ---------- */
const track = $('#track'), prev = $('#prev'), next = $('#next');
function step(dir) {
  const card = $('.card', track), gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  track.scrollBy({ left: dir * (card.offsetWidth + gap), behavior: RM.matches ? 'auto' : 'smooth' });
}
prev.addEventListener('click', () => step(-1));
next.addEventListener('click', () => step(1));
let arrowState = '';
function arrows() {
  const a = track.scrollLeft <= 2, b = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2, s = a + '' + b;
  if (s === arrowState) return;
  arrowState = s; prev.disabled = a; next.disabled = b;
}
track.addEventListener('scroll', arrows, { passive: true });

/* ---------- start en formaatwissel ---------- */
function measureAll() { measureTiles(); if (scrubOn) { measureHero(); onScroll(); } parallax(); arrows(); }
let rsT = null;
addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(measureAll, 120); });
addEventListener('load', measureAll);
applyHeroMode();
if (RM.matches) pinToFinalStates();
measureAll();
})();
