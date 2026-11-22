// Offline cache. Bump VERSION after changing index.html so phones pick up the update.
const VERSION='desk-v13';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
// only old app caches are deleted; 'desk-push' holds the background-alert settings
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('desk-v')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.hostname.endsWith('firebasedatabase.app')||u.hostname.endsWith('workers.dev')||u.pathname.endsWith('__push-config'))return; // never cache sync / push calls
  if(e.request.mode==='navigate'){ // network first for the page, cache when offline
    e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(VERSION).then(x=>x.put('./index.html',c));return r}).catch(()=>caches.match('./index.html')));return}
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok||r.type==='opaque'){const c=r.clone();caches.open(VERSION).then(x=>x.put(e.request,c))}return r}).catch(()=>hit)));
});

/* ---------- background break alerts (push from push/worker.js) ---------- */
const tFmt=t=>new Date(t).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'});
const wins=()=>self.clients.matchAll({type:'window',includeUncontrolled:true});
const tell=m=>wins().then(cs=>cs.forEach(c=>c.postMessage(m)));
async function cfg(){try{const c=await caches.open('desk-push');const r=await c.match('./__push-config');return r?await r.json():{}}catch(e){return {}}}
async function once(at,kind){const c=await cfg();if(!c.url||!c.id)return;try{await fetch(c.url.replace(/\/$/,'')+'/once',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:c.id,at,kind})})}catch(e){}}
function show(m){
  const brk=m.kind==='break';
  return self.registration.showNotification(m.title||'Stand up and walk',{body:m.body||'',tag:'break',renotify:true,requireInteraction:true,
    vibrate:[400,200,400,200,400],icon:'icon-192.png',badge:'icon-192.png',data:{kind:m.kind,at:Date.now()},
    actions:brk?[{action:'w5',title:'Walk 5 min'},{action:'snooze',title:'Snooze 5 min'}]:[]});
}
self.addEventListener('push',e=>{
  let m={};try{m=e.data?e.data.json():{}}catch(_){}
  e.waitUntil((async()=>{
    const cs=await wins();
    if(!m.test&&cs.some(c=>c.visibilityState==='visible')){await tell({t:m.kind==='walkdone'?'walkdone':'break'});return} // app on screen: it shows its own full-screen reminder
    const old=await self.registration.getNotifications({tag:'break'});
    if(!m.test&&old.some(n=>n.data&&n.data.kind===m.kind&&Date.now()-n.data.at<150000))return; // the open app already showed it
    await show(m);await tell({t:m.kind==='walkdone'?'walkdone':'break'});
  })());
});
self.addEventListener('notificationclick',e=>{
  const n=e.notification,kind=n.data&&n.data.kind;n.close();
  if(e.action==='w5'){const end=Date.now()+5*60000;
    e.waitUntil(Promise.all([once(end,'walkdone'),tell({t:'walk',end}),
      self.registration.showNotification('Walking… back at '+tFmt(end),{body:'Keep moving. You will get an alert when 5 minutes are up.',tag:'break',silent:true,icon:'icon-192.png',badge:'icon-192.png',data:{kind:'walking',at:Date.now()}})]));return}
  if(e.action==='snooze'){const at=Date.now()+5*60000;e.waitUntil(Promise.all([once(at,'break'),tell({t:'snooze',at})]));return}
  // tap on the notification itself: open the app
  e.waitUntil(wins().then(cs=>{for(const c of cs){if('focus' in c){if(kind==='break')c.postMessage({t:'break'});return c.focus()}}return self.clients.openWindow('./')}));
});
