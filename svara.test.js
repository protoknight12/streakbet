// node svara.test.js
const assert = require('node:assert');
const Svara = require('./svara.js');
const { score } = Svara;

// scoring
assert.equal(score(['7H', '7D', '7S']), 34);
assert.equal(score(['7H', '7C', '7S']), 34);
assert.equal(score(['AH', 'AD', 'AS']), 33);
assert.equal(score(['KH', 'KD', 'KS']), 30);
assert.equal(score(['AH', 'AD', '8S']), 22);
assert.equal(score(['AH', 'AD', '7C']), 33); // two aces + шеха
assert.equal(score(['AH', 'KH', 'QH']), 31);
assert.equal(score(['AH', 'KH', '7C']), 32); // шеха joins hearts
assert.equal(score(['9S', '8D', '7H']), 9);
assert.equal(score(['9S', '8S', '7H']), 17);
assert.equal(score(['7C', '8D', '9H']), 20); // шеха 11 + the 9
assert.equal(score(['10C', 'JC', '7C']), 31); // the шеха counts 11, not 7, in its own suit
assert.equal(Svara.describe(['7H', '7D', '7S']), 'Three sevens');

const seats = n => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, stack: 1000 }));
const chips = st => st.seats.reduce((s, p) => s + (p ? p.stack : 0), 0) + st.pot;

// a simple hand: antes, a raise, a call, a fold
{
  const st = Svara.create(seats(3), 10, 42);
  Svara.start(st);
  assert.equal(st.pot, 30);
  assert.equal(st.dealer, 0);
  assert.equal(st.turn, 1);
  assert.throws(() => Svara.apply(st, { type: 'call', seat: 2 }), /turn/);
  assert.throws(() => Svara.apply(st, { type: 'raise', seat: 1, amount: 5 }), /Raise between/);
  Svara.apply(st, { type: 'raise', seat: 1, amount: 50 });
  assert.equal(st.turn, 2);
  assert.equal(Svara.legal(st, 2).toCall, 50);
  Svara.apply(st, { type: 'call', seat: 2 });
  Svara.apply(st, { type: 'fold', seat: 0 });
  assert.equal(st.phase, 'result');
  assert.equal(chips(st), 3000);
  assert.equal(st.pot, 0);
  // the view hides cards until the showdown, then shows only the hands that were still in
  const v = Svara.view(st, 0);
  assert.ok(v.hands[1].every(Boolean) && v.hands[2].every(Boolean));
  assert.ok(v.hands[0].every(Boolean)); // your own
  assert.equal(Svara.view(st, 1).hands[0][0], null); // the folded hand stays hidden
}
// everyone folds to one player: no showdown
{
  const st = Svara.create(seats(3), 10, 7);
  Svara.start(st);
  Svara.apply(st, { type: 'raise', seat: 1, amount: 10 });
  Svara.apply(st, { type: 'fold', seat: 2 });
  Svara.apply(st, { type: 'fold', seat: 0 });
  assert.equal(st.result.winner, 1);
  assert.deepEqual(st.result.shown, []);
  assert.equal(st.seats[1].stack, 1020);
}
// table stakes: no raise bigger than the shortest stack can call
{
  const st = Svara.create([{ name: 'A', stack: 1000 }, { name: 'B', stack: 100 }], 10, 3);
  Svara.start(st);
  assert.equal(Svara.legal(st, 1).maxRaise, 90);
  assert.throws(() => Svara.apply(st, { type: 'raise', seat: 1, amount: 91 }));
}
// свара: force a tie by setting the hands, then a third player joins for half the pot
{
  const st = Svara.create(seats(3), 10, 1);
  Svara.start(st);
  st.hands[1] = ['AH', 'KH', '9S']; st.hands[2] = ['AD', 'KD', '8C']; st.hands[0] = ['7S', '8H', '9D'];
  Svara.apply(st, { type: 'call', seat: 1 });
  Svara.apply(st, { type: 'call', seat: 2 });
  Svara.apply(st, { type: 'fold', seat: 0 });
  assert.equal(st.phase, 'join');
  assert.deepEqual(st.result.svara, [1, 2]);
  assert.deepEqual(st.joiners, [0]);
  assert.equal(Svara.legal(st, 0).cost, 15);
  Svara.apply(st, { type: 'join', seat: 0 });
  assert.equal(st.phase, 'bet');
  assert.equal(st.pot, 45);
  assert.equal(st.svara, 1);
  assert.deepEqual(st.in, [true, true, true, false, false, false]);
  assert.equal(chips(st), 3000);
}
// leaving mid-hand folds you and hands back your stack
{
  const st = Svara.create(seats(2), 10, 9);
  Svara.start(st);
  const back = Svara.leave(st, 0);
  assert.equal(back, 990);
  assert.equal(st.phase, 'result');
  assert.equal(st.result.winner, 1);
  assert.equal(st.seats[1].stack, 1010);
}
// a long random game between bots: chips are never made or lost, and every action the bots pick is legal
{
  let hands = 0, svaras = 0;
  for (let game = 0; game < 300; game++) {
    const n = 2 + game % 5, st = Svara.create(seats(n).map(p => ({ ...p, bot: true })), 5 + game % 20, game);
    const total = chips(st);
    for (let step = 0; step < 4000 && Svara.ready(st).length >= 2; step++) {
      if (st.phase === 'idle' || st.phase === 'result') { Svara.start(st); hands++; continue; }
      const seat = st.phase === 'join' ? st.joiners[0] : st.turn;
      if (st.phase === 'join' && st.joiners.length) svaras++;
      Svara.apply(st, Svara.bot(st, seat));
      assert.equal(chips(st), total);
      assert.ok(st.seats.every(p => !p || p.stack >= 0));
      // sometimes a player walks away mid-hand
      if (step % 97 === 50) { const i = st.seats.findIndex(Boolean); if (i >= 0 && st.seats.filter(Boolean).length > 2) { const got = Svara.leave(st, i); assert.ok(got >= 0); assert.equal(chips(st) + got, total); break; } }
    }
  }
  assert.ok(hands > 1000 && svaras > 5, `${hands} hands, ${svaras} svara joins`);
  console.log(`svara ok (${hands} hands)`);
}
