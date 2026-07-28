/* Firebase Cloud Messaging – fallback background SW.
   Appka registruje service-worker.js a předává ho FCM přes serviceWorkerRegistration,
   takže tenhle soubor je jen záloha pro výchozí FCM lookup (/firebase-messaging-sw.js).
   Config drž SHODNÝ s index.html i service-worker.js. */

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
      data: payload.data || {}
    });
  });
} catch(e){ /* ignore */ }
