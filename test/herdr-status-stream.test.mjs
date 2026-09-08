import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subscribeHerdrStatuses } from "../src/herdr-status-stream.mjs";

test("Herdr status subscription handles framed events and only forwards subscribed panes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-status-test-"));
  let peer;
  let request;
  const server = createServer(socket => {
    peer = socket;
    socket.once("data", bytes => {
      request = JSON.parse(bytes.toString());
      socket.write('{"result":{"type":"subscription_started"}}\n');
    });
  });
  const path = join(directory, "api.sock");
  server.listen(path); await once(server, "listening");
  const events = [];
  let stop;
  try {
    stop = await subscribeHerdrStatuses({ socketPath: path, paneIds: ["w1:p1"],
      onStatus: event => events.push(event), onError() {} });
    assert.deepEqual(request.params.subscriptions, [{ type: "pane.agent_status_changed", pane_id: "w1:p1" }]);
    const frame = JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: "w1:p1", agent_status: "working" } }) + "\n";
    peer.write(frame.slice(0, 20)); peer.write(frame.slice(20));
    peer.write(JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: "w2:p1", agent_status: "blocked" } }) + "\n");
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(events, [{ pane_id: "w1:p1", agent_status: "working" }]);
  } finally {
    stop?.(); peer?.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
