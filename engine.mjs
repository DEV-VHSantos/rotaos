export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
export const normalizeLocation = value => normalize(value).replace(/\s+/g,'');
const key = value => normalize(value).replace(/[^A-Z0-9]/g,'');
const unique = a => [...new Map(a.map(x => [x.id,x])).values()];
export function parseMatrix(rows) {
  let header = rows.findIndex(row => row.filter(v => /TURMA|MANUTEN|CUSTOMER|CLIENTE|SUPERVISOR/.test(normalize(v))).length >= 2);
  if (header < 0) header = rows.findIndex(row => row.filter(v => String(v ?? '').trim()).length >= 2 && !row.some(v => normalize(v) === 'RESPONSAVEL'));
  if (header < 0) throw new Error('Não foi possível identificar os responsáveis na matriz.');
  const owners = [], bindings = new Map(), warnings = [];
  rows[header].forEach((cell,col) => {
    const name = String(cell ?? '').trim();
    if (!name || normalize(name) === 'RESPONSAVEL') return;
    const n=normalize(name), team=n.match(/TURMA\s*([A-Z])/);
    const type=/MANUTEN/.test(n)?'MANUTENCAO':/CUSTOMER|CLIENTE|SUAPE/.test(n)?'CUSTOMER':'SUPERVISOR';
    const owner={id:'owner-'+col,name,type,team:team?.[1]||'',locations:[]};
    for (let r=header+1;r<rows.length;r++) {
      for (let location of String(rows[r]?.[col]??'').split(/[;,\n]+/)) {
        location=location.trim();
        if (!location || /^(SALA DE CONTROLE|SE 230 KV|CONTAINER BLACK-START|RADIADORES|►)/.test(normalize(location))) continue;
        const code=normalizeLocation(location);
        if (!/^[A-Z][A-Z0-9.-]*$/.test(code)) { warnings.push('Código ignorado em '+name+': '+location); continue; }
        if (!owner.locations.includes(code)) owner.locations.push(code);
        if (!bindings.has(code)) bindings.set(code,[]);
        if (!bindings.get(code).some(o=>o.id===owner.id)) bindings.get(code).push(owner);
      }
    }
    owners.push(owner);
  });
  if (!owners.length || !bindings.size) throw new Error('A matriz não contém vínculos válidos entre códigos e responsáveis.');
  const conflicts=[...bindings].filter(([,o])=>o.length>1).map(([code,owners])=>({code,owners}));
  return {owners,bindings,conflicts,warnings};
}
const aliases={
 wo:['WORKORDER','WO','ORDEM','ORDEMDESERVICO'],
 location:['LOCATION','LOCAL','LOCALIZACAO'],
 description:['DESCRIPTION','DESCRICAO','TITLE','TITULO','SUMMARY'],
 status:['STATUS'], target:['TARGETSTART','INICIOPREVISTO','DATAPREVISTA'],
 type:['WORKGROUP','WORKGROUPID','CRAFT','TIPO','TYPE','DISCIPLINE','DISCIPLINA']
};
export function parseSchedule(rows) {
  const header=rows.findIndex((row,i)=>i<60 && row.some(v=>aliases.wo.includes(key(v))) && row.some(v=>aliases.location.includes(key(v))));
  if(header<0) throw new Error('Cabeçalhos Work Order e Location não encontrados nas primeiras 60 linhas.');
  const columns={};
  Object.entries(aliases).forEach(([name,names])=>{columns[name]=rows[header].findIndex(v=>names.includes(key(v)));});
  const orders=[], ignored=[]; const counts=new Map();
  for(let r=header+1;r<rows.length;r++){
    const cells=rows[r]||[], wo=String(cells[columns.wo]??'').trim();
    if(!cells.some(v=>v!==null && v!==undefined && v!=='')) continue;
    if(!/^(?:[A-Z]{0,5}[- ]?)?\d{3,}$/i.test(wo)){
      ignored.push({row:r+1,value:wo||'(sem número)',reason:/NUMBER OF RECORDS|TOTAL|REGISTROS/.test(normalize(wo))?'Rodapé':'Linha sem identificador de ordem válido'});
      continue;
    }
    const get=name=>columns[name]>=0?(cells[columns[name]]??''):'';
    const order={id:'row-'+(r+1),wo,description:String(get('description')),location:String(get('location')).trim(),status:String(get('status')),target:get('target'),type:normalize(get('type')),sourceRow:r+1};
    orders.push(order); counts.set(wo,(counts.get(wo)||0)+1);
  }
  if(!orders.length) throw new Error('Nenhuma ordem de serviço válida encontrada.');
  orders.forEach(o=>o.duplicate=counts.get(o.wo)>1);
  return {orders,ignored,columns,hasType:columns.type>=0};
}
const typeMap={OPERATOR:'SUPERVISOR',ELECTR:'MANUTENCAO',MECH:'MANUTENCAO',CUSTOMER:'CUSTOMER'};
export function identify(order,matrix){
  if(order.duplicate)return {ownerId:'',method:'revisar',reason:'Número de WO repetido na origem. Confira as linhas antes de distribuir.'};
  const location=normalizeLocation(order.location);
  let matches=matrix.bindings.get(location)||[], method='Location exata';
  if(!matches.length && location.includes('-')){
    matches=matrix.bindings.get(location.split('-')[0])||[];method='Equipamento principal';
  }
  if(!matches.length){
    const candidates=[...matrix.bindings].filter(([code])=>/^[A-Z]{1,6}$/.test(code)&&location.startsWith(code)&&/^\d/.test(location.slice(code.length))).sort((a,b)=>b[0].length-a[0].length);
    if(candidates.length){matches=candidates[0][1];method='Família '+candidates[0][0];}
  }
  matches=unique(matches);
  const team=normalize(order.description).match(/TURMA\s*([A-Z])/);
  const titleOwners=team?matrix.owners.filter(o=>o.team===team[1]):[];
  if(matches.length===1){
    const owner=matches[0], expected=typeMap[order.type];
    let reason='Responsável definido pela LOCATION na matriz.';
    if(expected && owner.type!==expected)reason+=' O grupo '+order.type+' informado no planejamento não altera esta atribuição.';
    if(team && owner.team && owner.team!==team[1])reason+=' A LOCATION prevalece sobre a turma mencionada na descrição.';
    return {ownerId:owner.id,method,reason};
  }
  if(matches.length>1){
    const overlap=matches.filter(o=>titleOwners.some(t=>t.id===o.id));
    if(overlap.length===1)return {ownerId:overlap[0].id,method:method+' + turma',reason:'A turma da descrição identifica um dos responsáveis vinculados à LOCATION.'};
    return {ownerId:'',method:'revisar',reason:'A matriz vincula esta LOCATION a mais de um responsável: '+matches.map(o=>o.name).join('; ')+'. Selecione o responsável correto.'};
  }
  if(titleOwners.length===1)return {ownerId:titleOwners[0].id,method:'Turma na descrição',reason:'LOCATION sem vínculo na matriz. Responsável identificado pela turma informada na ordem.'};
  if(titleOwners.length>1)return {ownerId:'',method:'revisar',reason:'LOCATION sem vínculo na matriz e mais de um responsável cadastrado para a turma informada.'};
  return {ownerId:'',method:'revisar',reason:'LOCATION sem vínculo na matriz e descrição sem turma suficiente para identificar o responsável.'};
}
export function distribute(schedule,matrix){return schedule.orders.map(order=>({...order,...identify(order,matrix)}));}
export function exportRows(orders,matrix){
  return [['Work Order','Description','Location','Status','Target Start','Responsável','Critério','Observação'],...orders.map(o=>[o.wo,o.description,o.location,o.status,o.target,matrix.owners.find(p=>p.id===o.ownerId)?.name||'REVISAR',o.method,o.reason])];
}
export function slug(s){return normalize(s).replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'')||'REVISAR';}
export function displayDate(value){
  if(value===''||value==null)return '—';
  if(typeof value==='number'){
    const d=new Date(Date.UTC(1899,11,30)+Math.round(value*86400000));
    return d.toLocaleDateString('pt-BR',{timeZone:'UTC'});
  }
  return String(value);
}
