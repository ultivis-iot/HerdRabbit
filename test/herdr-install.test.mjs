import test from "node:test";
import assert from "node:assert/strict";
import { delimiter, join } from "node:path";
import {
  ensureHerdrExecutable,
  executableOnPath,
} from "../scripts/herdr-install.mjs";

test("uses an existing Herdr executable without installing it", async () => {
  const candidate = join("/", "opt", "herdr", "bin", "herdr");
  let installCalled = false;
  const resolved = await ensureHerdrExecutable({
    path: [join("/", "usr", "bin"), join("/", "opt", "herdr", "bin")].join(delimiter),
    isExecutable: async (path) => path === candidate,
    install: async () => { installCalled = true; },
    log: () => {},
  });

  assert.equal(resolved, candidate);
  assert.equal(installCalled, false);
});

test("installs Herdr and returns its absolute executable path when missing", async () => {
  const installDir = join("/", "home", "tester", ".local", "bin");
  const installed = join(installDir, "herdr");
  let installationFinished = false;
  const resolved = await ensureHerdrExecutable({
    path: join("", "usr", "bin"),
    installDir,
    isExecutable: async (path) => installationFinished && path === installed,
    install: async ({ installDir: target }) => {
      assert.equal(target, installDir);
      installationFinished = true;
    },
    log: () => {},
  });

  assert.equal(resolved, installed);
});

test("reports a failed Herdr installation instead of writing a broken service", async () => {
  await assert.rejects(
    ensureHerdrExecutable({
      path: join("", "usr", "bin"),
      installDir: join("/", "home", "tester", ".local", "bin"),
      isExecutable: async () => false,
      install: async () => {},
      log: () => {},
    }),
    /installation finished but .*herdr is not executable/,
  );
});

test("ignores empty PATH entries while resolving executables", async () => {
  const checked = [];
  const resolved = await executableOnPath("herdr", {
    path: `${delimiter}${join("", "usr", "local", "bin")}${delimiter}`,
    isExecutable: async (candidate) => {
      checked.push(candidate);
      return false;
    },
  });

  assert.equal(resolved, null);
  assert.deepEqual(checked, [join("", "usr", "local", "bin", "herdr")]);
});
