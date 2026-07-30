import assert from "node:assert/strict";
import test from "node:test";

import {
  isStandaloneCodexTuiProcessInfo,
  planLruEvictions,
} from "../src/lru.mjs";

test("keeps active TUIs when they fit the limit", () => {
  const panes = [pane("w1:p1", "idle"), pane("w1:p2", "done")];
  const result = planLruEvictions({
    panes,
    state: stateFor(panes),
    maxActiveTuis: 8,
    protectedPaneId: "w1:p1",
  });

  assert.equal(result.activeCount, 2);
  assert.equal(result.overflow, 0);
  assert.deepEqual(result.candidates, []);
});

test("parks least recently focused idle and done TUIs", () => {
  const panes = Array.from({ length: 10 }, (_, index) =>
    pane(`w1:p${index + 1}`, index % 2 === 0 ? "idle" : "done"),
  );
  const state = stateFor(panes);
  state.threads.thread1.lastFocusedAt = 100;
  state.threads.thread2.lastFocusedAt = 200;
  state.threads.thread3.lastFocusedAt = 300;

  const result = planLruEvictions({
    panes,
    state,
    maxActiveTuis: 8,
    protectedPaneId: "w1:p10",
  });

  assert.equal(result.overflow, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.pane_id),
    ["w1:p1", "w1:p2"],
  );
});

test("protects focused and unsafe agent states", () => {
  const panes = [
    pane("w1:p1", "working"),
    pane("w1:p2", "blocked"),
    pane("w1:p3", "unknown"),
    pane("w1:p4", "idle", { focused: true }),
    pane("w1:p5", "done"),
  ];
  const result = planLruEvictions({
    panes,
    state: stateFor(panes),
    maxActiveTuis: 2,
    protectedPaneId: "w1:p5",
  });

  assert.equal(result.overflow, 3);
  assert.deepEqual(result.candidates, []);
});

test("ignores unmanaged Codex panes and history placeholders", () => {
  const panes = [
    pane("w1:p1", "idle"),
    pane("w1:p2", "idle", { managed: false }),
    pane("w1:p3", "idle", { agent: "codex-history" }),
  ];
  const result = planLruEvictions({
    panes,
    state: stateFor(panes),
    maxActiveTuis: 1,
    protectedPaneId: "w1:p9",
  });

  assert.equal(result.activeCount, 1);
  assert.deepEqual(result.candidates, []);
});

test("recognizes only standalone Codex resume processes for migration", () => {
  const standalone = {
    foreground_processes: [
      {
        name: "codex",
        argv0: "/home/user/.local/bin/codex",
        argv: ["codex", "resume", "--no-alt-screen", "thread1"],
      },
    ],
  };
  const remote = {
    foreground_processes: [
      {
        name: "codex",
        argv0: "/home/user/.local/bin/codex",
        argv: [
          "codex",
          "resume",
          "--remote",
          "unix://",
          "--no-alt-screen",
          "thread1",
        ],
      },
    ],
  };

  assert.equal(isStandaloneCodexTuiProcessInfo(standalone), true);
  assert.equal(isStandaloneCodexTuiProcessInfo(remote), false);
  assert.equal(
    isStandaloneCodexTuiProcessInfo({
      foreground_processes: [{ name: "codex", cmdline: "codex resume thread1" }],
    }),
    false,
  );
});

function pane(
  paneId,
  agentStatus,
  { agent = "codex", focused = false, managed = true } = {},
) {
  const threadId = `thread${paneId.split("p").at(-1)}`;
  return {
    pane_id: paneId,
    agent,
    agent_status: agentStatus,
    focused,
    tokens: managed ? { codex_thread_id: threadId } : {},
  };
}

function stateFor(panes) {
  const threads = {};
  for (const [index, current] of panes.entries()) {
    const threadId = current.tokens.codex_thread_id;
    if (threadId) {
      threads[threadId] = {
        lastFocusedAt: (index + 1) * 1_000,
        recencyAt: (index + 1) * 10_000,
      };
    }
  }
  return { version: 3, projects: {}, threads };
}
