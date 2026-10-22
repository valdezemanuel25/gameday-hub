// Makes the Hub installable. It caches nothing: every page and number comes straight from the server, so nothing can be out of date.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // no handler work: the browser does the request itself
