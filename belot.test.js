// node belot.test.js — bots play many full games; every move goes through the validating reducer.
const assert = require('node:assert');
const B = require('./belot.js');

const st0 = { contract: 'H', trick: [], hands: [] };
assert.equal(B.winner(st0, [{ seat: 0, card: 'AS' }, { seat: 1, card: '7H' }, { seat: 2, card: '10S' }, { seat: 3, card: 'KS' }]).seat, 1);
assert.equal(B.winner({ contract: 'NT' }, [{ seat: 0, card: '10S' }, { seat: 1, card: 'JS' }, { seat: 2, card: 'AH' }, { seat: 3, card: 'AS' }]).seat, 3);
assert.equal(B.winner({ contract: 'AT' }, [{ seat: 0, card: 'AS' }, { seat: 1, card: '9S' }, { seat: 2, card: 'JH' }, { seat: 3, card: '10S' }]).seat, 1);
// must overtrump an opponent's trump
assert.deepEqual(B.legalCards({ contract: 'H', trick: [{ seat: 1, card: 'AS' }, { seat: 2, card: '9H' }], hands: [, , , ['7H', 'JH', 'KD']] }, 3), ['JH']);
// partner holds the trick: no need to trump
assert.deepEqual(B.legalCards({ contract: 'H', trick: [{ seat: 0, card: 'AS' }, { seat: 1, card: '7S' }], hands: [, , ['7H', 'KD']] }, 2), ['7H', 'KD']);

const TOTAL = { NT: 130, AT: 258 }; // card points + last trick (suit games: 162)
let hands = 0;
for (let g = 0; g < 200; g++) {
  const st = B.create(['a', 'b', 'c', 'd']);
  for (let steps = 0; st.phase !== 'over'; steps++) {
    assert(steps < 20000, 'game never ended');
    if (st.phase === 'done') {
      assert.equal(st.pts[0] + st.pts[1], TOTAL[st.contract] ?? 162);
      hands++;
      B.apply(st, { type: 'next' });
      continue;
    }
    B.apply(st, B.bot(st, st.turn));
  }
  assert(Math.max(...st.score) >= 151);
}
assert.throws(() => B.apply(B.create(['a', 'b', 'c', 'd']), { seat: 3, type: 'bid', bid: 'C' }), /not your turn/);
// a seat's view never contains another player's cards or the deck
const live = B.create(['a', 'b', 'c', 'd']);
const v = B.view(live, 2);
assert.deepEqual(v.hands.map(h => typeof h), ['number', 'number', 'object', 'number']);
assert.equal(v.deck, undefined);
assert(!JSON.stringify(v).includes(JSON.stringify(live.hands[0])));

// контра / реконтра: only the defenders can double, only the bidders can redouble, a higher bid clears it
const bid = (st, b) => B.apply(st, { seat: st.turn, type: 'bid', bid: b });
const fresh = () => { const st = B.create(['a', 'b', 'c', 'd'], () => 0.5); return st; };
let st = fresh();
bid(st, 'H');
assert(B.view(st, st.turn).legal.includes('X'));
bid(st, 'X');
assert.equal(st.double, 2);
assert(B.view(st, st.turn).legal.includes('XX'), "bidder's partner may redouble");
bid(st, 'pass');
assert(!B.view(st, st.turn).legal.includes('XX'), 'defender cannot redouble');
bid(st, 'pass');
bid(st, 'XX');
assert.equal(st.double, 4);
bid(st, 'AT');
assert.equal(st.double, 1);

// scoring: a doubled made contract takes everything x2; a tie hangs and goes to the next hand's winner
const finish = (pts, double, hang = 0) => {
  const s = fresh();
  Object.assign(s, { contract: 'H', bidder: 0, double, hang, pts: pts.slice(), decl: [0, 0], tricks: [3, 4], phase: 'play', trick: [],
    hands: [['7C'], ['8C'], ['9C'], ['10C']], turn: 0 });
  for (let i = 0; i < 4; i++) B.apply(s, { seat: s.turn, type: 'play', card: s.hands[s.turn][0] });
  return s; // 10C wins the last trick (+10 points for team 1, plus the 10's own 10)
};
let r = finish([100, 42], 1).result; // 100 vs 42+20 = 62
assert.deepEqual(r.gp, [10, 6]);
r = finish([100, 42], 2).result; // контра made: everything x2 to the bidders
assert.deepEqual(r.gp, [32, 0]);
r = finish([71, 61], 1, 0); // 71 vs 61+20 = 81: inside
assert.deepEqual(r.result.gp, [0, 15]);
r = finish([81, 61], 1, 0); // 81 vs 81: tie, bidders' 8 hang
assert.deepEqual([r.result.gp, r.hang, r.result.hung], [[0, 8], 8, 8]);
r = finish([100, 42], 1, 8); // next hand: the winners collect the hanging 8
assert.deepEqual([r.result.gp, r.hang, r.result.took], [[18, 6], 0, 8]);

// declarations count only when announced with the first card, and belot only when called
st = B.create(['a', 'b', 'c', 'd']);
Object.assign(st, { phase: 'play', contract: 'S', bidder: 0, turn: 0, trick: [],
  hands: [['7H', '8H', '9H', 'KS', 'QS', 'AD', '7C', '8D'], ['10H', 'JH', 'QH', 'AC', 'KC', '9D', '10D', 'JD'],
    ['KH', 'AH', '7S', '8S', '9S', 'QC', 'JC', '10C'], ['10S', 'JS', 'AS', '9C', '7D', 'KD', 'QD', '8C']] });
const opts = B.view(st, 0).options;
assert.deepEqual(opts.map(o => o.what), ['Терца']);
B.apply(st, { seat: 0, type: 'play', card: 'KS', declare: [], belot: false }); // silent: no терца, no белот
for (const seat of [1, 2, 3]) B.apply(st, B.bot(st, seat));
// seats 1 and 2 both hold a Q-high терца: equal best sequences cancel, so nobody scores; seat 0 stayed quiet
assert.deepEqual([st.decl, st.declared.length], [[0, 0], 0]);
assert(st.announced.every(d => d.seat !== 0) && st.announced.length === 4);
console.log('ok', hands, 'hands');
