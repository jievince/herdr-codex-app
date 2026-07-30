#!/usr/bin/env node

import fs from "node:fs";
import readline from "node:readline";

if (process.argv[2] !== "app-server") {
  process.stderr.write("fake Codex only supports app-server\n");
  process.exit(2);
}

const mode = process.env.FAKE_CODEX_MODE || "paginate";
const logPath = process.env.FAKE_CODEX_LOG;
const input = readline.createInterface({ input: process.stdin });

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (logPath) {
    fs.appendFileSync(logPath, `${JSON.stringify(message)}\n`);
  }
  if (message.method === "initialize") {
    respond(message.id, { userAgent: "fake-codex" });
    return;
  }
  if (message.method !== "thread/list") {
    return;
  }

  if (mode === "error") {
    write({
      id: message.id,
      error: { code: -32_000, message: "forced thread/list error" },
    });
    return;
  }
  if (mode === "exit") {
    process.stderr.write("forced app-server exit\n");
    process.exit(7);
  }
  if (mode === "timeout") {
    return;
  }
  if (mode === "invalid-json") {
    process.stdout.write("not-json\n");
    return;
  }

  if (message.params.cursor === null) {
    respond(message.id, {
      data: [
        { id: "thread-1", cwd: "/project", preview: "First chat" },
        { id: "thread-2", cwd: "/project", preview: "Second chat" },
      ],
      nextCursor: "page-2",
    });
    return;
  }
  respond(message.id, {
    data: [{ id: "thread-3", cwd: "/project", preview: "Third chat" }],
    nextCursor: null,
  });
});

function respond(id, result) {
  write({ id, result });
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
