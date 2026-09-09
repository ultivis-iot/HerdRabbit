import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { FileAccessError } from "../src/file-browser.mjs";
import {
  RemoteFileBrowser,
  remoteAccessError,
  validateRemotePath,
} from "../src/remote-file-browser.mjs";

function attrs({ dir = false, file = true, link = false, size = 0, mtime = 1_700_000_000 } = {}) {
  return {
    size,
    mtime,
    isDirectory: () => dir,
    isFile: () => file,
    isSymbolicLink: () => link,
  };
}

// Stands in for an ssh2 SFTP session; every call answers on the callback.
function fakeSftp(tree, { onOpen } = {}) {
  const sessions = [];
  const make = () => {
    const session = {
      ended: false,
      realpath(path, cb) { cb(null, path === "." ? "/home/me" : path.replace(/\/$/u, "")); },
      readdir(path, cb) {
        const listing = tree[path];
        if (!listing) return cb(Object.assign(new Error("no such file"), { code: 2 }));
        cb(null, listing);
      },
      lstat(path, cb) {
        const found = tree.files?.[path];
        if (!found) return cb(Object.assign(new Error("no such file"), { code: 2 }));
        cb(null, found.attrs);
      },
      stat(path, cb) {
        const found = tree.targets?.[path];
        if (!found) return cb(Object.assign(new Error("no such file"), { code: 2 }));
        cb(null, found);
      },
      createReadStream(path) {
        onOpen?.(path);
        return Readable.from([Buffer.from(tree.files[path].body)]);
      },
      end() { session.ended = true; },
    };
    sessions.push(session);
    return session;
  };
  return { make, sessions };
}

function fakeClient(sftp) {
  const client = new EventEmitter();
  client.sftp = (cb) => cb(null, sftp.make());
  client.end = () => client.emit("close");
  return client;
}

const profile = { id: "ssh_x", host: "box.example", username: "me", authMethod: "config" };

function browser(tree, options = {}) {
  const sftp = fakeSftp(tree, options);
  const remote = new RemoteFileBrowser(profile, {
    connect: async () => fakeClient(sftp),
    ...options,
  });
  // The effective config is normally read from ssh -G; skip that here.
  remote.config = {
    host: "box.example",
    port: 22,
    username: "me",
    identityFiles: [],
    knownHostsFiles: ["/dev/null"],
  };
  return { remote, sftp };
}

test("requires an absolute posix path", () => {
  assert.equal(validateRemotePath("/srv/app"), "/srv/app");
  assert.equal(validateRemotePath("/srv/../etc"), "/etc");
  for (const value of ["", "relative", " /srv", "/srv\n/x", null]) {
    assert.throws(() => validateRemotePath(value), FileAccessError, String(value));
  }
});

test("maps SFTP status codes onto the same statuses the local browser uses", () => {
  assert.equal(remoteAccessError({ code: 2 }).status, 404);
  assert.equal(remoteAccessError({ code: 3 }).status, 403);
  assert.equal(remoteAccessError({ code: 8 }).status, 501);
  assert.equal(remoteAccessError({ code: 99 }), null, "unknown codes are not swallowed");
  const own = new FileAccessError(418, "teapot", "kept");
  assert.equal(remoteAccessError(own), own);
});

test("lists a folder with directories first", async () => {
  const { remote } = browser({
    "/srv/app": [
      { filename: "readme.md", attrs: attrs({ size: 12 }) },
      { filename: "src", attrs: attrs({ dir: true, file: false }) },
      { filename: ".env", attrs: attrs({ size: 3 }) },
    ],
  });

  const listing = await remote.listDirectory("/srv/app");
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["src", ".env", "readme.md"]);
  assert.equal(listing.entries[1].hidden, true);
  assert.equal(listing.entries[2].size, 12);
  assert.equal(listing.parent, "/srv");
});

test("resolves symlink targets and flags broken ones", async () => {
  const { remote } = browser({
    "/srv": [
      { filename: "to-dir", attrs: attrs({ link: true, file: false }) },
      { filename: "dangling", attrs: attrs({ link: true, file: false }) },
    ],
    targets: { "/srv/to-dir": attrs({ dir: true, file: false }) },
  });

  const listing = await remote.listDirectory("/srv");
  const byName = Object.fromEntries(listing.entries.map((entry) => [entry.name, entry]));
  assert.equal(byName["to-dir"].kind, "directory");
  assert.equal(byName["to-dir"].symlink, true);
  assert.equal(byName.dangling.broken, true);
});

test("clips a large folder to the first names in order", async () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    filename: `file-${String(index).padStart(3, "0")}`,
    attrs: attrs({ size: 1 }),
  }));
  const { remote } = browser({ "/srv/big": many });

  const listing = await remote.listDirectory("/srv/big", { limit: 10 });
  assert.equal(listing.entries.length, 10);
  assert.equal(listing.truncated, true);
  assert.equal(listing.total, 30);
  assert.equal(listing.entries[0].name, "file-000");
});

test("filters by prefix on the server side", async () => {
  const { remote } = browser({
    "/srv": [
      { filename: "alpha", attrs: attrs({ dir: true, file: false }) },
      { filename: "beta", attrs: attrs({ dir: true, file: false }) },
    ],
  });
  const listing = await remote.listDirectory("/srv", { prefix: "al" });
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["alpha"]);
});

test("streams a regular file and closes its session", async () => {
  const { remote, sftp } = browser({
    files: { "/srv/app/notes.txt": { attrs: attrs({ size: 5 }), body: "hello" } },
  });

  const file = await remote.openFile("/srv/app/notes.txt");
  assert.equal(file.name, "notes.txt");
  assert.equal(file.size, 5);
  const chunks = [];
  for await (const chunk of file.stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString("utf8"), "hello");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(sftp.sessions.at(-1).ended, "the transfer session is released");
});

test("refuses anything that is not a regular file", async () => {
  const { remote } = browser({
    files: {
      "/srv/pipe": { attrs: attrs({ file: false }), body: "" },
      "/srv/dir": { attrs: attrs({ dir: true, file: false }), body: "" },
    },
  });
  // A FIFO would hang the remote sftp-server, so it never gets opened.
  await assert.rejects(() => remote.openFile("/srv/pipe"), (error) => error.status === 400);
  await assert.rejects(() => remote.openFile("/srv/dir"), (error) => error.status === 400);
});

test("refuses a file past the download ceiling", async () => {
  const { remote } = browser(
    { files: { "/srv/big.bin": { attrs: attrs({ size: 99 }), body: "x" } } },
    { maxBytes: 8 },
  );
  await assert.rejects(() => remote.openFile("/srv/big.bin"), (error) => error.status === 413);
});

test("keeps listing on one session and gives transfers their own", async () => {
  const { remote, sftp } = browser({
    "/srv": [{ filename: "a", attrs: attrs({ size: 1 }) }],
    files: { "/srv/a": { attrs: attrs({ size: 1 }), body: "a" } },
  });

  await remote.listDirectory("/srv");
  await remote.listDirectory("/srv");
  assert.equal(sftp.sessions.length, 1, "listing reuses one session");

  await remote.openFile("/srv/a");
  assert.equal(sftp.sessions.length, 2, "a transfer opens its own session");
});

test("shares one handshake between concurrent first requests", async () => {
  let opened = 0;
  const sftp = fakeSftp({ "/srv": [] });
  const remote = new RemoteFileBrowser(profile, {
    connect: async () => {
      opened += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return fakeClient(sftp);
    },
  });
  remote.config = { host: "box.example", port: 22, username: "me", identityFiles: [], knownHostsFiles: [] };

  await Promise.all([
    remote.listDirectory("/srv"),
    remote.listDirectory("/srv"),
    remote.listDirectory("/srv"),
  ]);
  assert.equal(opened, 1);
});

test("holds the connection open while a transfer or ticket is outstanding", async () => {
  const { remote } = browser({ "/srv": [] });
  await remote.listDirectory("/srv");
  assert.ok(remote.client);

  remote.hold();
  remote.release();
  assert.ok(remote.client, "still connected while the idle timer runs");
  remote.close();
  assert.equal(remote.client, null);
});

// Writing goes to one folder per server. The uploads helpers below stand in for
// the SFTP session's write side.
function writableSftp(existing = new Set()) {
  const written = new Map();
  const removed = [];
  const session = {
    realpath(path, cb) { cb(null, path === "." ? "/home/remote" : path); },
    mkdir(path, cb) { cb(existing.has(path) ? Object.assign(new Error("exists"), { code: 4 }) : null); },
    lstat(path, cb) {
      if (existing.has(path) || written.has(path)) return cb(null, attrs({ size: 1 }));
      cb(Object.assign(new Error("no such file"), { code: 2 }));
    },
    readdir(path, cb) {
      cb(null, [...written.keys()]
        .filter((file) => file.startsWith(`${path}/`))
        .map((file) => ({ filename: file.slice(path.length + 1), attrs: attrs({ size: written.get(file).length }) })));
    },
    unlink(path, cb) { removed.push(path); written.delete(path); cb(null); },
    createWriteStream(path) {
      const chunks = [];
      const stream = new Writable({
        write(chunk, _encoding, next) {
          chunks.push(chunk);
          next();
        },
      });
      // A name already taken fails at open, the way OpenSSH answers EXCL: no
      // open, no finish, and nothing written.
      if (existing.has(path) || written.has(path)) {
        queueMicrotask(() => stream.destroy(Object.assign(new Error("Failure"), { code: 4 })));
        return stream;
      }
      stream.on("finish", () => {
        written.set(path, Buffer.concat(chunks).toString("utf8"));
        stream.emit("close");
      });
      return stream;
    },
    end() {},
  };
  return { session, written, removed };
}

function writableBrowser(existing) {
  const fake = writableSftp(existing);
  const client = new EventEmitter();
  client.sftp = (cb) => cb(null, fake.session);
  client.end = () => client.emit("close");
  const remote = new RemoteFileBrowser(profile, { connect: async () => client });
  remote.config = { host: "box", port: 22, username: "me", identityFiles: [], knownHostsFiles: [] };
  return { remote, fake };
}

test("puts uploads in one folder per server, mirroring the local layout", async () => {
  const { remote } = writableBrowser();
  assert.equal(await remote.uploadsDirectory(), "/home/remote/.local/share/herdrabbit/files");
});

test("numbers a colliding upload instead of replacing it", async () => {
  const taken = new Set(["/home/remote/.local/share/herdrabbit/files/report.txt"]);
  const { remote, fake } = writableBrowser(taken);

  const saved = await remote.saveUpload("report.txt", Readable.from([Buffer.from("fresh")]));
  assert.equal(saved.name, "report-2.txt");
  // The file that was already there must survive the collision.
  assert.deepEqual(fake.removed, [], "nothing was deleted while stepping around the name");
});

test("removes only what it created when a transfer breaks", async () => {
  const { remote, fake } = writableBrowser();
  const failing = new Readable({
    read() { this.destroy(new Error("connection lost")); },
  });

  await assert.rejects(() => remote.saveUpload("half.bin", failing));
  assert.deepEqual(fake.removed, ["/home/remote/.local/share/herdrabbit/files/half.bin"]);
});

test("refuses to delete a name the uploads listing does not show", async () => {
  const { remote } = writableBrowser();
  await remote.saveUpload("kept.txt", Readable.from([Buffer.from("x")]));

  await assert.rejects(
    () => remote.removeUpload("../../../.ssh/authorized_keys"),
    (error) => error.status === 404,
  );
  assert.equal((await remote.listUploads()).length, 1, "the real file is untouched");
});
