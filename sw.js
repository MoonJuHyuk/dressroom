// 오프라인에서도 앱이 열리도록 화면 파일을 저장해 둡니다. 앱을 고치면 VERSION을 올리세요 (js/app.js와 같이).
const VERSION = 'dressroom-v0.1.3';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/ai.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && !k.startsWith('img-')).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 앱 화면: 네트워크 우선, 끊기면 저장본
  if (url.origin === location.origin) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  // 옷 사진(구글드라이브)·글꼴: 저장본 우선
  if (/drive\.google\.com$|googleusercontent\.com$|fonts\.(googleapis|gstatic)\.com$|cdn\.jsdelivr\.net$/.test(url.hostname) && req.destination !== 'document') {
    e.respondWith(caches.open('img-v1').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
  }
});
