import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
// Real-browser check for the tracking snippet: the momento proxy path must run under the
// strict policy, an inline snippet must run with the request nonce, and an origin the
// snippet did not declare must be blocked by CSP and reported to the violation list.
const base=process.env.MADI_BASE_URL;if(!base)throw new Error('Isolated fixture URL required');
const email=process.env.MADI_TEST_EMAIL||'admin@example.test';const password=process.env.MADI_TEST_PASSWORD||'Integration-Test-Password-2026!';
const collected=[];const collectorCookies=[];
const collector=http.createServer((request,response)=>{
 if(request.headers.cookie)collectorCookies.push(request.headers.cookie);
 if(request.url.startsWith('/tracker.js')){response.writeHead(200,{'content-type':'text/javascript'});response.end("const s=document.currentScript;window.__madiTracker={site:s.dataset.siteId,endpoint:s.dataset.endpoint};fetch(s.dataset.endpoint+'/collect/v1/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({site:s.dataset.siteId,type:'page_view',path:location.pathname})}).then(r=>{window.__madiTrackerStatus=r.status});");return;}
 if(request.method==='POST'&&request.url==='/collect/v1/events'){let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{collected.push(JSON.parse(body));response.writeHead(204);response.end();});return;}
 response.writeHead(404);response.end();
});
await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
const collectorURL=`http://127.0.0.1:${collector.address().port}`;
const browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();
const external=[];const consoleErrors=[];
await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==new URL(base).origin){external.push(url.href);return route.abort();}return route.continue();});
page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())});
async function api(endpoint,method='GET',data){const response=await context.request.fetch(`${base}/api/v1${endpoint}`,{method,data,headers:{'X-Madi-Request':'1'}});assert.ok(response.ok(),`${method} ${endpoint}: ${response.status()} ${await response.text()}`);return response.json();}
try{
 await api('/auth/login','POST',{email,password});
 const before=await page.goto(base+'/app');
 assert.ok(!before.headers()['content-security-policy'].includes('nonce-'),'default page carries no nonce');
 assert.equal(await page.evaluate(()=>document.querySelectorAll('script[nonce]').length),0,'default page carries no snippet');

 await api('/admin/settings','PUT',{tracking_enabled:true,tracking_provider:'momento',tracking_momento_url:collectorURL,tracking_momento_site_id:'madi-browser'});
 const tracked=await page.goto(base+'/app');
 const policy=tracked.headers()['content-security-policy'];
 assert.match(policy,/script-src 'self' 'nonce-[A-Za-z0-9_-]+'; /);assert.ok(policy.includes('report-uri /api/v1/tracking/csp-report'));assert.ok(!policy.includes(collectorURL),'proxied collector never appears in the policy');
 await page.waitForFunction(()=>window.__madiTrackerStatus===204);
 assert.deepEqual(await page.evaluate(()=>window.__madiTracker),{site:'madi-browser',endpoint:'/momento'});
 assert.equal(collected.length,1);assert.equal(collected[0].path,'/app');assert.deepEqual(collectorCookies,[],'madi session cookie must not reach the collector');
 assert.deepEqual(external,[],'no request may leave the madi origin');

 // An inline snippet runs with the nonce; an origin it hides from the scraper is blocked and reported.
 await api('/admin/settings','PUT',{tracking_provider:'custom',tracking_custom_snippet:"<script>window.__madiInline=true;fetch('https:'+'//beacon.blocked.example/collect').catch(()=>{window.__madiBlocked=true})</script>"});
 await page.goto(base+'/app');
 await page.waitForFunction(()=>window.__madiInline===true&&window.__madiBlocked===true);
 await page.waitForTimeout(500);
 const violations=(await api('/admin/tracking/violations')).items;
 const blocked=violations.find(item=>item.origin==='https://beacon.blocked.example');
 assert.ok(blocked,`blocked origin must be reported: ${JSON.stringify(violations)}`);assert.equal(blocked.directive,'connect-src');assert.equal(blocked.allowed,false);
 assert.ok(consoleErrors.some(text=>text.includes('Content Security Policy')),'the browser must have refused the undeclared origin');
 assert.deepEqual(external,[],'CSP blocks the beacon before the network');

 await api('/admin/settings','PUT',{tracking_allowed_hosts:'https://beacon.blocked.example'});
 assert.equal((await api('/admin/tracking/violations')).items.find(item=>item.origin==='https://beacon.blocked.example').allowed,true);
 await api('/admin/settings','PUT',{tracking_enabled:false});
 const after=await page.goto(base+'/app');
 assert.ok(!after.headers()['content-security-policy'].includes('nonce-'),'policy returns to strict');
 assert.equal(await page.evaluate(()=>document.querySelectorAll('script[nonce]').length),0);
 console.log('PASS momento proxy tracked the page under the strict policy; inline snippet ran with the nonce; undeclared origin blocked and reported');
}finally{await browser.close();collector.close();}
