import assert from 'node:assert/strict';
// Opt-in browser regression: PLAYWRIGHT_MODULE may point to an installed Playwright module.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createHerdrHttpServer } from '../src/http-server.mjs';
const snapshot=JSON.parse(await readFile(new URL('../test/fixtures/fake-state.template.json', import.meta.url),'utf8')).snapshot;
let sentAt=0; const reads=[]; const sentKeys=[];
const {server}=createHerdrHttpServer({herdr:{async snapshot(){return snapshot;},async readPane(){reads.push(Date.now()); return Array.from({length:150},(_,i)=>`line ${i}`).join('\n')+(sentAt&&Date.now()-sentAt>=400?'\nECHO_READY':'');},async sendText(){sentAt=Date.now();},async sendKeys(_pane, keys){sentKeys.push(keys);}}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({serviceWorkers:'block',viewport:{width:390,height:844}});
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('#terminal-output').filter({hasText:'line 149'}).waitFor();
 await page.locator('#terminal-input').fill('hello');
 await page.locator('.send-button').click();
 await page.waitForFunction(()=>document.querySelector('#terminal-output').textContent.includes('ECHO_READY'));
 const latency=Date.now()-sentAt;
 const output=page.locator('#terminal-output');await output.hover();await page.mouse.wheel(0,-300);await page.waitForTimeout(150);
 const buttonVisible=await page.locator('#terminal-live').isVisible();
 console.log(JSON.stringify({latency,reads:reads.filter(t=>t>=sentAt).map(t=>t-sentAt),buttonVisible}));
 if(buttonVisible){await page.locator('#terminal-live').click();await page.waitForTimeout(100);assert(await output.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<40));}
 assert(latency<800,'400ms echo should render within 800ms');
 assert(buttonVisible,'scrolling up must expose the bottom button even without a TUI banner');
 assert.deepEqual(sentKeys, [], 'local scrolling must not send keys to the terminal');
 assert.equal(await page.locator('#terminal-live').isVisible(), false, 'button hides after returning to the bottom');
}finally{await browser.close();await new Promise(r=>server.close(r));}
