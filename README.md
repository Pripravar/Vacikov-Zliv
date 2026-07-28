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

## Ještě není hotové (milník 2)
- **Firebase Storage** – EU bucket + pravidla `auth != null` + CORS `*`; přesměrovat fotky i PDF sem.
- **Převod technické specifikace (PD) do PDF** a navázání na staničení (panel výkresů).
- **Cloud Function deploy** (push notifikace, denní záloha DB) přes Firebase CLI.
- Stavební objekty / etapy (`STAVEBNI_OBJEKTY`, `SO_OBJEKTY`) – u téhle stavby minimálně (2 úseky/2 etapy).
