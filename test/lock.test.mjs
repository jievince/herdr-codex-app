import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  recoverStaleLock,
  stateDirectory,
  withLock,
} from "../src/lib.mjs";

test("does not steal an old lock while its owner is alive", async () => {
  await withTemporaryState((directory) => {
    const lockPath = path.join(directory, "live.lock");
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: process.pid, token: "live", createdAt: 1 })}\n`,
    );
    const old = new Date(Date.now() - 600_000);
    fs.utimesSync(lockPath, old, old);

    assert.equal(recoverStaleLock(lockPath), false);
    assert.equal(fs.existsSync(lockPath), true);
  });
});

test("removes a lock whose owner is known dead", async () => {
  await withTemporaryState((directory) => {
    const lockPath = path.join(directory, "dead.lock");
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: 12345, token: "dead", createdAt: 1 })}\n`,
    );

    assert.equal(
      recoverStaleLock(lockPath, { isAlive: () => false }),
      true,
    );
    assert.equal(fs.existsSync(lockPath), false);
  });
});

test("removes corrupt locks only after the age threshold", async () => {
  await withTemporaryState((directory) => {
    const lockPath = path.join(directory, "corrupt.lock");
    fs.writeFileSync(lockPath, "not-json\n");

    assert.equal(recoverStaleLock(lockPath), false);
    const old = new Date(Date.now() - 600_000);
    fs.utimesSync(lockPath, old, old);
    assert.equal(recoverStaleLock(lockPath), true);
  });
});

test("concurrent lock attempts skip without deleting the live owner", async () => {
  await withTemporaryState(async () => {
    let nested;
    await withLock("sync", async () => {
      nested = await withLock("sync", () => {
        throw new Error("nested callback must not run");
      });
    });
    assert.deepEqual(nested, { skipped: true });
  });
});

test("lock release does not delete a replacement owner", async () => {
  await withTemporaryState(async (directory) => {
    const lockPath = path.join(directory, "sync.lock");
    await withLock("sync", async () => {
      fs.writeFileSync(
        lockPath,
        `${JSON.stringify({
          pid: process.pid,
          token: "replacement",
          createdAt: Date.now(),
        })}\n`,
      );
    });
    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(
      JSON.parse(fs.readFileSync(lockPath, "utf8")).token,
      "replacement",
    );
  });
});

async function withTemporaryState(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-csi-lock-"));
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  const previousSocket = process.env.HERDR_SOCKET_PATH;
  process.env.HERDR_PLUGIN_STATE_DIR = directory;
  process.env.HERDR_SOCKET_PATH = path.join(directory, "herdr.sock");
  try {
    return await callback(stateDirectory());
  } finally {
    if (previous === undefined) {
      delete process.env.HERDR_PLUGIN_STATE_DIR;
    } else {
      process.env.HERDR_PLUGIN_STATE_DIR = previous;
    }
    if (previousSocket === undefined) {
      delete process.env.HERDR_SOCKET_PATH;
    } else {
      process.env.HERDR_SOCKET_PATH = previousSocket;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
