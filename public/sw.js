const CACHE = 'qflow-v1';
const OFFLINE_URLS = ['/', '/login'];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE_URLS).catch(() => {})));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/rest/') || url.hostname.includes('supabase')) return;
  e.respondWith(fetch(e.request).then((res) => { if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {}); } return res; }).catch(() => caches.match(e.request).then((c) => c ?? new Response('Offline', { status: 503 }))));
});
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let data; try { data = e.data.json(); } catch { data = { title: 'QFlow', body: e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title ?? 'QFlow', { body: data.body ?? '', icon: '/favicon.ico', badge: '/favicon.ico', tag: data.tag ?? 'qflow', requireInteraction: true, data: data.url ? { url: data.url } : undefined }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url;
  if (!url) return;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => { const ex = list.find((c) => c.url === url); if (ex) return ex.focus(); return clients.openWindow(url); }));
});
