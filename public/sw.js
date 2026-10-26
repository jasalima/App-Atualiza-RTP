/* Installation support only. Authenticated pages and institutional data are
   deliberately never cached on the device. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',(event)=>event.waitUntil(self.clients.claim()));
