// Свара tab: practice against bots on this device, or open a table and play with friends by code or link.
// Rules live in svara.js; online the svara edge function holds the cards and chips and every view puts you at the
// bottom. Chips are bought from the wallet; leaving the table cashes them out (online as a "Свара" transfer).
const SV_BOTS = ['Bot Pesho', 'Bot Gosho', 'Bot Mariika', 'Bot Tsetso', 'Bot Baba Penka'];
let sv = null;        // the table you sit at: { mode: 'local' | 'online', seat, view, seats?, host?, code?, version? }
let svLocal = null;   // practice: the engine state itself (saved in S.svaraLocal so a reload resumes it)
let svTimer, svSub, svPoll, svBusy = false;

const svMsg = (text, bad) => { $('#svMsg').textContent = text || ''; $('#svMsg').classList.toggle('bad', !!bad); };
const svMoney = n => fmt(n);
const svNum = id => Math.floor(+$(id).value);

// --- practice table -----------------------------------------------------------------------------------------
function svLocalSave() { S.svaraLocal = svLocal; save(); }
function svLocalView() { sv = { mode: 'local', seat: 0, view: Svara.view(svLocal, 0) }; svRender(); }
function svLocalAct(a) {
  try { Svara.apply(svLocal, a); } catch (e) { svMsg(e.message, true); return sfx('nope'); }
  // bots that ran dry buy back in, so the practice table never empties
  if (svLocal.phase === 'result') svLocal.seats.forEach(p => { if (p?.bot && p.stack < svLocal.ante) p.stack = svLocal.ante * 100; });
  svLocalSave(); svLocalView();
}
$('#svPractice').onclick = () => {
  const ante = svNum('#svAnte'), buyin = svNum('#svBuyin');
  if (!(ante >= 1) || !(buyin >= ante)) return svMsg('Pick an ante and a buy-in of at least one ante.', true);
  if (!spend(buyin)) return svMsg(`You have ${fmt(S.cash)}.`, true);
  sfx('yoink');
  const bots = 3;
  svLocal = Svara.create([{ name: named() ? S.name : 'You', stack: buyin },
    ...SV_BOTS.slice(0, bots).map(name => ({ name, stack: ante * 100, bot: true }))], ante);
  Svara.start(svLocal);
  svMsg('');
  svLocalSave(); svLocalView();
};

// --- online table ---------------------------------------------------------------------------------------------
function svOnline(data) {
  if (sv?.mode === 'online' && sv.code === data.code && data.version < sv.version) return; // an older answer arrived late
  sv = { mode: 'online', code: data.code, seat: data.seat, seats: data.seats, host: data.host, version: data.version, view: data.view };
  localStorage.setItem('svaraCode', data.code);
  if (!svSub || svSub.code !== data.code) {
    svSub?.ch.unsubscribe();
    svSub = { code: data.code, ch: sb.channel('svara-' + data.code)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'svara_rooms', filter: `code=eq.${data.code}` }, svRefresh).subscribe() };
    clearInterval(svPoll);
    svPoll = setInterval(() => !$('#svara').hidden && svRefresh(), 5000); // in case a realtime ping is missed
  }
  svRender();
}
async function svCall(op, extra = {}) {
  if (svBusy && op !== 'view') return null;
  if (op !== 'view') svBusy = true;
  try {
    const data = await svaraCall(op, { code: sv?.code, ...extra });
    if (data.left) return data;
    svOnline(data);
    return data;
  } catch (e) {
    if (op !== 'view' && op !== 'bot') { svMsg(e.message, true); sfx('nope'); }
    if (/No table|not at this table/.test(e.message)) svGone();
    return null;
  } finally { if (op !== 'view') svBusy = false; }
}
const svRefresh = () => sv?.mode === 'online' && svCall('view');
function svGone() {
  svSub?.ch.unsubscribe(); svSub = null;
  clearInterval(svPoll); clearTimeout(svTimer);
  localStorage.removeItem('svaraCode');
  sv = null; svRender();
}
$('#svCreate').onclick = async () => {
  const ante = svNum('#svAnte'), buyin = svNum('#svBuyin');
  if (!(ante >= 1) || !(buyin >= ante)) return svMsg('Pick an ante and a buy-in of at least one ante.', true);
  if (buyin > S.cash) return svMsg(`You have ${fmt(S.cash)}.`, true);
  svMsg('Opening a table…');
  if (await svCall('create', { ante, buyin })) { svMsg('Table open. Share the code or the link with your friends.'); sfx('chaching'); }
};
$('#svJoin').onsubmit = async e => {
  e.preventDefault();
  const code = $('#svCode').value.trim().toUpperCase(), buyin = svNum('#svBuyin');
  if (!/^[A-Z0-9]{5}$/.test(code)) return svMsg('A table code has 5 letters and digits.', true);
  if (!(buyin >= 1) || buyin > S.cash) return svMsg(buyin > S.cash ? `You have ${fmt(S.cash)}.` : 'Pick your buy-in first.', true);
  svMsg('Joining…');
  sv = null;
  if (await svaraJoin(code, buyin)) svMsg('');
};
const svaraJoin = (code, buyin) => svCall('join', { code, buyin });

// --- moves (both modes) -----------------------------------------------------------------------------------------
function svAct(a) {
  sfx(a.type === 'fold' || a.type === 'skip' ? 'tick' : 'chip');
  if (sv.mode === 'local') return svLocalAct({ ...a, seat: 0 });
  svCall('act', { action: a });
}
function svNext() { sv.mode === 'local' ? svLocalAct({ type: 'next' }) : svCall('next'); }
$('#svLeave').onclick = async () => {
  if (!sv) return;
  if (sv.mode === 'local') {
    const back = Svara.leave(svLocal, 0);
    if (back) earn(back, 'Свара practice cash-out');
    toast(back ? `You cashed out ${fmt(back)}` : 'You left the table');
    sfx('chaching');
    delete S.svaraLocal; save(); svLocal = null; sv = null; svRender();
    return;
  }
  const data = await svCall('leave');
  if (data?.left) { toast(data.back ? `Cashing out ${fmt(data.back)}: it lands in your wallet in a moment` : 'You left the table'); svGone(); }
};
$('#svRebuy').onclick = async () => {
  const n = svNum('#svRebuyAmt');
  if (!(n >= 1)) return svMsg('How many chips?', true);
  if (sv.mode === 'local') {
    if (svLocal.phase === 'bet' && svLocal.in[0]) return svMsg('Add chips between hands.', true);
    if (!spend(n)) return;
    Svara.addChips(svLocal, 0, n); svLocalSave(); svLocalView(); sfx('yoink');
  } else if (n > S.cash) { spend(n); } else if (await svCall('rebuy', { amount: n })) sfx('yoink');
};
$('#svShare').onclick = async () => {
  const url = `${location.origin}${location.pathname}?svara=${sv.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Свара', text: `Come play Свара with me: table ${sv.code}`, url });
    else { await navigator.clipboard.writeText(url); toast('Link copied. Send it to your friends.'); }
  } catch {}
};

// --- drawing ------------------------------------------------------------------------------------------------------
function svRender() {
  clearTimeout(svTimer);
  $('#svLobby').hidden = !!sv;
  $('#svTable').hidden = !sv;
  if (!sv) return;
  const v = sv.view, me = sv.seat, L = v.legal || {};
  $('#svTitle').textContent = sv.mode === 'local' ? 'Practice table' : `Table ${sv.code}`;
  $('#svShare').hidden = sv.mode !== 'online';
  $('#svInfo').textContent = `Ante ${svMoney(v.ante)} · hand ${v.hand || 0}${v.svara ? ' · СВАРА' : ''}`;
  const name = i => v.seats[i]?.name || '';
  const look = i => sv.mode === 'local' ? (i === me ? { color: S.color, skin: S.skin } : { color: '#c4c4c4' }) : sv.seats?.[i] || {};

  // seats, you first, then clockwise
  const order = Array.from({ length: Svara.SEATS }, (_, k) => (me + k) % Svara.SEATS);
  $('#svSeats').replaceChildren(...order.map(i => {
    const p = v.seats[i], el = document.createElement('div');
    if (!p) {
      el.className = 'sv-seat empty';
      el.textContent = 'Empty seat';
      if (sv.mode === 'local' || sv.host === me) {
        const add = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost small', textContent: '+ Bot' });
        add.onclick = () => {
          if (sv.mode === 'local') {
            const used = svLocal.seats.filter(Boolean).map(s => s.name);
            Svara.sit(svLocal, i, { name: SV_BOTS.find(b => !used.includes(b)) || 'Bot', stack: svLocal.ante * 100, bot: true });
            svLocalSave(); svLocalView();
          } else svCall('addbot');
        };
        el.append(add);
      }
      return el;
    }
    const playing = v.in[i], folded = v.hand && !playing && (v.phase === 'bet' || v.phase === 'join' || v.phase === 'result') && v.hands[i];
    el.className = 'sv-seat' + (i === me ? ' me' : '') + (v.turn === i || (v.phase === 'join' && v.joiners[0] === i) ? ' turn' : '') + (folded ? ' folded' : '')
      + (v.result?.winner === i ? ' won' : '') + (v.result?.svara?.includes(i) && v.phase === 'join' ? ' tie' : '');
    el.innerHTML = `<div class="sv-who">${pigIcon(look(i).color, look(i).skin)}<b></b>${v.dealer === i ? '<span class="sv-dealer" title="Dealer">D</span>' : ''}</div>`
      + '<div class="sv-stack"></div><div class="sv-cards"></div><div class="sv-note"></div>';
    el.querySelector('b').textContent = p.name + (i === me ? ' (you)' : '');
    el.querySelector('.sv-stack').textContent = `${svMoney(p.stack)}${v.bets[i] && playing ? ` · bet ${svMoney(v.bets[i])}` : ''}`;
    if (i !== me && v.hands[i]) el.querySelector('.sv-cards').append(...v.hands[i].map(c => cardEl(c || '', !c)));
    const sc = v.result?.scores?.[i];
    el.querySelector('.sv-note').textContent = sc != null && (v.phase === 'result' || v.phase === 'join') ? `${sc} points` : folded ? 'Пас' : p.stack < v.ante && !playing ? 'out of chips' : '';
    return el;
  }));

  // the middle: pot and what's happening
  $('#svPot').textContent = svMoney(v.pot);
  const turnName = v.phase === 'join' ? name(v.joiners[0]) : name(v.turn);
  $('#svState').textContent = v.phase === 'idle' ? (Svara.ready({ ...v, seats: v.seats }).length >= 2 ? 'Ready to deal.' : 'Waiting for players with chips…')
    : v.phase === 'bet' ? (v.turn === me ? 'Your turn.' : `${turnName} is thinking…`)
    : v.phase === 'join' ? `Свара! ${v.result.svara.map(name).join(' and ')} tie on ${v.result.top}. ${v.joiners[0] === me ? `Join for ${svMoney(L.cost)}?` : `${turnName} decides whether to join…`}`
    : v.result?.winner != null ? `${name(v.result.winner)} takes ${svMoney(v.result.pot)}${v.result.shown?.length ? ` with ${v.result.scores[v.result.winner]} points` : ': everyone else passed'}.` : '';

  // your cards
  const mine = v.hands[me];
  showCards($('#svMine'), mine || []); // only new cards animate in
  $('#svScore').textContent = v.my && mine ? v.my.text : '';

  // what you can do
  const acts = [];
  const btn = (text, cls, fn) => { const b = Object.assign(document.createElement('button'), { type: 'button', className: cls, textContent: text }); b.onclick = fn; acts.push(b); return b; };
  if (L.fold) {
    btn('Пас', 'ghost', () => svAct({ type: 'fold' }));
    btn(L.toCall ? `Плащам ${svMoney(L.toCall)}` : 'Чек', 'btn', () => svAct({ type: 'call' }));
    if (L.maxRaise) {
      const box = Object.assign(document.createElement('input'), { type: 'number', className: 'field sv-raise', min: L.minRaise, max: L.maxRaise, step: 1, value: Math.min(L.maxRaise, Math.max(L.minRaise, v.ante * 2)) });
      box.setAttribute('aria-label', 'Raise by');
      const quick = document.createElement('div');
      quick.className = 'sv-quick';
      for (const [t, n] of [['Ante', L.minRaise], ['½ pot', Math.floor(v.pot / 2)], ['Pot', v.pot], ['Max', L.maxRaise]]) {
        const q = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost small', textContent: t });
        q.onclick = () => { box.value = Math.min(L.maxRaise, Math.max(L.minRaise, n)); sfx('tick'); };
        quick.append(q);
      }
      const raise = btn('Вдигам', 'btn raise', () => svAct({ type: 'raise', amount: Math.floor(+box.value) }));
      acts.splice(acts.indexOf(raise), 0, box);
      acts.push(quick);
    }
  } else if (L.skip) {
    if (L.join) btn(`Влизам за ${svMoney(L.cost)}`, 'btn', () => svAct({ type: 'join' }));
    btn('Не влизам', 'ghost', () => svAct({ type: 'skip' }));
    if (!L.join) acts.push(Object.assign(document.createElement('span'), { className: 'muted', textContent: `Joining costs ${svMoney(L.cost)}; you don't have enough chips.` }));
  } else if (v.phase === 'result' || v.phase === 'idle') {
    btn(v.phase === 'idle' ? 'Deal' : 'Next hand', 'btn', svNext);
  }
  // a friend who went quiet can be folded after 45 s
  const waitingOn = v.phase === 'bet' ? v.turn : v.phase === 'join' ? v.joiners[0] : -1;
  if (sv.mode === 'online' && waitingOn >= 0 && waitingOn !== me && !v.seats[waitingOn]?.bot) {
    const left = 45e3 - (Date.now() - v.turnAt);
    if (left <= 0) btn(`Fold ${name(waitingOn)} (away)`, 'ghost small', () => svCall('nudge'));
    else svTimer = setTimeout(svRender, left + 200);
  }
  $('#svActs').replaceChildren(...acts);
  $('#svRebuyRow').hidden = !!(v.phase === 'bet' && v.in[me]);
  $('#svLog').replaceChildren(...v.log.slice(-6).reverse().map(t => Object.assign(document.createElement('li'), { textContent: t })));

  // keep the bots (and the dealing) going: locally always, online only from the host's device
  const drive = sv.mode === 'local' || sv.host === me;
  const botUp = waitingOn >= 0 && v.seats[waitingOn]?.bot;
  if (drive && botUp) svTimer = setTimeout(() => sv.mode === 'local' ? svLocalAct(Svara.bot(svLocal, waitingOn)) : svCall('bot'), 800 + Math.random() * 600);
  else if (drive && v.phase === 'result' && Svara.ready(v).length >= 2) svTimer = setTimeout(svNext, 5000);
}

onView.svara = () => {
  if (!sv && S.svaraLocal) { svLocal = S.svaraLocal; svLocalView(); }
  else if (!sv && localStorage.getItem('svaraCode') && sb) svCall('view', { code: localStorage.getItem('svaraCode') }); // back at your table after a reload
  else if (sv?.mode === 'online') svRefresh();
  else svRender();
};
// a shared link (?svara=CODE) fills in the code and opens the tab
{
  const code = new URLSearchParams(location.search).get('svara');
  if (code && /^[A-Za-z0-9]{5}$/.test(code)) {
    $('#svCode').value = code.toUpperCase();
    history.replaceState(null, '', location.pathname);
    $('#views [data-view=svara]').click();
  }
}
svRender();
