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
  messaging.onBackgroundMessage(function(payload){
    var n = payload.notification || {};
    self.registration.showNotification(n.title || 'II/176 Vacíkov–Zliv', {
      body: n.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: payload.data || {}
    });
  });
} catch(e){ /* messaging nemusí být dostupný v tomto kontextu */ }

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(function(cl){
      for (var i=0;i<cl.length;i++){ if('focus' in cl[i]) return cl[i].focus(); }
      if(clients.openWindow) return clients.openWindow('./');
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
