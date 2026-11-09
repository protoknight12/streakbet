// node core.test.js
const assert = require('node:assert');
const Core = require('./core.js');

assert.equal(Core.key(new Date(2026, 0, 5)), '2026-01-05');
assert.equal(Core.xp('   ', 5), 5);
assert.equal(Core.xp('x'.repeat(1000), 10), 80);
for (let l = 1; l < 60; l++) assert.equal(Core.level(Core.levelXp(l)), l);
assert.equal(Core.fill(0), 0);
assert.equal(Core.fill(Core.levelXp(11)), 0.5);
assert.equal(Core.fill(1e9), 1);
assert.equal(Core.weight(0), 1.2);

const lie = [{ xp: 1 }];
const now = new Date(2026, 9, 11);
const ago = n => Core.key(new Date(2026, 9, 11 - n));
assert.equal(Core.streak({ [ago(0)]: lie, [ago(1)]: lie, [ago(2)]: lie, [ago(4)]: lie }, now), 3);
assert.equal(Core.streak({ [ago(1)]: lie, [ago(2)]: lie }, now), 2);
assert.equal(Core.streak({ [ago(2)]: lie }, now), 0);
assert.equal(Core.streak({ [ago(0)]: [] }, now), 0);
assert.equal(Core.bj(['A', 'K']), 21);
assert.equal(Core.bj(['A', 'A', '9']), 21);
assert.equal(Core.bj(['K', 'Q', '5']), 25);
assert.equal(Core.bj(['A', '5', 'A', 'K']), 17);
assert.equal(Core.roulette(17, 17), 36);
assert.equal(Core.roulette('red', 0), 0);
assert.equal(Core.roulette('red', 1), 2);
assert.equal(Core.roulette('black', 1), 0);
assert.equal(Core.roulette('d3', 36), 3);
assert.equal(Core.roulette('even', 0), 0);
// 5x3 slots: grid[reel][row]
const col = (a, b, c) => [a, b, c];
const g1 = [col('bar', 'seven', 'lemon'), col('bell', 'seven', 'bar'), col('lemon', 'wild', 'bell'), col('bar', 'bell', 'lemon'), col('bell', 'lemon', 'bar')];
assert.deepEqual(Core.slotWins(g1), [{ line: 0, sym: 'seven', n: 3, pay: 40 }]); // the wild completes three sevens
assert.equal(Core.slots(g1), 4);
assert.deepEqual(Core.slotLine(['wild', 'wild', 'bar', 'bar', 'cherry']), { sym: 'bar', n: 4, pay: 75 });
assert.equal(Core.slotLine(['star', 'star', 'star', 'cherry', 'cherry']).pay, 0); // stars don't pay on lines
assert.equal(Core.slotLine(['cherry', 'cherry', 'lemon', 'cherry', 'cherry']).pay, 0); // two in a row pay nothing
const all7 = Array.from({ length: 5 }, () => col('seven', 'seven', 'seven'));
assert.equal(Core.slotWins(all7).length, 10);
assert.equal(Core.slots(all7), 1000);
const stars = [col('star', 'bar', 'bell'), col('lemon', 'star', 'bar'), col('bell', 'bar', 'lemon'), col('bar', 'bell', 'star'), col('lemon', 'bar', 'bell')];
assert.equal(Core.stars(stars), 3);
assert.equal(Core.slotFree(stars), 10);
assert.equal(Core.slots(stars), 2);
assert.equal(Core.spinReel(0, 0), 'cherry');
assert.equal(Core.spinReel(0, .9999), 'star');
assert.ok(Core.spinGrid().every((c, r) => r % 4 || !c.includes('wild'))); // no wilds on the outer reels
// exact return: every line combination, the star count over 15 cells, and free spins (which can retrigger)
{
  const p = Core.SLOT_REELS.map(w => { const t = w.reduce((a, b) => a + b, 0); return w.map(v => v / t); });
  let line = 0;
  const walk = (i, syms, q) => i === 5 ? (line += q * Core.slotLine(syms).pay)
    : Core.SLOT_SYMS.forEach((s, k) => p[i][k] && walk(i + 1, [...syms, s], q * p[i][k]));
  walk(0, [], 1);
  let dist = [1];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
    const q = p[r][7], nd = Array(dist.length + 1).fill(0);
    dist.forEach((x, k) => { nd[k] += x * (1 - q); nd[k + 1] += x * q; });
    dist = nd;
  }
  const scat = dist.reduce((s, x, k) => s + x * Core.STAR_PAY[Math.min(k, 5)], 0), trig = dist.slice(3).reduce((a, b) => a + b, 0);
  const rtp = (line + scat) / (1 - Core.FREE_SPINS * trig);
  assert.ok(rtp > .95 && rtp < .965, `slots return ${rtp}`);
  assert.ok(1 / trig > 150 && 1 / trig < 250, `free spins every ${1 / trig}`);
}
assert.equal(Core.worth(100, [{ price: 1000, used: true }, { price: 1000 }]), 100 + 1200 + 1500);
assert.equal(Core.streakBonus(3), 60);
assert.equal(Core.streakBonus(99), 600);
assert.equal(Core.arcadePay('flappy', 10), 80);
assert.equal(Core.arcadePay('drive', 10000), 10000); // no cap
assert.equal(Core.arcadePay('nope', 10), 0);
assert.equal(Core.bankGrow(1000, 864e5), 1020);
assert.equal(Core.bankGrow(1000, -5), 1000);
assert.equal(Core.accrue(100, 864e5), 100);
assert.equal(Core.accrue(100, 30 * 864e5), 3000); // no 7-day cap
assert.equal(Core.accrue(100, -1), 0);
assert.equal(Core.title(499999), '');
assert.equal(Core.title(500000), 'Nikolov');
console.log('ok');
