// Pure rules, shared by the page and core.test.js.
const Core = {
  key: d => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-'),
  // length counts up to 280 chars; power (1-10) multiplies it
  xp: (text, power) => Math.round(power * (1 + Math.min(text.trim().length, 280) / 40)),
  totalXp: lies => Object.values(lies).flat().reduce((s, l) => s + l.xp, 0),
  level: xp => Math.floor(Math.sqrt(xp / 8)) + 1,
  levelXp: lvl => 8 * (lvl - 1) ** 2,
  size: lvl => 0.55 + 0.45 * Core.girth(lvl),
  girth: lvl => Math.min(lvl - 1, 20) / 20,
  weight: xp => +(1.2 + xp * 0.025).toFixed(1), // kg
  // cash inside the pig: one twentieth per level, partial within the current level
  fill: xp => {
    const l = Core.level(xp);
    return Math.min((l - 1 + (xp - Core.levelXp(l)) / (Core.levelXp(l + 1) - Core.levelXp(l))) / 20, 1);
  },
  // consecutive days with a lie, ending today (or yesterday if today isn't fed yet)
  streak(lies, now = new Date()) {
    const d = new Date(now);
    if (!lies[Core.key(d)]?.length) d.setDate(d.getDate() - 1);
    let n = 0;
    while (lies[Core.key(d)]?.length) { n++; d.setDate(d.getDate() - 1); }
    return n;
  },

  // --- money -----------------------------------------------------------
  START_CASH: 300,
  coins: xp => xp * 25, // cash earned per lie
  streakBonus: days => Math.min(days, 30) * 20, // paid on the first lie of each day
  // arcade pays on game over, no cap
  arcadePay: (game, score) => Math.floor(score * ({ snake: 4, gems: .1, flappy: 8, drive: 1 }[game] || 0)),
  // cars count for more than they cost on the leaderboard, so buying one climbs the ranks
  carValue: car => Math.round(car.price * (car.used ? 1.2 : 1.5)),
  // Pim-Pal savings: 2% a day, compounded continuously, from the last deposit/withdraw
  bankGrow: (bal, ms) => bal * Math.pow(1.02, Math.max(0, ms) / 864e5),
  // rent and business income: perDay $, piling up until collected (no cap)
  accrue: (perDay, ms) => perDay * Math.max(0, ms) / 864e5,
  RENT: .01, // homes rent out for 1% of their price a day
  // the special title next to your name once your net worth passes $500k
  TITLE_AT: 500000,
  title: worth => worth >= Core.TITLE_AT ? 'Nikolov' : '',
  worth: (cash, cars) => cash + cars.reduce((s, c) => s + Core.carValue(c), 0),

  // --- StreakBet -------------------------------------------------------
  // blackjack total of ranks ('A','2'..'10','J','Q','K'): aces count 11 until that would bust
  bj(ranks) {
    let t = 0, aces = 0;
    for (const r of ranks) { t += r === 'A' ? 11 : 'JQK'.includes(r) ? 10 : +r; if (r === 'A') aces++; }
    while (t > 21 && aces) { t -= 10; aces--; }
    return t;
  },
  RED: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
  // European roulette: what one chip on `bet` returns when n comes up (stake included), 0 if lost
  roulette(bet, n) {
    if (typeof bet === 'number') return bet === n ? 36 : 0;
    if (n === 0) return 0;
    const red = Core.RED.includes(n);
    const win = { red, black: !red, odd: n % 2 === 1, even: n % 2 === 0, low: n <= 18, high: n > 18,
      d1: n <= 12, d2: n > 12 && n <= 24, d3: n > 24 }[bet];
    return win ? (bet[0] === 'd' ? 3 : 2) : 0;
  },
  // --- slots: 5 reels x 3 rows, 10 paylines, like a real video slot ---------------------------------------------
  // Every reel has its own strip (weights per symbol). WILD (reels 2-4 only) stands in for any symbol but the STAR.
  // STARs (scatter) pay x the whole stake anywhere on the screen, and 3+ of them give FREE_SPINS free spins.
  // Returns 95.7% on average (free spins included), a win on about 42% of spins, free spins about 1 spin in 200.
  SLOT_SYMS: ['cherry', 'lemon', 'bell', 'bar', 'seven', 'diamond', 'wild', 'star'],
  SLOT_REELS: [[36, 32, 24, 16, 8, 4, 0, 3], [36, 32, 24, 16, 8, 4, 4, 3], [36, 32, 24, 16, 8, 4, 4, 3],
    [36, 32, 24, 16, 8, 4, 4, 3], [36, 32, 24, 16, 8, 4, 0, 3]],
  // pays x the line bet for 0..5 in a row from the left reel (wilds count as the symbol)
  SLOT_PAY: { cherry: [0, 0, 0, 5, 15, 50], lemon: [0, 0, 0, 5, 15, 60], bell: [0, 0, 0, 10, 30, 150],
    bar: [0, 0, 0, 15, 75, 300], seven: [0, 0, 0, 40, 200, 1000], diamond: [0, 0, 0, 100, 500, 5000] },
  STAR_PAY: [0, 0, 0, 2, 10, 50], // x the whole stake, for 3/4/5+ stars anywhere
  FREE_SPINS: 10,
  // row (0 top, 1 middle, 2 bottom) on each of the 5 reels
  LINES: [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1]],
  spinReel: (reel = 0, r = Math.random()) => {
    const w = Core.SLOT_REELS[reel];
    let x = r * w.reduce((a, b) => a + b, 0);
    return Core.SLOT_SYMS[w.findIndex(v => (x -= v) < 0)] ?? 'cherry';
  },
  // grid[reel][row]
  spinGrid: (rand = Math.random) => Array.from({ length: 5 }, (_, reel) => Array.from({ length: 3 }, () => Core.spinReel(reel, rand()))),
  // what one line of 5 symbols pays (x the line bet): { sym, n, pay }
  slotLine(syms) {
    const sym = syms.find(s => s !== 'wild');
    if (!sym || sym === 'star') return { sym, n: 0, pay: 0 };
    let n = 0;
    while (n < 5 && (syms[n] === sym || syms[n] === 'wild')) n++;
    return { sym, n, pay: Core.SLOT_PAY[sym][n] };
  },
  // every winning line: { line, sym, n (in a row from the left), pay (x the line bet) }
  slotWins: grid => Core.LINES.map((rows, line) => ({ line, ...Core.slotLine(rows.map((r, i) => grid[i][r])) })).filter(w => w.pay),
  stars: grid => grid.flat().filter(s => s === 'star').length,
  // what a spin returns as a multiple of the whole stake (the stake is spread evenly over the 10 lines), stars included
  slots: grid => Core.slotWins(grid).reduce((s, w) => s + w.pay, 0) / Core.LINES.length + Core.STAR_PAY[Math.min(Core.stars(grid), 5)],
  slotFree: grid => Core.stars(grid) >= 3 ? Core.FREE_SPINS : 0,
};
if (typeof module !== 'undefined') module.exports = Core;
