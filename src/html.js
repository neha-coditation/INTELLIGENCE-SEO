import { cleanText } from './checks.js';
/** Parse a bounded HTML document using the Workers native HTMLRewriter. */
export async function extractHtml(html, currentUrl) {
  const data = {title:'',description:'',canonical:'',h1:'',h1_count:0,image_count:0,image_alt_missing:0,jsonld_count:0,og_title:'',og_image:'',robots:'',lang:'', links:[], anchors:[]};
  const linkSet = new Set();
  const rewriter = new HTMLRewriter()
    .on('html', {element(e) {data.lang=cleanText(e.getAttribute('lang')||'',20);}})
    .on('title', {text(t) {data.title+=t.text;}})
    .on('h1', {element(){data.h1_count++;}, text(t){if(data.h1_count===1) data.h1+=t.text;}})
    .on('meta', {element(e) {
      const name=(e.getAttribute('name')||'').toLowerCase();
      const prop=(e.getAttribute('property')||'').toLowerCase();
      const value=e.getAttribute('content')||'';
      if(name==='description')data.description=value;
      if(name==='robots')data.robots=value;
      if(prop==='og:title')data.og_title=value;
      if(prop==='og:image')data.og_image=value;
    }})
    .on('link', {element(e){if((e.getAttribute('rel')||'').toLowerCase().split(/\s+/).includes('canonical'))data.canonical=e.getAttribute('href')||'';}})
    .on('img', {element(e){data.image_count++;if(e.getAttribute('alt')===null)data.image_alt_missing++;}})
    .on('a[href]', {element(e){
      const href=e.getAttribute('href')||'';
      try {const u=new URL(href,currentUrl); if(u.protocol==='https:'&&linkSet.size<120){linkSet.add(u.toString());data.anchors.push({href:u.toString(),rel:e.getAttribute('rel')||''});}}catch{}
    }})
    .on('script[type="application/ld+json"]', {element(){data.jsonld_count++;}});
  await rewriter.transform(new Response(html,{headers:{'content-type':'text/html;charset=utf-8'}})).text();
  data.title=cleanText(data.title,220); data.h1=cleanText(data.h1,250);data.description=cleanText(data.description,400);
  data.links=[...linkSet];
  return data;
}
