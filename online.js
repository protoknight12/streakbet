// Online layer for Belot and Свара tables with friends. Everyone is an anonymous Supabase user: no email, no password.
// The login is only created the first time you open or join an online table, and it stays in this browser's storage.
// Uses the same Supabase project and edge functions as the main streakable game.
const sb = window.supabase && CONFIG.url ? supabase.createClient(CONFIG.url, CONFIG.key) : null;
let me = null, claimSub = null;

const netError = e => e?.name === 'AuthRetryableFetchError' || e?.status === 0 || /failed to fetch|network|load failed|timed? ?out/i.test(e?.message || '');

// resolves with the saved login (or null); never signs in by itself, so a network hiccup can't create stray guests
const ready = (async () => {
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    me = data.session?.user || null;
    if (me) {
      const { error } = await sb.auth.getUser();
      if (error && !netError(error)) { try { await sb.auth.signOut({ scope: 'local' }); } catch {} me = null; } // account gone
    }
  } catch (e) { console.warn('auth:', e); }
  if (me) listenMoney();
  return me;
})();

// the anonymous login, made on first use
let loginP = null;
async function ensureLogin() {
  if (!sb) throw Error('Online play is not available right now');
  await ready;
  if (me) return me;
  loginP ||= sb.auth.signInAnonymously().then(({ data, error }) => {
    loginP = null;
    if (error) throw Error(netError(error) ? 'You need to be online for this' : error.message);
    me = data.user;
    listenMoney();
    return me;
  }, e => { loginP = null; throw e; });
  return loginP;
}

// guests are always "named": Guest 1234 until they pick one
const named = () => true;
function askName() {
  const n = prompt('Your name at the tables (up to 20 characters):', S.name);
  if (n === null) return;
  S.name = n.trim().replace(/[<>]/g, '').slice(0, 20) || S.name;
  save();
  showName();
}

// profile row: Свара buy-ins are charged from the server's copy of your cash, so it is sent before every paying call
async function upsertProfile() {
  const cash = Math.max(0, Math.floor(S.cash));
  const row = { id: me.id, name: S.name.slice(0, 20), color: S.color, cash, worth: cash, cars: 0, garage: [], homes: [], biz: [], skin: 'classic', level: 1 };
  let res = await sb.from('profiles').upsert(row);
  if (res.error?.code === 'PGRST204' && /'skin'/.test(res.error.message)) { delete row.skin; res = await sb.from('profiles').upsert(row); }
  return res;
}
const fnError = async error => (await error.context?.json?.().catch(() => null))?.error || 'Connection problem';

async function belotCall(op, extra = {}) {
  await ensureLogin();
  const { data, error } = await sb.functions.invoke('belot', { body: { op, name: S.name, color: S.color, ...extra } });
  if (error) throw Error(await fnError(error));
  return data;
}
// paying calls (create, join, rebuy) send your latest cash first; what the server charged leaves the local wallet too
async function svaraCall(op, extra = {}) {
  await ensureLogin();
  if (['create', 'join', 'rebuy'].includes(op)) {
    const up = await upsertProfile();
    if (up.error) throw Error(up.error.message);
  }
  const { data, error } = await sb.functions.invoke('svara', { body: { op, name: S.name, color: S.color, skin: 'classic', ...extra } });
  if (error) throw Error(await fnError(error));
  if (data.paid) { S.cash = Math.max(0, S.cash - data.paid); save(); renderCash(); }
  return data;
}

// Свара cash-outs arrive as transfers to yourself; claim them into the wallet
async function claimMoney() {
  const { data } = await sb.rpc('claim_money');
  if (!data?.length) return;
  const sum = data.reduce((s, t) => s + Number(t.amount), 0);
  data.forEach(t => logIncome(t.note?.slice(0, 40) || 'Transfer', Number(t.amount)));
  if (sum >= 0) { earn(sum); sfx('chaching'); } else { S.cash = Math.max(0, S.cash + sum); save(); renderCash(); sfx('lose'); }
  toast(data.length === 1 && data[0].note ? `${data[0].note}: ${fmt(Number(data[0].amount))}` : `${sum >= 0 ? 'You got' : 'You lost'} ${fmt(Math.abs(sum))}`);
}
function listenMoney() {
  if (claimSub || !me) return;
  claimMoney();
  claimSub = sb.channel('inbox').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transfers', filter: `recipient=eq.${me.id}` }, claimMoney).subscribe();
}
