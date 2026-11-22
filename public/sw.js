// Lightweight Service Worker for Delivery Tycoon PWA installability.
// Uses network pass-through without aggressive caching so game updates apply immediately.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).catch(() => new Response('', { status: 503, statusText: 'Offline' }))
  );
});
