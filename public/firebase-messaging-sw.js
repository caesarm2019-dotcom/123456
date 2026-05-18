importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js');

// This is a minimal background messaging handler
// The applet environment might have specific config needs
firebase.initializeApp({
  apiKey: "AIzaSyByEIxQy0o5qjVvs--XAXHGdaRYAIMqClc",
  authDomain: "sook-9615f.firebaseapp.com",
  projectId: "sook-9615f",
  storageBucket: "sook-9615f.firebasestorage.app",
  messagingSenderId: "794822563698",
  appId: "1:794822563698:web:41f8155ede4218574c6feb"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/logo.png' 
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
