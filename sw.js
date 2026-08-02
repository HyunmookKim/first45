const CACHE = 'first45-v27';
const TILES = 'first45-tiles';   // 지도 타일 전용 (버전 올려도 지우지 않는다)
const ASSETS = ['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-180.png'];
const TILE_HOSTS = ['tile.openstreetmap.org','tiles.openseamap.org'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  // 앱 캐시만 정리한다. 타일 캐시는 유지해야 오프라인에서 지도가 남는다.
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k!==CACHE && k!==TILES).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET') return;
  let u;
  try{ u = new URL(e.request.url); }catch(err){ return; }

  // 지도 타일: 캐시 우선. 한 번 본 구간은 바다에서도 남는다.
  // 타일은 내용이 거의 변하지 않으므로 캐시해도 안전하다.
  if(TILE_HOSTS.includes(u.hostname)){
    e.respondWith(
      caches.match(e.request).then(hit=> hit || fetch(e.request).then(res=>{
        if(res && res.ok){
          const copy = res.clone();
          caches.open(TILES).then(c=>c.put(e.request, copy)).catch(()=>{});
        }
        return res;
      }).catch(()=> new Response('', {status:504})))
    );
    return;
  }

  // 그 밖의 외부 요청(날씨·해양 API, Firestore 등)은 건드리지 않는다.
  // 캐시 우선으로 잡으면 지난 예보가 최신인 척 계속 나온다 — 바다에서 위험.
  if(u.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(hit=> hit || fetch(e.request).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match('./index.html')))
  );
});
