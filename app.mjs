import {parseMatrix,parseSchedule,distribute,exportRows,slug,displayDate,normalize} from './engine.mjs';
import {readWorkbook,createXlsx,makeZip,download} from './io.mjs';
const $=id=>document.getElementById(id),state={matrixSheets:[],scheduleSheets:[],matrix:null,schedule:null,orders:[],page:0,pending:false,busy:false,demo:false,dirty:false};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(text,error=false){$('message').hidden=!text;$('message').textContent=text;$('message').classList.toggle('error',error);}
function dialog(title,html){$('dialogTitle').textContent=title;$('dialogBody').innerHTML=html;$('dialog').showModal();}
function ready(){$('startupStatus').hidden=true;for(const id of ['reset','demo','matrixSheet','scheduleSheet'])$(id).disabled=state.busy;for(const kind of ['matrix','schedule'])$(kind+'File').disabled=state.busy;const ok=state.matrixSheets.length&&state.scheduleSheets.length&&!state.busy;$('process').disabled=!ok;$('readyText').textContent=state.busy?'Lendo arquivo no navegador…':ok?'Arquivos prontos. Você pode conferir a distribuição.':'Selecione os dois arquivos para começar.';}
function clearResults(){state.dirty=false;state.orders=[];state.matrix=null;state.schedule=null;$('results').hidden=true;$('emptyState').hidden=false;for(const id of ['step2','step3'])$(id).classList.remove('current');$('step1').classList.add('current');$('navPendingCount').hidden=true;$('navDistribution').classList.add('active');$('navReview').classList.remove('active');}
function setSheets(kind,sheets,name){state[kind+'Sheets']=sheets;$(kind+'Name').textContent=name;$(kind+'Check').textContent='✓';$(kind+'Sheet').innerHTML=sheets.map((s,i)=>'<option value="'+i+'">'+esc(s.name)+'</option>').join('');$(kind+'SheetField').hidden=sheets.length<=1;}
async function load(kind,file){
 if(!file)return;
 if(state.busy)return;
 state.busy=true;ready();message('Lendo '+file.name+'...');clearResults();state[kind+'Sheets']=[];$(kind+'Check').textContent='';$(kind+'Name').textContent='Lendo arquivo...';
 try{const sheets=await readWorkbook(file);setSheets(kind,sheets,file.name);state.demo=false;message('Arquivo lido: '+file.name+'. O conteúdo permanece nesta sessão.');}
 catch(e){$(kind+'Name').textContent='Não foi possível ler o arquivo.';message(e.message,true);}
 finally{state.busy=false;$(kind+'File').value='';ready();}
}
for(const kind of ['matrix','schedule']){
 $(kind+'File').addEventListener('change',e=>load(kind,e.target.files[0]));
 $(kind+'Sheet').addEventListener('change',()=>{clearResults();message('Aba alterada. Distribua novamente para atualizar os resultados.');});
 const zone=$(kind+'Drop');zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
 zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
 zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');if(e.dataTransfer.files.length!==1){message('Selecione um arquivo por área.',true);return;}load(kind,e.dataTransfer.files[0]);});
}
function process(){
 try{
  message('');const matrix=parseMatrix(state.matrixSheets[Number($('matrixSheet').value)].rows),schedule=parseSchedule(state.scheduleSheets[Number($('scheduleSheet').value)].rows);
  const orders=distribute(schedule,matrix);state.matrix=matrix;state.schedule=schedule;state.orders=orders;state.dirty=true;state.page=0;state.pending=false;
  $('search').value='';$('ownerFilter').innerHTML='<option value="">Todos os responsáveis</option><option value="pending">Sem responsável</option>'+matrix.owners.map(o=>'<option value="'+o.id+'">'+esc(o.name)+'</option>').join('');
  $('results').hidden=false;$('emptyState').hidden=true;$('step1').classList.remove('current');$('step2').classList.add('current');$('step3').classList.remove('current');
  $('resultMeta').textContent=(state.demo?'Demonstração fictícia · ':'')+schedule.orders.length+' ordens válidas · '+matrix.owners.length+' responsáveis na matriz';
  renderSummary();renderTable();$('results').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){message(e.message,true);}
}
$('process').addEventListener('click',process);
function filtered(){
 const q=normalize($('search').value),owner=$('ownerFilter').value;
 return state.orders.filter(o=>(!state.pending||!o.ownerId)&&(!owner||(owner==='pending'?!o.ownerId:o.ownerId===owner))&&(!q||normalize(o.wo+' '+o.description+' '+o.location).includes(q)));
}
function groups(){const g=new Map();for(const o of state.orders){const id=o.ownerId||'pending';if(!g.has(id))g.set(id,[]);g.get(id).push(o);}return g;}
function renderSummary(){
 const pending=state.orders.filter(o=>!o.ownerId).length,g=groups();
 $('totalStat').textContent=state.orders.length;$('assignedStat').textContent=state.orders.length-pending;$('pendingStat').textContent=pending;$('pendingBadge').textContent=pending;$('navPendingCount').textContent=pending;$('navPendingCount').hidden=pending===0;$('ownerStat').textContent=[...g.keys()].filter(k=>k!=='pending').length;
 const notes=[];
 if(state.matrix.conflicts.length)notes.push(state.matrix.conflicts.length+' códigos da matriz têm mais de um responsável.');
 if(state.orders.some(o=>o.duplicate))notes.push('Há números de WO repetidos na origem. As linhas foram preservadas e marcadas para revisão.');
 if(state.matrix.warnings.length)notes.push(state.matrix.warnings.length+' entradas da matriz foram ignoradas por formato inválido.');
 if(state.schedule.ignored.length)notes.push(state.schedule.ignored.length+' linha(s) de rodapé ou sem WO válida foram ignoradas.');
 $('warnings').hidden=!notes.length;$('warnings').textContent=notes.join(' ');
 $('destinations').innerHTML=[...g].map(([id,orders])=>'<div class="destination"><b>'+esc(id==='pending'?'Pendentes de revisão':state.matrix.owners.find(o=>o.id===id)?.name)+'</b><span>'+orders.length+' ordem'+(orders.length===1?'':'s')+'</span><button class="text-button" data-download="'+esc(id)+'">Baixar Excel ↓</button></div>').join('');
 $('ignoredSummary').textContent='Linhas ignoradas ('+state.schedule.ignored.length+')';
 $('ignoredRows').innerHTML=state.schedule.ignored.length?state.schedule.ignored.map(o=>'<p>Linha '+o.row+': '+esc(o.value)+' · '+esc(o.reason)+'</p>').join(''):'<p>Nenhuma linha ignorada.</p>';
}
function renderTable(){
 const rows=filtered(),size=20;state.page=Math.max(0,Math.min(state.page,Math.max(0,Math.ceil(rows.length/size)-1)));
 $('navDistribution').classList.toggle('active',!state.pending);$('navReview').classList.toggle('active',state.pending);$('allTab').classList.toggle('selected',!state.pending);$('pendingTab').classList.toggle('selected',state.pending);
 $('visibleCount').textContent=rows.length+' ordens no filtro';const slice=rows.slice(state.page*size,(state.page+1)*size);
 $('orderRows').innerHTML=slice.length?slice.map(o=>{
  const ownerName=state.matrix.owners.find(p=>p.id===o.ownerId)?.name||'Selecione um responsável';
  const explanation=o.ownerId?'<details class="row-details"><summary>Ver critério</summary><span class="reason">'+esc(o.reason)+'</span></details>':'<span class="reason pending-reason">'+esc(o.reason)+'</span>';
  return '<tr><td><span class="wo">'+esc(o.wo)+'</span><span class="description">'+esc(o.description)+'</span></td><td><code class="location-code">'+esc(o.location||'—')+'</code></td><td><span class="date-cell">'+esc(displayDate(o.target))+'</span></td><td><span class="status-pill">'+esc(o.status||'—')+'</span></td><td><select data-assign="'+o.id+'" aria-label="Responsável da '+esc(o.wo)+'" title="'+esc(ownerName)+'"><option value="">Selecionar responsável</option>'+state.matrix.owners.map(p=>'<option value="'+p.id+'"'+(o.ownerId===p.id?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></td><td><span class="criterion'+(!o.ownerId?' pending':'')+'">'+esc(o.ownerId?o.method:'Precisa de revisão')+'</span>'+explanation+'</td></tr>';
 }).join(''):'<tr><td colspan="6">Nenhuma ordem corresponde a este filtro.</td></tr>';
 $('pageText').textContent=rows.length?((state.page*size)+1)+'–'+Math.min((state.page+1)*size,rows.length)+' de '+rows.length:'0 ordens';$('prevPage').disabled=state.page===0;$('nextPage').disabled=(state.page+1)*size>=rows.length;
}
$('search').addEventListener('input',()=>{state.page=0;renderTable();});
$('ownerFilter').addEventListener('change',()=>{state.page=0;renderTable();});
$('allTab').addEventListener('click',()=>{state.pending=false;state.page=0;renderTable();});
$('pendingTab').addEventListener('click',()=>{state.pending=true;state.page=0;renderTable();});
$('clearFilters').addEventListener('click',()=>{state.pending=false;state.page=0;$('search').value='';$('ownerFilter').value='';renderTable();});
$('prevPage').addEventListener('click',()=>{state.page--;renderTable();});
$('nextPage').addEventListener('click',()=>{state.page++;renderTable();});
$('orderRows').addEventListener('change',e=>{
 const id=e.target.dataset.assign;if(!id)return;const order=state.orders.find(o=>o.id===id);if(!order)return;
 const selected=e.target.value;if(selected&&!state.matrix.owners.some(o=>o.id===selected))return;
 state.dirty=true;order.ownerId=selected;order.method=selected?'Revisão manual':'revisar';order.reason=selected?'Responsável definido manualmente nesta sessão.':'Aguardando definição manual do responsável.';
 renderSummary();renderTable();
});
function timestamp(){const d=new Date();return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'_'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+String(d.getSeconds()).padStart(2,'0');}
function outputName(id,stamp){return (id==='pending'?'REVISAR':slug(state.matrix.owners.find(o=>o.id===id)?.name))+'_'+stamp+'.xlsx';}
function downloaded(complete=false){if(complete)state.dirty=false; $('step2').classList.remove('current');$('step3').classList.add('current');message('Download gerado no navegador. Confira os arquivos antes de compartilhar.');}
$('destinations').addEventListener('click',e=>{
 const b=e.target.closest('[data-download]');if(!b)return;const id=b.dataset.download,orders=groups().get(id);
 try{download(createXlsx(exportRows(orders,state.matrix)),outputName(id,timestamp()),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');downloaded();}catch(error){message(error.message,true);}
});
$('downloadReport').addEventListener('click',()=>{
 try{download(createXlsx(exportRows(state.orders,state.matrix)),'DISTRIBUICAO_GERAL_'+timestamp()+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');downloaded(true);}catch(e){message(e.message,true);}
});
$('downloadZip').addEventListener('click',()=>{
 try{
 const stamp=timestamp(),files=[...groups()].map(([id,orders])=>({name:outputName(id,stamp),data:createXlsx(exportRows(orders,state.matrix))}));
 files.push({name:'DISTRIBUICAO_GERAL_'+stamp+'.xlsx',data:createXlsx(exportRows(state.orders,state.matrix))});
 const pending=state.orders.filter(o=>!o.ownerId).length;
 files.push({name:'LEIA-ME.txt',data:'RotaOS — Distribuição de ordens de serviço\r\n'+state.orders.length+' ordens de serviço; '+pending+' pendentes de revisão.\r\nQuando houver pendências, elas estarão no arquivo REVISAR, incluído no pacote.\r\nResponsáveis escolhidos manualmente valem apenas nesta sessão.\r\nAs planilhas contêm status, início previsto e critério de distribuição.\r\nLinhas de rodapé ignoradas: '+state.schedule.ignored.length+'.\r\nConfira a distribuição antes de compartilhar.'});
 download(makeZip(files),'ROTAOS_'+stamp+'.zip','application/zip');downloaded(true);
 }catch(e){message(e.message,true);}
});
$('closeDialog').addEventListener('click',()=>$('dialog').close());
$('dialog').addEventListener('click',e=>{if(e.target===$('dialog')){const r=$('dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('dialog').close();}});
$('help').addEventListener('click',()=>dialog('Da planilha para cada responsável','<ol><li>Selecione a matriz. Cada coluna deve ter o nome de um responsável e os códigos dos equipamentos abaixo. Separe vários códigos por vírgula ou ponto e vírgula.</li><li>Selecione o planejamento com as colunas Work Order e Location. Description, Status, Target Start e Work Group são reconhecidos quando presentes.</li><li>Clique em distribuir. Confira as pendências e escolha um responsável nas linhas que precisarem de revisão.</li><li>Baixe um Excel por destino, um relatório geral ou o pacote ZIP. As pendências também são incluídas.</li></ol><p>São aceitos arquivos .xlsx de até 20 MB. Arquivos com senha não são suportados. Use uma versão atual do Chrome ou Edge.</p><p>Na versão publicada, basta abrir o link: adicionar como aplicativo é opcional. Após o primeiro acesso completo, o RotaOS pode abrir sem internet. As planilhas precisam ser selecionadas a cada sessão.</p><p>Os códigos exatos têm prioridade. Depois, o sistema procura o equipamento anterior ao hífen, a família de letras mais específica seguida de números e a turma no texto. A LOCATION tem prioridade sobre o grupo executor e sobre uma turma divergente na descrição. Se a LOCATION tiver vários responsáveis, a turma pode desempatar entre eles. Sem definição suficiente, a ordem fica pendente. O sistema não escolhe o primeiro responsável disponível.</p>'));
$('privacy').addEventListener('click',()=>dialog('Seus arquivos nesta sessão','<p>A leitura e a separação das planilhas acontecem no seu navegador. Este aplicativo não envia o conteúdo dos arquivos para um servidor, não possui banco de dados remoto e não salva planilhas no armazenamento do navegador. A versão PWA guarda somente os arquivos do aplicativo para abrir sem internet após o primeiro acesso.</p><p>Ao atualizar ou fechar esta página, será necessário selecionar os arquivos novamente. Os arquivos que você baixar continuam na pasta de downloads do computador.</p><p>A hospedagem entrega os arquivos do aplicativo ao navegador. O uso com dados corporativos deve seguir a política da empresa e a aprovação da área responsável.</p>'));
$('matrixView').addEventListener('click',()=>{
 let matrix;try{matrix=state.matrix||parseMatrix(state.matrixSheets[Number($('matrixSheet').value)]?.rows||[]);}catch{dialog('Matriz de responsáveis','<p>Selecione uma matriz de responsabilidades para consultar os responsáveis e seus códigos.</p>');return;}
 dialog('Matriz de responsáveis','<p>'+matrix.owners.length+' responsáveis · '+matrix.bindings.size+' códigos · '+matrix.conflicts.length+' códigos compartilhados.</p>'+matrix.owners.map(o=>'<details><summary><b>'+esc(o.name)+'</b> · '+o.locations.length+' códigos</summary><p class="codes">'+o.locations.map(esc).join(' · ')+'</p></details>').join('')+(matrix.conflicts.length?'<h3>Códigos compartilhados</h3><p>A turma da descrição pode identificar um dos responsáveis vinculados. Sem essa definição, estas locations exigem revisão. O grupo executor não desempata vínculos.</p><table><thead><tr><th>Código</th><th>Responsáveis</th></tr></thead><tbody>'+matrix.conflicts.map(c=>'<tr><td>'+esc(c.code)+'</td><td>'+c.owners.map(o=>esc(o.name)).join('<br>')+'</td></tr>').join('')+'</tbody></table>':''));
});
$('navDistribution').addEventListener('click',()=>{
 if(state.orders.length){state.pending=false;state.page=0;renderTable();}
 window.scrollTo({top:0,behavior:'smooth'});
});
$('navReview').addEventListener('click',()=>{
 if(!state.orders.length){message('Selecione a matriz e o planejamento e distribua as ordens para consultar as pendências.');return;}
 state.pending=true;state.page=0;$('search').value='';$('ownerFilter').value='';renderTable();$('ordersPanel').scrollIntoView({behavior:'smooth',block:'start'});
});
$('navDownloads').addEventListener('click',()=>{
 if(!state.orders.length){message('Os arquivos para download estarão disponíveis após a distribuição das ordens.');return;}
 $('downloadActions').scrollIntoView({behavior:'smooth',block:'center'});
});
$('reset').addEventListener('click',()=>{
 if(state.busy)return;
 if(state.dirty&&!window.confirm('Iniciar uma nova distribuição encerra esta sessão. Baixe os resultados que deseja guardar antes de continuar. Continuar?'))return;
 state.matrixSheets=[];state.scheduleSheets=[];state.demo=false;clearResults();
 for(const kind of ['matrix','schedule']){$(kind+'Name').textContent=kind==='matrix'?'Selecione a matriz com os responsáveis e os códigos dos equipamentos.':'Selecione a lista de ordens de serviço enviada pelo planejamento.';$(kind+'Check').textContent='';$(kind+'SheetField').hidden=true;$(kind+'File').value='';}
 message('Sessão limpa. Selecione os arquivos para uma nova distribuição.');ready();window.scrollTo({top:0,behavior:'smooth'});
});
$('demo').addEventListener('click',()=>{
 if(state.busy)return;
 if(state.dirty&&!window.confirm('Abrir a demonstração substitui a distribuição atual. Continuar?'))return;
 setSheets('matrix',[{name:'Matriz fictícia',rows:[['Responsável A (Turma A)','Responsável B (Turma B)','Equipe Técnica (Manutenção)'],['EQP101','EQP201','BOM'],['EQP102','EQP202','EQP102']]}],'Matriz de demonstração · dados fictícios');
 setSheets('schedule',[{name:'Planejamento fictício',rows:[['Work Order','Description','Location','Status','Target Start'],['WO100001','Inspeção mensal da unidade 101','EQP101','WAPPR',46310],['WO100002','Verificação da bomba auxiliar','BOM903-D002','WAPPR',46311],['WO100003','Inspeção dos ventiladores — Turma B','GERAL','WSCH',46312],['WO100004','Inspeção da unidade 102','EQP102','WAPPR',46313],['WO100005','Inspeção de equipamento sem cadastro','NOVO901','WAPPR',46314],['WO100006','Inspeção da unidade 202','EQP202-D001','WAPPR',46315],['Number of Records:',6]]}],'Planejamento de demonstração · dados fictícios');
 state.demo=true;ready();process();
});
ready();

window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
