import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { createHerdrHttpServer } from "../src/http-server.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const snapshot = JSON.parse(await readFile(new URL("../test/fixtures/fake-state.template.json", import.meta.url), "utf8")).snapshot;
const writes = [];
let inFlight = 0;
let maxInFlight = 0;
const record = async item => {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise(resolve => setTimeout(resolve, 20));
  writes.push(item);
  inFlight--;
};
const { server } = createHerdrHttpServer({ herdr: {
  async snapshot() { return snapshot; },
  async readPane() { return "older line\n".repeat(230) + "terminal ready\nhttps://example.com\nselect this text"; },
  async sendText(paneId, text, options) { await record({ paneId, text, ...options }); },
  async sendKeys(paneId, keys) { await record({ paneId, keys }); },
}, logger: { info() {}, error() {} } });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  for (const mobile of [false, true]) {
    writes.length = 0;
    const page = await browser.newPage({ serviceWorkers: "block", hasTouch: mobile, isMobile: mobile,
      viewport: { width: mobile ? 390 : 1280, height: 844 } });
    const errors = [];
    const httpTerminalRequests = [];
    page.on("request", request => {
      if (/\/api\/panes\/.*\/(text|keys|output)/.test(request.url())) httpTerminalRequests.push(request.url());
    });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const output = page.locator("#terminal-output");
    await output.filter({ hasText: "terminal ready" }).waitFor();
    const activate = () => mobile ? output.tap({ position: { x: 30, y: 15 } })
      : output.click({ position: { x: 30, y: 15 } });
    await activate();
    assert.equal(await page.evaluate(() => document.activeElement.id), "terminal-direct-input");
    await page.keyboard.type("/$help");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#terminal-input-indicator").hidden === false);
    await page.waitForTimeout(250);
    assert.equal(writes.filter(item => item.text).map(item => item.text).join(""), "/$help");
    assert(writes.filter(item => item.text).every(item => item.submit === false));
    assert.deepEqual(writes.filter(item => item.keys).map(item => item.keys), [["tab"], ["up"], ["enter"]]);
    writes.length = 0;
    // Emulate both composition updates and the final input event.
    await page.locator("#terminal-direct-input").evaluate(input => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.value = "\u200bㅎ";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "ㅎ" }));
    });
    await page.waitForTimeout(50);
    assert.equal(writes.map(item => item.text).join(""), "ㅎ", "Hangul must reach the terminal before composition commits");
    await page.locator("#terminal-direct-input").evaluate(input => {
      input.value = "\u200b한글";
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한글" }));
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "한글" }));
    });
    await page.waitForTimeout(100);
    assert.equal(writes.map(item => item.text).join(""), "ㅎ\x7f한글");
    writes.length = 0;
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(100);
    assert.deepEqual(writes.map(item => item.keys), [["backspace"], ["ctrl+c"]]);
    writes.length = 0;
    await page.locator('.quick-keys [data-modifier="ctrl"]').click();
    await page.locator("#terminal-direct-input").evaluate(input => {
      input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "a" }));
    });
    await page.locator('.quick-keys [data-key="end"]').click();
    await page.waitForTimeout(100);
    assert.deepEqual(writes.map(item => item.keys), [["ctrl+a"], ["end"]]);
    writes.length = 0;
    await activate();
    await page.locator("#terminal-direct-input").evaluate(input => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", "echo pasted\n");
      input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }));
    });
    await page.waitForTimeout(100);
    assert.equal(writes.map(item => item.text).join(""), "echo pasted\n");
    writes.length = 0;
    const copyAllowed = await output.evaluate(el => {
      el.focus();
      window.getSelection().selectAllChildren(el);
      const event = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return !event.defaultPrevented;
    });
    assert(copyAllowed);
    await page.waitForTimeout(50);
    assert.equal(writes.length, 0);
    await page.evaluate(() => window.getSelection().removeAllRanges());
    const composer = page.locator("#terminal-input");
    await composer.fill("draft\nsecond line");
    assert.equal(await page.locator("#terminal-input-indicator").isVisible(), false);
    assert.equal(writes.length, 0);
    await page.locator(".send-button").click();
    await page.waitForTimeout(100);
    assert.deepEqual(writes.map(({ text, submit }) => ({ text, submit })), [{ text: "draft\nsecond line", submit: true }]);
    assert.deepEqual(errors, []);
    assert.deepEqual(httpTerminalRequests, [], "live terminal input and output must use WebSocket only");
    const historyResponse = page.waitForResponse(response => /\/output\?lines=400/.test(response.url()));
    await output.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
    assert.equal((await historyResponse).status(), 200);
    console.log({ mobile, directTyping: true, keys: true, composition: true, selectionCopy: true, composerPreserved: true });
    await page.close();
  }
  assert.equal(maxInFlight, 1);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
