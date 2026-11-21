// NutriTrack Service Worker (PWA & Web Push Background Service)
// Handles background push notifications when the app/browser is completely closed.

const SW_VERSION = 'nutritrack-sw-v1.0';

// 1. Install & Activate Lifecycle
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    clients.claim().then(() => {
      console.log('[SW] NutriTrack Service Worker activated and controlling clients');
    })
  );
});

// 2. Background Push Event (Wakes up even when browser/app is killed from recent apps)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'NutriTrack 🥗', body: event.data.text() };
    }
  }

  const title = data.title || 'NutriTrack 🥗';
  const options = {
    body: data.body || 'Pengingat nutrisi & hidrasi harian untukmu.',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || ('nutritrack_' + Date.now()),
    renotify: true,
    vibrate: [200, 100, 200, 100, 250],
    data: {
      url: data.url || '/',
      date: new Date().toISOString()
    },
    actions: [
      { action: 'open', title: 'Buka NutriTrack' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 3. Notification Click Interaction (Opens or focuses the app)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes(self.registration.scope)) {
            return client.focus();
          }
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
