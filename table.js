// Belot table, offline against bots or online at a lobby code. Rules live in belot.js; online, the server
// (supabase/functions/belot) holds the deck and every view is rotated so you always sit at the bottom.
const SUITS_UI = { C: ['♣', 'Clubs', 'k'], D: ['♦', 'Diamonds', 'r'], H: ['♥', 'Hearts', 'r'], S: ['♠', 'Spades', 'k'] };
const BID_HINT = { C: 'Clubs are trumps (lowest bid)', D: 'Diamonds are trumps', H: 'Hearts are trumps', S: 'Spades are trumps',
  NT: 'No trumps: highest card of the led suit wins, points doubled', AT: 'All trumps: every suit ranks J, 9, A... (highest bid)', pass: 'Let someone else choose',
  X: 'Double their bid: the hand is worth x2 and the winners take everything', XX: 'Redouble: x4' };
const BID_BG = { C: 'Спатия', D: 'Каро', H: 'Купа', S: 'Пика', NT: 'Без коз', AT: 'Всичко коз', X: 'Контра', XX: 'Реконтра', pass: 'Пас' };
const HAND_ORDER = ['S', 'H', 'C', 'D'], RANK_ORDER = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const NAMES = ['You', 'Bot Ivan', 'Bot Maria', 'Bot Georgi'];
const WIN_PRIZE = 600, HAND_PRIZE = 40; // game win / each hand your team takes
let bel = null, belTimer, shownCards = 0, paidHand = '', paidGame = false, names = NAMES;
let declareOff = new Set(), belotOff = false, seenBelots = 0; // your announcement toggles for the hand
let room = null, roomSub = null, roomBusy = false, roomPoll; // online: { code, seat, seats, started, version }

// a bid as HTML: coloured suit sign + name
const bidLabel = b => SUITS_UI[b] ? `<span class="suit ${SUITS_UI[b][2]}">${SUITS_UI[b][0]}︎</span> ${BID_BG[b]}` : BID_BG[b] || b;
const BID_ICON = { NT: 'БК', AT: 'ВК' };

// the bidding board: every call laid out like a table, the ones you can't make greyed out
function bidBoard(v) {
  const board = document.createElement('div');
  board.className = 'bid-board';
  const tile = (b, cls) => {
    const btn = document.createElement('button');
    btn.className = 'bid-tile ' + cls;
    btn.disabled = !v.legal.includes(b);
    btn.title = BID_HINT[b];
    btn.innerHTML = SUITS_UI[b] ? `<span class="glyph suit ${SUITS_UI[b][2]}">${SUITS_UI[b][0]}︎</span><small>${BID_BG[b]}</small>`
      : BID_ICON[b] ? `<span class="glyph">${BID_ICON[b]}</span><small>${BID_BG[b]}</small>` : BID_BG[b];
    btn.onclick = () => { belotSend({ type: 'bid', bid: b }); sfx('chip'); };
    return btn;
  };
  const calls = document.createElement('div');
  calls.className = 'bid-calls';
  calls.append(...['X', 'XX'].filter(b => v.legal.includes(b)).map(b => tile(b, 'call')), tile('pass', 'pass'));
  board.append(...['C', 'D', 'H', 'S', 'NT', 'AT'].map(b => tile(b, 'contract-tile')), calls);
  return board;
}

// what each seat has called this hand: its bid while bidding, then терца/белот… once play starts
function seatSays(v, i) {
  if (v.phase === 'bid') return v.said[i] ? bidLabel(v.said[i]) : '';
  const heard = v.announced.filter(d => d.seat === i).map(d => d.what);
  if (v.declared.some(d => d.seat === i && d.what === 'Белот')) heard.push('<b class="belot-tag">Белот!</b>');
  return heard.join(' · ');
}

// seat `me`'s view rewritten as if `me` were seat 0, so the renderer below never cares where you sit
function rotate(v, me) {
  if (!me) return v;
  const r = s => s == null ? s : (s - me + 4) % 4, rot = a => a.map((_, i) => a[(i + me) % 4]), tm = a => me % 2 ? [a[1], a[0]] : a;
  const seats = list => list.map(p => ({ ...p, seat: r(p.seat) }));
  return { ...v, hands: rot(v.hands), turn: r(v.turn), dealer: r(v.dealer), bidder: r(v.bidder),
    said: Object.fromEntries(Object.entries(v.said).map(([s, b]) => [r(+s), b])),
    trick: seats(v.trick), declared: seats(v.declared), announced: seats(v.announced),
    lastTrick: v.lastTrick && { cards: seats(v.lastTrick.cards), winner: r(v.lastTrick.winner) },
    score: tm(v.score), tricks: tm(v.tricks), result: v.result && { ...v.result, gp: tm(v.result.gp), valat: v.result.valat < 0 ? -1 : (v.result.valat + me) % 2 } };
}

function belotRender(v) {
  for (let i = 0; i < 4; i++) {
    const seat = $(`#table .s${i}`);
    seat.classList.toggle('turn', v.turn === i && (v.phase === 'bid' || v.phase === 'play'));
    seat.querySelector('.who').textContent = names[i] + (v.dealer === i ? ' · dealer' : '');
    const said = seat.querySelector('.said'), html = seatSays(v, i);
    if (said.dataset.html !== html) { said.innerHTML = html; said.dataset.html = html; } // re-set only on change, so the pop plays once
    const backs = seat.querySelector('.backs');
    if (backs) backs.replaceChildren(...Array.from({ length: v.hands[i] }, () => cardEl('', true)));
  }
  $('#usNames').textContent = `you + ${names[2]}`;
  $('#themNames').textContent = `${names[1]} + ${names[3]}`;

  // trump badge in the corner of the table
  const badge = $('#contract');
  badge.hidden = !v.contract;
  if (v.contract) badge.innerHTML = `<small>Trumps</small>${bidLabel(v.contract)}${v.double > 1 ? ` <b class="double">${v.double === 2 ? 'Контра ×2' : 'Реконтра ×4'}</b>` : ''}<small></small>`;
  if (v.contract) badge.lastChild.textContent = `bid by ${names[v.bidder]}${v.hang ? ` · висящи ${v.hang}` : ''}`;

  // a fresh белот gets a big flash over the table, on top of the tag by the player's name
  const belots = v.declared.filter(d => d.what === 'Белот');
  if (belots.length > seenBelots) {
    const flash = document.createElement('div');
    flash.className = `belot-flash p${belots.at(-1).seat}`;
    flash.textContent = 'Белот! +20';
    $('#table').append(flash);
    setTimeout(() => flash.remove(), 2200);
    sfx('chaching');
  }
  seenBelots = belots.length;

  // the trick in the middle, or the finished one until the next card lands
  const shown = v.trick.length ? v.trick : v.lastTrick?.cards || [];
  $('#trick').classList.toggle('done', !v.trick.length && !!v.lastTrick);
  $('#trick').replaceChildren(...shown.map(p => {
    const el = cardEl(p.card);
    el.classList.add(`p${p.seat}`);
    if (!v.trick.length && v.lastTrick?.winner === p.seat) el.classList.add('won');
    return el;
  }));
  const played = v.trick.length + (v.tricks[0] + v.tricks[1]) * 4;
  if (played > shownCards) sfx('card');
  shownCards = played;

  // scores as progress towards 151
  [['us', 0], ['them', 1]].forEach(([id, t]) => {
    $(`#${id}Score`).textContent = `${v.score[t]}${v.phase === 'play' ? ` · ${v.tricks[t]} tricks` : ''}`;
    $(`#${id}Bar`).style.width = Math.min(100, v.score[t] / 151 * 100) + '%';
  });

  const myTurn = v.turn === 0, hand = (v.hands[0] || []).slice().sort((a, b) =>
    HAND_ORDER.indexOf(Belot.suit(a)) - HAND_ORDER.indexOf(Belot.suit(b)) || RANK_ORDER.indexOf(Belot.rank(a)) - RANK_ORDER.indexOf(Belot.rank(b)));
  $('#myHand').classList.toggle('your-turn', myTurn && v.phase === 'play');
  const trumpOf = c => v.contract === 'AT' || v.contract === Belot.suit(c);
  const pairOf = c => ['K', 'Q'].includes(Belot.rank(c)) && trumpOf(c) && v.contract !== 'NT'
    && hand.includes((Belot.rank(c) === 'K' ? 'Q' : 'K') + Belot.suit(c));
  $('#myHand').replaceChildren(...hand.map(c => {
    const el = cardEl(c), ok = v.phase === 'play' && myTurn && v.legal.includes(c);
    el.classList.toggle('playable', ok);
    if (v.contract && (v.contract === 'AT' || v.contract === Belot.suit(c))) el.classList.add('trump');
    if (ok) el.onclick = () => belotSend({ type: 'play', card: c, belot: !belotOff,
      declare: v.options.filter(o => !declareOff.has(o.id)).map(o => o.id) });
    return el;
  }));

  // announcements: toggles for what you hold, all on by default; tap one to keep it quiet
  const toggle = (label, off, flip) => {
    const b = document.createElement('button');
    b.className = 'announce' + (off ? '' : ' on');
    b.setAttribute('aria-pressed', !off);
    b.textContent = (off ? '' : '✓ ') + label;
    b.onclick = () => { flip(); belotRender(v); };
    return b;
  };
  const chips = [];
  if (myTurn && v.phase === 'play') {
    chips.push(...v.options.map(o => toggle(`Обяви ${o.what} (+${o.pts})`, declareOff.has(o.id),
      () => declareOff.has(o.id) ? declareOff.delete(o.id) : declareOff.add(o.id))));
    if (hand.some(pairOf) && !v.declared.some(d => d.seat === 0 && d.what === 'Белот'))
      chips.push(toggle('Обяви Белот (+20) when I play K/Q', belotOff, () => { belotOff = !belotOff; }));
  }
  $('#bids').replaceChildren(...(v.phase === 'bid' && myTurn ? [bidBoard(v)] : chips));

  if (v.phase === 'bid') { declareOff.clear(); belotOff = false; seenBelots = 0; }
  const msg = $('#belotMsg'), decl = v.declared.map(d => `${d.what} (${names[d.seat]})`).join(', ');
  msg.className = 'table-msg';
  if (v.phase === 'done' || v.phase === 'over') {
    const r = v.result, weWon = r.gp[0] > r.gp[1], hand = `${v.dealer}:${v.score}`;
    if (paidHand !== hand) {
      paidHand = hand;
      if (weWon) { earn(HAND_PRIZE, 'Belot'); sfx('chaching'); } else sfx('lose');
    }
    msg.classList.add(weWon ? 'good' : 'bad');
    msg.textContent = `${weWon ? 'Your team takes the hand' : 'They take the hand'}: +${r.gp[0]} for us, +${r.gp[1]} for them.`
      + (weWon ? ` +${fmt(HAND_PRIZE)}.` : '') + (r.inside ? ' The bidders went inside (вътре).' : '') + (r.valat >= 0 ? ' Valat!' : '')
      + (decl ? ` Bonuses: ${decl}.` : '') + (r.double > 1 ? ` ${r.double === 2 ? 'Контра' : 'Реконтра'} ×${r.double}.` : '')
      + (r.hung ? ` Tie: ${r.hung} points hang (висящи) until the next hand.` : '') + (r.took ? ` Plus ${r.took} hanging points.` : '');
    if (v.phase === 'over') {
      const won = v.score[0] > v.score[1];
      if (!paidGame) { paidGame = true; if (won) { earn(WIN_PRIZE, 'Belot'); setTimeout(() => sfx('win'), 300); } }
      msg.textContent += won ? ` You win the game! +${fmt(WIN_PRIZE)}` : ' They win the game.';
    } else {
      const next = document.createElement('button');
      next.className = 'btn';
      next.textContent = 'Next hand';
      next.onclick = () => belotSend({ type: 'next' });
      $('#bids').replaceChildren(next);
    }
  } else if (v.phase === 'bid') {
    msg.textContent = myTurn ? 'Your call. Pick the trump suit you are strongest in, or pass.' : `${names[v.turn]} is bidding…`;
    if (v.hang) msg.textContent += ` ${v.hang} points are hanging (висящи) for whoever wins this hand.`;
  } else if (!v.trick.length && v.lastTrick && v.tricks[0] + v.tricks[1] > 0) {
    const w = v.lastTrick.winner, pts = v.lastTrick.cards.reduce((s, p) => s + Belot.points(v, p.card), 0);
    msg.classList.add(w % 2 ? 'bad' : 'good');
    msg.textContent = `${names[w]} ${w ? 'takes' : 'take'} the trick (+${pts}). ` + (myTurn ? 'Your lead: play any card.' : '');
  } else {
    msg.textContent = myTurn ? (v.trick.length ? 'Your turn: play one of the lit cards.' : 'Your lead: play any card.') : `${names[v.turn]} is thinking…`;
    if (decl && v.tricks[0] + v.tricks[1] === 0) msg.textContent += ` Bonuses: ${decl}.`;
  }
}

const botPause = v => !v.trick.length && v.lastTrick ? 1400 : 700;

// you act, then the bots take their turns with a short pause so you can follow along
function belotSend(action) {
  if (room) return roomCall('act', { action });
  Belot.apply(bel, { ...action, seat: 0 });
  belotStep();
}
function belotStep() {
  clearTimeout(belTimer);
  belotRender(Belot.view(bel, 0));
  if ((bel.phase === 'bid' || bel.phase === 'play') && bel.turn !== 0)
    belTimer = setTimeout(() => { Belot.apply(bel, Belot.bot(bel, bel.turn)); belotStep(); }, botPause(bel));
}
function freshTable() { shownCards = 0; paidGame = false; paidHand = ''; }
$('#belotNew').onclick = () => {
  if (room) leaveRoom();
  names = NAMES;
  bel = Belot.create(NAMES);
  freshTable();
  belotStep();
  sfx('card');
};

// --- online tables ----------------------------------------------------
function say(text, bad) { const m = $('#belotMsg'); m.className = 'table-msg' + (bad ? ' bad' : ''); m.textContent = text; }

let roomStale = false;
async function roomCall(op, extra = {}) {
  if (roomBusy) { if (op === 'view') roomStale = true; return; } // one request at a time; catch up afterwards
  roomBusy = true;
  try { showRoom(await belotCall(op, { code: room?.code, ...extra })); }
  catch (e) { if (op !== 'bot') say(e.message, true); if (op === 'bot' || /Busy/.test(e.message)) roomStale = true; }
  finally { roomBusy = false; }
  if (roomStale && room) { roomStale = false; setTimeout(() => roomCall('view'), 300); }
}

function showRoom(r) {
  if (!r || r.left) return;
  const first = room?.code !== r.code;
  if (r.version < (room?.version ?? -1) && !first) return; // a slower, older answer
  room = r;
  if (first) { freshTable(); subscribe(r.code); loadChat(r.code); }
  clearTimeout(roomPoll); // safety net: if a realtime ping is ever missed, re-check after a quiet spell
  roomPoll = setTimeout(() => room && roomCall('view'), 5000);
  $('#lobby').hidden = true;
  $('#room').hidden = false;
  $('#roomCode').textContent = r.code;
  const host = r.seats.findIndex(s => s && !s.bot);
  $('#roomSeats').replaceChildren(...r.seats.map((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = s ? pigIcon(s.color || '#c4c4c4') + '<span></span>' : '<span></span>';
    li.lastChild.textContent = s ? `${s.name}${i === r.seat ? ' (you)' : ''}${s.bot ? ' · bot' : ''}${i === host ? ' · host' : ''}`
      : `Seat ${i + 1}: waiting${r.started ? '' : ' (a bot plays if empty)'}`;
    li.className = (i % 2 === r.seat % 2 ? 'mate' : 'rival') + (s ? '' : ' empty');
    return li;
  }));
  $('#roomStart').hidden = r.started || r.seat !== host;
  if (!r.started) {
    names = NAMES;
    return say(r.seat === host ? 'Share the code. Seats across from you are your team. Press Start when ready.' : 'Waiting for the host to start…');
  }
  names = r.seats.map((s, i) => i === r.seat ? 'You' : s.name);
  names = names.map((_, i) => names[(i + r.seat) % 4]);
  const v = rotate(r.view, r.seat);
  belotRender(v);
  // the host's client nudges the bots; the server checks it's really a bot's turn
  clearTimeout(belTimer);
  if (r.seat === host && ['bid', 'play'].includes(r.view.phase) && r.seats[r.view.turn].bot)
    belTimer = setTimeout(() => roomCall('bot'), botPause(r.view));
}

function subscribe(code) {
  roomSub?.unsubscribe();
  // ponytail: realtime only says "something changed"; each client then fetches its own private view
  roomSub = sb.channel('lobby-' + code)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lobbies', filter: `code=eq.${code}` }, e => {
      if (e.eventType === 'DELETE') return leaveRoom(true);
      if (room && e.new.version > room.version) roomCall('view');
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'belot_chat', filter: `code=eq.${code}` }, e => addChat(e.new, true))
    .subscribe();
}

// --- table chat (online only): the server checks you're seated, realtime delivers new lines
async function loadChat(code) {
  $('#chat').hidden = false;
  $('#chatLog').replaceChildren();
  const { data } = await sb.from('belot_chat').select('id,seat,name,text').eq('code', code).order('id', { ascending: false }).limit(30);
  (data || []).reverse().forEach(m => addChat(m));
}
function addChat(m, fresh) {
  const log = $('#chatLog'), li = document.createElement('li');
  li.innerHTML = '<b></b> <span></span>';
  li.children[0].textContent = m.name + ':';
  li.children[1].textContent = m.text;
  if (m.seat === room?.seat) li.className = 'mine';
  else if (fresh) sfx('tick');
  log.append(li);
  while (log.children.length > 50) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}
$('#chatForm').onsubmit = e => {
  e.preventDefault();
  const text = $('#chatText').value.trim();
  if (!text || !room) return;
  $('#chatText').value = '';
  belotCall('chat', { code: room.code, text }).catch(err => { say(err.message, true); $('#chatText').value = text; });
};

function leaveRoom(quiet) {
  if (!room) return;
  if (!quiet) belotCall('leave', { code: room.code }).catch(() => {});
  roomSub?.unsubscribe();
  clearTimeout(belTimer);
  clearTimeout(roomPoll);
  room = roomSub = null;
  $('#lobby').hidden = false;
  $('#room').hidden = true;
  $('#chat').hidden = true;
  say('You left the table.');
}

$('#lobbyHost').onclick = () => { room = null; roomCall('create'); sfx('chip'); };
$('#lobbyJoin').onclick = () => {
  const code = $('#lobbyCode').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return say('Codes are 5 letters/numbers.', true);
  room = null;
  belotCall('join', { code }).then(showRoom, e => say(e.message, true));
};
$('#lobbyCode').onkeydown = e => { if (e.key === 'Enter') $('#lobbyJoin').click(); };
$('#roomStart').onclick = () => roomCall('start');
$('#roomLeave').onclick = () => leaveRoom();
$('#roomCopy').onclick = () => navigator.clipboard?.writeText(room.code).then(() => say('Code copied. Send it to your friends.'));
$("#lobby").hidden = !sb;
