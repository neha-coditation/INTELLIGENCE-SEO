import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalUrl,reportingWindow,buildSeoInsights,googleStatus} from '../src/google.js';
test('normalizes canonical URLs to configured site',()=>{assert.equal(canonicalUrl('/about/?utm_source=google'),'https://www.coditation.com/about');assert.equal(canonicalUrl('https://coditation.com/about/'),'https://www.coditation.com/about');assert.equal(canonicalUrl('https://example.com/'),null);assert.equal(canonicalUrl('http://www.coditation.com/'),null);});
test('uses 28 days of completed search data',()=>assert.deepEqual(reportingWindow(new Date('2026-10-14T11:00:00Z')),{start:'2026-09-14',end:'2026-10-11'}));
test('identifies low CTR opportunities',()=>{const r=buildSeoInsights([{kind:'page',key_value:'https://www.coditation.com/a',impressions:220,ctr:.004},{kind:'page',key_value:'https://www.coditation.com/b',impressions:1000,ctr:.07}],[{key_value:'https://www.coditation.com/a',sessions:4}]);assert.equal(r.opportunities.length,1);assert.equal(r.matchedPages,1);});
test('unconfigured Google account does not expose secrets',async()=>{const s=await googleStatus({DB:{prepare:()=>({first:async()=>null})}});assert.equal(s.configured,false);assert.equal(s.gaPropertyConfigured,false);});
