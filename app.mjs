import {parseMatrix,parseSchedule,distribute,exportRows,slug,displayDate,normalize} from './engine.mjs';
import {readWorkbook,createXlsx,makeZip,download} from './io.mjs';
const $=id=>document.getElementById(id);
const state={stage:1,matrixSheets:[],scheduleSheets:[],matrix:null,schedule:null,orders:[],page:0,pending:false,busy:false,reading:'',demo:false,dirty:false,downloaded:false};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(text,error=false){$('message').hidden=!text;$('message').textContent=text;$('message').classList.toggle('error',error);}
function dialog(title,html){$('dialogTitle').textContent=title;$('dialogBody').innerHTML=html;$('dialog').showModal();}
function stage(number,scroll=true){
 if(number!==1&&!state.orders.length)return;
 state.stage=number;
 $('filesStage').hidden=number!==1;$('results').hidden=number!==2;$('downloadsStage').hidden=number!==3;
 for(let i=1;i<=3;i++){
  const button=$('step'+i);button.classList.toggle('current',i===number);button.classList.toggle('complete',i<number);
  if(i===number)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
 }
 $('demoBanner').hidden=!state.demo;
 if(scroll)window.scrollTo({top:0,behavior:'smooth'});
}
function ready(){
 $('startupStatus').hidden=true;
 const matrix=state.matrixSheets.length>0,schedule=state.scheduleSheets.length>0,count=Number(matrix)+Number(schedule);
 $('fileCount').textContent=count+' de 2 arquivos';
 $('reset').hidden=!count&&!state.orders.length;
 for(const id of ['reset','startAgain','demo','matrixSheet','scheduleSheet','matrixRemove','scheduleRemove'])$(id).disabled=state.busy;
 for(const kind of ['matrix','schedule'])$(kind+'File').disabled=state.busy;
 $('process').disabled=!(matrix&&schedule)||state.busy;
 for(const i of [2,3])$('step'+i).disabled=!state.orders.length||state.busy;
 $('step1').disabled=state.busy;
 const title=state.busy?'Lendo a planilha…':matrix&&schedule?'Tudo pronto para continuar':matrix?'Agora escolha o planejamento':schedule?'Agora escolha a matriz':'Escolha os dois arquivos para continuar';
 $('readyTitle').textContent=title;
 $('readyText').textContent=state.busy?'Aguarde a leitura terminar antes de selecionar outro arquivo.':matrix&&schedule?'Confira os arquivos acima. No próximo passo, você poderá revisar os responsáveis.':'A distribuição será feita aqui, no seu navegador.';
 $('process').innerHTML=(state.orders.length?'Voltar à conferência':'Separar ordens e continuar')+'<span aria-hidden="true">→</span>';
}
function clearResults(){
 state.orders=[];state.matrix=null;state.schedule=null;state.dirty=false;state.downloaded=false;state.page=0;state.pending=false;
 $('downloadSuccess').hidden=true;stage(1);ready();
}
function mayReplace(){return !state.dirty||window.confirm('Trocar os arquivos apaga a conferência atual. Baixe os resultados que deseja guardar antes de continuar. Continuar?');}
function errorFile(kind,text){$(kind+'Error').textContent=text;$(kind+'Error').hidden=!text;$(kind+'Drop').classList.toggle('has-error',!!text);}
function fileEmpty(kind){
 state[kind+'Sheets']=[];$(kind+'Name').textContent='Nenhum arquivo escolhido';$(kind+'Check').textContent='Aguardando arquivo';
 $(kind+'ButtonText').textContent=kind==='matrix'?'Escolher matriz':'Escolher planejamento';$(kind+'Remove').hidden=true;$(kind+'SheetField').hidden=true;
 $(kind+'Drop').classList.remove('loaded');$(kind+'File').value='';errorFile(kind,'');
}
function setSheets(kind,sheets,name){
 state[kind+'Sheets']=sheets;$(kind+'Name').textContent=name;$(kind+'Check').textContent='Arquivo selecionado';
 $(kind+'ButtonText').textContent='Trocar arquivo';$(kind+'Remove').hidden=false;$(kind+'Drop').classList.add('loaded');errorFile(kind,'');
 $(kind+'Sheet').innerHTML=sheets.map((s,i)=>'<option value="'+i+'">'+esc(s.name)+'</option>').join('');
 $(kind+'SheetField').hidden=sheets.length<=1;$(kind+'Sheet').dataset.previous='0';
}
async function load(kind,file){
 if(!file||state.busy)return;
 if(!mayReplace()){$(kind+'File').value='';return;}
 if(state.demo)fileEmpty(kind==='matrix'?'schedule':'matrix');
 state.busy=true;state.reading=kind;state.demo=false;clearResults();fileEmpty(kind);
 $(kind+'Check').textContent='Lendo…';$(kind+'Name').textContent='Lendo arquivo…';$(kind+'Drop').classList.add('is-reading');ready();message('Lendo '+file.name+'…');
 try{
  const sheets=await readWorkbook(file);setSheets(kind,sheets,file.name);message('Arquivo lido: '+file.name+'.');
 }catch(error){
  $(kind+'Name').textContent='Não foi possível ler o arquivo.';$(kind+'Check').textContent='Confira o arquivo';
  errorFile(kind,error.message);message(error.message,true);
 }finally{
  state.busy=false;state.reading='';$(kind+'File').value='';$(kind+'Drop').classList.remove('is-reading');ready();
 }
}
for(const kind of ['matrix','schedule']){
 $(kind+'File').addEventListener('change',event=>load(kind,event.target.files[0]));
 $(kind+'Remove').addEventListener('click',()=>{
  if(state.busy||!mayReplace())return;
  fileEmpty(kind);state.demo=false;clearResults();ready();message('Arquivo removido. Escolha outro arquivo para continuar.');
 });
 $(kind+'Sheet').addEventListener('change',event=>{
  if(!mayReplace()){event.target.value=event.target.dataset.previous||'0';return;}
  event.target.dataset.previous=event.target.value;clearResults();errorFile(kind,'');ready();message('Aba alterada. Clique em Separar ordens e continuar para atualizar os resultados.');
 });
 const zone=$(kind+'Drop');
 zone.addEventListener('dragover',event=>{event.preventDefault();if(!state.busy)zone.classList.add('drag-over');});
 zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
 zone.addEventListener('drop',event=>{
  event.preventDefault();zone.classList.remove('drag-over');
  if(event.dataTransfer.files.length!==1){message('Arraste somente uma planilha por vez para cada quadro.',true);return;}
  return load(kind,event.dataTransfer.files[0]);
 });
}
function process(){
 if(state.busy)return;
 if(state.orders.length){message('');stage(2);return;}
 if(!state.matrixSheets.length||!state.scheduleSheets.length){message('Escolha a matriz e o planejamento antes de continuar.',true);return;}
 let matrix,schedule;
 try{matrix=parseMatrix(state.matrixSheets[Number($('matrixSheet').value)]?.rows||[]);errorFile('matrix','');}
 catch(error){stage(1);errorFile('matrix',error.message);message('Confira a matriz: '+error.message,true);return;}
 try{schedule=parseSchedule(state.scheduleSheets[Number($('scheduleSheet').value)]?.rows||[]);errorFile('schedule','');}
 catch(error){stage(1);errorFile('schedule',error.message);message('Confira o planejamento: '+error.message,true);return;}
 state.matrix=matrix;state.schedule=schedule;state.orders=distribute(schedule,matrix);state.dirty=true;state.downloaded=false;state.page=0;state.pending=false;
 $('search').value='';$('ownerFilter').innerHTML='<option value="">Todos os responsáveis</option><option value="pending">Sem responsável</option>'+matrix.owners.map(o=>'<option value="'+o.id+'">'+esc(o.name)+'</option>').join('');
 $('resultMeta').textContent='Veja a distribuição abaixo. Você pode ajustar qualquer responsável antes de baixar.';
 $('downloadSuccess').hidden=true;renderSummary();renderTable();message('');ready();stage(2);
}
$('process').addEventListener('click',process);
function groups(){const result=new Map();for(const order of state.orders){const id=order.ownerId||'pending';if(!result.has(id))result.set(id,[]);result.get(id).push(order);}return result;}
function renderSummary(){
 const total=state.orders.length,pending=state.orders.filter(o=>!o.ownerId).length,assigned=total-pending;
 $('totalStat').textContent=total;$('assignedStat').textContent=assigned;$('pendingStat').textContent=pending;
 $('pendingBadge').textContent=pending;$('navPendingCount').textContent=pending;$('navPendingCount').hidden=!pending;
 $('reviewGuidance').classList.toggle('resolved',!pending);$('guidanceIcon').textContent=pending?'!':'✓';
 $('reviewTitle').textContent=pending?(pending===1?'1 ordem precisa de um responsável':pending+' ordens precisam de um responsável'):'Todas as ordens têm responsável';
 $('reviewText').textContent=pending?'Abra a lista abaixo e escolha quem deve receber essas ordens.':'Faça uma última conferência. Se estiver tudo certo, continue para os downloads.';
 $('navReview').hidden=!pending;
 $('continueHint').textContent=pending?'Ainda há '+pending+' ordem(ns) sem responsável. Elas serão incluídas em REVISAR.':'Tudo conferido? Siga para baixar as planilhas.';
 $('assignmentProgress').max=total||1;$('assignmentProgress').value=assigned;
 $('progressText').textContent=assigned+' de '+total+' ordens com responsável';
 $('downloadPending').hidden=!pending;
 $('downloadPendingTitle').textContent=pending===1?'Ainda há 1 ordem sem responsável':'Ainda há '+pending+' ordens sem responsável';
 const destinations=groups();$('ownerStat').textContent=[...destinations.keys()].filter(k=>k!=='pending').length;
 $('destinations').innerHTML=[...destinations].map(([id,orders])=>'<div class="destination'+(id==='pending'?' pending-destination':'')+'"><b>'+esc(id==='pending'?'Ordens sem responsável':state.matrix.owners.find(o=>o.id===id)?.name)+'</b><span>'+orders.length+' ordem'+(orders.length===1?'':'s')+'</span><button class="text-button" data-download="'+esc(id)+'">Baixar Excel</button></div>').join('');
 const notes=[];
 if(state.matrix.conflicts.length)notes.push(state.matrix.conflicts.length+' códigos da matriz têm mais de um responsável.');
 if(state.orders.some(o=>o.duplicate))notes.push('Existem números de WO repetidos. Todas as linhas foram mantidas. Confira a repetição com o planejamento antes de entregar.');
 if(state.matrix.warnings.length)notes.push(state.matrix.warnings.length+' entradas da matriz não foram usadas por formato inválido.');
 if(state.schedule.ignored.length)notes.push(state.schedule.ignored.length+' linha(s) de rodapé ou sem número válido não foram usadas.');
 $('warnings').textContent=notes.join(' ');$('warnings').hidden=!notes.length;
 $('readingSummary').textContent='Detalhes da leitura dos arquivos'+(notes.length?' · '+notes.length+' aviso(s)':'');
 $('ignoredSummary').textContent='Linhas não usadas ('+state.schedule.ignored.length+')';
 $('ignoredRows').innerHTML=state.schedule.ignored.length?state.schedule.ignored.map(o=>'<p>Linha '+o.row+': '+esc(o.value)+' — '+esc(o.reason)+'</p>').join(''):'<p>Nenhuma linha foi ignorada.</p>';
}
function filtered(){
 const query=normalize($('search').value),owner=$('ownerFilter').value;
 return state.orders.filter(order=>(!state.pending||!order.ownerId)&&(!owner||(owner==='pending'?!order.ownerId:owner===order.ownerId))&&(!query||normalize(order.wo+' '+order.description+' '+order.location).includes(query)));
}
function renderTable(){
 const rows=filtered(),size=20;
 state.page=Math.max(0,Math.min(state.page,Math.max(0,Math.ceil(rows.length/size)-1)));
 $('allTab').classList.toggle('selected',!state.pending);$('pendingTab').classList.toggle('selected',state.pending);
 $('allTab').setAttribute('aria-pressed',String(!state.pending));$('pendingTab').setAttribute('aria-pressed',String(state.pending));
 $('visibleCount').textContent=rows.length+' ordens no filtro';
 $('orderRows').innerHTML=rows.slice(state.page*size,(state.page+1)*size).map(order=>{
  const owner=state.matrix.owners.find(o=>o.id===order.ownerId)?.name||'Escolha o responsável';
  const explanation=order.ownerId?'<details class="row-details"><summary>Ver explicação</summary><span class="reason">'+esc(order.reason)+'</span></details>':'<span class="reason pending-reason">'+esc(order.reason)+'</span>';
  return '<tr><td data-label="Ordem"><span class="wo">'+esc(order.wo)+'</span><span class="description">'+esc(order.description)+'</span></td><td data-label="Equipamento (LOCATION)"><code class="location-code">'+esc(order.location||'Não informado')+'</code></td><td data-label="Início previsto"><span class="date-cell">'+esc(displayDate(order.target))+'</span></td><td data-label="Status"><span class="status-pill">'+esc(order.status||'Não informado')+'</span></td><td data-label="Responsável"><select class="'+(!order.ownerId?'unassigned':'')+'" data-assign="'+order.id+'" aria-label="Responsável da ordem '+esc(order.wo)+'" title="'+esc(owner)+'"><option value="">Escolha o responsável</option>'+state.matrix.owners.map(o=>'<option value="'+o.id+'"'+(o.id===order.ownerId?' selected':'')+'>'+esc(o.name)+'</option>').join('')+'</select></td><td data-label="Como foi definido"><span class="criterion'+(!order.ownerId?' pending':'')+'">'+esc(order.ownerId?order.method:'Precisa de revisão')+'</span>'+explanation+'</td></tr>';
 }).join('')||'<tr><td colspan="6">'+(state.pending&&!state.orders.some(o=>!o.ownerId)?'Nenhuma ordem sem responsável. Todas já têm um destino.':'Nenhuma ordem encontrada. Tente outra busca ou use Limpar filtros.')+'</td></tr>';
 $('pageText').textContent=rows.length?(state.page*size+1)+'–'+Math.min((state.page+1)*size,rows.length)+' de '+rows.length:'0 ordens';
 $('prevPage').disabled=state.page===0;$('nextPage').disabled=(state.page+1)*size>=rows.length;
}
function clearFilters(pending=false){
 state.pending=pending;state.page=0;$('search').value='';$('ownerFilter').value='';renderTable();
}
function reviewPending(){if(!state.orders.length){message('Selecione a matriz e o planejamento antes de conferir as ordens.');return;}message('');stage(2);clearFilters(true);$('ordersPanel').scrollIntoView({behavior:'smooth',block:'start'});}
$('navReview').addEventListener('click',reviewPending);$('backToPending').addEventListener('click',reviewPending);
$('allTab').addEventListener('click',()=>{state.pending=false;state.page=0;renderTable();});
$('pendingTab').addEventListener('click',()=>{state.pending=true;state.page=0;renderTable();});
$('navDistribution').addEventListener('click',()=>clearFilters());$('clearFilters').addEventListener('click',()=>clearFilters());
$('search').addEventListener('input',()=>{state.page=0;renderTable();});
$('ownerFilter').addEventListener('change',()=>{state.page=0;renderTable();});
$('prevPage').addEventListener('click',()=>{state.page--;renderTable();});$('nextPage').addEventListener('click',()=>{state.page++;renderTable();});
$('orderRows').addEventListener('change',event=>{
 const order=state.orders.find(o=>o.id===event.target.dataset.assign);
 if(!order)return;
 const owner=event.target.value;if(owner&&!state.matrix.owners.some(o=>o.id===owner))return;
 order.ownerId=owner;order.method=owner?'Revisão manual':'revisar';order.reason=owner?'Responsável definido manualmente nesta sessão.':'Aguardando definição manual do responsável.';
 state.dirty=true;state.downloaded=false;$('downloadSuccess').hidden=true;renderSummary();renderTable();
 message(owner?'Responsável atualizado para a ordem '+order.wo+'.'+(state.pending?' Ela saiu da lista porque agora já tem um responsável.':''):'A ordem '+order.wo+' voltou para a revisão.');
 $('ordersTitle').focus({preventScroll:true});
});
for(let i=1;i<=3;i++)$('step'+i).addEventListener('click',()=>{if(!state.busy){message('');stage(i);}});
$('backToFiles').addEventListener('click',()=>{message('');stage(1);ready();});
$('backToReview').addEventListener('click',()=>{message('');stage(2);});
$('navDownloads').addEventListener('click',()=>{if(!state.orders.length)return;message('');renderSummary();stage(3);});

function timestamp(){const d=new Date();return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'_'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+String(d.getSeconds()).padStart(2,'0');}
function outputName(id,stamp){return (id==='pending'?'REVISAR':slug(state.matrix.owners.find(o=>o.id===id)?.name))+'_'+stamp+'.xlsx';}
function downloaded(complete=false){if(complete){state.dirty=false;state.downloaded=true;}$('downloadSuccess').hidden=false;message('Download gerado. Confira o arquivo no navegador ou na pasta Downloads.');}
$('downloadReport').addEventListener('click',()=>{
 if(!state.orders.length)return;
 try{download(createXlsx(exportRows(state.orders,state.matrix),{includeMaximo:true}),'DISTRIBUICAO_GERAL_'+timestamp()+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');downloaded(true);}catch(error){message(error.message,true);}
});
$('downloadZip').addEventListener('click',()=>{
 if(!state.orders.length)return;
 try{
  const stamp=timestamp(),files=[...groups()].map(([id,orders])=>({name:outputName(id,stamp),data:createXlsx(exportRows(orders,state.matrix),{includeMaximo:true})}));
  files.push({name:'DISTRIBUICAO_GERAL_'+stamp+'.xlsx',data:createXlsx(exportRows(state.orders,state.matrix),{includeMaximo:true})});
  files.push({name:'LEIA-ME.txt',data:'RotaOS - Distribuição de ordens de serviço\r\n'+state.orders.length+' ordens; '+state.orders.filter(o=>!o.ownerId).length+' sem responsável.\r\nQuando houver pendências, elas estão em REVISAR.\r\nAs escolhas manuais valem apenas para esta sessão.\r\nCada Excel contém a aba MAXIMO, com as OS separadas por vírgula na coluna C, por responsável. Copie uma célula de cada vez para o campo de OS do Maximo. Em listas grandes, repita para cada lote. Confira também o responsável no Maximo antes de atribuir.\r\nConfira os arquivos antes de compartilhar.'});
  download(makeZip(files),'ROTAOS_'+stamp+'.zip','application/zip');downloaded(true);
 }catch(error){message(error.message,true);}
});
$('destinations').addEventListener('click',event=>{
 const button=event.target.closest('[data-download]');if(!button)return;
 const id=button.dataset.download,orders=groups().get(id);if(!orders)return;
 try{download(createXlsx(exportRows(orders,state.matrix),{includeMaximo:true}),outputName(id,timestamp()),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');downloaded();}catch(error){message(error.message,true);}
});
function reset(){
 if(state.busy)return;
 if(state.dirty&&!window.confirm('Recomeçar apaga esta conferência. Você já baixou os resultados que deseja guardar?'))return;
 state.demo=false;fileEmpty('matrix');fileEmpty('schedule');clearResults();message('');ready();
}
$('reset').addEventListener('click',reset);$('startAgain').addEventListener('click',reset);$('exitDemo').addEventListener('click',reset);
$('demo').addEventListener('click',()=>{
 if(state.busy||!mayReplace())return;
 clearResults();
 setSheets('matrix',[{name:'Matriz de exemplo',rows:[['Responsável A (Turma A)','Responsável B (Turma B)','Equipe Técnica (Manutenção)'],['EQP101','EQP201','BOM'],['EQP102','EQP202','EQP102']]}],'Matriz de exemplo.xlsx');
 setSheets('schedule',[{name:'Planejamento de exemplo',rows:[['Work Order','Description','Location','Status','Target Start'],['WO100001','Inspeção mensal da unidade 101','EQP101','WAPPR',46310],['WO100002','Verificação da bomba auxiliar','BOM903-D002','WAPPR',46311],['WO100003','Inspeção dos ventiladores - Turma B','GERAL','WSCH',46312],['WO100004','Inspeção da unidade 102','EQP102','WAPPR',46313],['WO100005','Inspeção de equipamento sem cadastro','NOVO901','WAPPR',46314],['WO100006','Inspeção da unidade 202','EQP202-D001','WAPPR',46315],['Number of Records:',6]]}],'Planejamento de exemplo.xlsx');
 state.demo=true;ready();process();
});
$('help').addEventListener('click',()=>dialog('Três passos para separar as ordens','<ol><li><b>Escolha os arquivos.</b> Selecione a matriz, que informa os responsáveis pelos equipamentos, e o planejamento com as ordens. Use Excel .xlsx sem senha, até 20 MB por arquivo.</li><li><b>Confira os responsáveis.</b> Veja os totais. Nas ordens sem responsável, escolha o nome correto. Você também pode corrigir uma atribuição existente. A alteração vale imediatamente.</li><li><b>Baixe as planilhas.</b> O ZIP reúne os arquivos por responsável e o relatório geral. Ordens ainda sem responsável entram no arquivo REVISAR. Cada Excel inclui a aba <b>MAXIMO</b>: copie a célula da coluna C, a partir de C2, e cole no campo de OS do Maximo. No relatório geral, cada responsável tem sua própria lista.</li></ol><p><b>O código do equipamento (LOCATION) tem prioridade</b>, mesmo quando a ordem vier como OPERATOR. Se houver mais de um responsável e a turma não resolver o vínculo, você decide na revisão.</p><p>Você pode voltar às etapas sem perder a conferência. Se trocar os arquivos, mudar a aba, atualizar ou fechar a página, a distribuição precisará ser feita novamente. Baixe os resultados antes.</p>'));
$('privacy').addEventListener('click',()=>dialog('Seus arquivos ficam neste computador','<p>A leitura das planilhas e a separação das ordens acontecem no seu navegador. O RotaOS não envia o conteúdo para um servidor e não altera os arquivos originais.</p><p>As planilhas e as escolhas feitas na tela existem apenas nesta sessão. Ao fechar ou atualizar a página, selecione os arquivos novamente. Os downloads que você já guardou continuam no computador.</p>'));
$('matrixView').addEventListener('click',()=>{
 if(!state.matrix)return;
 const matrix=state.matrix;
 dialog('Matriz de responsáveis','<p>'+matrix.owners.length+' responsáveis e '+matrix.bindings.size+' códigos de equipamento. Abra um nome para consultar seus códigos.</p>'+matrix.owners.map(o=>'<details><summary><b>'+esc(o.name)+'</b> · '+o.locations.length+' códigos</summary><p>'+o.locations.map(esc).join(' · ')+'</p></details>').join('')+(matrix.conflicts.length?'<h3>Códigos compartilhados</h3><p>Quando a descrição não indicar uma turma que resolva o vínculo, esses códigos precisam de revisão.</p><table><thead><tr><th>Código</th><th>Responsáveis</th></tr></thead><tbody>'+matrix.conflicts.map(c=>'<tr><td>'+esc(c.code)+'</td><td>'+c.owners.map(o=>esc(o.name)).join('<br>')+'</td></tr>').join('')+'</tbody></table>':''));
});
for(const id of ['closeDialog','dialogDone'])$(id).addEventListener('click',()=>$('dialog').close());
$('dialog').addEventListener('click',event=>{if(event.target===$('dialog')){const rect=$('dialog').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('dialog').close();}});
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
stage(1,false);ready();

let darkMode=false;
$('themeToggle').addEventListener('click',()=>{
 darkMode=!darkMode;
 $('appBody').classList.toggle('dark-mode',darkMode);
 $('themeToggle').setAttribute('aria-pressed',String(darkMode));
 const action=darkMode?'Ativar modo claro':'Ativar modo escuro';
 $('themeToggle').setAttribute('aria-label',action);
 $('themeToggle').setAttribute('title',action);
 $('themeLabel').textContent=darkMode?'Modo claro':'Modo escuro';
 $('themeMoon').hidden=darkMode;
 $('themeSun').hidden=!darkMode;
});
