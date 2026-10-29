/* RotaOS: somente arquivos públicos do aplicativo entram no cache. */
const CACHE_PREFIX='rotaos-'+encodeURIComponent(self.registration.scope)+'-';
const CACHE_NAME=CACHE_PREFIX+'1.0.0-85d74f633079';
const ASSETS=["index.html","style.css","logo.svg","app.mjs","engine.mjs","io.mjs","pwa.mjs","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png","icons/apple-touch-icon.png"];
const urls=ASSETS.map(file=>new URL(file,self.registration.scope).href);
const indexURL=new URL('index.html',self.registration.scope).href;
const homeURL=new URL('./',self.registration.scope).href;
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  await cache.addAll(urls.map(url=>new Request(url,{cache:'reload'})));
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME).map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
self.addEventListener('message',event=>{
 if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.search)return;
 const canonical=request.mode==='navigate'&&(url.href===homeURL||url.href===indexURL)?indexURL:url.href;
 if(!urls.includes(canonical))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE_NAME);
  return (await cache.match(canonical))||fetch(request);
 })());
});
