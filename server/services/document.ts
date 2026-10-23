import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import pdf from 'pdf-parse';
import { parseValidity, scheduleFromHtml, scheduleFromItems, normalize, type PositionedItem, type Schedule } from './schedule';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function extractText(filePath: string, mime: string) {
  return extractBuffer(await fs.readFile(filePath),mime);
}

export async function extractBuffer(buffer:Buffer,mime:string){
  return (await extractDocument(buffer,mime)).text;
}

/** Text plus the individual schedule, read from the document's layout (PDF positions or DOCX table). */
export async function extractDocument(buffer:Buffer,mime:string):Promise<{text:string;schedule:Schedule|null}>{
  if (mime === 'application/pdf') {
    const items:PositionedItem[]=[];let page=0;
    const text=(await pdf(buffer)).text;
    await pdf(buffer,{pagerender:async(p:any)=>{page++;const content=await p.getTextContent();for(const it of content.items)items.push({page,x:it.transform[4],y:it.transform[5],w:it.width,s:it.str});return ''}});
    return {text,schedule:scheduleFromItems(items,parseValidity(text))};
  }
  if (mime === DOCX) {
    const [raw,html]=await Promise.all([mammoth.extractRawText({buffer}),mammoth.convertToHtml({buffer})]);
    return {text:raw.value,schedule:scheduleFromHtml(html.value,parseValidity(raw.value))};
  }
  if (mime === 'application/msword') throw Object.assign(new Error('DOC legado deve ser convertido para DOCX antes da extração.'), { status: 422 });
  throw Object.assign(new Error('Formato não suportado.'), { status: 415 });
}

// The scholar is identified only by a full-name match against the people already
// registered in the project; a document is never allowed to create or pick a scholar on its own.
export function identifyScholar<T extends { id: string; full_name: string }>(text: string, scholars: T[]):
  { status: 'found'; scholar: T } | { status: 'none' } | { status: 'ambiguous'; names: string[] } {
  const haystack = normalize(text);
  const found = scholars.filter((s) => s.full_name.trim().length > 4 && haystack.includes(normalize(s.full_name.trim())));
  if (found.length === 1) return { status: 'found', scholar: found[0] };
  if (!found.length) return { status: 'none' };
  return { status: 'ambiguous', names: found.map((s) => s.full_name) };
}

type ItemType='objective'|'goal'|'activity'|'product'|'dependency'|'indicator';
export type ExtractedItem={title:string;description:string;source_reference:Record<string,unknown>;scheduled_months:string[];starts_on:string|null;ends_on:string|null};
type Section=ItemType|'general'|'skip';

// Headings of the FAPTO Formulário 29 (Plano de Trabalho do Bolsista).
const sectionHeadings:Array<[RegExp,Section]>=[
  [/^(\d+\s*[.)-]?\s*)?objetivo geral\b/,'general'],
  [/^(\d+\s*[.)-]?\s*)?objetivos? especificos?\b/,'objective'],
  [/^(\d+\s*[.)-]?\s*)?metas?\b/,'goal'],
  [/^(\d+\s*[.)-]?\s*)?atividades( a serem executadas| previstas)?\b/,'activity'],
  [/^(\d+\s*[.)-]?\s*)?produtos?(\(s\))? esperados?/,'product'],
  [/^(\d+\s*[.)-]?\s*)?indicadores?\b/,'indicator'],
  [/^(\d+\s*[.)-]?\s*)?(referencial|referencias|bibliografia)/,'skip']
];
const bullet=/^([●•▪◦■□➢➤\-–*]|[a-z]\)|\d{1,2}[.)](?!\d))\s*/i;
const words=(s:string)=>new Set(normalize(s).replace(/[^a-z0-9 ]/g,' ').split(' ').filter((w)=>w.length>2));
function similarity(a:string,b:string){const A=words(a),B=words(b);if(!A.size||!B.size)return 0;let n=0;for(const w of A)if(B.has(w))n++;return n/Math.max(A.size,B.size)}
const firstDay=(m:string)=>`${m}-01`;
const lastDay=(m:string)=>{const [y,mo]=m.split('-').map(Number);return `${m}-${String(new Date(Date.UTC(y,mo,0)).getUTCDate()).padStart(2,'0')}`};

/**
 * Splits the plan into objectives, activities, products… by the Formulário 29
 * sections and bullet points, then attaches to each activity the months marked
 * in its cronograma row. Falls back to keyword heuristics for other layouts.
 */
export function structurePlan(text:string,schedule:Schedule|null=null){
  const clean=text.replace(/\r/g,'').replace(/[ \t]+/g,' ').trim();
  const lines=clean.split('\n').map((x)=>x.trim()).filter((l)=>l&&!/fundamento legal/i.test(l)&&!/^\d{1,3}$/.test(l));
  const buckets:Record<ItemType,ExtractedItem[]>={objective:[],goal:[],activity:[],product:[],dependency:[],indicator:[]};
  const make=(title:string,ref:Record<string,unknown>):ExtractedItem=>({title,description:'',source_reference:ref,scheduled_months:[],starts_on:null,ends_on:null});
  let section:Section|null=null,current:ExtractedItem|null=null,general:string[]=[],generalLine=0,found=0;
  const close=()=>{if(current&&current.title.length>8)buckets[(section==='general'?'objective':section) as ItemType]?.push(current);current=null};
  for(const [i,line] of lines.entries()){
    const n=normalize(line);
    if(/cronograma de atividades/.test(n)){close();section=null;break}
    // A heading is numbered ("3. Atividades…"), ends with ":" or stands alone; a wrapped
    // line that merely starts with "atividades, metas…" is content.
    const headingShape=/^\d+\s*[.)-]/.test(n)||/:\s*$/.test(line)||(line.length<45&&!/[,;]/.test(line));
    const heading=headingShape?sectionHeadings.find(([re])=>re.test(n)&&line.length<120):undefined;
    if(heading){
      close();section=heading[1];found++;
      const rest=line.replace(/^[^:]*:\s*/,'');
      if(section==='general'){general=rest!==line&&rest?[rest]:[];generalLine=i+1}
      else if(rest!==line&&rest.length>8&&section!=='skip')current=make(rest,{line:i+1,section});
      continue;
    }
    if(!section||section==='skip')continue;
    if(section==='general'){general.push(line);continue}
    if(bullet.test(line)){close();current=make(line.replace(bullet,'').trim(),{line:i+1,section});continue}
    if(current)current.title=`${current.title} ${line}`;else current=make(line,{line:i+1,section});
    if(/[.;]$/.test(line)&&!bullet.test(lines[i+1]??'-'))close();
  }
  close();
  if(general.length)buckets.objective.unshift(make(general.join(' ').replace(/\s+/g,' ').trim(),{line:generalLine,section:'general'}));
  if(!found)return legacyStructure(clean,schedule);
  for(const list of Object.values(buckets))for(const item of list)item.title=item.title.replace(/\s+/g,' ').replace(/\s+([;.,])/g,'$1').trim();
  attachSchedule(buckets.activity,schedule);
  return {items:buckets,sourceText:clean,schedule};
}

// Each cronograma row is matched to the listed activity with the most words in
// common; rows that match nothing become activities of their own.
function attachSchedule(activities:ExtractedItem[],schedule:Schedule|null){
  if(!schedule)return;
  const used=new Set<number>();
  for(const row of schedule.rows){
    let best=-1,score=0;
    activities.forEach((a,i)=>{const s=similarity(a.title,row.activity);if(!used.has(i)&&s>score){score=s;best=i}});
    const target=best>=0&&score>=0.6?activities[best]:null;
    if(target)used.add(best);
    const item=target??{title:row.activity,description:'',source_reference:{section:'cronograma'},scheduled_months:[],starts_on:null,ends_on:null};
    item.scheduled_months=row.months;
    item.source_reference={...item.source_reference,schedule:row.columns.map((c)=>schedule.columns[c]?.label)};
    if(row.months.length){item.starts_on=firstDay(row.months[0]);item.ends_on=lastDay(row.months[row.months.length-1])}
    if(!target)activities.push(item);
  }
}

function legacyStructure(clean:string,schedule:Schedule|null){
  const lines=clean.split('\n').map((x)=>x.trim()).filter(Boolean);
  const buckets:Record<ItemType,ExtractedItem[]>={objective:[],goal:[],activity:[],product:[],dependency:[],indicator:[]};
  let active:ItemType='activity';
  const headings:Record<string,ItemType>={objetivo:'objective',meta:'goal',atividade:'activity',produto:'product',entrega:'product',dependência:'dependency',indicador:'indicator'};
  const make=(title:string,line:number):ExtractedItem=>({title,description:'',source_reference:{line},scheduled_months:[],starts_on:null,ends_on:null});
  lines.forEach((line,i)=>{
    const normalized=line.toLocaleLowerCase('pt-BR');
    const heading=Object.entries(headings).find(([word])=>normalized.includes(word)&&line.length<90);
    if(heading){active=heading[1];if(/[:–-]\s*\S/.test(line))buckets[active].push(make(line.replace(/^.*?[:–-]\s*/,''),i+1));return}
    if(line.length>18&&!/^(plano de trabalho|cronograma|identificação)/i.test(line))buckets[active].push(make(line,i+1));
  });
  attachSchedule(buckets.activity,schedule);
  return {items:buckets,sourceText:clean,schedule};
}
