// DeepFlow Client Portal — service worker for push notifications.
// Deliberately minimal: this app has no offline-caching strategy (every
// visit re-fetches live data by design, see the portal's own "stale data"
// handling), so this file's only job is receiving and displaying pushes.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}

  const title = data.title || 'DeepFlow';
  const options = {
    body: data.body || 'You have an update.',
    icon: data.icon || undefined,
    badge: data.badge || undefined,
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
