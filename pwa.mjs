const pwaElement=id=>document.getElementById(id);
let installPrompt=null,waitingWorker=null,updating=false;
const pwaStatus=()=>{
 const el=pwaElement('connectionStatus');
 el.classList.toggle('offline',!navigator.onLine);
 el.innerHTML='<span></span>'+(!navigator.onLine?' Sem conexão':' Processamento local');
};
const showUpdate=worker=>{waitingWorker=worker;pwaElement('updateNotice').hidden=false;};
pwaElement('installApp').addEventListener('click',async()=>{
 if(!installPrompt)return;
 const prompt=installPrompt;installPrompt=null;pwaElement('installApp').hidden=true;
 try{await prompt.prompt();await prompt.userChoice;}catch{/* A instalação opcional não interfere no uso pelo link. */}
});
window.addEventListener('beforeinstallprompt',event=>{
 event.preventDefault();installPrompt=event;pwaElement('installApp').hidden=false;
});
window.addEventListener('appinstalled',()=>{
 installPrompt=null;pwaElement('installApp').hidden=true;
});
pwaElement('updateApp').addEventListener('click',()=>{
 if(!waitingWorker)return;
 if(!window.confirm('Atualizar encerra esta sessão. Você já baixou os resultados que deseja guardar?'))return;
 updating=true;pwaElement('updateApp').disabled=true;
 waitingWorker.postMessage({type:'SKIP_WAITING'});
});
window.addEventListener('online',pwaStatus);
window.addEventListener('offline',pwaStatus);
pwaStatus();
if('serviceWorker' in navigator&&window.isSecureContext&&/^https?:$/.test(location.protocol)){
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updating)window.location.reload();});
 window.addEventListener('load',async()=>{
  try{
   const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
   if(registration.waiting)showUpdate(registration.waiting);
   registration.addEventListener('updatefound',()=>{
    const worker=registration.installing;
    worker?.addEventListener('statechange',()=>{
     if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate(registration.waiting||worker);
    });
   });
   registration.update().catch(()=>{});
  }catch{/* O processamento continua disponível se a política do navegador bloquear o modo offline. */}
 });
}
