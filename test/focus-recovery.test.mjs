import assert from "node:assert/strict";
import test from "node:test";

import { recoverFocusedHistoryThread } from "../src/focus-recovery.mjs";
import { createFakeHerdr } from "./helpers/fake-herdr.mjs";

const config = { sourceKinds: ["cli"] };

test("recovers a unique legacy history pane by exact cwd and title", async () => {
  const fake = legacyPane();
  const recovered = await recoverFocusedHistoryThread({
    pane: fake.state.panes[0],
    config,
    runHerdr: fake.run,
    listThreads: async () => [thread("thread1")],
  });

  assert.equal(recovered.id, "thread1");
  assert.equal(fake.state.panes[0].tokens.codex_thread_id, "thread1");
  assert.equal(
    fake.state.panes[0].tokens.herdr_codex_app_managed_tab,
    undefined,
  );
});

test("does not recover an ambiguous cwd and title match", async () => {
  const fake = legacyPane();
  const recovered = await recoverFocusedHistoryThread({
    pane: fake.state.panes[0],
    config,
    runHerdr: fake.run,
    listThreads: async () => [thread("thread1"), thread("thread2")],
  });

  assert.equal(recovered, null);
  assert.deepEqual(fake.state.panes[0].tokens, {});
});

test("does not recover a tab containing another pane", async () => {
  const fake = legacyPane();
  fake.state.panes.push({
    ...fake.state.panes[0],
    pane_id: "w1:p2",
  });
  let listed = false;
  const recovered = await recoverFocusedHistoryThread({
    pane: fake.state.panes[0],
    config,
    runHerdr: fake.run,
    listThreads: async () => {
      listed = true;
      return [thread("thread1")];
    },
  });

  assert.equal(recovered, null);
  assert.equal(listed, false);
});

function legacyPane() {
  return createFakeHerdr({
    workspaces: [{ workspace_id: "w1", label: "project", tokens: {} }],
    tabs: [
      {
        tab_id: "w1:t1",
        workspace_id: "w1",
        label: "Introduce project",
        number: 1,
      },
    ],
    panes: [
      {
        pane_id: "w1:p1",
        workspace_id: "w1",
        tab_id: "w1:t1",
        cwd: "/project/a",
        label: "Codex",
        focused: true,
        agent: null,
        agent_status: "unknown",
        tokens: {},
      },
    ],
  });
}

function thread(id) {
  return {
    id,
    cwd: "/project/a",
    name: "Introduce project",
    recencyAt: 100,
  };
}
