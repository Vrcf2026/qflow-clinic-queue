// QFlow Service Worker — notificações push para página /espera
const CACHE = 'qflow-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

// Push notification handler
self.addEventListener('push', (e) => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title ?? 'QFlow', {
      body: data.body ?? '',
      icon: data.icon ?? '/favicon.ico',
      badge: data.badge ?? '/favicon.ico',
      tag: data.tag ?? 'qflow',
      requireInteraction: true,
      data: data.url ? { url: data.url } : undefined,
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url;
  if (url) {
    e.waitUntil(clients.openWindow(url));
  }
});
