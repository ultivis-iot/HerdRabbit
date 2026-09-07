import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

export async function configureClaude({
  configDirectory = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
} = {}) {
  const path = join(configDirectory, "settings.json");
  let original;
  try { original = await readFile(path, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const settings = original === undefined ? {} : JSON.parse(original);
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isObject(settings) || (settings.env !== undefined && !isObject(settings.env))) {
    throw new Error(`Invalid Claude settings object: ${path}`);
  }
  if (settings.tui === "default" && settings.env?.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN === "1") {
    return { path, changed: false };
  }
  settings.tui = "default";
  settings.env = { ...settings.env, CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1" };
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  const suffix = randomUUID();
  const backup = original === undefined ? undefined : `${path}.herdrabbit-${suffix}.bak`;
  if (backup) await writeFile(backup, original, { flag: "wx", mode: 0o600 });
  const temporary = `${path}.${suffix}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return { path, changed: true, backup };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  configureClaude().then(({ path, changed }) => {
    console.log(`Claude 일반 터미널 모드 ${changed ? "설정 완료" : "유지"}: ${path}`);
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
