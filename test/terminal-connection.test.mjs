import test from "node:test";
import assert from "node:assert/strict";
import { terminalConnection } from "../public/terminal-connection.js";

test("reconnection restores the screen subscription but never replays unacknowledged input", async () => {
  const sockets = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    sent = [];
    constructor() { sockets.push(this); }
    send(message) { this.sent.push(JSON.parse(message)); }
    open() { this.readyState = 1; this.onopen(); }
    receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
    close() { this.readyState = 3; this.onclose({ code: 1006 }); }
  }
  const frames = [];
  const connection = terminalConnection({ WebSocketImpl: Socket, url: "ws://localhost/api/terminal",
    credentials: () => ({ csrf: "write", launchToken: "launch" }), onOutput: frame => frames.push(frame),
    onDisconnect() {}, onAuthenticationRequired() {} });
  connection.select("w1:p1", 200);
  sockets[0].open();
  sockets[0].receive({ type: "ready" });
  sockets[0].receive({ type: "output", paneId: "w1:p1", requestedLines: 200, update: "replace", output: "old", revision: "1" });
  const sent = connection.send({ paneId: "w1:p1", text: "command" });
  const rejected = assert.rejects(sent, /not resent/);
  sockets[0].close();
  await rejected;
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(sockets.length, 2);
  sockets[1].open();
  sockets[1].receive({ type: "ready" });
  assert.deepEqual(sockets[1].sent.map(message => message.type), ["auth", "watch", "watch-statuses"]);
  sockets[1].receive({ type: "output", paneId: "w1:p1", requestedLines: 200, update: "replace", output: "current", revision: "2" });
  assert.equal(frames.at(-1).output, "current");
  connection.pause();
});
