import test from 'node:test';
import assert from 'node:assert/strict';
import {pageUrl, externalSource, inspectPage, parseSitemap, parseBacklinkCsv, sameDestination} from '../src/checks.js';
const host='www.coditation.com';
test('only approved HTTPS hostnames can be crawled',()=>{
  assert.equal(pageUrl('/about?utm_source=x#intro','https://www.coditation.com/',host),'https://www.coditation.com/about');
  assert.equal(pageUrl('https://coditation.com/blog/','https://www.coditation.com/',host),'https://coditation.com/blog');
  assert.equal(pageUrl('https://coditation.com.evil.example/page','https://www.coditation.com/',host),null);
  assert.equal(pageUrl('http://www.coditation.com','https://www.coditation.com/',host),null);
  assert.equal(pageUrl('https://www.coditation.com/file.pdf','https://www.coditation.com/',host),null);
});
test('rejects private, malformed and non-HTTPS backlink targets',()=>{
  assert.equal(externalSource('http://example.com/page'),null);
  assert.equal(externalSource('https://127.0.0.1/admin'),null);
  assert.equal(externalSource('https://localhost/admin'),null);
  assert.equal(externalSource('https://partner.example.net/post'),'https://partner.example.net/post');
});
test('page checks distinguish errors from guidance',()=>{
  const base={title:'',description:'',canonical:'',h1_count:0,image_count:4,image_alt_missing:2,og_title:'',og_image:'',robots:'',lang:''};
  const issues=inspectPage({...base,status_code:200});
  assert.ok(issues.some(x=>x.code==='missing_title'&&x.severity==='high'));
  assert.ok(issues.some(x=>x.code==='image_alt_review'));
  assert.deepEqual(inspectPage({...base,status_code:404}).map(x=>x.code),['not_found']);
  assert.deepEqual(inspectPage({...base,status_code:403}).map(x=>x.code),['access_restricted']);
});
test('sitemap index vs URL list',()=>{
  assert.deepEqual(parseSitemap('<sitemapindex><sitemap><loc>https://coditation.com/sitemap-1.xml</loc></sitemap></sitemapindex>'),{kind:'index',locs:['https://coditation.com/sitemap-1.xml']});
  assert.deepEqual(parseSitemap('<urlset><url><loc>https://coditation.com/a&amp;b</loc></url></urlset>'),{kind:'urls',locs:['https://coditation.com/a&b']});
});
test('CSV import handles quoted commas',()=>{
  const rows=parseBacklinkCsv('Source URL,Target URL,Anchor Text\nhttps://partner.example/x,https://www.coditation.com/,"AI, Data"\n');
  assert.equal(rows[0].anchor,'AI, Data');
});
test('link verification recognizes www apex variants',()=>{
  assert.ok(sameDestination('https://coditation.com/blog/','https://www.coditation.com/blog'));
  assert.ok(!sameDestination('https://other.com/blog','https://www.coditation.com/blog'));
});
