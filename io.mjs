const enc=new TextEncoder(), dec=new TextDecoder();
function xml(value){return String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function makeZip(files){
 const local=[], central=[];let offset=0;const now=new Date(),time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),date=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
 for(const file of files){
  const name=enc.encode(file.name),data=typeof file.data==='string'?enc.encode(file.data):new Uint8Array(file.data),crc=crc32(data);
  const l=new Uint8Array(30+name.length),lv=new DataView(l.buffer);
  lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint16(10,time,true);lv.setUint16(12,date,true);
  lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);l.set(name,30);
  local.push(l,data);
  const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);
  cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(12,time,true);cv.setUint16(14,date,true);
  cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);c.set(name,46);
  central.push(c);offset+=l.length+data.length;
 }
 const size=central.reduce((s,a)=>s+a.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);
 ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,size,true);ev.setUint32(16,offset,true);
 const out=new Uint8Array(offset+size+22);let p=0;for(const part of [...local,...central,end]){out.set(part,p);p+=part.length;}return out;
}
export async function unzip(input){
 const bytes=new Uint8Array(input),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break;}
 if(end<0)throw new Error('Arquivo XLSX inválido ou incompleto.');
 const count=v.getUint16(end+10,true);let p=v.getUint32(end+16,true),total=0;const out=new Map();
 if(count>3000||count===65535)throw new Error('Esta planilha excede o limite de estrutura suportado.');
 for(let i=0;i<count;i++){
  if(p+46>bytes.length||v.getUint32(p,true)!==0x02014b50)throw new Error('Estrutura do XLSX inválida.');
  const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),size=v.getUint32(p+20,true),rawSize=v.getUint32(p+24,true),n=v.getUint16(p+28,true),e=v.getUint16(p+30,true),c=v.getUint16(p+32,true),at=v.getUint32(p+42,true);
  const name=dec.decode(bytes.subarray(p+46,p+46+n));p+=46+n+e+c;
  total+=rawSize;if(rawSize>40*1024*1024||total>120*1024*1024)throw new Error('Planilha muito grande para processamento local.');
  if(flags&1)throw new Error('Planilhas protegidas por senha não são suportadas.');
  if(at+30>bytes.length||v.getUint32(at,true)!==0x04034b50)throw new Error('Bloco XLSX inválido.');
  const start=at+30+v.getUint16(at+26,true)+v.getUint16(at+28,true);
  if(start+size>bytes.length)throw new Error('Arquivo XLSX incompleto.');
  if(!/^(xl\/|\[Content_Types\]|_rels\/)/.test(name))continue;
  const chunk=bytes.subarray(start,start+size);let data;
  if(method===0)data=chunk;
  else if(method===8){
   let stream;try{stream=new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw new Error('Atualize o Chrome ou Edge para ler este arquivo.');}
   const reader=stream.getReader(),parts=[];let length=0;
   while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>rawSize||length>40*1024*1024){await reader.cancel();throw new Error('Conteúdo descompactado acima do limite.');}parts.push(r.value);}
   data=new Uint8Array(length);let q=0;for(const a of parts){data.set(a,q);q+=a.length;}
  }else throw new Error('Compactação XLSX não suportada.');
  if(data.length!==rawSize||crc32(data)!==crc)throw new Error('Falha de integridade no arquivo XLSX.');
  out.set(name,data);
 }
 return out;
}
function parseXML(bytes){if(!bytes)throw new Error('Parte obrigatória ausente na planilha.');const s=dec.decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(s))throw new Error('XML não permitido.');const d=new DOMParser().parseFromString(s,'application/xml');if(d.getElementsByTagName('parsererror').length)throw new Error('Conteúdo XML inválido na planilha.');return d;}
function children(node,name){return [...node.getElementsByTagNameNS('*',name)];}
function columnIndex(ref){let n=0;for(const c of (ref.match(/^[A-Z]+/i)?.[0]||'A').toUpperCase())n=n*26+c.charCodeAt(0)-64;return n-1;}
function col(i){let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;}
export async function readWorkbook(file){
 if(file.size>20*1024*1024)throw new Error('O limite por arquivo é 20 MB.');
 if(!/\.xlsx$/i.test(file.name))throw new Error('Selecione uma planilha .xlsx. Salve arquivos antigos nesse formato antes de importar.');
 const archive=await unzip(await file.arrayBuffer()),book=parseXML(archive.get('xl/workbook.xml')),rels=parseXML(archive.get('xl/_rels/workbook.xml.rels'));
 const shared=archive.has('xl/sharedStrings.xml')?children(parseXML(archive.get('xl/sharedStrings.xml')),'si').map(s=>children(s,'t').map(t=>t.textContent).join('')):[];
 const sheets=[];
 for(const sheet of children(book,'sheet')){
  const id=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
  const target=children(rels,'Relationship').find(r=>r.getAttribute('Id')===id)?.getAttribute('Target');
  if(!target)continue;
  const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
  const document=parseXML(archive.get(path)),rows=[];
  for(const row of children(document,'row')){
   const i=Number(row.getAttribute('r'))-1;if(i<0||i>100000)throw new Error('A planilha excede 100 mil linhas.');
   const values=[];
   for(const cell of children(row,'c')){
    const index=columnIndex(cell.getAttribute('r')||'A1');if(index>1024)continue;
    const type=cell.getAttribute('t'),v=children(cell,'v')[0]?.textContent??'';
    let value=type==='s'?shared[Number(v)]??'':type==='inlineStr'?children(cell,'t').map(t=>t.textContent).join(''):type==='b'?v==='1':type==='str'||type==='e'||type==='d'?v:v!==''?Number(v):'';
    if(typeof value==='number'&&!Number.isFinite(value))value=v;
    values[index]=value;
   }
   rows[i]=values;
  }
  sheets.push({name:sheet.getAttribute('name')||'Planilha',rows:Array.from(rows,r=>r||[])});
 }
 if(!sheets.length)throw new Error('Nenhuma aba legível encontrada.');return sheets;
}
export function createXlsx(rows){
 const count=rows[0]?.length||1;
 const widths=Array.from({length:count},(_,i)=>Math.min(i===1||i===7?65:42,Math.max(14,...rows.slice(0,2000).map(r=>String(r[i]??'').length+2))));
 const contents=rows.map((r,ri)=>'<row r="'+(ri+1)+'"'+(ri===0?' ht="27" customHeight="1"':'')+'>'+Array.from({length:count},(_,ci)=>{
  const value=r[ci]??'',ref=col(ci)+(ri+1),style=ri===0?' s="1"':ci===4&&typeof value==='number'?' s="2"':'';
  return typeof value==='number'&&Number.isFinite(value)?'<c r="'+ref+'"'+style+'><v>'+value+'</v></c>':'<c r="'+ref+'" t="inlineStr"'+style+'><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
 }).join('')+'</row>').join('');
 const sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:'+col(count-1)+rows.length+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols><sheetData>'+contents+'</sheetData><autoFilter ref="A1:'+col(count-1)+rows.length+'"/></worksheet>';
 return makeZip([
  {name:'[Content_Types].xml',data:'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
  {name:'_rels/.rels',data:'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
  {name:'xl/workbook.xml',data:'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ordens" sheetId="1" r:id="rId1"/></sheets></workbook>'},
  {name:'xl/_rels/workbook.xml.rels',data:'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
  {name:'xl/styles.xml',data:'<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF102B50"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'},
  {name:'xl/worksheets/sheet1.xml',data:sheet}
 ]);
}
export function download(bytes,name,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
