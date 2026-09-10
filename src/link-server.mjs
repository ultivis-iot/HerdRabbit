import { HttpError, decodePaneId, readJsonBody, sendJson } from "./http-basics.mjs";
import { validation } from "./herdr-client.mjs";
import { LINK_PROTOCOL } from "./leaf-protocol.mjs";

// Undici tears a response down after five idle minutes, and a quiet terminal
// easily goes that long, so the stream says something well before then.
const HEARTBEAT_MS = 15_000;
const MAX_WATCHED_PANES = 512;

// A hub reaches a leaf through this surface and no other. It is deliberately
// not the browser API: that one is shaped by things a browser has and a server
// does not -- an Origin, a cookie, a CSRF token from a page load -- and making
// a server-to-server caller imitate them buys nothing.
//
// `client` is the leaf's own Herdr client, never its MultiServerClient. That is
// what makes "a leaf reports only its own sessions" structural: it does not
// hold anyone else's to report.
export function leafLinkRoutes({ client, version, serverName = "", maxBodyBytes = 128 * 1024 }) {
  function hello() {
    return {
      product: "herdrabbit",
      version,
      link_protocol: LINK_PROTOCOL,
      scope: "local",
      server_name: serverName,
    };
  }

  async function statuses(request, response, body) {
    const paneIds = body.paneIds;
    if (!Array.isArray(paneIds) || paneIds.length === 0 || paneIds.length > MAX_WATCHED_PANES ||
        paneIds.some((id) => typeof id !== "string" || id === "" || id.length > 512)) {
      throw new HttpError(400, "invalid_input", "Invalid status subscription");
    }
    if (typeof client.watchStatuses !== "function") {
      throw new HttpError(501, "statuses_unsupported", "This server cannot report agent status.");
    }

    let stop = null;
    let closed = false;
    const write = (text) => { if (!closed) response.write(text); };
    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(beat);
      stop?.();
      response.end();
    };

    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Connection", "keep-alive");
    // Nothing should sit between a leaf and its hub, but a buffering proxy
    // would hold every event until the stream ends, which is never.
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    const beat = setInterval(() => write(":hb\n\n"), HEARTBEAT_MS);
    beat.unref?.();
    // The hub going away has to release the underlying subscription. `response`
    // covers the connection dropping as well as an orderly end; `request` alone
    // does not fire reliably once the body has been consumed.
    request.once("close", finish);
    response.once("close", finish);

    try {
      stop = await client.watchStatuses(
        [...new Set(paneIds)],
        (event) => write(`data: ${JSON.stringify({ pane_id: event.pane_id, agent_status: event.agent_status })}\n\n`),
        (error) => {
          write(`event: error\ndata: ${JSON.stringify({ message: String(error?.message || "Status stream failed") })}\n\n`);
          finish();
        },
      );
    } catch (error) {
      // The subscription never started, so this is still an ordinary failure
      // the hub can read as one rather than a stream that opened and died.
      clearInterval(beat);
      closed = true;
      response.end(`event: error\ndata: ${JSON.stringify({ message: String(error?.message || "Status stream failed") })}\n\n`);
      return;
    }
    if (closed) stop?.();
    else write("event: ready\ndata: {}\n\n");
  }

  return async function handle(request, response, url, method) {
    if (!url.pathname.startsWith("/api/link/")) return false;

    if (method === "GET" && url.pathname === "/api/link/hello") {
      sendJson(response, 200, hello());
      return true;
    }

    if (method === "GET" && url.pathname === "/api/link/snapshot") {
      // The handshake rides along so the hub re-checks compatibility on every
      // poll without paying for a second round trip.
      sendJson(response, 200, { hello: hello(), snapshot: await client.snapshot() });
      return true;
    }

    const paneMatch = url.pathname.match(/^\/api\/link\/panes\/([^/]+)\/(output|text|keys)$/u);
    if (paneMatch) {
      const paneId = decodePaneId(paneMatch[1]);
      if (method === "GET" && paneMatch[2] === "output") {
        const output = await client.readPane(paneId, {
          lines: validation.validateLines(url.searchParams.get("lines")),
          format: validation.validateReadFormat(url.searchParams.get("format")),
        });
        // A string, not a revision window: the hub's own watcher does the
        // diffing, and it expects what a local read would have given it.
        sendJson(response, 200, { output: String(output) });
        return true;
      }
      if (method === "POST" && paneMatch[2] === "text") {
        const body = await readJsonBody(request, maxBodyBytes);
        await client.sendText(paneId, validation.validateText(body.text), { submit: body.submit === true });
        sendJson(response, 200, { ok: true });
        return true;
      }
      if (method === "POST" && paneMatch[2] === "keys") {
        const body = await readJsonBody(request, maxBodyBytes);
        await client.sendKeys(paneId, validation.validateKeys(body.keys));
        sendJson(response, 200, { ok: true });
        return true;
      }
    }

    if (url.pathname === "/api/link/statuses") {
      if (method !== "POST") throw new HttpError(405, "method_not_allowed", "Method not allowed");
      // A body, not a query string: 512 pane ids overflow a URL long before
      // they trouble a request body.
      await statuses(request, response, await readJsonBody(request, maxBodyBytes));
      return true;
    }

    throw new HttpError(404, "not_found", "Not found");
  };
}
