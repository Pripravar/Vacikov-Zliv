/* Service worker pro II/176 Vacíkov–Zliv
   Účel:
   1) Background push (Firebase Cloud Messaging).
   2) Splnit podmínku "má fetch handler" kvůli instalaci PWA na plochu.
   ZÁMĚRNĚ NEcachujeme app shell agresivně — u téhle appky je kritické, aby se
   po pushi/commitu vždy načetla čerstvá data (opakovaná past se stale cache).
   Fetch je proto čistě síťový průchod (network-only). */

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyCsnMGlGG9ALS74Q2_bANecvk3GtGMa1P8',
  authDomain:        'vacikov-zliv.firebaseapp.com',
  databaseURL:       'https://vacikov-zliv-default-rtdb.europe-west1.firebasedatabase.app',
  projectId:         'vacikov-zliv',
  storageBucket:     'vacikov-zliv.firebasestorage.app',
  messagingSenderId: '5136463422',
  appId:             '1:5136463422:web:60ab1c84dc697da48b836f'
});

try {
  var messaging = firebase.messaging();
  /* Odznáček na ikoně na ploše – trvalý čítač (přežije zavření appky). Ukládá se přes Cache API;
   appka po otevření pošle {type:'clearBadge'} → vynulujeme. Číslo (ne prázdný dot) se na iOS zobrazí spolehlivěji. */
async function _badgeGet(){ try{ var c=await caches.open('ms-badge'); var r=await c.match('count'); return r ? (parseInt(await r.text(),10)||0) : 0; }catch(e){ return 0; } }
async function _badgePut(n){ try{ var c=await caches.open('ms-badge'); await c.put('count', new Response(String(n))); }catch(e){} }
async function _bumpAppBadge(){ try{ var n=(await _badgeGet())+1; await _badgePut(n); if(self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(n); }catch(e){} }
async function _clearAppBadgeSW(){ try{ await _badgePut(0); if(self.navigator && self.navigator.clearAppBadge) await self.navigator.clearAppBadge(); }catch(e){} }
self.addEventListener('message', function(e){ if(e.data && e.data.type==='clearBadge'){ if(e.waitUntil) e.waitUntil(_clearAppBadgeSW()); else _clearAppBadgeSW(); } });

messaging.onBackgroundMessage(function(payload){
    var n = payload.notification || {};
    self.registration.showNotification(n.title || 'II/176 Vacíkov–Zliv', {
      body: n.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: payload.data || {}
    });
    _bumpAppBadge();   // odznak na ikoně i při zavřené appce
  });
} catch(e){ /* messaging nemusí být dostupný v tomto kontextu */ }

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var d = e.notification.data || {};
  var hash=''; if(d.taskId) hash='#task='+encodeURIComponent(d.taskId); else if(d.kanalId) hash='#chat='+encodeURIComponent(d.kanalId); else if(d.typ==='chat') hash='#chat'; else if(d.fotoKey) hash='#foto='+encodeURIComponent(d.fotoKey);
  var url='./'+hash;
  e.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(function(cl){
      for (var i=0;i<cl.length;i++){ var c=cl[i]; if('focus' in c){ c.focus(); if('navigate' in c && hash) c.navigate(url); return; } }
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

/* Network-only průchod (žádná cache) → appka je vždy aktuální, jen splníme
   podmínku pro instalaci PWA. */
self.addEventListener('fetch', function(event){
  event.respondWith(fetch(event.request).catch(function(){ return new Response('', {status:504}); }));
});
