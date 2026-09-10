import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  InputValidationError,
  HerdrCommandError,
  ALLOWED_KEYS,
  MAX_PANE_READ_LINES,
  validation,
} from "./herdr-client.mjs";
import { PasswordAuth } from "./password-auth.mjs";
import { PasskeyError } from "./passkey-auth.mjs";
import { OutputRevisions } from "./output-revisions.mjs";
import { attachTerminalWebSocket } from "./terminal-websocket.mjs";
import { HttpError, acceptUpload, decodePaneId, readJsonBody, sendJson } from "./http-basics.mjs";
import { PeerRejected } from "./peer-identity.mjs";
import { terminalOutputWatcher } from "./terminal-output-watch.mjs";
import { PushValidationError } from "./web-push-service.mjs";
import { validateTransferName } from "./file-store.mjs";
import { FileAccessError, fileAccessError, listDirectory, openFile, validateBrowsePath } from "./file-browser.mjs";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const SIMPLEWEBAUTHN_BROWSER_BUNDLE = fileURLToPath(new URL(
  "../node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js",
  import.meta.url,
));
const STATIC_FILES = new Map([
  ["/ui/index.html", { path: `${PUBLIC_DIR}/ui/index.html`, type: "text/html; charset=utf-8" }],
  ["/ui/ui.css", { path: `${PUBLIC_DIR}/ui/ui.css`, type: "text/css; charset=utf-8" }],
  ["/ui/tokens.css", { path: `${PUBLIC_DIR}/ui/tokens.css`, type: "text/css; charset=utf-8" }],
  ["/ui/base.css", { path: `${PUBLIC_DIR}/ui/base.css`, type: "text/css; charset=utf-8" }],
  ["/ui/components.css", { path: `${PUBLIC_DIR}/ui/components.css`, type: "text/css; charset=utf-8" }],
  ["/ui/examples.css", { path: `${PUBLIC_DIR}/ui/examples.css`, type: "text/css; charset=utf-8" }],
  ["/ui/examples.js", { path: `${PUBLIC_DIR}/ui/examples.js`, type: "text/javascript; charset=utf-8" }],
  ["/", { path: `${PUBLIC_DIR}/index.html`, type: "text/html; charset=utf-8" }],
  ["/app.js", { path: `${PUBLIC_DIR}/app.js`, type: "text/javascript; charset=utf-8" }],
  ["/ansi.js", { path: `${PUBLIC_DIR}/ansi.js`, type: "text/javascript; charset=utf-8" }],
  ["/terminal-links.js", { path: `${PUBLIC_DIR}/terminal-links.js`, type: "text/javascript; charset=utf-8" }],
  ["/direct-terminal-input.js", { path: `${PUBLIC_DIR}/direct-terminal-input.js`, type: "text/javascript; charset=utf-8" }],
  ["/terminal-connection.js", { path: `${PUBLIC_DIR}/terminal-connection.js`, type: "text/javascript; charset=utf-8" }],
  ["/key-combinations.js", { path: `${PUBLIC_DIR}/key-combinations.js`, type: "text/javascript; charset=utf-8" }],
  ["/ui-model.js", { path: `${PUBLIC_DIR}/ui-model.js`, type: "text/javascript; charset=utf-8" }],
  ["/pane-preference.js", { path: `${PUBLIC_DIR}/pane-preference.js`, type: "text/javascript; charset=utf-8" }],
  ["/browse-preference.js", { path: `${PUBLIC_DIR}/browse-preference.js`, type: "text/javascript; charset=utf-8" }],
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
  // File and SFTP failures already carry a status; without this they would
  // surface as 500s from the paths that throw outside a route's own handling.
  if (error instanceof FileAccessError) {
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
  if (error instanceof PeerRejected) {
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

// Unlike readJsonBody, an oversized upload cannot be drained: the point of the
// limit is to not read it. Content-Length settles the question before a byte
// arrives, and a request that will not declare its size is refused outright.

// Node rejects header values above U+00FF, so a file copied in from a terminal
// under a Korean or emoji name has to travel as RFC 5987 percent-encoding. The
// attachment disposition and octet-stream type are what keep a stored HTML or
// SVG file from ever rendering in the browser, so neither is conditional.
// A size of null means the length is unknown -- procfs reports zero while still
// holding content -- so the body goes out chunked rather than with a header that
// would cut it short.
async function sendDownload(response, { file, stream }) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/octet-stream");
  if (file.size !== null && file.size !== undefined) {
    response.setHeader("Content-Length", file.size);
  }
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  );
  response.on("close", () => stream.destroy());
  await pipeline(stream, response);
}

// Browsing reads whatever the service account can read, and a stuck NFS mount or
// a slow directory ties up a libuv thread that logins and static files share. A
// small ceiling keeps one wedged path from taking the whole app down.
function directoryReadLimiter(maxConcurrent) {
  let active = 0;
  return async function withSlot(work) {
    if (active >= maxConcurrent) {
      throw new HttpError(429, "browse_busy", "Too many folders are being read. Try again.");
    }
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
    }
  };
}

// A download is a plain navigation, so it cannot carry the launch token header
// the /api/ gate wants. A ticket stands in for that header: minted on an
// authorised request, short lived, spent once. It also keeps the file path out
// of every URL, and so out of any proxy log sitting in front of the app.
const LOCAL_SERVER = "local";

function downloadTickets({ ttlMs = 30_000, max = 32 } = {}) {
  const tickets = new Map();
  const sweep = () => {
    const now = Date.now();
    for (const [key, value] of tickets) if (value.expiresAt <= now) tickets.delete(key);
  };
  return {
    issue(filePath, serverId = LOCAL_SERVER) {
      sweep();
      if (tickets.size >= max) {
        throw new HttpError(429, "too_many_downloads", "Too many downloads are pending.");
      }
      const ticket = randomBytes(32).toString("base64url");
      tickets.set(ticket, { path: filePath, serverId, expiresAt: Date.now() + ttlMs });
      return ticket;
    },
    redeem(ticket) {
      sweep();
      const found = tickets.get(ticket);
      if (!found) throw new HttpError(404, "ticket_expired", "This download link has expired.");
      tickets.delete(ticket);
      return found;
    },
  };
}

// The browser module throws raw filesystem errors; without this an EACCES would
// surface as a 500 and be written to the error log.
function browseFailure(error) {
  const mapped = fileAccessError(error);
  if (!mapped) throw error;
  throw new HttpError(mapped.status, mapped.code, mapped.message);
}

function browsePath(value) {
  try {
    return validateBrowsePath(value);
  } catch (error) {
    return browseFailure(error);
  }
}

async function browseDirectory(value, options, source) {
  try {
    if (source) return await source.listDirectory(value, options);
    return await listDirectory(browsePath(value), options);
  } catch (error) {
    return browseFailure(error);
  }
}

async function openBrowsedFile(value, source) {
  try {
    const file = source ? await source.openFile(value) : await openFile(value);
    return { file, stream: file.stream };
  } catch (error) {
    return browseFailure(error);
  }
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
  files = null,
  auth = new PasswordAuth(),
  passkeys = null,
  push = null,
  notificationMonitor = null,
  allowedHosts = LOOPBACK_HOSTS,
  peer = null,
  link = null,
  discover = null,
  csrfToken = randomBytes(32).toString("base64url"),
  maxBodyBytes = 16 * 1024,
  maxTransferBytes = 50 * 1024 * 1024,
  logger = console,
} = {}) {
  if (!herdr) {
    throw new TypeError("herdr client is required");
  }

  const normalizedAllowedHosts = new Set(
    [...allowedHosts].map((host) => String(host).toLowerCase()),
  );
  const outputRevisions = new OutputRevisions();
  const server = createServer(async (request, response) => {
    applySecurityHeaders(response);

    try {
      if (!hasValidHost(request, normalizedAllowedHosts)) {
        throw new HttpError(421, "host_rejected", "Request host rejected");
      }

      const url = new URL(request.url || "/", `http://${request.headers.host}`);
      const method = request.method || "GET";

      // A leaf serves one thing: the API its hub calls. Nothing else is worth
      // answering -- there is no person at this address, and handing out the UI
      // would only produce a dead end that advertises the version. Narrowing the
      // surface before asking who is calling keeps the refusal the same for
      // everyone and keeps the log free of paths that were never going to be
      // served.
      if (peer?.required) {
        if (!url.pathname.startsWith("/api/link/")) {
          throw new HttpError(404, "not_found", "Not found");
        }
        peer.authorize(request);
      }

      // Ahead of the /api/ gate on purpose: a hub carries no cookie, no launch
      // token and no CSRF token, and it does not need them -- the peer gate
      // above already decided whether this caller may be here at all.
      if (link && await link(request, response, url, method)) {
        return;
      }

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

      // Ahead of the /api/ gate on purpose: a navigation cannot send the launch
      // token header, and the ticket already proves the request was authorised.
      const ticketMatch = url.pathname.match(/^\/api\/browse\/download\/([A-Za-z0-9_-]{16,86})$/u);
      if (method === "GET" && ticketMatch) {
        const claim = tickets.redeem(ticketMatch[1]);
        const from = claim.serverId === LOCAL_SERVER ? null : herdr.fileClient?.(claim.serverId);
        await sendDownload(response, await openBrowsedFile(claim.path, from));
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

      if (profiles && url.pathname.startsWith("/api/servers")) {
        const match = url.pathname.match(/^\/api\/servers(?:\/(link_[a-f0-9-]{36}|test|discover))?$/u);
        if (!match) throw new HttpError(404, "not_found", "Server route not found");
        const id = match[1];
        if (method === "GET" && !id) {
          sendJson(response, 200, { profiles: profiles.list() });
          return;
        }
        requireWriteAuthorization(request, csrfToken);
        if (method === "POST" && id === "discover") {
          if (!discover) {
            throw new HttpError(501, "discovery_unavailable", "This machine cannot list its tailnet.");
          }
          sendJson(response, 200, await discover(profiles.list().map((item) => item.address)));
          return;
        }
        if (method === "POST" && id === "test") {
          const { validateServerProfile } = await import("./server-profiles.mjs");
          const profile = validateServerProfile(await readJsonBody(request, maxBodyBytes));
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

      if (files && url.pathname.startsWith("/api/files")) {
        const match = url.pathname.match(/^\/api\/files(?:\/([^/]+))?$/u);
        if (!match) throw new HttpError(404, "not_found", "File route not found");
        const name = match[1] === undefined ? null : validateTransferName(match[1]);
        // Writing to a linked server goes to that machine's own uploads folder,
        // never to a path the request chooses.
        const { serverId: filesServer, source: remote } = fileSource(url.searchParams.get("server"));
        if (method === "GET" && !name) {
          // The directory is sent so the UI can tell when it is showing the
          // uploads folder and offer uploads there. It is a display hint only -- what
          // actually confines writes is that these routes cannot address a path
          // outside the uploads folder at all.
          const listing = remote
            ? { directory: await remote.uploadsDirectory(), files: await remote.listUploads() }
            : { directory: files.directory, files: await files.list() };
          sendJson(response, 200, { ...listing, server: filesServer });
          return;
        }
        if (method === "GET" && name) {
          if (remote) {
            const file = await remote.openUpload(name);
            await sendDownload(response, { file, stream: file.stream });
          } else {
            await sendDownload(response, await files.open(name));
          }
          return;
        }
        requireWriteAuthorization(request, csrfToken);
        if (method === "POST" && name) {
          const body = acceptUpload(request, maxTransferBytes);
          const saved = remote
            ? await remote.saveUpload(name, body, { bytes: Number(request.headers["content-length"]) })
            : await files.save(name, body);
          sendJson(response, 201, { file: saved, server: filesServer });
          return;
        }
        if (method === "DELETE" && name) {
          if (remote) await remote.removeUpload(name);
          else await files.remove(name);
          sendEmpty(response, 204);
          return;
        }
        throw new HttpError(405, "method_not_allowed", "Method not allowed");
      }

      if (url.pathname.startsWith("/api/browse")) {
        if (method === "GET" && url.pathname === "/api/browse") {
          // Same-origin only. Another site cannot read the reply, but it could
          // still trigger the request, and a wedged path costs a shared thread.
          requireSameOrigin(request);
          const prefix = url.searchParams.get("prefix") || "";
          if (prefix.length > 255) {
            throw new HttpError(400, "invalid_input", "That name is too long.");
          }
          const { serverId, source } = fileSource(url.searchParams.get("server"));
          const target = url.searchParams.get("path");
          // A linked server does its own reading, so it needs none of the local
          // thread budget -- and one that stops answering cannot exhaust it.
          const listing = source
            ? await browseDirectory(target, { prefix }, source)
            : await withDirectorySlot(() => browseDirectory(target, { prefix }));
          sendJson(response, 200, { ...listing, server: serverId });
          return;
        }
        if (method === "POST" && url.pathname === "/api/browse/tickets") {
          requireWriteAuthorization(request, csrfToken);
          const body = await readJsonBody(request, maxBodyBytes);
          const { serverId, source } = fileSource(body.server);
          sendJson(response, 201, {
            ticket: tickets.issue(source ? String(body.path) : browsePath(body.path), serverId),
          });
          return;
        }
        // A download link that did not match the ticket pattern above is a
        // stale or mistyped one, which reads as expired rather than as a bad
        // method.
        if (method === "GET" && url.pathname.startsWith("/api/browse/download/")) {
          throw new HttpError(404, "ticket_expired", "This download link has expired.");
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
        // Legacy history=hybrid requests also use the terminal's own scrollback.
        const output = await herdr.readPane(paneId, {
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

  // Uploads stream a whole file through one request, and requestTimeout covers
  // the entire body, so the 10s that suits JSON routes would cut them off.
  // headersTimeout keeps the slowloris defence on the header phase.
  server.requestTimeout = 120_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;

  // A linked server answers for its own files, so the id resolves to that
  // machine's client; local keeps the filesystem path.
  function fileSource(value) {
    if (value === undefined || value === null || value === "" || value === LOCAL_SERVER) {
      return { serverId: LOCAL_SERVER, source: null };
    }
    const source = herdr.fileClient?.(value);
    if (!source) throw new HttpError(404, "unknown_server", "That server is no longer configured.");
    return { serverId: value, source };
  }

  const tickets = downloadTickets();
  const withDirectorySlot = directoryReadLimiter(4);
  const outputWatcher = terminalOutputWatcher({ herdr, outputWindow });
  attachTerminalWebSocket({
    server,
    authorizeUpgrade(request) {
      // The upgrade path never reaches the request handler, so the peer gate
      // has to be repeated here or it is simply absent for sockets.
      if (peer?.required) peer.authorize(request);
      if (!hasValidHost(request, normalizedAllowedHosts) || !request.headers.origin) throw new Error("Origin required");
      requireSameOrigin(request);
      if (auth.required && !auth.hasValidSession(request.headers.cookie)) throw new Error("Authentication required");
    },
    authorizeMessage(request, credentials) {
      if (peer?.required) peer.authorize(request);
      if (!credentials || !safeTokenEquals(csrfToken, credentials.csrf)) throw new Error("Write token rejected");
      if (auth.required && (!auth.hasValidSession(request.headers.cookie) ||
          !auth.hasValidLaunchToken(credentials.launchToken))) throw new Error("Authentication required");
    },
    async sendInput(message) {
      if (message.keys) await herdr.sendKeys(message.paneId, validation.validateKeys(message.keys));
      else await herdr.sendText(message.paneId, validation.validateText(message.text), { submit: message.submit === true });
      outputWatcher.input(message.paneId);
    },
    watchOutput: (...args) => outputWatcher.watch(...args),
    watchStatuses: typeof herdr.watchStatuses === "function" ? (...args) => herdr.watchStatuses(...args) : undefined,
    onRequest: (paneId, text) => notificationMonitor?.recordRequest(paneId, text),
  });

  return Object.freeze({ server, csrfToken });
}
