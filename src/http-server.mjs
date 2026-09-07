import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  InputValidationError,
  HerdrCommandError,
  ALLOWED_KEYS,
  MAX_PANE_READ_LINES,
} from "./herdr-client.mjs";
import { PasswordAuth } from "./password-auth.mjs";
import { PasskeyError } from "./passkey-auth.mjs";
import { OutputRevisions } from "./output-revisions.mjs";
import {
  ScreenHistoryStore,
  comparableRow,
  screenRows,
} from "./screen-history.mjs";
import { PushValidationError } from "./web-push-service.mjs";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const SIMPLEWEBAUTHN_BROWSER_BUNDLE = fileURLToPath(new URL(
  "../node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js",
  import.meta.url,
));
const STATIC_FILES = new Map([
  ["/", { path: `${PUBLIC_DIR}/index.html`, type: "text/html; charset=utf-8" }],
  ["/app.js", { path: `${PUBLIC_DIR}/app.js`, type: "text/javascript; charset=utf-8" }],
  ["/ansi.js", { path: `${PUBLIC_DIR}/ansi.js`, type: "text/javascript; charset=utf-8" }],
  ["/ui-model.js", { path: `${PUBLIC_DIR}/ui-model.js`, type: "text/javascript; charset=utf-8" }],
  ["/pane-preference.js", { path: `${PUBLIC_DIR}/pane-preference.js`, type: "text/javascript; charset=utf-8" }],
  ["/workspace-preference.js", { path: `${PUBLIC_DIR}/workspace-preference.js`, type: "text/javascript; charset=utf-8" }],
  ["/terminal-preference.js", { path: `${PUBLIC_DIR}/terminal-preference.js`, type: "text/javascript; charset=utf-8" }],
  ["/completion-preference.js", { path: `${PUBLIC_DIR}/completion-preference.js`, type: "text/javascript; charset=utf-8" }],
  ["/input-history-preference.js", { path: `${PUBLIC_DIR}/input-history-preference.js`, type: "text/javascript; charset=utf-8" }],
  ["/launch-session.js", { path: `${PUBLIC_DIR}/launch-session.js`, type: "text/javascript; charset=utf-8" }],
  ["/push-notifications.js", { path: `${PUBLIC_DIR}/push-notifications.js`, type: "text/javascript; charset=utf-8" }],
  ["/vendor/simplewebauthn-browser.js", { path: SIMPLEWEBAUTHN_BROWSER_BUNDLE, type: "text/javascript; charset=utf-8" }],
  ["/theme.js", { path: `${PUBLIC_DIR}/theme.js`, type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { path: `${PUBLIC_DIR}/styles.css`, type: "text/css; charset=utf-8" }],
  ["/manifest.webmanifest", { path: `${PUBLIC_DIR}/manifest.webmanifest`, type: "application/manifest+json; charset=utf-8" }],
  ["/sw.js", { path: `${PUBLIC_DIR}/sw.js`, type: "text/javascript; charset=utf-8" }],
  ["/favicon.ico", { path: `${PUBLIC_DIR}/favicon.ico`, type: "image/x-icon" }],
  ["/icons/favicon.svg", { path: `${PUBLIC_DIR}/icons/favicon.svg`, type: "image/svg+xml" }],
  ["/icons/app-icon.svg", { path: `${PUBLIC_DIR}/icons/app-icon.svg`, type: "image/svg+xml" }],
  ["/icons/favicon-32.png", { path: `${PUBLIC_DIR}/icons/favicon-32.png`, type: "image/png" }],
  ["/icons/rabbit-outline-v33.svg", { path: `${PUBLIC_DIR}/icons/favicon.svg`, type: "image/svg+xml" }],
  ["/icons/rabbit-outline-32-v33.png", { path: `${PUBLIC_DIR}/icons/favicon-32.png`, type: "image/png" }],
  ["/icons/rabbit-outline-180-v33.png", { path: `${PUBLIC_DIR}/icons/herdr-180.png`, type: "image/png" }],
  ["/icons/rabbit-outline-192-v33.png", { path: `${PUBLIC_DIR}/icons/herdr-192.png`, type: "image/png" }],
  ["/icons/rabbit-outline-512-v33.png", { path: `${PUBLIC_DIR}/icons/herdr-512.png`, type: "image/png" }],
  ["/icons/rabbit-outline-app-180-v35.png", { path: `${PUBLIC_DIR}/icons/herdr-180.png`, type: "image/png" }],
  ["/icons/rabbit-outline-app-192-v35.png", { path: `${PUBLIC_DIR}/icons/herdr-192.png`, type: "image/png" }],
  ["/icons/rabbit-outline-app-512-v35.png", { path: `${PUBLIC_DIR}/icons/herdr-512.png`, type: "image/png" }],
  ["/icons/herdr-180.png", { path: `${PUBLIC_DIR}/icons/herdr-180.png`, type: "image/png" }],
  ["/icons/herdr-192.png", { path: `${PUBLIC_DIR}/icons/herdr-192.png`, type: "image/png" }],
  ["/icons/herdr-512.png", { path: `${PUBLIC_DIR}/icons/herdr-512.png`, type: "image/png" }],
  ["/icons/notification-icon-192.png", { path: `${PUBLIC_DIR}/icons/notification-icon-192.png`, type: "image/png" }],
  ["/icons/notification-badge-96.png", { path: `${PUBLIC_DIR}/icons/notification-badge-96.png`, type: "image/png" }],
]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const DEFAULT_OUTPUT_LINES = 200;
const MAX_OUTPUT_LINES = MAX_PANE_READ_LINES - 1;
const OUTPUT_REVISION_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function applySecurityHeaders(response) {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function sendEmpty(response, status) {
  response.statusCode = status;
  response.end();
}

function requestHostname(request) {
  const host = request.headers.host;
  if (typeof host !== "string" || host.length > 255) {
    return null;
  }

  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

function hasValidHost(request, allowedHosts) {
  const hostname = requestHostname(request)?.toLowerCase();
  return hostname !== undefined && hostname !== null && allowedHosts.has(hostname);
}

function safeTokenEquals(expected, candidate) {
  if (typeof candidate !== "string") {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  return (
    expectedBuffer.length === candidateBuffer.length &&
    timingSafeEqual(expectedBuffer, candidateBuffer)
  );
}

function requireWriteAuthorization(request, csrfToken) {
  if (!safeTokenEquals(csrfToken, request.headers["x-herdr-csrf"])) {
    throw new HttpError(403, "csrf_rejected", "Write token rejected");
  }

  requireSameOrigin(request);
}

function requireSameOrigin(request) {
  const origin = request.headers.origin;
  const allowedOrigins = new Set([
    `http://${request.headers.host}`,
    `https://${request.headers.host}`,
  ]);
  if (origin !== undefined && !allowedOrigins.has(origin)) {
    throw new HttpError(403, "origin_rejected", "Request origin rejected");
  }

  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new HttpError(403, "site_rejected", "Cross-site writes are not allowed");
  }
}

function forwardedProtocol(request) {
  return String(request.headers["x-forwarded-proto"] || "")
    .split(",", 1)[0]
    .trim()
    .toLowerCase();
}

function requestOrigin(request) {
  if (typeof request.headers.origin === "string") {
    return request.headers.origin;
  }
  const protocol = request.socket.encrypted === true || forwardedProtocol(request) === "https"
    ? "https"
    : "http";
  return `${protocol}://${request.headers.host}`;
}

function sendAuthenticatedSession(response, request, auth, extra = {}) {
  const secure = request.socket.encrypted === true || forwardedProtocol(request) === "https";
  const cookieSession = auth.createSession();
  const launchToken = auth.createLaunchToken();
  response.setHeader("Set-Cookie", auth.sessionCookie(cookieSession, { secure }));
  sendJson(response, 200, {
    ok: true,
    required: true,
    launchToken,
    ...extra,
  });
}

async function readJsonBody(request, maxBodyBytes) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Expected application/json");
  }

  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }

  if (tooLarge) {
    throw new HttpError(413, "body_too_large", "Request body is too large");
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Body is not an object");
    }
    return body;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
  }
}

function decodePaneId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "invalid_path", "Invalid pane path");
  }
}

function parseOutputLineLimit(value) {
  if (value === null || value === "") return DEFAULT_OUTPUT_LINES;
  const lines = Number(value);
  if (!Number.isInteger(lines) || lines < 1 || lines > MAX_OUTPUT_LINES) {
    throw new HttpError(
      400,
      "invalid_output_lines",
      `Output lines must be between 1 and ${MAX_OUTPUT_LINES}`,
    );
  }
  return lines;
}

function parseOutputRevision(value) {
  if (value === null || value === "") return null;
  if (!OUTPUT_REVISION_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_output_revision", "Output revision is invalid");
  }
  return value;
}

function parseOutputHistoryMode(value) {
  if (value === null || value === "") return "ansi";
  if (value === "hybrid") return value;
  throw new HttpError(400, "invalid_output_history", "Output history mode is invalid");
}

function outputRows(output) {
  return screenRows(typeof output === "string" ? output : String(output));
}

export function mergePlainHistoryWithStyledScreen(plainOutput, ansiOutput) {
  const plainRows = outputRows(plainOutput);
  const ansiRows = outputRows(ansiOutput);
  if (plainRows.length <= ansiRows.length) return ansiOutput;
  if (ansiRows.length === 0) return plainOutput;

  const plainTail = plainRows.slice(-ansiRows.length);
  const tailMatches = ansiRows.every(
    (row, index) =>
      comparableRow(row) === comparableRow(plainTail[index]),
  );
  if (!tailMatches) return plainOutput;

  return [
    ...plainRows.slice(0, -ansiRows.length),
    ...ansiRows,
  ].join("\n");
}

export function outputWindow(output, requestedLines) {
  const rows = output === "" ? [] : String(output).split("\n");
  const hasMore = rows.length > requestedLines;
  const visibleRows = hasMore ? rows.slice(-requestedLines) : rows;
  return {
    output: visibleRows.join("\n"),
    requestedLines,
    returnedLines: visibleRows.length,
    hasMore,
  };
}

function errorResponse(error) {
  if (error instanceof HttpError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof InputValidationError) {
    return { status: 400, code: "invalid_input", message: error.message };
  }
  if (error instanceof PushValidationError) {
    return { status: 400, code: "invalid_push_subscription", message: error.message };
  }
  if (error instanceof PasskeyError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof HerdrCommandError) {
    return {
      status: error.code === "herdr_timeout" ? 504 : 502,
      code: error.code,
      message: error.message,
    };
  }

  return { status: 500, code: "internal_error", message: "Internal server error" };
}

async function serveStatic(response, pathname, method) {
  const entry = STATIC_FILES.get(pathname);
  if (!entry) {
    return false;
  }

  const body = await readFile(entry.path);
  response.statusCode = 200;
  response.setHeader("Content-Type", entry.type);
  response.setHeader("Cache-Control", pathname === "/sw.js" ? "no-cache" : "no-cache, private");
  response.setHeader("Content-Length", body.length);
  response.end(method === "HEAD" ? undefined : body);
  return true;
}

export function createHerdrHttpServer({
  herdr,
  profiles = null,
  auth = new PasswordAuth(),
  passkeys = null,
  push = null,
  notificationMonitor = null,
  allowedHosts = LOOPBACK_HOSTS,
  csrfToken = randomBytes(32).toString("base64url"),
  maxBodyBytes = 16 * 1024,
  logger = console,
} = {}) {
  if (!herdr) {
    throw new TypeError("herdr client is required");
  }

  const normalizedAllowedHosts = new Set(
    [...allowedHosts].map((host) => String(host).toLowerCase()),
  );
  const outputRevisions = new OutputRevisions();
  const screenHistory = new ScreenHistoryStore();

  const server = createServer(async (request, response) => {
    applySecurityHeaders(response);

    try {
      if (!hasValidHost(request, normalizedAllowedHosts)) {
        throw new HttpError(421, "host_rejected", "Request host rejected");
      }

      const url = new URL(request.url || "/", `http://${request.headers.host}`);
      const method = request.method || "GET";

      if ((method === "GET" || method === "HEAD") && (await serveStatic(response, url.pathname, method))) {
        return;
      }

      if (method === "GET" && url.pathname === "/api/auth/status") {
        sendJson(response, 200, {
          required: auth.required,
          authenticated: auth.hasValidSession(request.headers.cookie) &&
            auth.hasValidLaunchToken(request.headers["x-herdr-launch-token"]),
          passkeyAvailable: auth.required && passkeys?.hasCredentials === true,
        });
        return;
      }

      if (method === "POST" && url.pathname === "/api/auth/login") {
        requireSameOrigin(request);
        const body = await readJsonBody(request, maxBodyBytes);
        if (!auth.required) {
          sendJson(response, 200, { ok: true, required: false });
          return;
        }
        if (!(await auth.verifyPassword(body.password))) {
          throw new HttpError(401, "invalid_password", "The password is incorrect.");
        }
        sendAuthenticatedSession(response, request, auth, {
          passkeyAvailable: passkeys?.hasCredentials === true,
        });
        return;
      }

      if (method === "POST" && url.pathname === "/api/auth/passkeys/login/options") {
        requireSameOrigin(request);
        await readJsonBody(request, maxBodyBytes);
        if (!auth.required || !passkeys || passkeys.hasCredentials !== true) {
          throw new HttpError(404, "passkey_unavailable", "No passkey is registered.");
        }
        sendJson(response, 200, await passkeys.beginAuthentication(requestOrigin(request)));
        return;
      }

      if (method === "POST" && url.pathname === "/api/auth/passkeys/login/verify") {
        requireSameOrigin(request);
        const body = await readJsonBody(request, maxBodyBytes);
        if (!auth.required || !passkeys || passkeys.hasCredentials !== true) {
          throw new HttpError(404, "passkey_unavailable", "No passkey is registered.");
        }
        if (
          typeof body.attemptId !== "string" ||
          !body.credential ||
          typeof body.credential !== "object" ||
          Array.isArray(body.credential)
        ) {
          throw new HttpError(400, "invalid_passkey_response", "The passkey response is invalid.");
        }
        if (!(await passkeys.finishAuthentication(
          requestOrigin(request),
          body.attemptId,
          body.credential,
        ))) {
          throw new HttpError(401, "invalid_passkey", "Could not verify the passkey.");
        }
        sendAuthenticatedSession(response, request, auth, { passkeyAvailable: true });
        return;
      }

      if (
        url.pathname.startsWith("/api/") &&
        auth.required &&
        (
          !auth.hasValidSession(request.headers.cookie) ||
          !auth.hasValidLaunchToken(request.headers["x-herdr-launch-token"])
        )
      ) {
        throw new HttpError(401, "authentication_required", "Enter your password.");
      }

      if (profiles && url.pathname.startsWith("/api/ssh-profiles")) {
        const match = url.pathname.match(/^\/api\/ssh-profiles(?:\/(ssh_[a-f0-9-]{36}|test))?$/u);
        if (!match) throw new HttpError(404, "not_found", "SSH profile route not found");
        const id = match[1];
        if (method === "GET" && !id) {
          sendJson(response, 200, { profiles: profiles.list() });
          return;
        }
        requireWriteAuthorization(request, csrfToken);
        if (method === "POST" && id === "test") {
          const { validateSshProfile } = await import("./ssh-profiles.mjs");
          const profile = validateSshProfile(await readJsonBody(request, maxBodyBytes));
          sendJson(response, 200, await herdr.testProfile(profile));
          return;
        }
        if ((method === "POST" && !id) || (method === "PUT" && id && id !== "test")) {
          sendJson(response, 200, { profiles: await profiles.save(await readJsonBody(request, maxBodyBytes), id) });
          return;
        }
        if (method === "DELETE" && id && id !== "test") {
          sendJson(response, 200, { profiles: await profiles.remove(id) });
          return;
        }
        throw new HttpError(405, "method_not_allowed", "Method not allowed");
      }

      if (method === "POST" && url.pathname === "/api/auth/passkeys/register/options") {
        requireWriteAuthorization(request, csrfToken);
        await readJsonBody(request, maxBodyBytes);
        if (!passkeys) {
          throw new HttpError(503, "passkey_unavailable", "Passkeys are unavailable.");
        }
        sendJson(response, 200, await passkeys.beginRegistration(requestOrigin(request)));
        return;
      }

      if (method === "POST" && url.pathname === "/api/auth/passkeys/register/verify") {
        requireWriteAuthorization(request, csrfToken);
        const body = await readJsonBody(request, maxBodyBytes);
        if (!passkeys) {
          throw new HttpError(503, "passkey_unavailable", "Passkeys are unavailable.");
        }
        if (
          typeof body.attemptId !== "string" ||
          !body.credential ||
          typeof body.credential !== "object" ||
          Array.isArray(body.credential)
        ) {
          throw new HttpError(400, "invalid_passkey_response", "The passkey response is invalid.");
        }
        if (!(await passkeys.finishRegistration(
          requestOrigin(request),
          body.attemptId,
          body.credential,
        ))) {
          throw new HttpError(400, "passkey_verification_failed", "Could not verify the passkey.");
        }
        sendJson(response, 200, { ok: true, passkeyAvailable: true });
        return;
      }

      if (method === "GET" && url.pathname === "/api/bootstrap") {
        sendJson(response, 200, {
          authRequired: auth.required,
          csrfToken,
          allowedKeys: ALLOWED_KEYS,
          pollIntervalMs: 1_000,
          pushPublicKey: push?.publicKey || null,
        });
        return;
      }

      if (url.pathname === "/api/push/subscriptions") {
        if (!push) {
          throw new HttpError(503, "push_unavailable", "Push notifications are unavailable");
        }
        requireWriteAuthorization(request, csrfToken);
        const body = await readJsonBody(request, maxBodyBytes);
        if (method === "POST") {
          await push.subscribe(body.subscription);
          await notificationMonitor?.poll?.();
          sendJson(response, 201, { ok: true });
          return;
        }
        if (method === "DELETE") {
          await push.unsubscribe(body.endpoint);
          sendEmpty(response, 204);
          return;
        }
      }

      if (method === "GET" && url.pathname === "/api/snapshot") {
        sendJson(response, 200, { snapshot: await herdr.snapshot() });
        return;
      }

      if (method === "POST" && url.pathname === "/api/workspaces") {
        requireWriteAuthorization(request, csrfToken);
        const body = await readJsonBody(request, maxBodyBytes);
        if (body.herdrSessionId === undefined) {
          await herdr.createWorkspace(body.label);
        } else {
          await herdr.createWorkspace(body.label, body.herdrSessionId);
        }
        sendJson(response, 201, { snapshot: await herdr.snapshot() });
        return;
      }

      const workspaceRenameMatch = url.pathname.match(
        /^\/api\/workspaces\/([^/]+)\/rename$/,
      );
      if (method === "POST" && workspaceRenameMatch) {
        requireWriteAuthorization(request, csrfToken);
        const body = await readJsonBody(request, maxBodyBytes);
        await herdr.renameWorkspace(
          decodePaneId(workspaceRenameMatch[1]),
          body.label,
        );
        sendJson(response, 200, { ok: true });
        return;
      }

      const workspaceTabsMatch = url.pathname.match(
        /^\/api\/workspaces\/([^/]+)\/tabs$/,
      );
      if (method === "POST" && workspaceTabsMatch) {
        requireWriteAuthorization(request, csrfToken);
        await readJsonBody(request, maxBodyBytes);
        await herdr.createTab(decodePaneId(workspaceTabsMatch[1]));
        sendJson(response, 201, { snapshot: await herdr.snapshot() });
        return;
      }

      const workspaceCloseMatch = url.pathname.match(
        /^\/api\/workspaces\/([^/]+)\/close$/,
      );
      if (method === "POST" && workspaceCloseMatch) {
        requireWriteAuthorization(request, csrfToken);
        const body = await readJsonBody(request, maxBodyBytes);
        if (body.confirmed !== true) {
          throw new HttpError(400, "confirmation_required", "Close confirmation is required");
        }
        await herdr.closeWorkspace(decodePaneId(workspaceCloseMatch[1]));
        sendJson(response, 200, { snapshot: await herdr.snapshot() });
        return;
      }

      const tabCloseMatch = url.pathname.match(/^\/api\/tabs\/([^/]+)\/close$/);
      if (method === "POST" && tabCloseMatch) {
        requireWriteAuthorization(request, csrfToken);
        const body = await readJsonBody(request, maxBodyBytes);
        if (body.confirmed !== true) {
          throw new HttpError(400, "confirmation_required", "Close confirmation is required");
        }
        await herdr.closeTab(decodePaneId(tabCloseMatch[1]));
        sendJson(response, 200, { snapshot: await herdr.snapshot() });
        return;
      }

      const outputMatch = url.pathname.match(/^\/api\/panes\/([^/]+)\/output$/);
      if (method === "GET" && outputMatch) {
        const paneId = decodePaneId(outputMatch[1]);
        const lines = parseOutputLineLimit(url.searchParams.get("lines"));
        const since = parseOutputRevision(url.searchParams.get("since"));
        const historyMode = parseOutputHistoryMode(url.searchParams.get("history"));
        const output = historyMode === "hybrid"
          ? await Promise.all([
              herdr.readPane(paneId, { lines: lines + 1, format: "text" }),
              herdr.readPane(paneId, { lines: lines + 1, format: "ansi" }),
            ]).then(([plainOutput, ansiOutput]) => {
              // Alternate-screen agents keep no scrollback in Herdr, so the
              // history has to be reconstructed from the frames we poll.
              const history = screenHistory.observe(paneId, plainOutput);
              const plainWithHistory = [
                ...history,
                ...outputRows(plainOutput),
              ].join("\n");
              return mergePlainHistoryWithStyledScreen(plainWithHistory, ansiOutput);
            })
          : await herdr.readPane(paneId, {
              lines: lines + 1,
              format: "ansi",
            });
        const window = outputWindow(output, lines);
        const update = outputRevisions.update({ paneId, window, since });
        if (update === null) {
          sendEmpty(response, 204);
          return;
        }
        sendJson(response, 200, update);
        return;
      }

      const textMatch = url.pathname.match(/^\/api\/panes\/([^/]+)\/text$/);
      if (method === "POST" && textMatch) {
        requireWriteAuthorization(request, csrfToken);
        const body = await readJsonBody(request, maxBodyBytes);
        const paneId = decodePaneId(textMatch[1]);
        await herdr.sendText(paneId, body.text, {
          submit: body.submit === true,
        });
        if (body.submit === true) {
          notificationMonitor?.recordRequest(paneId, body.text);
        }
        sendJson(response, 200, { ok: true });
        return;
      }

      const keysMatch = url.pathname.match(/^\/api\/panes\/([^/]+)\/keys$/);
      if (method === "POST" && keysMatch) {
        requireWriteAuthorization(request, csrfToken);
        const body = await readJsonBody(request, maxBodyBytes);
        await herdr.sendKeys(decodePaneId(keysMatch[1]), body.keys);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (
        method !== "GET" &&
        method !== "HEAD" &&
        method !== "POST" &&
        method !== "DELETE"
      ) {
        response.setHeader("Allow", "GET, HEAD, POST, DELETE");
        throw new HttpError(405, "method_not_allowed", "Method not allowed");
      }

      throw new HttpError(404, "not_found", "Not found");
    } catch (error) {
      const publicError = errorResponse(error);
      if (publicError.status >= 500) {
        logger.error?.("request failed", {
          method: request.method,
          path: request.url?.split("?", 1)[0],
          code: publicError.code,
        });
      }
      if (!response.headersSent) {
        sendJson(response, publicError.status, {
          error: { code: publicError.code, message: publicError.message },
        });
      } else {
        response.destroy();
      }
    }
  });

  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;

  return Object.freeze({ server, csrfToken });
}
