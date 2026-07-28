# II/176 Vacíkov–Volenice–Zliv — mobilní mapa stavby

Jednosouborová webová aplikace (velín) pro stavbu **II/176 Vacíkov-Nová Luka-Volenice-Zliv**
(oprava povrchu komunikace, km 3,400–8,450, okr. Příbram, objednatel KSÚS Středočeského kraje).

- **Web (za přihlášením):** https://pripravar.github.io/Vacikov-Zliv/
- **Hosting:** GitHub Pages (větev `main`, kořen) — jen `index.html` + pomocné soubory.
- **Citlivá data (PDF dokumentace, fotky):** Firebase Storage **za přihlášením** (ne veřejně na GitHubu).
- **Backend:** Firebase projekt `vacikov-zliv` (europe-west1) — Realtime Database, Google Auth, Cloud Messaging, Storage.

## Osa a staničení
- `GPX_POINTS` — 117 bodů osy z Mapy.cz exportu (ZÚ km 3,400 → KÚ km 8,450).
- `CALIB_POINTS` — 2 kalibrační body (ZÚ, KÚ). Staničení se mezi nimi interpoluje podle délky osy.
- Délka kreslené osy 5,24 km vs. nominál 5,05 km (~4 %); oba konce jsou ukotvené přesně.

## Klíčové soubory
| Soubor | Účel |
|---|---|
| `index.html` | Celá aplikace (HTML+CSS+JS). Data konstanty nahoře ve `<script>`. |
| `manifest.json` | PWA (přidání na plochu). |
| `service-worker.js` | Background push (FCM) + fetch handler pro instalaci. Záměrně **necachuje** (aby data byla vždy aktuální). |
| `firebase-messaging-sw.js` | Fallback FCM background SW. |
| `icon-192.png`, `icon-512.png` | Ikony PWA. |
| `cloud-function/` | Cloud Functions (push/zálohy). Fotky NEjdou přes GitHub — jdou na Storage. |

## Backend – co je nastaveno
- **Realtime Database** (europe-west1), pravidla: `{ ".read": true, ".write": "auth != null" }`.
- **Google Auth** zapnutý; autorizovaná doména `pripravar.github.io`.
- **Blaze plán** aktivní (fakturační účet „Můj fakturační účet").
- **Cloud Messaging** VAPID klíč vygenerován (v `index.html`).

## Konfigurace (kde co je v `index.html`)
`MAPY_API_KEY`, `FIREBASE_CONFIG`, `FIREBASE_VAPID_KEY`, `FIREBASE_URL`, `KM_START/END`,
`GPX_POINTS`, `CALIB_POINTS`, `GITHUB_USER_REPO`, `UPLOAD_FN_URL`.

## Hotové funkce (nad rámec základu)
- **Soukromé soubory přes Firebase Storage** (EU bucket, pravidla `auth != null`, CORS `*`) – fotky i PDF jen pro přihlášené; do DB se ukládají cesty, ne odkazy. Ověřeno: s tokenem 200, bez tokenu 403.
- **PD (technická specifikace) jako PDF** na Storage, navázaná na staničení (klik na km 3,400–8,450 → panel).
- **Správa uživatelů / práva** (admin panel 👥): per‑funkce práva (allow‑by‑default), blokování, povýšení na admina. Bootstrap admin = e‑mail koordinátora. Tvrdá brána = Firebase DB pravidla (`database.rules.json`, nasazeno).
- **Mazání jen vlastních** (`canDeleteRecord`) – nové fotky nesou `ownerUid`; admin smaže vše, legacy bez vlastníka smí každý.
- **Galerie:** miniatury (rychlé načítání), nastavitelná hustota mřížky (−/+), procházení fotek **tažením** ve fullscreenu (šipky, počítadlo, klávesy).
- **Place mode** – tlačítko 📍➕ + křížek na střed mapy (spolehlivější než long‑press).
- **Uložit / obnovit pohled** mapy (💾 Uložit / 📍 Můj / ⌂ Výchozí ve Vrstvách).
- **Vrstvy vyčištěné** – odebrány template objekty, které stavba nemá; pod‑vrstvy poznámek/úkolů se zobrazí až po zapnutí hlavního přepínače; sekce mají práva (`data-perm`).

## Backlog (další dávka)
- Nahrávání PDF/výkresů z aplikace (přes Storage) – umožní doplnit i přílohu **PAU** bez servisního klíče.
- Měření vzdálenosti/plochy + evidence.
- Úkoly: převzetí / předání / dokončení s historií.
- Hromadné mazání fotek z galerie.
- Fotky v mapě (fotomapa) jako vrstva.
- Statistika nejpoužívanějších funkcí.
- Plynulé focení – upload na pozadí.
- (Odloženo dle zadání: dron, 360°, push notifikace.)
