/* Service worker - الخطوة 1: يخلّي الموقع قابل للتثبيت.
   الخطوة 2 هنضيف هنا استقبال الإشعارات. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
