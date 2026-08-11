import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { listCodexThreads } from "../src/codex-client.mjs";

const helperPath = fileURLToPath(
  new URL("./helpers/fake-codex.mjs", import.meta.url),
);

test("lists Codex threads with documented pagination and filters", async () => {
  await withFakeCodex("paginate", async ({ logPath }) => {
    const threads = await listCodexThreads({
      maxThreads: 3,
      sourceKinds: ["cli", "appServer"],
      cwd: ["/project/a", "/project/b"],
      searchTerm: "chat",
      useStateDbOnly: true,
      requestTimeoutMs: 1_000,
    });

    assert.deepEqual(
      threads.map((thread) => thread.id),
      ["thread-1", "thread-2", "thread-3"],
    );
    const requests = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const lists = requests.filter((request) => request.method === "thread/list");
    assert.deepEqual(
      lists.map((request) => request.params),
      [
        {
          cursor: null,
          limit: 3,
          sortKey: "recency_at",
          sortDirection: "desc",
          sourceKinds: ["cli", "appServer"],
          archived: false,
          cwd: ["/project/a", "/project/b"],
          searchTerm: "chat",
          useStateDbOnly: true,
        },
        {
          cursor: "page-2",
          limit: 1,
          sortKey: "recency_at",
          sortDirection: "desc",
          sourceKinds: ["cli", "appServer"],
          archived: false,
          cwd: ["/project/a", "/project/b"],
          searchTerm: "chat",
          useStateDbOnly: true,
        },
      ],
    );
  });
});

test("surfaces app-server protocol errors", async () => {
  await withFakeCodex("error", async () => {
    await assert.rejects(
      listCodexThreads({
        maxThreads: 1,
        sourceKinds: ["cli"],
        requestTimeoutMs: 1_000,
      }),
      /forced thread\/list error/,
    );
  });
});

test("surfaces app-server process exits", async () => {
  await withFakeCodex("exit", async () => {
    await assert.rejects(
      listCodexThreads({
        maxThreads: 1,
        sourceKinds: ["cli"],
        requestTimeoutMs: 1_000,
      }),
      /app-server exited \(7\): forced app-server exit/,
    );
  });
});

test("fails closed on invalid app-server JSON", async () => {
  await withFakeCodex("invalid-json", async () => {
    await assert.rejects(
      listCodexThreads({
        maxThreads: 1,
        sourceKinds: ["cli"],
        requestTimeoutMs: 1_000,
      }),
      /app-server returned invalid JSON/,
    );
  });
});

test("times out an unresponsive app-server request", async () => {
  await withFakeCodex("timeout", async () => {
    await assert.rejects(
      listCodexThreads({
        maxThreads: 1,
        sourceKinds: ["cli"],
        requestTimeoutMs: 1_000,
      }),
      /request timed out: thread\/list/,
    );
  });
});

async function withFakeCodex(mode, callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "herdr-codex-client-"),
  );
  const binaryPath = path.join(directory, "codex");
  const logPath = path.join(directory, "requests.jsonl");
  fs.copyFileSync(helperPath, binaryPath);
  fs.chmodSync(binaryPath, 0o755);

  const previousBinary = process.env.HERDR_CODEX_BIN;
  const previousMode = process.env.FAKE_CODEX_MODE;
  const previousLog = process.env.FAKE_CODEX_LOG;
  process.env.HERDR_CODEX_BIN = binaryPath;
  process.env.FAKE_CODEX_MODE = mode;
  process.env.FAKE_CODEX_LOG = logPath;
  try {
    return await callback({ logPath });
  } finally {
    restoreEnvironment("HERDR_CODEX_BIN", previousBinary);
    restoreEnvironment("FAKE_CODEX_MODE", previousMode);
    restoreEnvironment("FAKE_CODEX_LOG", previousLog);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function restoreEnvironment(name, previous) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
