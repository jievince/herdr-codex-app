import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeSynchronizedState,
  synchronizeThreadTopology,
} from "../src/sync-core.mjs";
import { createFakeHerdr, userWorkspace } from "./helpers/fake-herdr.mjs";

const config = {
  maxIndexedChats: 40,
  maxIndexedChatsPerProject: 8,
};

test("first sync groups threads by cwd and creates lazy placeholders", () => {
  const fake = createFakeHerdr();
  const result = sync(fake, [
    thread("a1", "/project/a", 300),
    thread("a2", "/project/a", 200),
    thread("b1", "/project/b", 100),
  ]);

  assert.equal(result.createdProjects, 2);
  assert.equal(result.createdTabs, 1);
  assert.equal(fake.state.workspaces.length, 2);
  assert.equal(fake.state.tabs.length, 3);
  assert.equal(fake.state.panes.length, 3);
  assert.ok(fake.state.panes.every((pane) => pane.agent === "codex-history"));
  assert.ok(
    fake.state.panes.every(
      (pane) => pane.tokens.herdr_codex_app_managed_tab === "1",
    ),
  );
  assert.deepEqual(Object.keys(result.finalState.threads).sort(), [
    "a1",
    "a2",
    "b1",
  ]);
});

test("repeated sync is idempotent", () => {
  const fake = createFakeHerdr();
  const threads = [
    thread("a1", "/project/a", 300),
    thread("a2", "/project/a", 200),
  ];
  const first = sync(fake, threads);
  const callOffset = fake.calls.length;
  const second = sync(fake, threads, first.finalState);
  const newCalls = fake.calls.slice(callOffset);

  assert.equal(second.createdProjects, 0);
  assert.equal(second.createdTabs, 0);
  assert.equal(second.prunedTabs, 0);
  assert.equal(second.prunedWorkspaces, 0);
  assert.equal(
    newCalls.some(
      (args) =>
        (args[0] === "workspace" || args[0] === "tab") &&
        args[1] === "create",
    ),
    false,
  );
  assert.equal(fake.state.tabs.length, 2);
});

test("reuses a project workspace without taking ownership of its user tab", () => {
  const fake = createFakeHerdr(userWorkspace());
  const result = sync(fake, [thread("a1", "/project/a", 100)]);

  assert.equal(result.createdProjects, 0);
  assert.equal(result.createdTabs, 1);
  assert.equal(fake.state.tabs.length, 2);
  assert.equal(fake.state.panes.find((pane) => pane.pane_id === "w1:p1").agent, null);
  assert.equal(result.finalState.projects["/project/a"].managed, false);
  assert.equal(result.finalState.threads.a1.managedTab, true);
});

test("prunes stale managed tabs and converges to maxIndexedChats", () => {
  const fake = createFakeHerdr();
  const first = sync(fake, [
    thread("a1", "/project/a", 300),
    thread("a2", "/project/a", 200),
    thread("a3", "/project/a", 100),
  ]);
  const second = sync(
    fake,
    [thread("a1", "/project/a", 300)],
    first.finalState,
    { ...config, maxIndexedChats: 1 },
  );

  assert.equal(second.prunedTabs, 2);
  assert.equal(second.prunedWorkspaces, 0);
  assert.deepEqual(Object.keys(second.finalState.threads), ["a1"]);
  assert.equal(fake.state.tabs.length, 1);
});

test("closes an entirely stale plugin-owned workspace", () => {
  const fake = createFakeHerdr();
  const first = sync(fake, [thread("a1", "/project/a", 100)]);
  const second = sync(fake, [], first.finalState);

  assert.equal(second.prunedWorkspaces, 1);
  assert.equal(fake.state.workspaces.length, 0);
  assert.deepEqual(second.finalState.threads, {});
  assert.deepEqual(second.finalState.projects, {});
});

test("retains a stale live Codex pane until a later safe sync", () => {
  const fake = createFakeHerdr();
  const first = sync(fake, [thread("a1", "/project/a", 100)]);
  fake.state.panes[0].agent = "codex";
  fake.state.panes[0].agent_status = "working";
  const second = sync(fake, [], first.finalState);

  assert.equal(second.prunedWorkspaces, 0);
  assert.equal(second.retainedStale, 1);
  assert.ok(second.finalState.threads.a1);
  assert.equal(fake.state.workspaces.length, 1);
});

test("removes only the managed history tab from a reused workspace", () => {
  const fake = createFakeHerdr(userWorkspace());
  const first = sync(fake, [thread("a1", "/project/a", 100)]);
  const second = sync(fake, [], first.finalState);

  assert.equal(second.prunedTabs, 1);
  assert.equal(fake.state.workspaces.length, 1);
  assert.deepEqual(fake.state.tabs.map((tab) => tab.tab_id), ["w1:t1"]);
  assert.deepEqual(fake.state.panes.map((pane) => pane.pane_id), ["w1:p1"]);
});

test("missing directories do not consume the global chat limit", () => {
  const fake = createFakeHerdr();
  const result = sync(
    fake,
    [
      thread("missing", "/missing", 200),
      thread("valid", "/project/a", 100),
    ],
    undefined,
    { ...config, maxIndexedChats: 1 },
    (cwd) => cwd !== "/missing",
  );

  assert.equal(result.skippedMissingDirectories, 1);
  assert.deepEqual(Object.keys(result.finalState.threads), ["valid"]);
});

test("revalidation prevents closing a pane focused during sync", () => {
  const fake = createFakeHerdr();
  const first = sync(fake, [thread("a1", "/project/a", 100)]);
  let changed = false;
  fake.setBeforeCommand((args, state) => {
    if (
      !changed &&
      args[0] === "pane" &&
      args[1] === "get" &&
      args[2] === state.panes[0].pane_id
    ) {
      state.panes[0].focused = true;
      changed = true;
    }
  });
  const second = sync(fake, [], first.finalState);

  assert.equal(second.prunedWorkspaces, 0);
  assert.equal(second.prunedTabs, 0);
  assert.equal(second.retainedStale, 1);
  assert.ok(second.finalState.threads.a1);
});

test("state merge preserves concurrent focus updates and new records", () => {
  const initial = {
    version: 3,
    projects: {
      "/project/a": { workspaceId: "w1", managed: true },
    },
    threads: {
      a1: {
        cwd: "/project/a",
        workspaceId: "w1",
        tabId: "w1:t1",
        paneId: "w1:p1",
        lastFocusedAt: 10,
      },
    },
  };
  const current = structuredClone(initial);
  current.threads.a1.lastFocusedAt = 50;
  current.threads.concurrent = {
    workspaceId: "w2",
    tabId: "w2:t1",
    paneId: "w2:p1",
    lastFocusedAt: 60,
  };
  const synchronized = {
    finalState: {
      version: 3,
      projects: structuredClone(initial.projects),
      threads: {
        a1: { ...initial.threads.a1, lastFocusedAt: 10 },
      },
    },
  };

  mergeSynchronizedState(current, initial, synchronized);

  assert.equal(current.threads.a1.lastFocusedAt, 50);
  assert.equal(current.threads.concurrent.lastFocusedAt, 60);
});

test("state merge preserves a record concurrently moved to another pane", () => {
  const initial = {
    version: 3,
    projects: {},
    threads: {
      a1: {
        workspaceId: "w1",
        tabId: "w1:t1",
        paneId: "w1:p1",
      },
    },
  };
  const current = structuredClone(initial);
  current.threads.a1 = {
    workspaceId: "w2",
    tabId: "w2:t1",
    paneId: "w2:p1",
  };
  const synchronized = {
    finalState: { version: 3, projects: {}, threads: {} },
  };

  mergeSynchronizedState(current, initial, synchronized);

  assert.deepEqual(current.threads.a1, {
    workspaceId: "w2",
    tabId: "w2:t1",
    paneId: "w2:p1",
  });
});

function sync(
  fake,
  allThreads,
  initialState = { version: 3, projects: {}, threads: {} },
  selectedConfig = config,
  directoryExists = () => true,
) {
  return synchronizeThreadTopology({
    allThreads,
    config: selectedConfig,
    initialState,
    runHerdr: fake.run,
    reportPlaceholder: (paneId) =>
      fake.run([
        "pane",
        "report-agent",
        paneId,
        "--source",
        "test",
        "--agent",
        "codex-history",
        "--state",
        "idle",
      ]),
    directoryExists,
  });
}

function thread(id, cwd, recencyAt) {
  return {
    id,
    cwd,
    recencyAt,
    name: `Thread ${id}`,
    source: "cli",
  };
}
