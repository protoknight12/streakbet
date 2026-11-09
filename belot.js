// Bulgarian Belot rules engine: plain state + reducer, no DOM (so belot.test.js can run it in Node).
// Seats 0-3 play to the right (counter-clockwise); teams are 0+2 and 1+3.
const Belot = (() => {
  const SUITS = ['C', 'D', 'H', 'S'];
  const BIDS = ['C', 'D', 'H', 'S', 'NT', 'AT']; // ascending: clubs .. spades, no trumps, all trumps
  const PLAIN = { order: ['7', '8', '9', 'J', 'Q', 'K', '10', 'A'], pts: { 7: 0, 8: 0, 9: 0, J: 2, Q: 3, K: 4, 10: 10, A: 11 } };
  const TRUMP = { order: ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'], pts: { 7: 0, 8: 0, Q: 3, K: 4, 10: 10, A: 11, 9: 14, J: 20 } };
  const SEQ = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A']; // order for sequences
  const CARRE = { J: 200, 9: 150, A: 100, 10: 100, K: 100, Q: 100 };
  const suit = c => c.at(-1), rank = c => c.slice(0, -1), team = s => s % 2;
  const isTrump = (st, c) => st.contract === 'AT' || st.contract === suit(c);
  const info = (st, c) => isTrump(st, c) ? TRUMP : PLAIN;
  const power = (st, c) => info(st, c).order.indexOf(rank(c));
  const points = (st, c) => info(st, c).pts[rank(c)];

  function winner(st, trick) {
    const led = suit(trick[0].card);
    const trumps = SUITS.includes(st.contract) ? trick.filter(p => suit(p.card) === st.contract) : [];
    const pool = trumps.length ? trumps : trick.filter(p => suit(p.card) === led);
    return pool.reduce((a, b) => power(st, b.card) > power(st, a.card) ? b : a);
  }

  function legalCards(st, seat) {
    const hand = st.hands[seat], trick = st.trick;
    if (!trick.length) return hand.slice();
    const led = suit(trick[0].card), follow = hand.filter(c => suit(c) === led), best = winner(st, trick);
    if (follow.length) {
      // trumps led (any suit in all-trumps): you must beat the best card if you can
      if (isTrump(st, trick[0].card) && suit(best.card) === led) {
        const higher = follow.filter(c => power(st, c) > power(st, best.card));
        if (higher.length) return higher;
      }
      return follow;
    }
    // can't follow: free choice in no/all trumps, or when your partner holds the trick
    if (!SUITS.includes(st.contract) || team(best.seat) === team(seat)) return hand.slice();
    const trumps = hand.filter(c => suit(c) === st.contract);
    if (!trumps.length) return hand.slice();
    if (suit(best.card) !== st.contract) return trumps;
    const over = trumps.filter(c => power(st, c) > power(st, best.card));
    // ponytail: unable to overtrump -> free choice; strict tables force an undertrump instead
    return over.length ? over : hand.slice();
  }

  // a higher contract, or контра (X) from the defenders, then реконтра (XX) from the bidders
  function legalBids(st) {
    const bids = ['pass', ...BIDS.slice(st.contract ? BIDS.indexOf(st.contract) + 1 : 0)];
    if (st.contract && st.double === 1 && team(st.turn) !== team(st.bidder)) bids.push('X');
    if (st.double === 2 && team(st.turn) === team(st.bidder)) bids.push('XX');
    return bids;
  }

  function deal(st, rand = Math.random) {
    const deck = SUITS.flatMap(s => SEQ.map(r => r + s));
    for (let i = deck.length - 1; i > 0; i--) { const j = rand() * (i + 1) | 0; [deck[i], deck[j]] = [deck[j], deck[i]]; }
    st.dealer = (st.dealer + 1) % 4;
    st.hands = [[], [], [], []];
    // 3 then 2 cards each, starting right of the dealer; 3 more after the bidding
    for (const n of [3, 2]) for (let k = 1; k <= 4; k++) st.hands[(st.dealer + k) % 4].push(...deck.splice(0, n));
    Object.assign(st, { deck, phase: 'bid', turn: (st.dealer + 1) % 4, contract: null, bidder: null, passes: 0, said: {}, double: 1,
      trick: [], lastTrick: null, tricks: [0, 0], pts: [0, 0], decl: [0, 0], declared: [], announced: [], result: null });
    return st;
  }

  const create = (names, rand) => deal({ names, score: [0, 0], dealer: 3, hang: 0 }, rand);

  // what a seat could announce with its first card: терца/кварта/квинта and каре (none in no trumps)
  function options(st, seat) {
    const hand = st.hands[seat], found = [];
    if (st.contract === 'NT' || hand.length !== 8) return found;
    const carres = Object.keys(CARRE).filter(r => SUITS.every(s => hand.includes(r + s)));
    carres.forEach(r => found.push({ id: `c${r}`, what: `Каре ${r}`, pts: CARRE[r], kind: 'c', key: CARRE[r] }));
    for (const s of SUITS) {
      const has = SEQ.map(r => hand.includes(r + s) && !carres.includes(r)); // carré cards can't be reused
      for (let i = 0; i < 8; i++) {
        if (!has[i]) continue;
        let j = i;
        while (j < 8 && has[j]) j++;
        const len = j - i;
        if (len >= 3) found.push({ id: `s${s}${i}`, what: len >= 5 ? 'Квинта' : len === 4 ? 'Кварта' : 'Терца',
          pts: len >= 5 ? 100 : len === 4 ? 50 : 20, kind: 's', key: len * 10 + j - 1 });
        i = j;
      }
    }
    return found;
  }

  // after the first trick: of the announced sequences and carrés, the team with the best of each kind scores all of theirs
  function settle(st) {
    // ponytail: carrés compared like sequences (best wins all); some tables score both teams' carrés
    for (const kind of ['s', 'c']) {
      const top = [0, 1].map(t => Math.max(0, ...st.announced.filter(d => d.kind === kind && team(d.seat) === t).map(d => d.key)));
      if (top[0] === top[1]) continue;
      const t = top[0] > top[1] ? 0 : 1;
      for (const d of st.announced.filter(d => d.kind === kind && team(d.seat) === t)) { st.decl[t] += d.pts; st.declared.push(d); }
    }
  }

  function score(st) {
    const mult = st.contract === 'NT' ? 2 : 1;
    const raw = [0, 1].map(t => st.pts[t] * mult + st.decl[t] + (st.tricks[t] === 8 ? 90 : 0));
    const bt = team(st.bidder), ot = 1 - bt, x = st.double;
    let got = raw.map(p => p * x), hung = 0, took = 0;
    const inside = raw[bt] < raw[ot]; // "вътре": the bidders lose everything to the defenders
    if (raw[bt] === raw[ot]) { hung = got[bt]; got[bt] = 0; } // a tie: the bidders' points hang (висящи)
    else if (inside) got = [0, 0].map((_, t) => t === ot ? (raw[0] + raw[1]) * x : 0);
    else if (x > 1) got = [0, 0].map((_, t) => t === bt ? (raw[0] + raw[1]) * x : 0); // контра: the winners take everything
    const gp = got.map(p => Math.round(p / 10));
    if (hung) st.hang += Math.round(hung / 10);
    else if (st.hang) { took = st.hang; gp[inside ? ot : bt] += took; st.hang = 0; } // hanging points go to this hand's winners
    st.score = st.score.map((s, t) => s + gp[t]);
    st.result = { raw, gp, inside, valat: st.tricks.indexOf(8), double: x, hung: Math.round(hung / 10), took };
    st.phase = st.score.some(s => s >= 151) && st.score[0] !== st.score[1] ? 'over' : 'done';
  }

  // games saved before контра/висящи/announcements existed
  const upgrade = st => { st.double ??= 1; st.hang ??= 0; st.announced ??= []; };

  // validates and applies one action; throws on anything illegal so a server can trust it
  function apply(st, a) {
    upgrade(st);
    if (a.type === 'next') {
      if (st.phase !== 'done') throw Error('hand not finished');
      return deal(st);
    }
    if (a.seat !== st.turn) throw Error('not your turn');
    if (a.type === 'bid') {
      if (st.phase !== 'bid' || !legalBids(st).includes(a.bid)) throw Error('illegal bid');
      st.said[a.seat] = a.bid;
      if (a.bid === 'pass') st.passes++;
      else if (a.bid === 'X' || a.bid === 'XX') Object.assign(st, { double: a.bid === 'X' ? 2 : 4, passes: 0 });
      else Object.assign(st, { contract: a.bid, bidder: a.seat, passes: 0, double: 1 });
      st.turn = (a.seat + 1) % 4;
      if (!st.contract && st.passes === 4) return deal(st); // everybody passed: redeal
      if (st.contract && st.passes === 3) {
        for (let k = 1; k <= 4; k++) st.hands[(st.dealer + k) % 4].push(...st.deck.splice(0, 3));
        Object.assign(st, { phase: 'play', turn: (st.dealer + 1) % 4 });
      }
      return st;
    }
    if (a.type !== 'play' || st.phase !== 'play' || !legalCards(st, a.seat).includes(a.card)) throw Error('illegal card');
    const hand = st.hands[a.seat], r = rank(a.card), wants = Array.isArray(a.declare) ? a.declare : [];
    // declarations only count if you announce them with your first card
    for (const d of options(st, a.seat)) if (wants.includes(d.id)) st.announced.push({ ...d, seat: a.seat });
    // belot: K+Q of a trump suit, announced as the first of the pair is played
    if (a.belot && (r === 'K' || r === 'Q') && st.contract !== 'NT' && isTrump(st, a.card) && hand.includes((r === 'K' ? 'Q' : 'K') + suit(a.card))) {
      st.decl[team(a.seat)] += 20;
      st.declared.push({ seat: a.seat, what: 'Белот', pts: 20, belot: st.tricks[0] + st.tricks[1] });
    }
    hand.splice(hand.indexOf(a.card), 1);
    st.trick.push({ seat: a.seat, card: a.card });
    st.turn = (a.seat + 1) % 4;
    if (st.trick.length === 4) {
      const w = winner(st, st.trick);
      st.pts[team(w.seat)] += st.trick.reduce((s, p) => s + points(st, p.card), 0);
      st.tricks[team(w.seat)]++;
      st.lastTrick = { cards: st.trick, winner: w.seat };
      st.trick = [];
      st.turn = w.seat;
      if (st.tricks[0] + st.tricks[1] === 1) settle(st);
      if (!hand.length) { st.pts[team(w.seat)] += 10; score(st); }
    }
    return st;
  }

  function bot(st, seat) {
    const hand = st.hands[seat];
    if (st.phase === 'bid') {
      if (st.bidder !== null && team(st.bidder) === team(seat)) return { seat, type: 'bid', bid: 'pass' };
      const has = c => hand.includes(c), count = f => hand.filter(f).length;
      const val = { AT: count(c => rank(c) === 'J') * 3 + count(c => rank(c) === '9') * 2, NT: count(c => rank(c) === 'A') * 3 + count(c => rank(c) === '10') * 1.5 };
      for (const s of SUITS) val[s] = (has('J' + s) ? 3 : 0) + (has('9' + s) ? 2 : 0) + count(c => suit(c) === s) + count(c => rank(c) === 'A');
      const pick = legalBids(st).filter(b => b !== 'pass' && val[b] >= (b.length > 1 ? 9 : 7)).sort((a, b) => val[b] - val[a])[0];
      return { seat, type: 'bid', bid: pick || 'pass' };
    }
    const legal = legalCards(st, seat), play = card => ({ seat, type: 'play', card, declare: options(st, seat).map(d => d.id), belot: true });
    const cheap = c => points(st, c) * 10 + power(st, c);
    const lowest = () => legal.sort((a, b) => cheap(a) - cheap(b))[0];
    if (!st.trick.length) return play(legal.find(c => rank(c) === 'A' && !isTrump(st, c)) || legal.find(c => rank(c) === 'J' && isTrump(st, c)) || lowest());
    if (team(winner(st, st.trick).seat) === team(seat)) // partner holds it: feed points, keep trumps
      return play(legal.sort((a, b) => (isTrump(st, b) ? -1 : points(st, b)) - (isTrump(st, a) ? -1 : points(st, a)))[0]);
    const wins = legal.filter(c => winner(st, [...st.trick, { seat, card: c }]).seat === seat);
    return play(wins.length ? wins.sort((a, b) => cheap(a) - cheap(b))[0] : lowest());
  }

  // what one seat may see: other hands become card counts, the deck is hidden
  function view(st, seat) {
    upgrade(st);
    const v = JSON.parse(JSON.stringify(st));
    v.hands = v.hands.map((h, i) => i === seat ? h : h.length);
    delete v.deck;
    v.announced = v.announced.map(d => ({ seat: d.seat, what: d.what })); // you hear "терца", not which cards
    v.me = seat;
    v.legal = st.turn !== seat ? [] : st.phase === 'bid' ? legalBids(st) : st.phase === 'play' ? legalCards(st, seat) : [];
    v.options = st.turn === seat && st.phase === 'play' ? options(st, seat).map(({ id, what, pts }) => ({ id, what, pts })) : [];
    return v;
  }

  return { create, apply, bot, view, legalCards, winner, points, BIDS, SUITS, suit, rank };
})();
if (typeof module !== 'undefined') module.exports = Belot;
