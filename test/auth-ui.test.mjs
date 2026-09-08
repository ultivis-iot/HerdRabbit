import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(
  new URL("../public/styles.css", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);
const app = await readFile(
  new URL("../public/app.js", import.meta.url),
  "utf8",
);

test("keeps the password screen hidden when authentication is disabled", () => {
  assert.match(
    styles,
    /\.login-screen\[hidden\]\s*\{[\s\S]*?display:\s*none/,
  );
});

test("offers passkey login without removing the password fallback", () => {
  assert.match(page, /id="login-password"/);
  assert.match(page, /autocomplete="current-password webauthn"/);
  assert.match(page, /id="passkey-login"[^>]*>\s*Sign in with a passkey/s);
  assert.match(page, /id="passkey-dialog"/);
  assert.match(page, /id="passkey-register"/);
  assert.match(page, /simplewebauthn-browser\.js/);
  assert.match(app, /startAuthentication\(\{\s*optionsJSON:/);
  assert.match(app, /\/api\/auth\/passkeys\/login\/options/);
  assert.match(app, /startRegistration\(\{\s*optionsJSON:/);
  assert.match(app, /\/api\/auth\/passkeys\/register\/verify/);
});

test("renders Passkey before the password fallback in the login card", () => {
  assert.match(
    page,
    /id="passkey-login"[^>]*class="[^"]*primary-button[^"]*"[\s\S]*id="login-password"[\s\S]*class="[^"]*login-submit[^"]*secondary-button/,
  );
  assert.match(page, /id="login-instruction"/);
  assert.match(page, /id="login-password-label"/);
  assert.match(app, /loginMethodPresentation/);
});

test("starts a regular passkey ceremony once when the login screen opens", () => {
  assert.match(app, /passkeyAutoStarted: false,/);
  assert.match(app, /state\.passkeyAutoStarted = true;\s+void startPasskeyLogin\(\);/);
  assert.match(app, /elements\.loginScreen\.hidden = false;[\s\S]*?startAutomaticPasskeyLogin\(\);/);
  assert.doesNotMatch(app, /useBrowserAutofill: true/);
});

test("shares one verification path between automatic login and the passkey button", () => {
  assert.equal((app.match(/passkeys\/login\/verify/g) || []).length, 1);
  assert.match(app, /passkeyLogin\.addEventListener\("click", \(\) => \{\s+rememberLoginMethod\("passkey"\);\s+void startPasskeyLogin\(\);/);
});

test("guards concurrent passkey ceremonies", () => {
  assert.match(app, /async function startPasskeyLogin\(\) \{\s+if \(state\.passkeyBusy \|\| state\.authenticated/);
});
