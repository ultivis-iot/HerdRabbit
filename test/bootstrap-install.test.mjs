import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installer = await readFile(
  new URL("../install.sh", import.meta.url),
  "utf8",
);

test("offers a public one-line installer without losing the interactive prompt", () => {
  assert.match(installer, /https:\/\/github\.com\/ultivis-iot\/HerdRabbit\.git/);
  assert.match(installer, /\.local\/share\/herd-rabbit/);
  assert.match(installer, /scripts\/install-service\.mjs" <\/dev\/tty/);
  assert.match(installer, /Node\.js 22 or newer/);
  assert.match(installer, /need npm/);
  assert.match(installer, /npm --prefix "\$INSTALL_DIRECTORY" ci --omit=dev/);
  assert.match(installer, /does not point to \$REPOSITORY_URL/);
  assert.match(installer, /is not on the main branch/);
});
