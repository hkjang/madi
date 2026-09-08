import { chromium } from '../../../tests/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

// Invoked by the opt-in Go integration test against an isolated PostgreSQL
// schema and the actual production web/dist assets. Never targets production.
const base = process.env.MADI_BASE_URL;
assert.ok(base, 'Go harness must supply an isolated server URL');
const browser = await chromium.launch({headless:true});
const contexts = await Promise.all([browser.newContext(),browser.newContext()]);
const [a,b] = await Promise.all(contexts.map(c=>c.newPage()));
const issues=[];
for (const page of [a,b]) {
  page.on('pageerror',e=>issues.push(e.message));
  page.on('response',r=>{if(r.status()>=500)issues.push(`${r.status()} ${r.url()}`)});
  await page.addInitScript(()=>{
    const Original=window.WebSocket;
    window.__madiTestSockets=[];
    window.WebSocket=class extends Original {constructor(...args){super(...args);window.__madiTestSockets.push(this)}};
  });
}
async function api(context,path,method='GET',data){
  const response=await context.request.fetch(base+'/api/v1'+path,{method,data,headers:{'X-Madi-Request':'1'}});
  assert.ok(response.ok(),`${method} ${path} ${response.status()} ${await response.text()}`);
  return response.json();
}
const connected=page=>page.locator('.collaboration-bar[data-state="connected"]').waitFor();
const editable=page=>page.locator('.tiptap-content[contenteditable="true"]');
async function append(page,value){await editable(page).click();await page.keyboard.press('Control+End');await page.keyboard.insertText(value)}
try{
  await api(contexts[0],'/auth/login','POST',{email:'admin@example.test',password:'Integration-Test-Password-2026!'});
  await api(contexts[1],'/auth/login','POST',{email:'collaborator@example.test',password:'Collaboration-Password-2026!'});
  const workspaces=await api(contexts[0],'/workspaces');
  const doc=await api(contexts[0],'/documents','POST',{workspace_id:workspaces[0].id,title:'실시간 공동 편집 검증',markdown:'---\ntags: [공동편집]\n---\n## 함께 작성\n\n첫 문장'});
  await a.goto(base+'/app/documents/'+doc.id);
  await connected(a);
  await b.goto(base+'/app/documents/'+doc.id);
  await connected(b);
  await Promise.all([append(a,' ALICE_동시_😀'),append(b,' BOB_동시_한글')]);
  for(const page of [a,b]) await page.waitForFunction(()=>{const t=document.querySelector('.tiptap-content')?.textContent||'';return t.includes('ALICE_동시_😀')&&t.includes('BOB_동시_한글')});
  await a.waitForFunction(()=>document.querySelector('.collaboration-bar')?.textContent.includes('모든 변경 저장됨'));
  const saved=await api(contexts[0],'/documents/'+doc.id);
  assert.ok(saved.markdown.startsWith('---\ntags: [공동편집]\n---\n'));
  const savedPlain=saved.markdown.replaceAll('\\_','_');
  assert.ok(savedPlain.includes('ALICE_동시_😀')&&savedPlain.includes('BOB_동시_한글'),saved.markdown);
  await a.waitForFunction(()=>document.querySelectorAll('.collaboration-peers span').length>=2);
  await a.waitForFunction(()=>document.querySelectorAll('.collaboration-carets__caret').length>=1);
  console.log('PASS native two-browser concurrent editing, durable Markdown, presence and cursor');

  await append(b,' BEFORE_RECONNECT');
  await b.evaluate(()=>window.__madiTestSockets.at(-1).close());
  await connected(b);
  await a.waitForFunction(()=>document.querySelector('.tiptap-content')?.textContent.includes('BEFORE_RECONNECT'));
  await b.reload();await connected(b);
  assert.ok((await editable(b).innerText()).includes('BEFORE_RECONNECT'));
  console.log('PASS reconnect preserves unacknowledged edit and durable reload');

  const beforeRest=await api(contexts[0],'/documents/'+doc.id);
  await api(contexts[0],'/documents/'+doc.id,'PUT',{version:beforeRest.version,markdown:'# REST 기준 변경\n\nREST_EPOCH_BARRIER'});
  for(const page of [a,b])await page.locator('.collaboration-bar[data-state="conflict"]').waitFor();
  assert.equal((await api(contexts[0],'/documents/'+doc.id)).markdown,'# REST 기준 변경\n\nREST_EPOCH_BARRIER');
  await a.reload();await connected(a);await b.reload();await connected(b);
  console.log('PASS REST epoch replacement offers recovery instead of overwriting');

  const users=await api(contexts[0],'/admin/users');const user=users.find(u=>u.email==='collaborator@example.test');
  const beforeRevocation=await editable(b).innerText();
  await api(contexts[0],'/admin/users/'+user.id,'PUT',{disabled:true});
  await b.locator('.collaboration-bar[data-state="error"]').waitFor();
  await append(a,' SECRET_AFTER_REVOCATION');
  await a.waitForFunction(()=>document.querySelector('.collaboration-bar')?.textContent.includes('모든 변경 저장됨'));
  assert.equal(await b.locator('.tiptap-content').innerText(),beforeRevocation);
  assert.ok(!(await b.locator('.tiptap-content').innerText()).includes('SECRET_AFTER_REVOCATION'));
  console.log('PASS silent revoked browser receives no future document state');
  assert.deepEqual(issues,[],'browser runtime errors');
}catch(error){
  await a.screenshot({path:'/tmp/madi-collaboration-failure-a.png',fullPage:true}).catch(()=>{});
  await b.screenshot({path:'/tmp/madi-collaboration-failure-b.png',fullPage:true}).catch(()=>{});
  console.error('Browser issues:',issues);
  console.error('Page A:',await a.locator('body').innerText().catch(()=>''));
  console.error('Page B:',await b.locator('body').innerText().catch(()=>''));
  throw error;
}finally{await browser.close()}
