/* Service worker: التثبيت + استقبال الإشعارات */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAbQMsUQNz3CKY7NLI_HaHoR6EgaePRQe8",
  authDomain: "students-e21f2.firebaseapp.com",
  databaseURL: "https://students-e21f2-default-rtdb.firebaseio.com",
  projectId: "students-e21f2",
  storageBucket: "students-e21f2.firebasestorage.app",
  messagingSenderId: "713037100201",
  appId: "1:713037100201:web:51a395f3ef400a9ff2a5b8"
});
const messaging = firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// إشعار والموقع مقفول
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  return self.registration.showNotification(d.title || "تحديث جديد", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    dir: "rtl",
    lang: "ar",
    data: { url: d.url || "/" },
  });
});

// الضغط على الإشعار يفتح الموقع على الصفحة المناسبة
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.focus();
          if ("navigate" in c) return c.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
