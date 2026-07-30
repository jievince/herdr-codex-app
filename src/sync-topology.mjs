import {
  MANAGED_TAB_TOKEN,
  THREAD_TOKEN,
} from "./constants.mjs";
import { normalizeCwd } from "./lib.mjs";

export function loadTopology(runHerdr) {
  const workspaceResponse = runHerdr(["workspace", "list"]);
  const workspaces = workspaceResponse?.result?.workspaces || [];
  const topology = {
    workspaces: [],
    workspacesById: new Map(),
    tabsById: new Map(),
    panesById: new Map(),
  };

  for (const workspaceInfo of workspaces) {
    const tabResponse = runHerdr([
      "tab",
      "list",
      "--workspace",
      workspaceInfo.workspace_id,
    ]);
    const paneResponse = runHerdr([
      "pane",
      "list",
      "--workspace",
      workspaceInfo.workspace_id,
    ]);
    const workspace = {
      ...workspaceInfo,
      tabs: tabResponse?.result?.tabs || [],
      panes: paneResponse?.result?.panes || [],
      identityCwd: null,
      createdRoot: null,
    };
    workspace.identityCwd = workspaceIdentityCwd(workspace);
    topology.workspaces.push(workspace);
    topology.workspacesById.set(workspace.workspace_id, workspace);
    for (const tab of workspace.tabs) {
      topology.tabsById.set(tab.tab_id, tab);
    }
    for (const pane of workspace.panes) {
      topology.panesById.set(pane.pane_id, pane);
    }
  }
  return topology;
}

export function findThreadPlacement(topology, threadId) {
  for (const pane of topology.panesById.values()) {
    if (
      pane.tokens?.[THREAD_TOKEN] === threadId ||
      (pane.agent_session?.agent === "codex" &&
        pane.agent_session.value === threadId)
    ) {
      const placement = placementForPane(topology, pane);
      if (placement) {
        return placement;
      }
    }
  }

  // A stored pane id is not ownership proof because users can repurpose panes.
  return null;
}

export function placementForPane(topology, pane) {
  const tab = topology.tabsById.get(pane.tab_id);
  const workspace = topology.workspacesById.get(pane.workspace_id);
  if (!tab || !workspace) {
    return null;
  }
  return { pane, tab, workspace };
}

export function placementIsManaged(topology, stored, placement) {
  if (
    stored?.managedTab === true &&
    samePlacement(stored, {
      paneId: placement.pane.pane_id,
      tabId: placement.tab.tab_id,
      workspaceId: placement.workspace.workspace_id,
    })
  ) {
    return true;
  }
  if (placement.pane.tokens?.[MANAGED_TAB_TOKEN] === "1") {
    return true;
  }
  return false;
}

export function panesForTab(topology, tabId) {
  return [...topology.panesById.values()].filter(
    (pane) => pane.tab_id === tabId,
  );
}

export function samePlacement(left, right) {
  if (!left || !right) {
    return false;
  }
  return (
    left.workspaceId === right.workspaceId &&
    left.tabId === right.tabId &&
    left.paneId === right.paneId
  );
}

function workspaceIdentityCwd(workspace) {
  if (workspace.worktree?.checkout_path) {
    return normalizeCwd(workspace.worktree.checkout_path);
  }

  const firstTab = [...workspace.tabs].sort(
    (left, right) => left.number - right.number,
  )[0];
  const candidates = firstTab
    ? workspace.panes.filter((pane) => pane.tab_id === firstTab.tab_id)
    : workspace.panes;
  const firstPane = [...candidates].sort((left, right) =>
    left.pane_id.localeCompare(right.pane_id, undefined, { numeric: true }),
  )[0];
  return normalizeCwd(firstPane?.cwd);
}
