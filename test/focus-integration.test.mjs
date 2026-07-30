import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("focus resumes a placeholder through the shared app server", () => {
  const fixture = runFocus({
    agent: "codex-history",
    agentStatus: "idle",
    processArgv: [],
  });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.match(fixture.result.stdout, /Resumed Codex chat thread1/);
    const start = fixture.herdrCalls.find(
      (args) => args[0] === "agent" && args[1] === "start",
    );
    assert.ok(start);
    assert.deepEqual(start.slice(start.indexOf("--") + 1), [
      "resume",
      "--remote",
      "unix://",
      "--no-alt-screen",
      "thread1",
    ]);
    assert.deepEqual(fixture.codexCalls, [
      ["app-server", "daemon", "start"],
    ]);
    assert.ok(
      fixture.herdrCalls.some(
        (args) =>
          args[0] === "plugin" &&
          args[1] === "action" &&
          args[2] === "invoke" &&
          args[3] === "jievince.herdr-codex-app.sync",
      ),
    );
    const saved = JSON.parse(
      fs.readFileSync(path.join(fixture.stateDirectory, "index.json"), "utf8"),
    );
    assert.ok(saved.threads.thread1.lastFocusedAt > 0);
  } finally {
    fixture.cleanup();
  }
});

test("focus redirects to an existing TUI for the same thread", () => {
  const fixture = runFocus({
    agent: "codex-history",
    agentStatus: "idle",
    processArgv: [],
    otherPanes: [
      {
        pane_id: "w2:p1",
        workspace_id: "w2",
        tab_id: "w2:t1",
        focused: false,
        agent: "codex",
        agent_status: "working",
        processArgv: ["codex", "resume", "thread1"],
        tokens: {},
      },
    ],
  });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.match(fixture.result.stdout, /already running in w2:p1/);
    assert.ok(
      fixture.herdrCalls.some(
        (args) =>
          args[0] === "agent" &&
          args[1] === "focus" &&
          args[2] === "w2:p1",
      ),
    );
    assert.ok(
      !fixture.herdrCalls.some(
        (args) => args[0] === "agent" && args[1] === "start",
      ),
    );
    assert.deepEqual(fixture.codexCalls, []);
  } finally {
    fixture.cleanup();
  }
});

test("focus migrates an idle standalone resume before reopening remotely", () => {
  const fixture = runFocus({
    agent: "codex",
    agentStatus: "idle",
    processArgv: ["codex", "resume", "--no-alt-screen", "thread1"],
  });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.match(fixture.result.stdout, /Migrated Codex chat thread1/);
    const commandNames = fixture.herdrCalls.map((args) =>
      args.slice(0, 2).join(" "),
    );
    assert.ok(
      commandNames.indexOf("pane process-info") <
        commandNames.indexOf("pane run"),
    );
    assert.ok(
      commandNames.indexOf("pane run") <
        commandNames.indexOf("agent start"),
    );
    const quit = fixture.herdrCalls.find(
      (args) => args[0] === "pane" && args[1] === "run",
    );
    assert.deepEqual(quit, ["pane", "run", "w1:p1", "/quit"]);
    const finalRuntime = JSON.parse(
      fs.readFileSync(fixture.runtimeStatePath, "utf8"),
    );
    assert.equal(finalRuntime.panes[0].agent, "codex");
    assert.equal(finalRuntime.panes[0].agent_status, "idle");
  } finally {
    fixture.cleanup();
  }
});

test("focus does not resume a chat while history refresh holds the sync lock", () => {
  const fixture = runFocus({
    agent: "codex-history",
    agentStatus: "idle",
    processArgv: [],
    syncLocked: true,
  });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.match(fixture.result.stdout, /history refresh is running/);
    assert.deepEqual(fixture.herdrCalls, []);
    assert.deepEqual(fixture.codexCalls, []);
  } finally {
    fixture.cleanup();
  }
});

function runFocus({
  agent,
  agentStatus,
  processArgv,
  otherPanes = [],
  syncLocked = false,
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-csi-focus-"));
  const stateDirectory = path.join(root, "plugin-state");
  const configDirectory = path.join(root, "plugin-config");
  const runtimeStatePath = path.join(root, "runtime.json");
  const herdrLogPath = path.join(root, "herdr.log");
  const codexLogPath = path.join(root, "codex.log");
  const fakeHerdrPath = path.join(root, "fake-herdr.cjs");
  const fakeCodexPath = path.join(root, "fake-codex.cjs");
  fs.mkdirSync(stateDirectory);
  fs.mkdirSync(configDirectory);
  fs.writeFileSync(
    runtimeStatePath,
    `${JSON.stringify({
      workspaces: [
        { workspace_id: "w1", label: "project" },
        ...otherPanes
          .filter(
            (pane, index, panes) =>
              panes.findIndex(
                (candidate) =>
                  candidate.workspace_id === pane.workspace_id,
              ) === index,
          )
          .map((pane) => ({
            workspace_id: pane.workspace_id,
            label: pane.workspace_id,
          })),
      ],
      processArgv,
      panes: [
        {
          pane_id: "w1:p1",
          workspace_id: "w1",
          tab_id: "w1:t1",
          focused: true,
          agent,
          agent_status: agentStatus,
          tokens: { codex_thread_id: "thread1" },
        },
        ...otherPanes,
      ],
    })}\n`,
  );
  fs.writeFileSync(
    path.join(stateDirectory, "index.json"),
    `${JSON.stringify({
      version: 3,
      projects: {},
      threads: {
        thread1: {
          paneId: "w1:p1",
          workspaceId: "w1",
          tabId: "w1:t1",
          lastFocusedAt: 0,
        },
      },
    })}\n`,
  );
  if (syncLocked) {
    fs.writeFileSync(
      path.join(stateDirectory, "sync.lock"),
      `${JSON.stringify({
        pid: process.pid,
        createdAt: Date.now(),
        token: "active-refresh",
      })}\n`,
    );
  }
  fs.writeFileSync(fakeHerdrPath, fakeHerdrSource());
  fs.writeFileSync(fakeCodexPath, fakeCodexSource());
  fs.chmodSync(fakeHerdrPath, 0o700);
  fs.chmodSync(fakeCodexPath, 0o700);

  const result = spawnSync(process.execPath, ["src/focus.mjs"], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HERDR_BIN_PATH: fakeHerdrPath,
      HERDR_CODEX_BIN: fakeCodexPath,
      HERDR_PANE_ID: "w1:p1",
      HERDR_PLUGIN_STATE_DIR: stateDirectory,
      HERDR_PLUGIN_CONFIG_DIR: configDirectory,
      FAKE_HERDR_STATE: runtimeStatePath,
      FAKE_HERDR_LOG: herdrLogPath,
      FAKE_CODEX_LOG: codexLogPath,
    },
    timeout: 20_000,
  });
  return {
    root,
    result,
    stateDirectory,
    runtimeStatePath,
    herdrCalls: readLog(herdrLogPath),
    codexCalls: readLog(codexLogPath),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function readLog(logPath) {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function fakeHerdrSource() {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const statePath = process.env.FAKE_HERDR_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(args) + "\\n");

function save() {
  fs.writeFileSync(statePath, JSON.stringify(state) + "\\n");
}

function respond(result) {
  process.stdout.write(JSON.stringify({ result }) + "\\n");
}

if (args[0] === "workspace" && args[1] === "list") {
  respond({ workspaces: state.workspaces });
} else if (args[0] === "pane" && args[1] === "list") {
  respond({ panes: state.panes });
} else if (args[0] === "pane" && args[1] === "get") {
  respond({ pane: state.panes.find((pane) => pane.pane_id === args[2]) || null });
} else if (args[0] === "pane" && args[1] === "list") {
  const workspaceId = args[args.indexOf("--workspace") + 1];
  respond({
    panes: state.panes.filter((pane) => pane.workspace_id === workspaceId),
  });
} else if (args[0] === "pane" && args[1] === "process-info") {
  const paneId = args[args.indexOf("--pane") + 1];
  const pane = state.panes.find((candidate) => candidate.pane_id === paneId);
  respond({
    process_info: {
      foreground_processes: [
        {
          name: "codex",
          argv0: "/opt/codex/bin/codex",
          argv: pane?.processArgv || state.processArgv || [],
        },
      ],
    },
  });
} else if (args[0] === "pane" && args[1] === "run") {
  if (args[3] !== "/quit") {
    process.stderr.write("expected /quit\\n");
    process.exit(2);
  }
  const pane = state.panes.find((candidate) => candidate.pane_id === args[2]);
  pane.agent = null;
  pane.agent_status = "unknown";
  save();
  respond({});
} else if (args[0] === "pane" && args[1] === "report-agent") {
  const pane = state.panes.find((candidate) => candidate.pane_id === args[2]);
  pane.agent = args[args.indexOf("--agent") + 1];
  pane.agent_status = args[args.indexOf("--state") + 1];
  save();
  respond({});
} else if (args[0] === "pane" && args[1] === "release-agent") {
  const pane = state.panes.find((candidate) => candidate.pane_id === args[2]);
  pane.agent = null;
  pane.agent_status = "unknown";
  save();
  respond({});
} else if (args[0] === "agent" && args[1] === "start") {
  const paneId = args[args.indexOf("--pane") + 1];
  const pane = state.panes.find((candidate) => candidate.pane_id === paneId);
  pane.agent = "codex";
  pane.agent_status = "idle";
  save();
  respond({ agent: { pane_id: paneId, agent: "codex" } });
} else if (args[0] === "agent" && args[1] === "focus") {
  for (const pane of state.panes) {
    pane.focused = pane.pane_id === args[2];
  }
  save();
  respond({ agent: state.panes.find((pane) => pane.pane_id === args[2]) });
} else if (
  args[0] === "plugin" &&
  args[1] === "action" &&
  args[2] === "invoke" &&
  args[3] === "jievince.herdr-codex-app.sync"
) {
  respond({ type: "plugin_action_invoked" });
} else {
  process.stderr.write("unsupported fake Herdr command: " + args.join(" ") + "\\n");
  process.exit(2);
}
`;
}

function fakeCodexSource() {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(args) + "\\n");
if (args.join(" ") !== "app-server daemon start") {
  process.stderr.write("unexpected fake Codex command: " + args.join(" ") + "\\n");
  process.exit(2);
}
`;
}
