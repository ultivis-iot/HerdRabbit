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

test("starts conditional WebAuthn so the passkey manager offers itself on the login screen", () => {
  // autocomplete="webauthn" does nothing on its own: the conditional request
  // has to be in flight before the browser will surface a passkey.
  assert.match(page, /id="login-password"[\s\S]*?autocomplete="current-password webauthn"/);
  assert.match(app, /async function startPasskeyAutofill\(\)/);
  assert.match(app, /browserSupportsWebAuthnAutofill/);
  assert.match(
    app,
    /startAuthentication\(\{\s*optionsJSON: ceremony\.options,\s*useBrowserAutofill: true,\s*\}\)/,
  );
  assert.match(
    app,
    /elements\.loginScreen\.hidden = false;[\s\S]*?void startPasskeyAutofill\(\);/,
    "the login screen must arm the conditional request when it appears",
  );
});

test("shares one verification path between the passkey button and autofill", () => {
  assert.match(app, /async function completePasskeyLogin\(ceremony, credential\)/);
  const verifyCalls = app.match(/passkeys\/login\/verify/g) || [];
  assert.equal(verifyCalls.length, 1, "verification must not be duplicated per entry point");
});

test("does not run two passkey ceremonies at once", () => {
  assert.match(app, /passkeyAutofillActive: false,/);
  // The autofill guard must also stand down for the button ceremony.
  assert.match(
    app,
    /if \(\s*state\.passkeyAutofillActive \|\|\s*state\.passkeyBusy \|\|\s*state\.authenticated \|\|/,
  );
  // Both ceremonies can resolve moments apart, so only the first may log in.
  assert.match(
    app,
    /async function completePasskeyLogin\(ceremony, credential\) \{[\s\S]*?if \(state\.authenticated\) return;/,
  );
});
