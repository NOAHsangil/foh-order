// 설치용 최소 서비스워커: 같은 사이트 파일만 거치고, 데이터(Firebase) 요청은 건드리지 않음
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
