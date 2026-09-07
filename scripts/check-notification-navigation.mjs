import assert from 'node:assert/strict';
// Opt-in browser check: PLAYWRIGHT_MODULE can point to an installed Playwright module.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createHerdrHttpServer } from '../src/http-server.mjs';
const snapshot=JSON.parse(await readFile(new URL('../test/fixtures/fake-state.template.json', import.meta.url),'utf8')).snapshot;
const {server}=createHerdrHttpServer({herdr:{async snapshot(){return snapshot;},async readPane(pane){return 'terminal '+pane;}}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
for(const mobile of [false,true]) {
const page=await browser.newPage({serviceWorkers:'block',viewport:mobile?{width:390,height:844}:{width:1280,height:900},hasTouch:mobile,isMobile:mobile});
await page.addInitScript(()=>{Object.defineProperty(window,'launchQueue',{value:{setConsumer(consumer){window.launchConsumer=consumer;}}});});
await page.goto('http://127.0.0.1:'+server.address().port);
await page.locator('#terminal-output').filter({hasText:'terminal'}).waitFor();
await page.route('**/api/snapshot', async route=>{await new Promise(r=>setTimeout(r,500));await route.continue().catch(()=>{});});
await page.evaluate(()=>{window.notificationProbe='same-window';const channel=new MessageChannel();channel.port1.onmessage=e=>window.notificationAccepted=e.data.accepted;navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'open-notification-pane',url:location.origin+'/?pane=w2%3Ap1'},ports:[channel.port2]}));});
await page.reload();
await page.locator('#terminal-output').filter({hasText:'terminal'}).waitFor();
const title=await page.locator('#pane-title').textContent();
console.log({mobile,title});
assert(title.toLowerCase().includes('deploy'),'notification target must survive a worker-update reload before the snapshot arrives');
await page.unroute('**/api/snapshot');
await page.locator('#terminal-input').fill('unsent draft');
await page.evaluate(()=>{
 window.stillSamePage=true;
 navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
 window.launchConsumer({targetURL:location.origin+'/?pane=w1%3Ap1'});
});
await page.waitForFunction(()=>document.querySelector('#terminal-output').textContent.includes('w1:p1'));
assert.equal(await page.evaluate(()=>window.stillSamePage),true,'worker activation must not reload the conversation');
assert.equal(await page.locator('#terminal-input').inputValue(),'unsent draft');
await page.close();
}
}finally{await browser.close();await new Promise(r=>server.close(r));}
