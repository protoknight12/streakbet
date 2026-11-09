// Свара (Svara) rules engine: plain state + a validating reducer + bots, no DOM, so the svara edge function can run
// it on the server and svara.test.js in Node. Up to 6 seats; money is table chips ("stacks"), bought in from the wallet.
//
// A hand: everyone with chips pays the ante, gets 3 cards from a 32-card deck (7 to A), then one betting round
// starting left of the dealer: fold (Пас), call/check (Плащам), or raise (Вдигам). When the bets are level and
// everyone has acted, the hands still in are shown and the best score takes the pot.
// A tie is a "свара": the pot stays, the tied players play again, and every other seated player may join by paying
// half the pot. Table stakes: no raise can exceed what the shortest stack still in can call, so there are no side pots.
const Svara = (() => {
  const SEATS = 6;
  const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'], SUITS = ['C', 'D', 'H', 'S'];
  const JOKER = '7C'; // the шеха: counts 11 in any suit
  const value = r => r === 'A' ? 11 : ['K', 'Q', 'J', '10'].includes(r) ? 10 : +r;
  const rank = c => c.slice(0, -1), suit = c => c.at(-1);

  // the hand's score: 34 for three sevens, 3 x value for three of a kind, 22 for two aces (33 with the шеха),
  // otherwise the best total of one suit, where the шеха adds 11 to whichever suit is best
  function score(cards) {
    const rs = cards.map(rank);
    if (rs.every(r => r === '7')) return 34;
    let best = 0;
    if (rs.every(r => r === rs[0])) best = 3 * value(rs[0]);
    const joker = cards.includes(JOKER), rest = joker ? cards.filter(c => c !== JOKER) : cards;
    const aces = rest.filter(c => rank(c) === 'A').length;
    if (aces >= 2) best = Math.max(best, 22 + (joker ? 11 : 0));
    for (const s of SUITS) {
      const sum = rest.filter(c => suit(c) === s).reduce((t, c) => t + value(rank(c)), 0);
      best = Math.max(best, sum + (joker ? 11 : 0));
    }
    return best;
  }
  const describe = cards => {
    const sc = score(cards), rs = cards.map(rank);
    if (sc === 34) return 'Three sevens';
    if (rs.every(r => r === rs[0])) return `Three ${rs[0]}s`;
    return `${sc} points${cards.includes(JOKER) ? ' with the шеха' : ''}`;
  };

  function deck(rand) {
    const d = SUITS.flatMap(s => RANKS.map(r => r + s));
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }
  // a small seeded generator, so the server's deals are random but a state can be replayed in tests
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // seats: array of { name, stack, bot? } or null; ante: chips each player pays per hand
  function create(seats, ante, seed = Math.random() * 2 ** 31 | 0) {
    if (!(ante >= 1)) throw Error('The ante must be at least 1');
    const s = Array.from({ length: SEATS }, (_, i) => seats[i] ? { name: String(seats[i].name), stack: Math.floor(seats[i].stack), bot: !!seats[i].bot } : null);
    return { seats: s, ante: Math.floor(ante), seed, dealer: -1, phase: 'idle', hand: 0, pot: 0, hands: Array(SEATS).fill(null),
      bets: Array(SEATS).fill(0), in: Array(SEATS).fill(false), acted: Array(SEATS).fill(false), turn: -1, svara: 0,
      joiners: [], result: null, log: [], turnAt: 0 };
  }
  const nextSeat = (st, from, ok) => { for (let k = 1; k <= SEATS; k++) { const i = (from + k) % SEATS; if (ok(i)) return i; } return -1; };
  const active = st => st.in.map((v, i) => v ? i : -1).filter(i => i >= 0);
  const say = (st, text) => { st.log.push(text); if (st.log.length > 30) st.log.shift(); };
  // who can play the next hand: seated with enough chips for the ante
  const ready = st => st.seats.map((p, i) => p && p.stack >= st.ante ? i : -1).filter(i => i >= 0);

  function dealTo(st, players) {
    const d = deck(rng(st.seed + st.hand * 7919 + st.svara * 104729));
    st.hands = Array(SEATS).fill(null);
    players.forEach(i => st.hands[i] = [d.pop(), d.pop(), d.pop()]);
    st.in = st.seats.map((_, i) => players.includes(i));
    st.bets = Array(SEATS).fill(0);
    st.acted = Array(SEATS).fill(false);
    st.phase = 'bet';
    st.turn = nextSeat(st, st.dealer, i => st.in[i]);
  }
  // a new hand: move the dealer, take the antes, deal
  function start(st) {
    const players = ready(st);
    if (players.length < 2) { st.phase = 'idle'; st.result = null; throw Error('Need at least 2 players with chips for the ante'); }
    st.hand++; st.svara = 0; st.result = null; // the pot is empty, unless a свара was abandoned
    st.dealer = nextSeat(st, st.dealer, i => players.includes(i));
    players.forEach(i => { st.seats[i].stack -= st.ante; st.pot += st.ante; });
    say(st, `Hand ${st.hand}: everyone pays the ${st.ante} ante`);
    dealTo(st, players);
  }

  // what the player in `seat` may do right now
  function legal(st, seat) {
    if (st.phase === 'join') {
      const half = Math.ceil(st.pot / 2);
      return st.joiners[0] === seat ? { join: half <= st.seats[seat].stack, skip: true, cost: half } : {};
    }
    if (st.phase !== 'bet' || st.turn !== seat) return {};
    const cur = Math.max(...st.bets), toCall = cur - st.bets[seat];
    // table stakes: after a raise of r, everyone still in must be able to reach cur + r
    const room = Math.min(...active(st).map(i => st.seats[i].stack + st.bets[i])) - cur;
    return { fold: true, call: true, toCall, minRaise: st.ante, maxRaise: room >= st.ante ? room : 0 };
  }

  function finishBetting(st) {
    const live = active(st);
    if (live.length === 1) return win(st, live, false);
    const cur = Math.max(...st.bets);
    if (live.some(i => !st.acted[i] || st.bets[i] !== cur)) return false;
    const scores = Object.fromEntries(live.map(i => [i, score(st.hands[i])]));
    const top = Math.max(...Object.values(scores)), best = live.filter(i => scores[i] === top);
    st.result = { shown: live, scores, top };
    if (best.length === 1) return win(st, best, true);
    // свара: the pot stays; the others may buy in for half of it
    st.result.svara = best;
    say(st, `Свара! ${best.map(i => st.seats[i].name).join(' and ')} tie on ${top}`);
    st.svaraPlayers = best;
    st.joiners = [];
    for (let k = 1; k <= SEATS; k++) {
      const i = (st.dealer + k) % SEATS;
      if (st.seats[i] && !best.includes(i)) st.joiners.push(i);
    }
    st.phase = 'join';
    st.turn = -1;
    advanceJoin(st);
    return true;
  }
  function win(st, winners, shown) {
    const [w] = winners, p = st.seats[w];
    p.stack += st.pot;
    st.result = { ...(st.result || {}), winner: w, pot: st.pot, shown: shown ? st.result.shown : [], scores: shown ? st.result.scores : {} };
    say(st, `${p.name} takes ${st.pot}${shown ? ` with ${describe(st.hands[w])}` : ''}`);
    st.pot = 0;
    st.phase = 'result';
    st.turn = -1;
    return true;
  }
  // skip joiners who can't afford it; once everyone has decided, the tied players (and joiners) play again
  function advanceJoin(st) {
    while (st.joiners.length && st.seats[st.joiners[0]]?.stack < Math.ceil(st.pot / 2)) st.joiners.shift();
    if (st.joiners.length) return;
    const players = st.svaraPlayers.filter(i => st.seats[i]);
    if (players.length === 1) return win(st, players, false); // everyone else left
    if (!players.length) { st.phase = 'idle'; return; } // nobody left: the pot waits for the next hand
    st.svara++;
    say(st, `The свара is dealt: ${players.map(i => st.seats[i].name).join(', ')}`);
    dealTo(st, players);
  }

  // the reducer: throws on anything illegal
  function apply(st, a, now = Date.now()) {
    const seat = a.seat;
    if (a.type === 'next') {
      if (!['result', 'idle'].includes(st.phase)) throw Error('The hand is still on');
      start(st);
    } else if (a.type === 'join' || a.type === 'skip') {
      if (st.phase !== 'join' || st.joiners[0] !== seat) throw Error('Not your turn to decide');
      st.joiners.shift();
      if (a.type === 'join') {
        const half = Math.ceil(st.pot / 2);
        if (st.seats[seat].stack < half) throw Error('Not enough chips to join');
        st.seats[seat].stack -= half; st.pot += half;
        st.svaraPlayers.push(seat);
        say(st, `${st.seats[seat].name} joins the свара for ${half}`);
      }
      advanceJoin(st);
    } else {
      const L = legal(st, seat);
      if (!L.fold) throw Error('Not your turn');
      const p = st.seats[seat];
      if (a.type === 'fold') {
        st.in[seat] = false;
        say(st, `${p.name}: пас`);
      } else if (a.type === 'call') {
        p.stack -= L.toCall; st.bets[seat] += L.toCall; st.pot += L.toCall;
        say(st, `${p.name}: ${L.toCall ? `плащам ${L.toCall}` : 'чек'}`);
      } else if (a.type === 'raise') {
        const r = Math.floor(a.amount);
        if (!L.maxRaise || !(r >= L.minRaise && r <= L.maxRaise)) throw Error(L.maxRaise ? `Raise between ${L.minRaise} and ${L.maxRaise}` : 'No room to raise');
        const put = L.toCall + r;
        p.stack -= put; st.bets[seat] += put; st.pot += put;
        st.acted = st.acted.map(() => false);
        say(st, `${p.name}: вдигам ${r}`);
      } else throw Error('Unknown move');
      st.acted[seat] = true;
      if (!finishBetting(st)) st.turn = nextSeat(st, seat, i => st.in[i]);
    }
    st.turnAt = now;
    return st;
  }

  // a player stands up: folds if in the hand, and takes their stack with them (returned)
  function leave(st, seat, now = Date.now()) {
    const p = st.seats[seat];
    if (!p) return 0;
    if (st.phase === 'bet' && st.in[seat]) {
      if (st.turn === seat) apply(st, { type: 'fold', seat }, now);
      else { st.in[seat] = false; say(st, `${p.name} left`); finishBetting(st); }
    }
    st.seats[seat] = null;
    st.in[seat] = false;
    if (st.phase === 'join') {
      st.joiners = st.joiners.filter(i => i !== seat);
      st.svaraPlayers = st.svaraPlayers.filter(i => i !== seat);
      advanceJoin(st);
    }
    return p.stack;
  }
  // someone sits down (between hands they play from the next one)
  function sit(st, seat, player) {
    if (st.seats[seat]) throw Error('That seat is taken');
    st.seats[seat] = { name: String(player.name), stack: Math.floor(player.stack), bot: !!player.bot };
  }
  function addChips(st, seat, n) {
    if (st.phase === 'bet' && st.in[seat]) throw Error('Add chips between hands');
    st.seats[seat].stack += Math.floor(n);
  }

  // what `seat` may see: their own cards; everyone's at the showdown
  function view(st, seat) {
    const shown = st.phase === 'result' || st.phase === 'join' ? st.result?.shown || [] : [];
    return { seats: st.seats, ante: st.ante, dealer: st.dealer, phase: st.phase, hand: st.hand, pot: st.pot, bets: st.bets,
      in: st.in, turn: st.turn, svara: st.svara, joiners: st.joiners, log: st.log, turnAt: st.turnAt,
      result: st.result && { ...st.result, hands: Object.fromEntries((st.result.shown || []).map(i => [i, st.hands[i]])) },
      hands: st.hands.map((h, i) => h && (i === seat || shown.includes(i)) ? h : h ? h.map(() => null) : null),
      my: seat >= 0 && st.hands[seat] ? { score: score(st.hands[seat]), text: describe(st.hands[seat]) } : null,
      legal: seat >= 0 ? legal(st, seat) : {} };
  }

  // bots: raise strong hands, call fair ones, fold weak ones facing a bet; join a свара when the price is right
  function bot(st, seat, rand = Math.random) {
    if (st.phase === 'join') {
      const half = Math.ceil(st.pot / 2), p = st.seats[seat];
      return { type: half <= p.stack / 3 && rand() < .5 ? 'join' : 'skip', seat };
    }
    const L = legal(st, seat), sc = score(st.hands[seat]), x = rand();
    const raise = r => ({ type: 'raise', seat, amount: Math.min(L.maxRaise, Math.max(L.minRaise, r)) });
    if (L.maxRaise && (sc >= 31 || (sc >= 27 && x < .5) || (x < .06))) return raise(st.ante * (sc >= 31 ? 3 : 1));
    if (!L.toCall) return { type: 'call', seat };
    const price = L.toCall / Math.max(1, st.pot + L.toCall);
    if (sc >= 25 || (sc >= 21 && price < .3) || (sc >= 18 && price < .15) || x < .08) return { type: 'call', seat };
    return { type: 'fold', seat };
  }

  return { SEATS, RANKS, SUITS, JOKER, score, describe, create, start, apply, legal, view, bot, leave, sit, addChips, ready };
})();
if (typeof module !== 'undefined') module.exports = Svara;
else globalThis.Svara = Svara;
