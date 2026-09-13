import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiAccounts } from "../../src/ai-accounts.mjs";
import { claudeAdapter, codexAdapter } from "../../src/ai-account-adapters.mjs";

// Every fake token carries this marker, so a test can prove no credential
// leaves the files it lives in.
export const SECRET = "SECRET-TOKEN-MARKER";

function jwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
}

export async function writeClaude(location, { uuid, email, token }) {
  await mkdir(join(location.credentials, ".."), { recursive: true });
  await writeFile(location.credentials, JSON.stringify({
    claudeAiOauth: {
      accessToken: `${SECRET}-access-${token}`,
      refreshToken: `${SECRET}-refresh-${token}`,
      expiresAt: 1,
      refreshTokenExpiresAt: 1_791_637_930_746,
      subscriptionType: "max",
    },
  }), { mode: 0o600 });
  let global = {};
  try { global = JSON.parse(await readFile(location.global, "utf8")); } catch {}
  await writeFile(location.global, JSON.stringify({
    ...global,
    oauthAccount: { accountUuid: uuid, emailAddress: email, organizationName: `${email} org` },
  }), { mode: 0o600 });
}

export async function writeCodex(location, { accountId, email, token }) {
  await mkdir(join(location.auth, ".."), { recursive: true });
  await writeFile(location.auth, JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      access_token: `${SECRET}-access-${token}`,
      refresh_token: `${SECRET}-refresh-${token}`,
      account_id: accountId,
      id_token: jwt({ email, "https://api.openai.com/auth": { chatgpt_plan_type: "plus", chatgpt_account_id: accountId } }),
    },
  }), { mode: 0o600 });
}

// The empty directory a sign-in command points its CLI at.
export function stagingDirectoryOf(command) {
  return /=\s*'([^']+)'/u.exec(command)[1];
}

// Where a CLI signed in inside a sign-in directory would have written.
export function stagedLocation(cli, directory) {
  const adapter = cli === "claude" ? claudeAdapter : codexAdapter;
  return adapter.locate({ [adapter.homeEnv]: directory });
}

// A machine with Claude and Codex both signed in to account A.
export async function machine(t, { running = [], adapters, now, email = "a@example.com" } = {}) {
  const home = await mkdtemp(join(tmpdir(), "herdr-ai-accounts-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { HOME: home };
  const claude = claudeAdapter.locate(env);
  const codex = codexAdapter.locate(env);
  await writeClaude(claude, { uuid: "uuid-a", email, token: "a1" });
  await writeFile(claude.global, JSON.stringify({
    ...JSON.parse(await readFile(claude.global, "utf8")),
    mcpServers: { keep: { command: "x" } },
  }));
  await writeCodex(codex, { accountId: "codex-a", email, token: "a1" });
  const directory = join(home, ".config", "herdr-bridge", "ai-accounts");
  const accounts = new AiAccounts({ directory, env, runningAgents: async () => running, adapters, now });
  return { home, env, claude, codex, directory, accounts };
}
