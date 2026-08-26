/* ════════════════════════════════════════════════════════════════
   CLOUD FUNCTION – odesílání push notifikací
   - Sleduje /notifikace_fronta v Realtime Database
   - Pro každý nový záznam pošle FCM zprávu příjemcům
   - Po odeslání záznam smaže (aby fronta nerostla)

   DEPLOYMENT:
     1. Nainstaluj Node.js (verze 18+) a Firebase CLI:
          npm install -g firebase-tools
     2. V této složce (cloud-function) spusť:
          npm install
          firebase login
          firebase init functions      (vyber existující projekt sulice-zelivec)
          ...ale tento soubor index.js si chraň – pokud Firebase zeptal,
             zda přepsat, řekni N (Ne), nebo prostě překopíruj zpět.
     3. Deploy:
          firebase deploy --only functions

   POŽADAVKY: plán Firebase 'Blaze' (pay-as-you-go), free tier pokryje
   stovky notifikací denně bez nákladů. Stačí jednou zadat platební kartu
   v Firebase Console - dokud nepřekročíš limit, žádné poplatky.
   ════════════════════════════════════════════════════════════════ */

// firebase-functions v6 vyžaduje explicitní /v1 import pro starší API (.ref().onCreate())
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.database();

// Funkce musí běžet ve stejné oblasti jako Realtime DB (europe-west1).
exports.sendTaskNotifications = functions
  .region('europe-west1')
  .database
  .ref('/notifikace_fronta/{id}')
  .onCreate(async (snap, context) => {
    const rec = snap.val();
    if(!rec) return null;

    // Sestavit titulek a tělo zprávy podle typu
    let title = 'Sulice – Želivec';
    let body  = '';
    let recipientUids = [];

    if(rec.typ === 'novy') {
      title = '✅ Nový úkol';
      body = (rec.zadalName || 'Někdo') + ' ti zadal: ' + (rec.title || '');
      recipientUids = (rec.prirazeno || []).map(p => p.uid).filter(Boolean);
    } else if(rec.typ === 'hotovo') {
      title = '🎉 Úkol hotov';
      body = 'Úkol "' + (rec.title || '') + '" byl označen jako hotový.';
      // Posíláme zadavateli (pokud zadavatel != ten, kdo úkol dokončil - tady jsme záměrně laxní)
      if(rec.zadalUid) recipientUids.push(rec.zadalUid);
    } else if(rec.typ === 'komentar') {
      title = '💬 Nový komentář';
      body = 'Komentář k úkolu "' + (rec.title || '') + '"';
      // Posíláme zadavateli i všem přiřazeným
      if(rec.zadalUid) recipientUids.push(rec.zadalUid);
      (rec.prirazeno || []).forEach(p => { if(p.uid) recipientUids.push(p.uid); });
    }

    // Odstranit duplicity
    // typ:'chat' – zpráva v interním chatu; příjemci = členové kanálu (bez pisatele), přijdou v záznamu
    if(rec.typ === 'chat') {
      title = '💬 ' + (rec.kanalNazev || 'Chat');
      body = (rec.zadalName || 'Někdo') + ': ' + (rec.komentText || '');
      recipientUids = (rec.recipientUids || []).filter(Boolean);
    }

    if(rec.typ === 'zminka') {
      title = '💬 Označení' + (rec.label ? (' – ' + rec.label) : '');
      body = (rec.zadalName || 'Někdo') + ': ' + (rec.komentText || '');
      recipientUids = (rec.recipientUids || []).filter(Boolean);
    }

    recipientUids = [...new Set(recipientUids)];

    if(recipientUids.length === 0) {
      console.log('Žádní příjemci, mažu záznam.');
      return snap.ref.remove();
    }

    // Najít FCM tokeny příjemců
    const usersSnap = await db.ref('/uzivatele').once('value');
    const users = usersSnap.val() || {};
    if(rec.typ === 'chat' && rec.kanalId){ recipientUids = recipientUids.filter(uid => !(users[uid] && users[uid].chatMute && users[uid].chatMute[rec.kanalId] === true)); }
    const rawTokens = [];
    recipientUids.forEach(uid => {
      const u = users[uid];
      if(!u) return;
      if(u.fcmToken) rawTokens.push(u.fcmToken);
      if(u.fcmTokens) Object.keys(u.fcmTokens).forEach(k => { if(u.fcmTokens[k]) rawTokens.push(u.fcmTokens[k]); });
    });
    const tokens = [...new Set(rawTokens)];

    if(tokens.length === 0) {
      console.log('Žádné FCM tokeny u příjemců.');
      return snap.ref.remove();
    }

    // Připravit zprávu
    const message = {
      notification: { title, body },
      data: {
        taskId: rec.taskId || '',
        kanalId: rec.kanalId || '',
        fotoKey: rec.fotoKey || '',
        typ:    rec.typ    || ''
      },
      tokens: tokens
    };

    try {
      const resp = await admin.messaging().sendEachForMulticast(message);
      console.log('FCM odesláno:', resp.successCount, '/', tokens.length);
      // Smazat neplatné tokeny
      const cleanupPromises = [];
      resp.responses.forEach((r, idx) => {
        if(!r.success) {
          const err = r.error;
          const badToken = tokens[idx];
          if(err && (err.code === 'messaging/invalid-registration-token' ||
                     err.code === 'messaging/registration-token-not-registered')) {
            // Najít uživatele, kdo má tento token, a smazat ho
            Object.keys(users).forEach(uid => {
              const u = users[uid]; if(!u) return;
              if(u.fcmToken === badToken) cleanupPromises.push(db.ref('/uzivatele/' + uid + '/fcmToken').remove());
              if(u.fcmTokens) Object.keys(u.fcmTokens).forEach(k => { if(u.fcmTokens[k] === badToken) cleanupPromises.push(db.ref('/uzivatele/' + uid + '/fcmTokens/' + k).remove()); });
            });
          }
        }
      });
      await Promise.all(cleanupPromises);
    } catch(e) {
      console.error('Chyba odeslání FCM:', e);
    }

    return snap.ref.remove();
  });

/* ════════════════════════════════════════════════════════════════
   HTTPS FUNKCE – upload fotky do GitHubu (token zůstává na serveru)
   - Klient pošle POST { filename, content (base64 JPEG) } + Firebase ID token
   - Funkce ověří přihlášení, validuje jméno souboru a commitne do repa
   - GitHub token je v Secret Manageru, NIKDY v prohlížeči

   NASTAVENÍ TOKENU (jednou):
     firebase functions:secrets:set GITHUB_TOKEN
       → vlož NOVÝ fine-grained PAT (repo Sulice---Zelivec, Contents: Read&Write)
   DEPLOY:
     firebase deploy --only functions
   URL po deployi:
     https://europe-west1-sulice-zelivec.cloudfunctions.net/uploadFoto
   ════════════════════════════════════════════════════════════════ */
const GH_REPO     = 'Pripravar/Vacikov-Zliv';         /* jméno repa stavby */
const GH_BRANCH   = 'main';
const ALLOW_ORIGIN = 'https://pripravar.github.io'; /* origin GitHub Pages (CORS) */

exports.uploadFoto = functions
  .region('europe-west1')
  .runWith({ secrets: ['GITHUB_TOKEN'] })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if(req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if(req.method !== 'POST')    { res.status(405).json({ error: 'Jen POST' }); return; }

    // 1) Ověřit přihlášeného uživatele (Firebase ID token)
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if(!idToken) { res.status(401).json({ error: 'Chybí přihlášení' }); return; }
    try {
      await admin.auth().verifyIdToken(idToken);
    } catch(e) {
      res.status(401).json({ error: 'Neplatné přihlášení' }); return;
    }

    // 2) Validovat vstup
    const body = req.body || {};
    const filename = String(body.filename || '');
    const content  = String(body.content  || '');
    // jen bezpečné názvy: písmena, číslice, tečka, podtržítko, pomlčka, volitelně jedna
    // podsložka (např. "standalone/"), končí .jpg/.jpeg/.png. Bez ".." a bez úvodního "/".
    if(!/^([A-Za-z0-9_-]+\/)?[A-Za-z0-9._-]+\.(jpe?g|png)$/i.test(filename)) {
      res.status(400).json({ error: 'Neplatné jméno souboru' }); return;
    }
    if(!content || content.length > 12 * 1024 * 1024) { // ~9 MB binárně
      res.status(400).json({ error: 'Chybí nebo příliš velký obsah' }); return;
    }

    // 3) Commit do GitHubu (token ze Secret Manageru)
    const apiUrl = 'https://api.github.com/repos/' + GH_REPO + '/contents/photos/' + filename;
    try {
      const ghResp = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': 'token ' + process.env.GITHUB_TOKEN,
          'Content-Type':  'application/json',
          'User-Agent':    'sulice-zelivec-fn'
        },
        body: JSON.stringify({ message: 'Foto: ' + filename, content: content, branch: GH_BRANCH })
      });
      const data = await ghResp.json();
      if(ghResp.ok && data && data.content && data.content.download_url) {
        res.status(200).json({ download_url: data.content.download_url });
      } else {
        console.error('GitHub upload err:', ghResp.status, JSON.stringify(data));
        res.status(502).json({ error: (data && data.message) || 'GitHub upload selhal' });
      }
    } catch(e) {
      console.error('uploadFoto výjimka:', e);
      res.status(500).json({ error: 'Chyba serveru při uploadu' });
    }
  });

/* ════════════════════════════════════════════════════════════════
   HTTPS FUNKCE – upload VÝKRESU (PDF) do GitHubu (pdf/ složka)
   - Klient pošle POST { filename, content (base64 PDF) } + Firebase ID token
   - Funkce ověří přihlášení, validuje jméno (jen .pdf, volitelně jedna podsložka
     např. "SO_101/") a commitne do pdf/ v repu. Token zůstává na serveru.
   - Stejný GITHUB_TOKEN secret jako uploadFoto.
   - Samostatná funkce (NE rozšíření uploadFoto) — uploadFoto běží v provozu,
     nesaháme do ní. URL po deployi:
       https://europe-west1-<projekt>.cloudfunctions.net/uploadVykres
   ════════════════════════════════════════════════════════════════ */
exports.uploadVykres = functions
  .region('europe-west1')
  .runWith({ secrets: ['GITHUB_TOKEN'] })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if(req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if(req.method !== 'POST')    { res.status(405).json({ error: 'Jen POST' }); return; }

    // 1) Ověřit přihlášeného uživatele (Firebase ID token)
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if(!idToken) { res.status(401).json({ error: 'Chybí přihlášení' }); return; }
    try {
      await admin.auth().verifyIdToken(idToken);
    } catch(e) {
      res.status(401).json({ error: 'Neplatné přihlášení' }); return;
    }

    // 2) Validovat vstup – jen .pdf, volitelně jedna podsložka, bez ".." a bez úvodního "/"
    const body = req.body || {};
    const filename = String(body.filename || '');
    const content  = String(body.content  || '');
    if(!/^([A-Za-z0-9_-]+\/)?[A-Za-z0-9._-]+\.pdf$/i.test(filename)) {
      res.status(400).json({ error: 'Neplatné jméno souboru (povoleno jen .pdf)' }); return;
    }
    if(!content || content.length > 12 * 1024 * 1024) { // ~9 MB binárně
      res.status(400).json({ error: 'Chybí nebo příliš velký obsah (max ~9 MB)' }); return;
    }

    // 3) Commit do GitHubu do pdf/ (token ze Secret Manageru)
    const apiUrl = 'https://api.github.com/repos/' + GH_REPO + '/contents/pdf/' + filename;
    try {
      const ghResp = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': 'token ' + process.env.GITHUB_TOKEN,
          'Content-Type':  'application/json',
          'User-Agent':    'stavba-fn'
        },
        body: JSON.stringify({ message: 'Výkres: ' + filename, content: content, branch: GH_BRANCH })
      });
      const data = await ghResp.json();
      if(ghResp.ok && data && data.content && data.content.download_url) {
        res.status(200).json({ download_url: data.content.download_url, path: 'pdf/' + filename });
      } else {
        console.error('GitHub upload výkresu err:', ghResp.status, JSON.stringify(data));
        res.status(502).json({ error: (data && data.message) || 'GitHub upload selhal' });
      }
    } catch(e) {
      console.error('uploadVykres výjimka:', e);
      res.status(500).json({ error: 'Chyba serveru při uploadu výkresu' });
    }
  });

/* ════════════════════════════════════════════════════════════════
   HTTPS FUNKCE – upload FOTKY Z DRONU do GitHubu (drone/ složka)
   - Klient pošle POST { filename, content (base64 JPEG/PNG) } + Firebase ID token
   - Fotka z dronu se NEzmenšuje na 1600 px (jako běžné fotky) – kvůli čitelnosti
     při měření přes ni. Proto vyšší limit (~10 MB binárně). Klient ji zmenší na
     max ~3000 px / Q0.85 sám, ať se vejde a upload je svižný.
   - Samostatná funkce (NE rozšíření uploadFoto – jiný limit i složka). Commit do drone/.
   - Stejný GITHUB_TOKEN secret + ALLOW_ORIGIN jako uploadFoto. URL po deployi:
       https://europe-west1-<projekt>.cloudfunctions.net/uploadDroneFoto
   ════════════════════════════════════════════════════════════════ */
exports.uploadDroneFoto = functions
  .region('europe-west1')
  .runWith({ secrets: ['GITHUB_TOKEN'] })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if(req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if(req.method !== 'POST')    { res.status(405).json({ error: 'Jen POST' }); return; }

    // 1) Ověřit přihlášeného uživatele (Firebase ID token)
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if(!idToken) { res.status(401).json({ error: 'Chybí přihlášení' }); return; }
    try {
      await admin.auth().verifyIdToken(idToken);
    } catch(e) {
      res.status(401).json({ error: 'Neplatné přihlášení' }); return;
    }

    // 2) Validovat vstup – jen jpg/png, bez podsložky, bez ".." a bez úvodního "/"
    const body = req.body || {};
    const filename = String(body.filename || '');
    const content  = String(body.content  || '');
    if(!/^[A-Za-z0-9._-]+\.(jpe?g|png)$/i.test(filename) || filename.indexOf('..') !== -1) {
      res.status(400).json({ error: 'Neplatné jméno souboru' }); return;
    }
    if(!content || content.length > 14 * 1024 * 1024) { // ~10 MB binárně (gen1 strop requestu)
      res.status(400).json({ error: 'Chybí nebo příliš velký obsah (max ~10 MB)' }); return;
    }

    // 3) Commit do GitHubu do drone/ (token ze Secret Manageru); sha při update
    const apiUrl = 'https://api.github.com/repos/' + GH_REPO + '/contents/drone/' + filename;
    try {
      let sha = null;
      try {
        const head = await fetch(apiUrl + '?ref=' + GH_BRANCH, {
          headers: { 'Authorization': 'token ' + process.env.GITHUB_TOKEN, 'User-Agent': 'stavba-fn' }
        });
        if(head.ok) { const hd = await head.json(); if(hd && hd.sha) sha = hd.sha; }
      } catch(_) { /* soubor neexistuje – ok */ }
      const payload = { message: 'Drone foto: ' + filename, content: content, branch: GH_BRANCH };
      if(sha) payload.sha = sha;
      const ghResp = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': 'token ' + process.env.GITHUB_TOKEN,
          'Content-Type':  'application/json',
          'User-Agent':    'stavba-fn'
        },
        body: JSON.stringify(payload)
      });
      const data = await ghResp.json();
      if(ghResp.ok && data && data.content && data.content.download_url) {
        res.status(200).json({ download_url: data.content.download_url, path: 'drone/' + filename });
      } else {
        console.error('GitHub upload drone err:', ghResp.status, JSON.stringify(data));
        res.status(502).json({ error: (data && data.message) || 'GitHub upload selhal' });
      }
    } catch(e) {
      console.error('uploadDroneFoto výjimka:', e);
      res.status(500).json({ error: 'Chyba serveru při uploadu' });
    }
  });

/* ════════════════════════════════════════════════════════════════
   NAPLÁNOVANÁ FUNKCE – denní záloha celé Realtime Database
   - Jednou denně vyexportuje celý strom DB jako JSON a uloží do
     PRIVÁTNÍHO Firebase Storage bucketu (zalohy/db-<den>.json + db-latest.json).
   - Storage je soukromé → záloha smí obsahovat i osobní údaje (jména, e-maily,
     podpisy). NIKDY ji neukládej do veřejného GitHub repa (GitHub Pages = public).
   - Nepoužívá GITHUB_TOKEN; jen admin SDK (Storage). firebase-admin Storage obsahuje.

   PŘED DEPLOYEM (jednou): Firebase Console → Build → Storage → Get started (default bucket).
   DEPLOY: firebase deploy --only functions:backupDatabase
   Při prvním deployi Firebase zapne Cloud Scheduler + Pub/Sub API (příp. App Engine app
   v regionu) – uživatel potvrdí v konzoli.

   OBNOVA: Console → Storage → zalohy/ → stáhnout db-latest.json →
           Realtime Database → kořen → ⋮ → Import JSON (POZOR: přepíše data).
   ════════════════════════════════════════════════════════════════ */
exports.backupDatabase = functions
  .region('europe-west1')
  .pubsub.schedule('every 24 hours')
  .timeZone('Europe/Prague')
  .onRun(async () => {
    const snap = await admin.database().ref('/').once('value');
    const data = snap.val() || {};
    const json = JSON.stringify(data);
    const d = new Date();
    const stamp = d.toISOString().slice(0, 10); // YYYY-MM-DD
    // Default bucket projektu. POZN.: nové projekty (2024+) mají bucket
    // '<projekt>.firebasestorage.app'. Když funkce spadne na "bucket not found",
    // uveď název explicitně: admin.storage().bucket('<projekt>.firebasestorage.app').
    const bucket = admin.storage().bucket();
    const opts = { contentType: 'application/json', resumable: false };
    try {
      await bucket.file('zalohy/db-' + stamp + '.json').save(json, opts); // denní snímek
      await bucket.file('zalohy/db-latest.json').save(json, opts);        // vždy nejnovější
      console.log('Záloha DB OK:', stamp, '(' + json.length + ' B)');
    } catch(e) {
      console.error('Záloha DB selhala:', e);
    }
    return null;
  });

exports.extractDodaciList = functions
  .region('europe-west1')
  .runWith({ secrets: ['ANTHROPIC_API_KEY'], timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if(req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if(req.method !== 'POST')    { res.status(405).json({ error: 'Jen POST' }); return; }

    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if(!idToken) { res.status(401).json({ error: 'Chybí přihlášení' }); return; }
    try { await admin.auth().verifyIdToken(idToken); }
    catch(e) { res.status(401).json({ error: 'Neplatné přihlášení' }); return; }

    const body = req.body || {};
    let image = String(body.image || '').replace(/^data:[^;]+;base64,/, '');
    const mime = /png/i.test(String(body.mime || '')) ? 'image/png' : 'image/jpeg';
    if(!image || image.length > 8 * 1024 * 1024) {
      res.status(400).json({ error: 'Chybí nebo příliš velký obrázek' }); return;
    }

    const extra = Array.isArray(body.extra) ? body.extra.slice(0,8) : [];
    const extraKeys = extra.map(function(e){ return String((e&&e.key)||'').replace(/[^a-zA-Z0-9_]/g,'').slice(0,32); }).filter(Boolean);
    const extraJson = extraKeys.map(function(k){ return '"'+k+'":""'; }).join(',');
    const extraDesc = extra.map(function(e){ var k=String((e&&e.key)||'').replace(/[^a-zA-Z0-9_]/g,'').slice(0,32); return k?(k+'='+String((e&&e.hint)||'').slice(0,140)):''; }).filter(Boolean).join('; ');
    const PROMPT = 'Na obrázku je DODACÍ LIST (dodávka materiálu na stavbu silnice v ČR). '
      + 'Vytáhni údaje a vrať POUZE JSON (žádný jiný text) přesně v tomto tvaru:\n'
      + '{"dodavatel":"","cisloDL":"","datum":"","spz":"","kvalita":"","polozky":[{"co":"","specifikace":"","mnozstvi":"","jednotka":""}]' + (extraJson ? (','+extraJson) : '') + '}\n'
      + 'Význam: dodavatel=kdo dodal (firma/závod/obalovna); cisloDL=číslo dodacího listu; datum=datum na dokladu ve formátu RRRR-MM-DD; spz=SPZ vozidla pokud je uvedena. '
      + 'polozky=seznam VŠECH dodaných položek na dokladu (u betonu obvykle jedna, u stavebnin i více řádků). Každá položka: co=materiál/zboží stručně (Beton, Obalované kamenivo, Ocel…); specifikace=třída/pevnost/značka – u betonu VŽDY plné značení (C30/37 XF4 XC4 Cl0,4 Dmax22 S4), u oceli B500B apod.; mnozstvi=jen číselná hodnota; jednotka=t/m3/ks/m/kg. '
      + (extraDesc ? ('Dále z dokladu vytáhni tyto údaje: ' + extraDesc + '. ') : '')
      + 'kvalita=posuď čitelnost FOTKY dokladu: "ok" když jde dobře přečíst, "rozmazane" když jen částečně, "necitelne" když je rozmazaná/tmavá/z úhlu a NEJDE spolehlivě přečíst (uživatel má vyfotit znovu). '
      + 'DŮLEŽITÉ: pokud údaj na dokladu JE, ale kvůli rozmazání/kvalitě ho NEJDE spolehlivě přečíst, napiš "?" (otazník) MÍSTO hádání. Prázdný řetězec dej jen když údaj na dokladu VŮBEC není. V polozky vrať aspoň jednu položku. Nic jiného nepiš.';

    try {
      const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 1024,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: image } },
            { type: 'text', text: PROMPT }
          ]}]
        })
      });
      const data = await aiResp.json();
      if(!aiResp.ok) {
        console.error('Anthropic err:', aiResp.status, JSON.stringify(data));
        res.status(502).json({ error: (data && data.error && data.error.message) || 'AI chyba' }); return;
      }
      let text = '';
      try { text = (data.content || []).map(function(b){ return b && b.type === 'text' ? b.text : ''; }).join(''); } catch(e){}
      let parsed = {};
      try { const m = text.match(/\{[\s\S]*\}/); if(m) parsed = JSON.parse(m[0]) || {}; } catch(e){ console.warn('parse JSON z AI selhal:', e && e.message); }
      const polozky = Array.isArray(parsed.polozky) ? parsed.polozky.map(function(it){ it=it||{}; return { co:String(it.co||''), specifikace:String(it.specifikace||''), mnozstvi:String(it.mnozstvi||''), jednotka:String(it.jednotka||'') }; }).filter(function(it){ return it.co||it.specifikace||it.mnozstvi||it.jednotka; }) : [];
      const first = polozky[0] || {};
      const fields = { co:String(first.co||''), specifikace:String(first.specifikace||''), mnozstvi:String(first.mnozstvi||''), jednotka:String(first.jednotka||''), dodavatel:String(parsed.dodavatel||''), cisloDL:String(parsed.cisloDL||''), datum:String(parsed.datum||''), spz:String(parsed.spz||'') };
      const extraVals = {}; extraKeys.forEach(function(k){ if(parsed[k] != null) extraVals[k] = String(parsed[k]); });
      res.status(200).json({ ok: true, fields: fields, polozky: polozky, extra: extraVals, kvalita: String(parsed.kvalita||''), usage: data.usage || null });
    } catch(e) {
      console.error('extractDodaciList výjimka:', e);
      res.status(500).json({ error: 'Chyba serveru při AI' });
    }
  });

