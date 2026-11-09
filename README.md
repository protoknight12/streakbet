# StreakBet

A guest-only, play-money casino: **blackjack, roulette, a 5-reel slot** (with auto spin), **Белот** and **Свара**.
No accounts, no email, no passwords.

- **Your cash is saved on your computer**, in this browser's `localStorage['streakbet-guest']`. You start with $10,000;
  below $10 a "Free $1,000" button refills the wallet. The ⋯ menu lets you change your table name, download a save
  file, load one, or start over. Clearing site data erases the save, so download a backup now and then.
- **Belot and Свара vs bots** run entirely on the device.
- **Online tables with friends** (Belot lobby codes, Свара tables) use an anonymous Supabase login, created the first
  time you host or join one. They share the backend of [streakable](https://github.com/protoknight12/streakable)
  (project `wxqhnboqkeeilyfgltuf`, edge functions `belot` and `svara`). Свара buy-ins are charged from a server-side
  copy of your cash that is sent just before each buy-in; cash-outs come back as transfers and are claimed into the wallet.
  Guest profiles therefore also exist in streakable's `profiles` table, and the admin's "Delete old guests" button there
  would remove a guest's online identity (the local save is unaffected).

Plain HTML/CSS/JS, no build step. `core.js`, `casino.js`, `belot.js`, `svara.js`, `table.js`, `svaratable.js` are copies
from streakable (the engines must match the edge functions' `engine.js`).

| File | Role |
|---|---|
| `index.html` | Page: header (wallet, sound, name/save menu), tabs, the three games |
| `app.js` | Local save, wallet (`earn`/`spend`), sound, avatar, toast, name, save export/import |
| `online.js` | Anonymous login on demand, `belotCall`, `svaraCall`, claiming Свара cash-outs |
| `nav.js` | Top tabs |
| `casino.js`, `table.js`, `svaratable.js` | Casino games, Belot table UI, Свара UI |
| `core.js`, `belot.js`, `svara.js` + `*.test.js` | Rules and tests (`npm test`) |
| `sw.js`, `manifest.webmanifest` | Offline/PWA; add new files to `FILES` and bump `CACHE` |

Run locally: `npm run dev` → http://localhost:5174. Deployed as static files on GitHub Pages.
