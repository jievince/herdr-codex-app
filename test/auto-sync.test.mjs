import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  recordSyncSuccess,
  requestAutoSync,
} from "../src/auto-sync-core.mjs";

test("throttles automatic sync requests after a request or success", async () => {
  await withStateDirectory(async () => {
    let invocations = 0;
    const invoke = () => {
      invocations += 1;
    };

    assert.deepEqual(
      await requestAutoSync({ now: 1_000, invoke }),
      { requested: true },
    );
    assert.deepEqual(
      await requestAutoSync({ now: 20_000, invoke }),
      { requested: false, reason: "cooldown" },
    );

    recordSyncSuccess(25_000);
    assert.deepEqual(
      await requestAutoSync({ now: 50_000, invoke }),
      { requested: false, reason: "cooldown" },
    );
    assert.deepEqual(
      await requestAutoSync({ now: 56_000, invoke }),
      { requested: true },
    );
    assert.equal(invocations, 2);
  });
});

test("does not enqueue automatic sync while a refresh owns the lock", async () => {
  await withStateDirectory(async (directory) => {
    fs.writeFileSync(
      path.join(directory, "sync.lock"),
      `${JSON.stringify({
        pid: process.pid,
        createdAt: Date.now(),
        token: "active-sync",
      })}\n`,
    );
    let invoked = false;

    assert.deepEqual(
      await requestAutoSync({
        now: 1_000,
        invoke: () => {
          invoked = true;
        },
      }),
      { requested: false, reason: "sync-running" },
    );
    assert.equal(invoked, false);
  });
});

async function withStateDirectory(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "herdr-codex-app-auto-sync-"),
  );
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  process.env.HERDR_PLUGIN_STATE_DIR = directory;
  try {
    await callback(directory);
  } finally {
    if (previous === undefined) {
      delete process.env.HERDR_PLUGIN_STATE_DIR;
    } else {
      process.env.HERDR_PLUGIN_STATE_DIR = previous;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
