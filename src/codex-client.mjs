import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";

import { PLUGIN_VERSION } from "./constants.mjs";

function codexBinary() {
  return process.env.HERDR_CODEX_BIN || "codex";
}

export function ensureCodexAppServer() {
  const result = spawnSync(
    codexBinary(),
    ["app-server", "daemon", "start"],
    {
      encoding: "utf8",
      env: process.env,
      timeout: 30_000,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `failed to start the managed Codex app server (${result.status}): ${detail}`,
    );
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export async function listCodexThreads({
  maxThreads,
  sourceKinds,
  cwd,
  searchTerm,
  useStateDbOnly = false,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}) {
  const client = new CodexAppServerClient({ requestTimeoutMs });
  try {
    await client.initialize();

    const threads = [];
    let cursor = null;
    do {
      const remaining = maxThreads - threads.length;
      const result = await client.request("thread/list", {
        cursor,
        limit: Math.min(remaining, 100),
        sortKey: "recency_at",
        sortDirection: "desc",
        sourceKinds,
        archived: false,
        ...(cwd ? { cwd } : {}),
        ...(searchTerm ? { searchTerm } : {}),
        ...(useStateDbOnly ? { useStateDbOnly: true } : {}),
      });
      threads.push(...(result.data || []));
      cursor = result.nextCursor || null;
    } while (cursor && threads.length < maxThreads);

    return threads.slice(0, maxThreads);
  } finally {
    client.close();
  }
}

class CodexAppServerClient {
  constructor({ requestTimeoutMs }) {
    // The stdio server is short-lived; resumed TUIs use the shared daemon.
    this.child = spawn(codexBinary(), ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.closed = false;
    this.requestTimeoutMs = requestTimeoutMs;

    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.onLine(line));
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-16_384);
    });
    this.child.on("error", (error) => {
      this.fail(
        new Error(`failed to start codex app-server: ${error.message}`),
      );
    });
    this.child.stdin.on("error", (error) => {
      this.fail(new Error(`codex app-server stdin failed: ${error.message}`));
    });
    this.child.on("exit", (code, signal) => {
      const detail = this.stderr.trim();
      const message = `codex app-server exited (${code ?? signal ?? "unknown"})${
        detail ? `: ${detail}` : ""
      }`;
      this.fail(new Error(message));
    });
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "herdr_codex_app",
        title: "Herdr Codex App",
        version: PLUGIN_VERSION,
      },
    });
    this.notify("initialized", {});
  }

  request(method, params) {
    if (this.closed) {
      return Promise.reject(new Error("codex app-server is not running"));
    }

    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex app-server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    this.write({ method, id, params });
    return response;
  }

  notify(method, params) {
    this.write({ method, params });
  }

  write(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.fail(
        new Error(`codex app-server returned invalid JSON: ${error.message}`),
      );
      return;
    }
    if (message.id === undefined || message.id === null) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(JSON.stringify(message.error)));
    } else {
      pending.resolve(message.result);
    }
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.child.stdin.end();
    this.child.kill("SIGTERM");
  }

  fail(error) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
    }
  }
}
