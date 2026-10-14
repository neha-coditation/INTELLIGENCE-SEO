/** Pure, deterministic helpers. No AI models, API credentials, or guessed backlinks. */
export function sameSiteHost(host, configuredHost) {
  const h = String(host).toLowerCase();
  const c = String(configuredHost).toLowerCase();
  return h === c || h.replace(/^www\./, '') === c.replace(/^www\./, '');
}
export function pageUrl(raw, base, configuredHost) {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !sameSiteHost(u.hostname, configuredHost)) return null;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|woff2?|css|js|xml|ico)(?:$|\?)/i.test(u.pathname)) return null;
    u.hash = '';
    u.search = ''; // prevent query traps / duplicate crawl targets
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch { return null; }
}
export function externalSource(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(h) || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(':')) return null;
    u.hash = '';
    return u.toString();
  } catch { return null; }
}
export function cleanText(str, max = 300) { return String(str || '').replace(/\s+/g, ' ').trim().slice(0, max); }
export function issue(code, severity, evidence, advice) { return { code, severity, evidence, advice }; }
export function inspectPage(page) {
  const out = [];
  const s = page.status_code;
  if (s >= 500) return [issue('server_error', 'critical', `HTTP ${s}`, 'Investigate server errors and restore the page.')];
  if (s === 404 || s === 410) return [issue('not_found', 'high', `HTTP ${s}`, 'Restore the URL or add a relevant 301 redirect; update internal links.')];
  if (s === 403 || s === 429) return [issue('access_restricted', 'medium', `HTTP ${s}`, 'Check access and bot restrictions; confirm whether the page is intentionally blocked.')];
  if (s >= 300 && s < 400) return [issue('redirect', 'low', `HTTP ${s} redirects to ${page.final_url || 'unknown'}`, 'Update internal links to the appropriate final URL where possible.')];
  if (s !== 200) return [issue('unexpected_status', 'medium', `HTTP ${s}`, 'Investigate this HTTP response.')];
  if (!page.title) out.push(issue('missing_title', 'high', 'No HTML title', 'Add a unique, descriptive title.'));
  if (page.title && (page.title.length < 20 || page.title.length > 65)) out.push(issue('title_review', 'low', `Title is ${page.title.length} characters`, 'Review title clarity and search snippet presentation; length is guidance, not a ranking rule.'));
  if (!page.description) out.push(issue('missing_description', 'medium', 'No meta description', 'Write a unique summary that matches the page intent.'));
  if (!page.canonical) out.push(issue('missing_canonical', 'medium', 'No canonical link element', 'Confirm the intended canonical URL; add a self-referencing canonical where appropriate.'));
  if (page.h1_count === 0) out.push(issue('missing_h1', 'medium', 'No H1 element', 'Add a clear primary page heading.'));
  if (page.h1_count > 1) out.push(issue('multiple_h1_review', 'low', `${page.h1_count} H1 headings`, 'Review the heading structure; multiple H1s are not automatically an SEO error.'));
  if (page.image_alt_missing > 0) out.push(issue('image_alt_review', 'medium', `${page.image_alt_missing}/${page.image_count} images lack alt attributes`, 'Add descriptive alt text for meaningful images; decorative images may use alt="".'));
  if (!page.og_title || !page.og_image) out.push(issue('social_metadata', 'low', `OG title: ${!!page.og_title}, OG image: ${!!page.og_image}`, 'Add relevant Open Graph tags for sharing.'));
  if (/noindex/i.test(page.robots || '')) out.push(issue('noindex_detected', 'high', `Robots directive: ${page.robots}`, 'Confirm whether excluding this page from indexing is intentional.'));
  if (!page.lang) out.push(issue('missing_language', 'low', 'HTML lang attribute is missing', 'Declare the page language for accessibility and machine interpretation.'));
  return out;
}
export function parseSitemap(xml) {
  const text = String(xml || '');
  const locs = [...text.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map(m => m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').trim())
    .filter(Boolean);
  return { kind: /<sitemapindex\b/i.test(text) ? 'index' : 'urls', locs };
}
export function sameDestination(a, b) {
  try {
    const x = new URL(a); const y = new URL(b);
    return x.hostname.toLowerCase().replace(/^www\./, '') === y.hostname.toLowerCase().replace(/^www\./, '') && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
  } catch { return false; }
}
export function csvRows(text) {
  const rows=[]; let row=[], val='', quoted=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (c==='"') { if(quoted && text[i+1]==='"'){val+='"';i++;} else quoted=!quoted; }
    else if(c===','&&!quoted){row.push(val);val='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(val);if(row.some(Boolean))rows.push(row);row=[];val='';}
    else val+=c;
  }
  row.push(val); if(row.some(Boolean))rows.push(row);
  return rows;
}
export function parseBacklinkCsv(csv) {
  const rows=csvRows(csv); if(rows.length<2)return [];
  const header=rows.shift().map(x=>x.trim().toLowerCase().replace(/[\s_-]/g,''));
  const col=(names)=>header.findIndex(x=>names.includes(x));
  const sourceIndex=col(['source','sourceurl','linkingpage','linkingpageurl','referringpage','referringurl','url']);
  const targetIndex=col(['target','targeturl','linkedpage','linkedpageurl','destination']);
  const anchorIndex=col(['anchor','anchortext']);
  if(sourceIndex<0) throw new Error('CSV needs a Source URL (or Linking page) column.');
  return rows.slice(0,500).map(r=>({source_url:(r[sourceIndex]||'').trim(), target_url:(targetIndex>=0?r[targetIndex]:'')?.trim()||'', anchor:anchorIndex>=0?(r[anchorIndex]||'').trim():''})).filter(r=>r.source_url);
}
