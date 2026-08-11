import {
  MANAGED_TAB_TOKEN,
  PLACEHOLDER_AGENT,
  PROJECT_TOKEN,
  THREAD_TOKEN,
} from "./constants.mjs";
import {
  normalizeCwd,
  projectCwdToken,
} from "./lib.mjs";

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

export function findThreadPlacements(topology, threadId, cwd = null) {
  const placements = [];
  for (const pane of topology.panesById.values()) {
    if (
      pane.tokens?.[THREAD_TOKEN] === threadId ||
      (pane.agent_session?.agent === "codex" &&
        pane.agent_session.value === threadId)
    ) {
      const placement = placementForPane(topology, pane);
      if (placement && (!cwd || placementMatchesCwd(placement, cwd))) {
        placements.push(placement);
      }
    }
  }
  return placements;
}

export function findThreadPlacement(
  topology,
  threadId,
  cwd = null,
  preferred = null,
) {
  const placements = findThreadPlacements(topology, threadId, cwd);
  if (preferred) {
    const exact = placements.find((placement) =>
      samePlacement(preferred, placementRecord(placement)),
    );
    if (exact) {
      return exact;
    }
  }
  return placements[0] || null;
}

export function findStoredThreadPlacement(topology, stored) {
  if (stored?.managedTab !== true || !stored.title || !stored.cwd) {
    return null;
  }
  const pane = topology.panesById.get(stored.paneId);
  const placement = pane ? placementForPane(topology, pane) : null;
  if (
    !placement ||
    !samePlacement(stored, placementRecord(placement)) ||
    !placementMatchesCwd(placement, stored.cwd) ||
    placement.tab.label !== stored.title ||
    placement.pane.label !== "Codex" ||
    panesForTab(topology, stored.tabId).length !== 1 ||
    paneHasAnotherAgent(placement.pane)
  ) {
    return null;
  }

  // Persisted IDs are accepted only with the full durable topology signature.
  return placement;
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

export function placementMatchesCwd(placement, cwd) {
  const expected = normalizeCwd(cwd);
  const workspaceCwd = normalizeCwd(placement.workspace.identityCwd);
  const paneCwd = normalizeCwd(placement.pane.cwd);
  return (
    expected !== null &&
    workspaceCwd === expected &&
    paneCwd === expected &&
    workspaceTokenMatchesCwd(placement.workspace, expected)
  );
}

export function workspaceMatchesCwd(workspace, cwd) {
  const expected = normalizeCwd(cwd);
  const identityCwd = normalizeCwd(workspace.identityCwd);
  return (
    expected !== null &&
    identityCwd === expected &&
    workspaceTokenMatchesCwd(workspace, expected)
  );
}

function workspaceTokenMatchesCwd(workspace, cwd) {
  const token = workspace.tokens?.[PROJECT_TOKEN];
  if (!token) {
    return true;
  }
  if (!String(token).startsWith("sha256:")) {
    // Herdr truncated legacy raw-cwd tokens at 80 characters.
    return true;
  }
  return token === projectCwdToken(cwd);
}

function placementRecord(placement) {
  return {
    workspaceId: placement.workspace.workspace_id,
    tabId: placement.tab.tab_id,
    paneId: placement.pane.pane_id,
  };
}

function paneHasAnotherAgent(pane) {
  const agents = [pane.agent, pane.agent_session?.agent].filter(Boolean);
  return agents.some((agent) => agent !== PLACEHOLDER_AGENT);
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
