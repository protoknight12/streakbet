// StreakBet shell: wallet, sound, local save. No accounts, no server: progress lives in this browser's localStorage.
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const STORE = 'streakbet-guest';
const START = 10000, TOPUP_BELOW = 10, TOPUP = 1000;

// --- sound + haptics (synthesized blips, no audio files) ---------------
let actx;
function tone(f1, f2, dur, type = 'sine', vol = .1, when = 0) {
  actx ||= new AudioContext();
  const t = actx.currentTime + when, o = actx.createOscillator(), gn = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  gn.gain.setValueAtTime(vol, t);
  gn.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(gn).connect(actx.destination);
  o.start(t); o.stop(t + dur);
}
function noise(dur, vol = .08, freq = 2000, when = 0) {
  actx ||= new AudioContext();
  const t = actx.currentTime + when, len = Math.ceil(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = actx.createBufferSource(), f = actx.createBiquadFilter(), gn = actx.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; gn.gain.value = vol;
  src.connect(f).connect(gn).connect(actx.destination);
  src.start(t);
}
const SFX = {
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, .25, 'triangle', .08, i * .09)),
  yoink: () => { tone(260, 1500, .14, 'square', .035); noise(.12, .07, 3200, .03); },
  chaching: () => { noise(.05, .1, 5000); tone(1568, 1568, .35, 'triangle', .08, .06); tone(2093, 2093, .5, 'triangle', .07, .13); },
  lose: () => { tone(392, 370, .25, 'triangle', .07); tone(330, 290, .5, 'triangle', .07, .28); },
  card: () => noise(.05, .14, 2600),
  chip: () => { tone(2400, 2150, .05, 'square', .02); noise(.03, .05, 6000); },
  tick: () => tone(1900, 1800, .018, 'square', .018),
  nope: () => tone(170, 120, .2, 'square', .05),
};
const sfx = k => {
  if (S.sound === false) return;
  try { SFX[k](); } catch { /* audio blocked: stay silent */ }
};
const buzz = ms => navigator.vibrate?.(ms);

// --- local save --------------------------------------------------------
let S;
try { S = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { S = {}; }
S = { cash: START, since: Date.now(), chip: 50, color: '#f2a7b5', skin: 'classic', name: 'Guest ' + (1000 + Math.floor(Math.random() * 9000)), ...S };
function save() {
  S.updated = Date.now();
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* storage blocked or full: play on without saving */ }
}

// --- wallet ------------------------------------------------------------
const fmt = n => '$' + Math.round(n).toLocaleString('en-US');
const replay = (el, cls) => { el.classList.remove(cls); el.getBoundingClientRect(); el.classList.add(cls); };
function renderCash() {
  $$('.cash').forEach(e => { if (e.textContent !== fmt(S.cash)) { e.textContent = fmt(S.cash); replay(e, 'bump'); } });
  $('#topup').hidden = S.cash >= TOPUP_BELOW;
}
// casino.js calls this; keeps a lifetime tally of net winnings per game
function logIncome(src, n) {
  if (!src || !n) return;
  const t = (S.totals ||= {});
  t[src] = (t[src] || 0) + n;
}
function earn(n, src) { S.cash += n; logIncome(src, n); save(); renderCash(); }
function spend(n) {
  if (!(n > 0) || n > S.cash) { sfx('nope'); buzz(30); $$('.cash').forEach(e => replay(e, 'shake')); return false; }
  S.cash -= n; save(); renderCash();
  return true;
}
$('#topup').onclick = () => { if (S.cash < TOPUP_BELOW) { S.refills = (S.refills || 0) + 1; earn(TOPUP); sfx('chaching'); } };

// --- names, avatar, toast -----------------------------------------------------
const onView = {}; // view id -> called when that tab opens (table.js and svaratable.js add theirs)
const pigIcon = (c, skin) => '<svg class="avatar" viewBox="0 0 40 32" aria-hidden="true"><g fill="' + (/^#[0-9a-f]{6}$/i.test(c) ? c : '#f2a7b0') + '">'
  + '<ellipse cx="18" cy="17" rx="14" ry="10.5"/><path d="M21 8l3-6 4 7z"/><rect x="9" y="23" width="4" height="7" rx="2"/>'
  + '<rect x="21" y="23" width="4" height="7" rx="2"/><rect x="29" y="13" width="7" height="8" rx="3"/></g>'
  + '<circle cx="26" cy="13" r="1.4" fill="#1b1b1d"/><path d="M14 9h7" stroke="#1b1b1d" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round"/></svg>';
let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  buzz([20, 40, 20]);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, 5000);
}
function showName() { $('#nameBtn').textContent = '✎ ' + S.name; }
$('#nameBtn').onclick = () => { askName(); $('.menu').open = false; };

// --- header buttons ------------------------------------------------------
const soundBtn = $('#soundBtn');
const showSound = () => { soundBtn.textContent = S.sound === false ? '🔇' : '🔊'; };
soundBtn.onclick = () => { S.sound = S.sound === false; save(); showSound(); sfx('tick'); };
$('#resetBtn').onclick = () => {
  if (!confirm('Start over with a fresh $' + START.toLocaleString() + '? This wipes your progress on this device.')) return;
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  location.reload();
};
$('#exportBtn').onclick = () => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' })), download: 'streakbet-save.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (typeof d.cash !== 'number' || !isFinite(d.cash)) throw 0;
    localStorage.setItem(STORE, JSON.stringify(d));
    location.reload();
  } catch { alert('That is not a StreakBet save file.'); }
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
showSound();
showName();
