// Makes the Hub installable and shows alerts. It caches nothing: every page and number comes straight from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // no handler work: the browser does the request itself
// An alert from the server: always show something, because phones turn off alerts for apps that receive one and show nothing.
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (er) { /* show the plain one */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Game Day Hub', { body: d.body || '', tag: d.tag || undefined, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.endsWith(url) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
