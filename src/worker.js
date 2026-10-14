import { pageUrl, externalSource, sameSiteHost, sameDestination, inspectPage, parseSitemap, cleanText } from './checks.js';
import { extractHtml } from './html.js';

const JSON_HEADERS={ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-robots-tag':'noindex, nofollow', 'x-content-type-options':'nosniff' };
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID();
function secureEqual(a,b) {a=String(a);b=String(b);let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0;}
function authorized(request,env) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_USER || env.ADMIN_PASSWORD.length < 12) return false;
  const header=request.headers.get('authorization')||'';
  if(!header.startsWith('Basic '))return false;
  try {const pair=atob(header.slice(6));const pivot=pair.indexOf(':');return secureEqual(pair.slice(0,pivot),env.ADMIN_USER)&&secureEqual(pair.slice(pivot+1),env.ADMIN_PASSWORD);}catch{return false;}
}
function err(text,status=400){return json({error:text},status);}
async function body(request){try{const v=await request.json();if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}catch{throw new Error('Invalid JSON body');}}
const cfg = env => {const url=new URL(env.SITE_URL||'https://www.coditation.com/');return {base:url.origin+'/',host:url.hostname,max:Math.min(75,Math.max(5,Number(env.MAX_PAGES)||40))};};
async function textFetch(url, maxBytes=640000){
  const res=await fetch(url,{redirect:'manual',headers:{accept:'text/html,application/xml,text/xml,text/plain;q=0.8'},signal:AbortSignal.timeout(12000)});
  const type=res.headers.get('content-type')||'';
  const location=res.headers.get('location')||'';
  const xRobots=res.headers.get('x-robots-tag')||'';
  if(![200,203].includes(res.status))return {status:res.status,type,location,xRobots,text:''};
  const reader=res.body?.getReader(); if(!reader)return {status:res.status,type,location,xRobots,text:''};
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new Error('Response too large for safe free-tier analysis');}chunks.push(value);}
  const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
  return {status:res.status,type,location,xRobots,text:new TextDecoder().decode(buffer)};
}
function robotsAllowed(robotsText,url) {
  const path=new URL(url).pathname;
  const lines=String(robotsText||'').split(/\r?\n/);
  let group=[];let inRules=false;const rules=[];
  for(const raw of lines){const line=raw.replace(/#.*/, '').trim();if(!line)continue;
    const match=line.match(/^([^:]+):\s*(.*)$/);if(!match)continue;
    const key=match[1].trim().toLowerCase(),val=match[2].trim();
    if(key==='user-agent'){if(inRules){group=[];inRules=false;}group.push(val.toLowerCase());}
    else if(key==='allow'||key==='disallow'){inRules=true;if(group.includes('*')&&val)rules.push({allow:key==='allow',prefix:val.split('*')[0].split('$')[0]});}
  }
  const matching=rules.filter(x=>path.startsWith(x.prefix)).sort((a,b)=>b.prefix.length-a.prefix.length);
  return matching.length?matching[0].allow:true;
}
async function discover(base,host,max) {
  let robots='',sitemaps=[];
  try {const r=await textFetch(new URL('robots.txt',base).toString(),120000);if(r.status===200){robots=r.text;const lines=robots.match(/^sitemap:\s*(\S+)/gim)||[];sitemaps=lines.map(x=>x.replace(/^sitemap:\s*/i,'').trim());}}catch{}
  if(!sitemaps.length)sitemaps=[new URL('sitemap.xml',base).toString()];
  const candidates=[base]; let counter=0;
  for(const siteMapUrl of sitemaps.slice(0,2)){
    if(counter>=4)break;
    try {
      if(!pageUrl(siteMapUrl.replace(/\.xml(?:\?.*)?$/, ''),base,host))continue;
      const r=await textFetch(siteMapUrl,300000);counter++;
      if(r.status!==200)continue;
      let parsed=parseSitemap(r.text);
      if(parsed.kind==='index'){
        for(const sub of parsed.locs.slice(0,3)){
          if(new URL(sub).protocol!=='https:' || !sameSiteHost(new URL(sub).hostname,host))continue;
          const x=await textFetch(sub,300000);counter++;
          if(x.status===200)candidates.push(...parseSitemap(x.text).locs.slice(0,max));
        }
      }else candidates.push(...parsed.locs.slice(0,max));
    }catch{}
  }
  const urls=[...new Set(candidates.map(x=>pageUrl(x,base,host)).filter(x=>x&&robotsAllowed(robots,x)))].slice(0,max);
  return {robots,urls:urls.length?urls:[base]};
}
async function startRun(env,source='manual',requestedLimit=null,siteOrigin=null){
  const selected=siteOrigin?new URL(siteOrigin):new URL(env.SITE_URL||'https://www.coditation.com/');
  const base=selected.origin+'/',host=selected.hostname,max=Math.min(75,Math.max(5,Number(env.MAX_PAGES)||40));
  const active=await env.DB.prepare("SELECT id FROM runs WHERE status='running' AND site=? ORDER BY created_at DESC LIMIT 1").bind(base).first();
  if(active)return {id:active.id,reused:true};
  const limit=Math.min(max,Math.max(5,Number(requestedLimit)||max));
  const id=uid();
  // Store the running state before network discovery so failures don't silently lose runs.
  await env.DB.prepare('INSERT INTO runs (id,site,status,max_pages,source) VALUES (?,?,?,?,?)').bind(id,base,'running',limit,source).run();
  try {
    const discovered=await discover(base,host,limit);
    await env.DB.prepare('UPDATE runs SET robots_text=? WHERE id=?').bind(discovered.robots,id).run();
    for(const u of discovered.urls)await env.DB.prepare('INSERT OR IGNORE INTO queue(run_id,url,depth) VALUES (?,?,0)').bind(id,u).run();
  }catch(e){
    await env.DB.prepare("UPDATE runs SET status='failed',message=?,completed_at=? WHERE id=?").bind(String(e.message).slice(0,400),now(),id).run();
    throw e;
  }
  return {id,reused:false};
}
async function saveIssues(env,runId,url,items){
  for(const i of items)await env.DB.prepare('INSERT INTO issues(id,run_id,url,code,severity,evidence,advice) VALUES (?,?,?,?,?,?,?)')
    .bind(uid(),runId,url,i.code,i.severity,cleanText(i.evidence,800),i.advice).run();
}
async function checkPage(env,run,item){
  const {host,base}={host:new URL(run.site).hostname,base:run.site};let p={url:item.url,status_code:0,final_url:'', title:'',description:'',canonical:'',h1:'',h1_count:0,image_count:0,image_alt_missing:0,jsonld_count:0,og_title:'',og_image:'',robots:'',lang:''};
  let issues=[];let internal=[];
  try{
    if(!robotsAllowed(run.robots_text,item.url)){
      issues=[{code:'robots_blocked',severity:'medium',evidence:'Excluded by robots.txt',advice:'Check whether excluding this URL is intentional.'}];
    }else{
      const response=await textFetch(item.url);
      p.status_code=response.status;p.final_url=response.location?new URL(response.location,item.url).toString():item.url;
      if(response.status===200&&(!response.type||/html/i.test(response.type))){
        const parsed=await extractHtml(response.text,item.url);
        Object.assign(p,parsed);
        p.robots=cleanText([parsed.robots,response.xRobots].filter(Boolean).join(', '),200);
        if(p.canonical){try{p.canonical=new URL(p.canonical,item.url).toString();}catch{p.canonical='';}}
        internal=parsed.links.map(link=>pageUrl(link,item.url,host)).filter(x=>x&&robotsAllowed(run.robots_text,x));
      }
      issues=inspectPage(p);
      if(p.status_code===200&&p.canonical&&!sameDestination(p.canonical,item.url))issues.push({code:'canonical_mismatch_review',severity:'medium',evidence:`Canonical: ${p.canonical}`,advice:'Confirm whether this alternate canonical is intended.'});
      if(p.status_code===200&&/html/i.test(response.type)&&p.jsonld_count===0)issues.push({code:'structured_data_review',severity:'low',evidence:'No JSON-LD scripts detected',advice:'Evaluate relevant schema types; not every page requires structured data.'});
    }
  }catch(e){p.status_code=0;issues=[{code:'crawl_failure',severity:'medium',evidence:String(e.message).slice(0,250),advice:'Retry or check whether automated crawling is blocked.'}];}
  await env.DB.prepare('INSERT OR REPLACE INTO pages (run_id,url,final_url,status_code,title,description,canonical,h1,h1_count,image_count,image_alt_missing,jsonld_count,og_title,og_image,robots,lang) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(run.id,item.url,p.final_url,p.status_code,p.title,p.description,p.canonical,p.h1,p.h1_count,p.image_count,p.image_alt_missing,p.jsonld_count,p.og_title,p.og_image,p.robots,p.lang).run();
  await saveIssues(env,run.id,item.url,issues);
  for(const target of [...new Set(internal)].slice(0,50)){
    await env.DB.prepare('INSERT OR IGNORE INTO links(run_id,source_url,target_url) VALUES (?,?,?)').bind(run.id,item.url,target).run();
  }
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM queue WHERE run_id=?').bind(run.id).first();
  let remaining=Math.max(0,run.max_pages-count.n);
  for(const target of [...new Set(internal)].slice(0,15)){
    if(!remaining)break;
    const ins=await env.DB.prepare('INSERT OR IGNORE INTO queue(run_id,url,depth) VALUES (?,?,?)').bind(run.id,target,item.depth+1).run();
    if(ins.meta.changes)remaining--;
  }
  if(p.status_code>=400){
    const sources=await env.DB.prepare('SELECT source_url FROM links WHERE run_id=? AND target_url=? LIMIT 20').bind(run.id,item.url).all();
    for(const link of sources.results){await saveIssues(env,run.id,link.source_url,[{code:'broken_internal_link',severity:'high',evidence:`Link to ${item.url} returns HTTP ${p.status_code}`,advice:'Update the internal link or restore/redirect the destination.'}]);}
  }
  await env.DB.prepare("UPDATE queue SET status='done' WHERE run_id=? AND url=?").bind(run.id,item.url).run();
}
async function stepRun(env,id,requested=3){
  const run=await env.DB.prepare('SELECT * FROM runs WHERE id=?').bind(id).first();
  if(!run)return {error:'Audit not found',status:404};
  if(run.status!=='running')return {id,status:run.status,done:true};
  const tasks=await env.DB.prepare("SELECT url,depth FROM queue WHERE run_id=? AND status='pending' ORDER BY depth,url LIMIT ?").bind(id,Math.min(4,Math.max(1,Number(requested)||3))).all();
  for(const task of tasks.results){
    const claimed=await env.DB.prepare("UPDATE queue SET status='processing' WHERE run_id=? AND url=? AND status='pending'").bind(id,task.url).run();
    if(!claimed.meta.changes)continue;
    try{await checkPage(env,run,task);}catch(e){await env.DB.prepare("UPDATE queue SET status='pending' WHERE run_id=? AND url=?").bind(id,task.url).run();throw e;}
  }
  const stats=await env.DB.prepare("SELECT SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, COUNT(*) AS total FROM queue WHERE run_id=?").bind(id).first();
  if(!stats.pending){
    const dupes=await env.DB.prepare("SELECT title,COUNT(*) AS n FROM pages WHERE run_id=? AND title<>'' AND status_code=200 GROUP BY title HAVING n>1 LIMIT 20").bind(id).all();
    for(const entry of dupes.results){
      const pages=await env.DB.prepare('SELECT url FROM pages WHERE run_id=? AND title=? LIMIT 20').bind(id,entry.title).all();
      for(const p of pages.results)await saveIssues(env,id,p.url,[{code:'duplicate_title',severity:'medium',evidence:`Title shared by ${entry.n} pages: ${entry.title}`,advice:'Review whether unique title wording would better describe each page.'}]);
    }
    await env.DB.prepare("UPDATE runs SET status='completed',completed_at=? WHERE id=?").bind(now(),id).run();
  }
  return {id,status:stats.pending?'running':'completed',done:stats.done||0,pending:stats.pending||0,total:stats.total||0};
}
async function summary(env){
  const runs=await env.DB.prepare('SELECT id,site,status,max_pages,source,created_at,completed_at,message FROM runs ORDER BY created_at DESC LIMIT 18').all();
  const latest=runs.results[0];
  const count=latest?await env.DB.prepare('SELECT severity,COUNT(*) AS n FROM issues WHERE run_id=? GROUP BY severity').bind(latest.id).all():{results:[]};
  const pages=latest?await env.DB.prepare('SELECT COUNT(*) AS n FROM pages WHERE run_id=?').bind(latest.id).first():{n:0};
  const queue=latest?await env.DB.prepare("SELECT COUNT(*) AS n FROM queue WHERE run_id=? AND status='pending'").bind(latest.id).first():{n:0};
  const links=await env.DB.prepare('SELECT state,COUNT(*) AS n FROM backlinks GROUP BY state').all();
  const issues=latest?await env.DB.prepare('SELECT url,code,severity,evidence,advice,state FROM issues WHERE run_id=? ORDER BY CASE severity WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END,created_at DESC LIMIT 8').bind(latest.id).all():{results:[]};
  return {latest:latest||null,runs:runs.results,bySeverity:Object.fromEntries(count.results.map(x=>[x.severity,x.n])),pages:pages?.n||0,pending:queue?.n||0,backlinks:Object.fromEntries(links.results.map(x=>[x.state,x.n])),issues:issues.results};
}
async function addBacklinks(env,entries){
  const {base,host}=cfg(env);let imported=0,rejected=0;
  for(const r of entries.slice(0,100)){
    const source=externalSource(r.source_url||'');
    const target=pageUrl(r.target_url||base,base,host);
    if(!source||!target||sameSiteHost(new URL(source).hostname,host)){rejected++;continue;}
    const result=await env.DB.prepare('INSERT OR IGNORE INTO backlinks(id,source_url,target_url,anchor) VALUES (?,?,?,?)')
      .bind(uid(),source,target,cleanText(r.anchor||'',150)).run();
    imported+=result.meta.changes||0;
  }
  return {imported,rejected,duplicates:Math.max(0,entries.slice(0,100).length-imported-rejected)};
}
async function verifyBacklinks(env,ids){
  const {host}=cfg(env);const results=[];
  for(const id of ids.slice(0,4)){
    const link=await env.DB.prepare('SELECT * FROM backlinks WHERE id=?').bind(String(id)).first();
    if(!link)continue;
    let state='inaccessible',note='',rel='',status=0;
    try{
      const safe=externalSource(link.source_url);
      if(!safe||sameSiteHost(new URL(safe).hostname,host))throw Error('Unsafe source URL');
      const r=await textFetch(safe);
      status=r.status;
      if(r.status>=300&&r.status<400){state='redirected';note='Source page redirects; review destination manually';}
      else if(r.status!==200){state='inaccessible';note=`Source returned HTTP ${r.status}`;}
      else if(!r.type.includes('html')){state='inaccessible';note='Source is not HTML';}
      else{
        const extracted=await extractHtml(r.text,safe);
        const found=extracted.anchors.find(a=>sameDestination(a.href,link.target_url));
        if(found){state='active';rel=found.rel;note=rel?`Verified; rel="${rel}"`:'Verified dofollow/unmarked link';}
        else {state='missing';note='No matching link found in server-returned HTML';}
      }
    }catch(e){note=String(e.message).slice(0,180);}
    await env.DB.prepare('UPDATE backlinks SET state=?,rel=?,note=?,http_status=?,checked_at=? WHERE id=?').bind(state,rel,note,status,now(),id).run();
    results.push({id,state,note});
  }
  return results;
}
function csvCell(v){return '"'+String(v??'').replace(/"/g,'""')+'"';}
function toCsv(rows,fields){return [fields.join(','),...rows.map(x=>fields.map(f=>csvCell(x[f])).join(','))].join('\r\n');}
async function api(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(method==='GET'&&path==='/api/sites')return json((await env.DB.prepare('SELECT id,name,origin,enabled,created_at FROM monitored_sites ORDER BY created_at DESC LIMIT 100').all()).results);
  if(method==='POST'&&path==='/api/sites'){const b=await body(request);let parsed;try{parsed=new URL(b.url);}catch{return err('Valid HTTPS website URL required');}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||parsed.pathname!=='/'||parsed.search||parsed.hash||!parsed.hostname.includes('.')||/^(localhost|.*\\.local|.*\\.internal)$/i.test(parsed.hostname)||/^(127\\.|10\\.|192\\.168\\.|169\\.254\\.|0\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.)/.test(parsed.hostname))return err('Public HTTPS website origin required');const origin=parsed.origin+'/';const name=String(b.name||parsed.hostname).trim().slice(0,80);await env.DB.prepare('INSERT OR IGNORE INTO monitored_sites(id,name,origin) VALUES(?,?,?)').bind(uid(),name,origin).run();return json({origin,added:true},201);}
  if(method==='GET'&&path==='/api/sites/runs'){const origin=url.searchParams.get('site');if(!origin)return err('site required');return json((await env.DB.prepare('SELECT id,site,status,max_pages,created_at,completed_at FROM runs WHERE site=? ORDER BY created_at DESC LIMIT 25').bind(origin).all()).results);}
  if(method==='POST'&&path==='/api/sites/audit'){const b=await body(request);const site=await env.DB.prepare('SELECT origin FROM monitored_sites WHERE id=? AND enabled=1').bind(String(b.site_id||'')).first();if(!site)return err('Select a registered website');return json(await startRun(env,'manual',b.max_pages,site.origin),201);}

  if(method==='GET'&&path==='/api/summary')return json(await summary(env));
  if(method==='GET'&&path==='/api/runs')return json((await env.DB.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT 50').all()).results);
  if(method==='POST'&&path==='/api/runs'){
    const b=await body(request);return json(await startRun(env,'manual',b.max_pages),201);
  }
  const step=path.match(/^\/api\/runs\/([a-zA-Z0-9-]+)\/step$/);
  if(method==='POST'&&step){const b=await body(request);const result=await stepRun(env,step[1],b.limit);return json(result,result.status===404?404:200);}
  if(method==='GET'&&path==='/api/issues'){
    const runId=url.searchParams.get('run');if(!runId)return err('run query parameter required');
    const rows=await env.DB.prepare('SELECT * FROM issues WHERE run_id=? ORDER BY CASE severity WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END,created_at DESC LIMIT 500').bind(runId).all();return json(rows.results);
  }
  if(method==='GET'&&path==='/api/pages'){
    const runId=url.searchParams.get('run');if(!runId)return err('run query parameter required');
    const rows=await env.DB.prepare('SELECT * FROM pages WHERE run_id=? ORDER BY url LIMIT 100').bind(runId).all();return json(rows.results);
  }
  if(method==='POST'&&path==='/api/issues/status'){
    const b=await body(request);if(!['open','in_review','approved','fixed_pending_verification','ignored'].includes(b.state))return err('Unknown state');
    const result=await env.DB.prepare('UPDATE issues SET state=? WHERE id=?').bind(b.state,String(b.id||'')).run();return json({updated:result.meta.changes});
  }
  if(method==='GET'&&path==='/api/backlinks')return json((await env.DB.prepare('SELECT * FROM backlinks ORDER BY created_at DESC LIMIT 500').all()).results);
  if(method==='POST'&&path==='/api/backlinks'){
    const b=await body(request);return json(await addBacklinks(env,[b]));
  }
  if(method==='POST'&&path==='/api/backlinks/import'){
    const b=await body(request);if(!Array.isArray(b.entries))return err('entries array required');return json(await addBacklinks(env,b.entries));
  }
  if(method==='POST'&&path==='/api/backlinks/verify'){
    const b=await body(request);if(!Array.isArray(b.ids))return err('ids array required');return json({results:await verifyBacklinks(env,b.ids)});
  }
  if(method==='GET'&&path==='/api/exports/issues.csv'){
    const r=url.searchParams.get('run');if(!r)return err('run required');
    const rows=(await env.DB.prepare('SELECT url,code,severity,evidence,advice,state,created_at FROM issues WHERE run_id=? LIMIT 3000').bind(r).all()).results;
    return new Response(toCsv(rows,['url','code','severity','evidence','advice','state','created_at']),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="seo-issues.csv"','cache-control':'no-store'}});
  }
  return err('Route not found',404);
}
export default {
  async fetch(request,env){
    if(!authorized(request,env))return new Response('Access restricted. Configure ADMIN_USER and ADMIN_PASSWORD as Worker secrets.',{status:401,headers:{'www-authenticate':'Basic realm="Coditation SEO Intelligence"','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
    if(!env.DB)return err('D1 is not bound. Run database setup first.',503);
    try{
      if(new URL(request.url).pathname.startsWith('/api/'))return await api(request,env);
      const asset=await env.ASSETS.fetch(request);
      const headers=new Headers(asset.headers);headers.set('Cache-Control','private, no-store');headers.set('X-Robots-Tag','noindex, nofollow');headers.set('X-Content-Type-Options','nosniff');
      return new Response(asset.body,{status:asset.status,headers});
    }catch(e){console.error('Application error',e);return err('Request failed: '+String(e.message).slice(0,160),500);}
  },
  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      try{
        if(controller.cron==='30 3 * * 1')await startRun(env,'weekly');
        const active=await env.DB.prepare("SELECT id FROM runs WHERE status='running' ORDER BY created_at LIMIT 1").first();
        if(active)await stepRun(env,active.id,3);
      }catch(e){console.error('Scheduled SEO scan failed',e);}
    })());
  }
};
