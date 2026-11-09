// StreakBet: blackjack, roulette and slots, paid from the lie wallet. Odds/payouts live in core.js.
const SUIT_SIGN = { S: '♠', H: '♥', D: '♦', C: '♣' };
// a playing card; '7H', '10S'... (also used by the Belot table)
function cardEl(card, back = false) {
  const el = document.createElement('div');
  el.className = 'card' + (back ? ' back' : '');
  el.dataset.c = back ? '' : card;
  if (!back) {
    const s = card.at(-1);
    if (s === 'H' || s === 'D') el.classList.add('red');
    // the suit sits under the rank in the corner too, so fanned cards stay readable
    el.innerHTML = `<b>${card.slice(0, -1)}<small>${SUIT_SIGN[s]}︎</small></b><i>${SUIT_SIGN[s]}︎</i><b class="flip">${card.slice(0, -1)}<small>${SUIT_SIGN[s]}︎</small></b>`;
  }
  return el;
}
// sync a row of cards, animating only the ones that changed
function showCards(row, cards, hideFrom = 99) {
  cards.forEach((c, i) => {
    const back = i >= hideFrom, cur = row.children[i];
    if (cur && cur.dataset.c === (back ? '' : c)) return;
    const el = cardEl(c, back);
    cur ? cur.replaceWith(el) : row.append(el);
    sfx('card');
  });
  while (row.children.length > cards.length) row.lastChild.remove();
}
const shuffled = deck => {
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
};

// --- chips ------------------------------------------------------------
const CHIPS = [10, 50, 100, 500, 1000, 10000, 25000, 50000, 100000];
S.chip ||= 50;
function renderChips() {
  $('#chips').replaceChildren(...CHIPS.map(v => {
    const b = document.createElement('button');
    b.className = 'chip' + (v === S.chip ? ' on' : '');
    b.textContent = v >= 1000 ? v / 1000 + 'k' : v;
    b.setAttribute('aria-label', `Bet ${v}`);
    b.onclick = () => { S.chip = v; save(); renderChips(); sfx('chip'); };
    return b;
  }), rainbowChip());
}
// rainbow chip: any bet you like, tap to set the amount
function rainbowChip() {
  const v = S.rainbowChip || 250, b = document.createElement('button');
  b.className = 'chip rainbow' + (v === S.chip && !CHIPS.includes(v) ? ' on' : '');
  b.textContent = v >= 1000 ? +(v / 1000).toFixed(1) + 'k' : v;
  b.setAttribute('aria-label', `Custom bet ${v}, tap to change`);
  b.onclick = () => {
    const n = Math.floor(Number(prompt('Rainbow chip bet:', v)));
    if (!(n > 0)) return;
    S.rainbowChip = S.chip = n; save(); renderChips(); sfx('chip');
  };
  return b;
}
renderChips();
$('#casinoTabs').onclick = e => {
  const c = e.target.dataset.c;
  if (!c) return;
  $$('#casinoTabs button').forEach(b => b.setAttribute('aria-pressed', b === e.target));
  $$('.felt').forEach(p => p.hidden = p.dataset.c !== c);
  sfx('tick');
};
function payout(msgEl, win, staked, text, src) {
  msgEl.textContent = text;
  msgEl.classList.toggle('good', win > staked);
  msgEl.classList.toggle('bad', win < staked);
  replay(msgEl, 'bump');
  if (win > 0) earn(win);
  logIncome(src + ' (net)', win - staked);
  if (win > staked) { sfx('chaching'); buzz([15, 40, 15]); } else if (win === staked) sfx('chip'); else sfx('lose');
}

// --- blackjack (one fresh deck per hand, dealer stands on all 17s, blackjack pays 3:2)
const bj = { phase: 'idle' };
const bjRanks = cards => cards.map(c => c.slice(0, -1));
function bjRender() {
  const hide = bj.phase === 'play' ? 1 : 99;
  showCards($('#bjDealer'), bj.dealer || [], hide);
  showCards($('#bjYou'), bj.you || []);
  $('#bjDealerTotal').textContent = bj.dealer ? (hide < 99 ? Core.bj(bjRanks(bj.dealer.slice(0, 1))) : Core.bj(bjRanks(bj.dealer))) : '';
  $('#bjYouTotal').textContent = bj.you ? Core.bj(bjRanks(bj.you)) : '';
  const playing = bj.phase === 'play';
  $('#bjBet').textContent = playing ? fmt(bj.bet) : '';
  $('#bjYouTotal').classList.toggle('bust', !!bj.you && Core.bj(bjRanks(bj.you)) > 21);
  $('#bjDeal').disabled = playing;
  $('#bjHit').disabled = $('#bjStand').disabled = !playing;
  $('#bjDouble').disabled = !playing || bj.you.length !== 2;
}
function bjEnd(text, win) {
  bj.phase = 'idle';
  bjRender();
  payout($('#bjMsg'), win, bj.bet, text, 'Blackjack');
}
function bjStand() {
  bj.phase = 'dealer';
  while (Core.bj(bjRanks(bj.dealer)) < 17) bj.dealer.push(bj.deck.pop());
  const you = Core.bj(bjRanks(bj.you)), dealer = Core.bj(bjRanks(bj.dealer));
  if (dealer > 21 || you > dealer) bjEnd(`You win ${fmt(bj.bet * 2)}.`, bj.bet * 2);
  else if (you === dealer) bjEnd('Push. Stake back.', bj.bet);
  else bjEnd(`Dealer takes it with ${dealer}.`, 0);
}
$('#bjDeal').onclick = () => {
  if (!spend(S.chip)) return;
  sfx('yoink');
  bj.bet = S.chip;
  bj.deck = shuffled(['C', 'D', 'H', 'S'].flatMap(s => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map(r => r + s)));
  bj.you = [bj.deck.pop(), bj.deck.pop()];
  bj.dealer = [bj.deck.pop(), bj.deck.pop()];
  bj.phase = 'play';
  $('#bjDealer').replaceChildren();
  $('#bjYou').replaceChildren();
  $('#bjMsg').textContent = 'Hit for another card, or stand.';
  $('#bjMsg').classList.remove('good', 'bad');
  bjRender();
  const you = Core.bj(bjRanks(bj.you)), dealer = Core.bj(bjRanks(bj.dealer));
  if (you !== 21) return;
  if (dealer === 21) bjEnd('Both blackjack. Push.', bj.bet);
  else bjEnd(`Blackjack! ${fmt(bj.bet * 2.5)}.`, bj.bet * 2.5);
};
$('#bjHit').onclick = () => {
  bj.you.push(bj.deck.pop());
  bjRender();
  if (Core.bj(bjRanks(bj.you)) > 21) bjEnd('Bust.', 0);
};
$('#bjStand').onclick = bjStand;
$('#bjDouble').onclick = () => {
  if (!spend(bj.bet)) return;
  sfx('yoink');
  bj.bet *= 2;
  bj.you.push(bj.deck.pop());
  bjRender();
  Core.bj(bjRanks(bj.you)) > 21 ? bjEnd('Doubled and bust.', 0) : bjStand();
};
bjRender();

// --- roulette (single zero) -------------------------------------------
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const pocketColour = n => n === 0 ? '#2e7d4f' : Core.RED.includes(n) ? '#b8322a' : '#1f1f22';
{
  const step = 360 / 37, rad = d => (d - 90) * Math.PI / 180, pt = (r, d) => `${(r * Math.cos(rad(d))).toFixed(2)} ${(r * Math.sin(rad(d))).toFixed(2)}`;
  $('#wheel').innerHTML = '<g id="wheelG">' + WHEEL.map((n, i) => {
    const a = i * step - step / 2, b = a + step;
    return `<path d="M${pt(100, a)}A100 100 0 0 1 ${pt(100, b)}L${pt(62, b)}A62 62 0 0 0 ${pt(62, a)}Z" fill="${pocketColour(n)}" stroke="#c9a24a" stroke-width=".6"/>` +
      `<text transform="rotate(${i * step}) translate(0 -86)" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="8.5" font-family="Instrument Sans,sans-serif">${n}</text>`;
  }).join('') + '<circle r="62" fill="#5a3b24"/><circle r="50" fill="#6e4a2e"/><circle r="12" fill="#c9a24a"/><path d="M0-46V46M-46 0H46" stroke="#c9a24a" stroke-width="3" stroke-linecap="round"/></g>';
}
const OUTSIDE = [['d1', '1st 12'], ['d2', '2nd 12'], ['d3', '3rd 12'], ['low', '1-18'], ['even', 'Even'], ['red', 'Red'], ['black', 'Black'], ['odd', 'Odd'], ['high', '19-36']];
const bets = new Map();
let spinning = false, wheelRot = 0;
{
  const cells = [`<button data-b="0" class="z" style="grid-row:1/4">0</button>`];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 12; col++) {
    const n = col * 3 + 3 - row;
    cells.push(`<button data-b="${n}" class="${Core.RED.includes(n) ? 'r' : 'k'}" style="grid-row:${row + 1};grid-column:${col + 2}">${n}</button>`);
  }
  OUTSIDE.forEach(([k, label], i) => cells.push(`<button data-b="${k}" class="o${k === 'red' ? ' r' : k === 'black' ? ' k' : ''}" style="grid-row:${i < 3 ? 4 : 5};grid-column:${i < 3 ? 2 + i * 4 + '/span 4' : 2 + (i - 3) * 2 + '/span 2'}">${label}</button>`));
  $('#board').innerHTML = cells.join('');
}
const betKey = b => /^\d+$/.test(b) ? +b : b;
function renderBets() {
  $$('#board button').forEach(b => {
    const v = bets.get(betKey(b.dataset.b));
    b.dataset.chip = v ? (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : v) : '';
  });
  const total = [...bets.values()].reduce((s, v) => s + v, 0);
  $('#roulTotal').textContent = total ? `${fmt(total)} on the table` : 'No bets';
}
$('#board').onclick = e => {
  const b = e.target.closest('button');
  if (!b || spinning || !spend(S.chip)) return;
  const k = betKey(b.dataset.b);
  bets.set(k, (bets.get(k) || 0) + S.chip);
  sfx('chip');
  renderBets();
};
$('#roulClear').onclick = () => {
  if (spinning) return;
  const back = [...bets.values()].reduce((s, v) => s + v, 0);
  bets.clear();
  if (back) { earn(back); sfx('chip'); }
  renderBets();
};
$('#spin').onclick = () => {
  if (spinning) return;
  if (!bets.size) { $('#roulResult').textContent = ''; $('#roulTotal').textContent = 'Put a chip down first'; return sfx('nope'); }
  spinning = true;
  sfx('yoink');
  const i = Math.random() * 37 | 0, n = WHEEL[i], step = 360 / 37;
  wheelRot = Math.ceil(wheelRot / 360) * 360 + 360 * 5 + (360 - i * step) % 360;
  $('#wheelG').style.transform = `rotate(${wheelRot}deg)`;
  $('#roulResult').textContent = '';
  $$('#board .hit').forEach(b => b.classList.remove('hit'));
  for (let t = 0, gap = 40; t < 3900; t += gap, gap *= 1.07) setTimeout(() => sfx('tick'), t); // ball clatter slowing down
  setTimeout(() => {
    const staked = [...bets.values()].reduce((s, v) => s + v, 0);
    const win = [...bets].reduce((s, [k, v]) => s + v * Core.roulette(k, n), 0);
    const r = $('#roulResult');
    r.textContent = n;
    r.style.background = pocketColour(n);
    replay(r, 'pop');
    $(`#board [data-b="${n}"]`).classList.add('hit');
    bets.clear();
    renderBets();
    payout($('#roulTotal'), win, staked, win ? `${n}! You get ${fmt(win)}.` : `${n}. The house thanks you.`, 'Roulette');
    spinning = false;
  }, 4100);
};

// --- slots ------------------------------------------------------------
const SYM = {
  cherry: '<path d="M20 6c-2 8-8 12-10 18M20 6c2 8 6 12 10 16" stroke="#4f7f3a" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="11" cy="27" r="7" fill="#c8324a"/><circle cx="29" cy="25" r="7" fill="#d9415a"/><circle cx="9" cy="24.5" r="2" fill="#fff" opacity=".5"/>',
  lemon: '<path d="M5 21c0-8 7-13 15-13s15 5 15 13-7 12-15 12S5 29 5 21z" fill="#f2cf3c"/><path d="M5 21l-2 1M35 21l2-1" stroke="#d9b326" stroke-width="3" stroke-linecap="round"/><ellipse cx="15" cy="16" rx="5" ry="2.5" fill="#fff" opacity=".45"/>',
  bell: '<path d="M20 6c-7 0-10 6-10 13v6l-4 5h28l-4-5v-6c0-7-3-13-10-13z" fill="#e0aa38"/><circle cx="20" cy="33" r="3.2" fill="#b8862a"/><path d="M14 13c1-2 3-3 5-3" stroke="#fff" stroke-width="2" opacity=".5" fill="none" stroke-linecap="round"/>',
  bar: '<rect x="4" y="12" width="32" height="16" rx="3" fill="#1f1f22"/><text x="20" y="24.5" text-anchor="middle" font-size="11" font-weight="700" fill="#f6f1e6" font-family="Instrument Sans,sans-serif">BAR</text>',
  seven: '<text x="20" y="33" text-anchor="middle" font-size="34" font-style="italic" font-weight="700" fill="#c8324a" font-family="Instrument Serif,serif">7</text>',
  diamond: '<path d="M20 35 4 16l6-8h20l6 8z" fill="#7cc8dd"/><path d="M4 16l6-8h20l6 8z" fill="#c6edf6"/><path d="M20 35l-5-19h10z" fill="#fff" opacity=".5"/>',
  wild: '<rect x="2" y="6" width="36" height="28" rx="7" fill="#c8324a"/><rect x="4" y="8" width="32" height="24" rx="5" fill="none" stroke="#f2d27c" stroke-width="1.5"/><text x="20" y="25" text-anchor="middle" font-size="11.5" font-weight="700" fill="#f6dc8a" font-family="Instrument Sans,sans-serif">WILD</text>',
  star: '<path d="M20 3l5 10.2 11.2 1.6-8.1 7.9 1.9 11.2L20 28.6l-10 5.3 1.9-11.2-8.1-7.9L15 13.2z" fill="#f2c94c" stroke="#b8862a" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 15l2-4" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/>',
};
const symEl = s => `<div class="sym" data-s="${s}"><svg viewBox="0 0 40 40">${SYM[s]}</svg></div>`;
// 5 reels x 3 rows, 10 paylines (Core.LINES). grid[reel][row]
let lastGrid = Core.spinGrid(), pulling = false, auto = 0;
$('#reels').innerHTML = lastGrid.map(col => `<div class="reel"><div class="strip">${col.map(symEl).join('')}</div></div>`).join('')
  + '<svg class="paylines" viewBox="0 0 5 3" preserveAspectRatio="none" aria-hidden="true"></svg>';
const symIcon = s => `<svg viewBox="0 0 40 40">${SYM[s]}</svg>`;
$('#payTable').innerHTML = Object.entries(Core.SLOT_PAY).reverse().map(([s, pay]) => `<span class="pay">${symIcon(s)}${
  [3, 4, 5].map(n => `${n}× <b>${pay[n]}</b>`).join(' · ')}</span>`).join('')
  + `<span class="pay">${symIcon('wild')}Wild (reels 2–4): stands in for any symbol but the star</span>`
  + `<span class="pay">${symIcon('star')}Star, anywhere: 3× <b>${Core.STAR_PAY[3]}</b> · 4× <b>${Core.STAR_PAY[4]}</b> · 5× <b>${Core.STAR_PAY[5]}</b> x your stake, and 3+ give ${Core.FREE_SPINS} free spins</span>`;
const LINE_COLS = ['#e0aa38', '#c8324a', '#2f5fb3', '#2e7d4f', '#8a4fc8', '#e0682c', '#1b9aaa', '#d14f9a', '#6f9f2f', '#7a5230'];
function showWins(wins) {
  $$('#reels .sym.win').forEach(e => e.classList.toggle('win', false));
  $('#reels .paylines').innerHTML = wins.map(w => `<polyline points="${Core.LINES[w.line].map((r, i) => `${i + .5},${r + .5}`).join(' ')}" stroke="${LINE_COLS[w.line]}"/>`).join('');
  const strips = $$('#reels .strip');
  wins.forEach(w => Core.LINES[w.line].slice(0, w.n).forEach((r, i) => strips[i].children[strips[i].children.length - 3 + r]?.classList.add('win')));
}
// free spins: 3+ stars give Core.FREE_SPINS spins at the stake that won them; they play by themselves (and can retrigger)
let freeLeft = 0, freeBet = 0, freeWon = 0;
const freeInfo = () => { $('#freeInfo').hidden = !freeLeft; $('#freeInfo').textContent = `FREE SPINS: ${freeLeft} left · won ${fmt(freeWon)}`; };
// one spin; resolves with what it paid (false if the wallet was short)
function spinSlots(turbo) {
  return new Promise(resolve => {
    const free = freeLeft > 0;
    if (pulling || (!free && !spend(S.chip))) return resolve(false);
    pulling = true;
    if (free) { freeLeft--; freeInfo(); } else sfx('yoink');
    showWins([]);
    const bet = free ? freeBet : S.chip, grid = Core.spinGrid(), speed = turbo ? .35 : 1;
    const ticker = setInterval(() => sfx('tick'), 70);
    $$('#reels .strip').forEach((strip, i) => {
      const syms = [...lastGrid[i], ...Array.from({ length: 10 + i * 4 }, () => Core.spinReel(i)), ...grid[i]];
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      strip.innerHTML = syms.map(symEl).join('');
      strip.getBoundingClientRect();
      strip.style.transition = `transform ${(.9 + i * .3) * speed}s cubic-bezier(.2, .8, .25, 1.04)`;
      strip.style.transform = `translateY(${-(syms.length - 3) * 100 / syms.length}%)`;
      strip.ontransitionend = () => {
        sfx('card');
        if (i < 4) return;
        clearInterval(ticker);
        lastGrid = grid;
        const wins = Core.slotWins(grid), mult = Core.slots(grid), win = Math.round(bet * mult), stars = Core.stars(grid), more = Core.slotFree(grid);
        showWins(wins);
        if (stars >= 3) $$('#reels .strip').forEach(st => [...st.children].slice(-3).forEach(e => e.dataset.s === 'star' && e.classList.add('win')));
        const best = [...wins].sort((a, b) => b.pay - a.pay)[0];
        const parts = [best && `${wins.length} line${wins.length === 1 ? '' : 's'}, best ${best.n}× ${best.sym}`, stars >= 3 && `${stars} stars`].filter(Boolean);
        if (free) freeWon += win;
        if (more) { if (!freeLeft) { freeBet = bet; if (!free) freeWon = 0; } freeLeft += more; freeInfo(); sfx('win'); }
        // a free spin costs nothing, so any win is a win
        payout($('#slotMsg'), win, free ? 0 : bet, (win ? `${parts.join(' + ')}. You win ${fmt(win)}.` : free ? 'Free spin: nothing this time.' : 'Nothing. Spin again?')
          + (more ? ` ${more} FREE SPINS!` : ''), 'Slots');
        if (mult >= 5 || more) replay($('#reels'), 'jackpot');
        pulling = false;
        resolve(win);
      };
    });
  });
}
// auto spin (WinBet style): pick how many spins, optionally stop on any win or a big one (10x+), turbo for short spins.
// It also stops when the wallet can't cover the next spin.
function renderAuto() {
  $('#autoGo').textContent = auto ? `Stop (${auto === Infinity ? '∞' : auto})` : 'Auto spin';
  $('#autoGo').classList.toggle('on', !!auto);
  $('#pull').disabled = !!auto;
}
// a paid spin, followed by any free spins it won; resolves with the total won (false if the wallet was short)
let inFree = false;
async function spinOnce(turbo) {
  const win = await spinSlots(turbo);
  if (win === false || inFree || !freeLeft) return win;
  inFree = true;
  $('#pull').disabled = true;
  while (freeLeft > 0) {
    await new Promise(r => setTimeout(r, turbo ? 300 : 900));
    await spinSlots(turbo);
  }
  inFree = false;
  $('#pull').disabled = !!auto;
  $('#slotMsg').textContent = `Free spins over: you won ${fmt(freeWon)} in total.`;
  freeInfo();
  return win + freeWon;
}
async function runAuto() {
  const stopWin = $('#autoStopWin').checked, stopBig = $('#autoStopBig').checked, turbo = $('#autoTurbo').checked;
  auto = $('#autoN').value === 'inf' ? Infinity : +$('#autoN').value;
  renderAuto();
  while (auto > 0) {
    const bet = S.chip, win = await spinOnce(turbo);
    if (win === false) break;
    if (!auto) break; // stopped while spinning
    auto--;
    renderAuto();
    if ((stopWin && win > bet) || (stopBig && win >= bet * 10)) break;
    await new Promise(r => setTimeout(r, turbo ? 150 : 450));
  }
  auto = 0;
  renderAuto();
}
$('#pull').onclick = () => spinOnce(false);
$('#autoGo').onclick = () => { if (auto) { auto = 0; renderAuto(); } else runAuto(); sfx('tick'); };
