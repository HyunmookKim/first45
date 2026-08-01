const CACHE = 'first45-v16';
const ASSETS = ['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-180.png'];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET') return;
  // 외부 API(날씨·해양 등)는 서비스워커가 건드리지 않는다.
  // 캐시 우선으로 잡아버리면 지난 예보가 최신인 척 계속 나온다 — 바다에서 위험.
  let sameOrigin = false;
  try{ sameOrigin = new URL(e.request.url).origin === self.location.origin; }catch(err){}
  if(!sameOrigin) return;
  e.respondWith(
    caches.match(e.request).then(hit=> hit || fetch(e.request).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match('./index.html')))
  );
});
