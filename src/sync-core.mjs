import fs from "node:fs";

import {
  MANAGED_TAB_TOKEN,
  MANAGED_TOKEN,
  METADATA_SOURCE,
  PLACEHOLDER_AGENT,
  THREAD_TOKEN,
} from "./constants.mjs";
import {
  normalizeCwd,
  projectLabel,
  threadTitle,
} from "./lib.mjs";
import {
  classifyStaleThreads,
  projectStateForThreads,
  pruneSafeStalePlaceholders,
  retainedThreadRecord,
} from "./sync-cleanup.mjs";
import {
  findThreadPlacement,
  loadTopology,
  placementIsManaged,
  samePlacement,
} from "./sync-topology.mjs";

export function synchronizeThreadTopology({
  allThreads,
  config,
  initialState,
  runHerdr,
  reportPlaceholder,
  directoryExists = isDirectory,
}) {
  const topology = loadTopology(runHerdr);
  const usedLabels = new Set(
    topology.workspaces.map((workspace) => workspace.label),
  );
  const { selected, skippedMissingDirectories } = selectRecentThreads(
    allThreads,
    config,
    directoryExists,
  );
  const indexed = indexSelectedThreads({
    selected,
    topology,
    initialState,
    usedLabels,
    runHerdr,
    reportPlaceholder,
  });
  const stale = classifyStaleThreads({
    topology,
    initialState,
    selectedIds: new Set(selected.map((thread) => thread.id)),
  });
  const cleanup = pruneSafeStalePlaceholders({
    topology,
    stale,
    runHerdr,
  });
  retainUnsafeStaleThreads(indexed.finalThreads, stale, cleanup.removedThreadIds);
  const projects = projectStateForThreads({
    finalThreads: indexed.finalThreads,
    initialState,
    topology,
  });

  return {
    finalState: {
      version: 3,
      projects,
      threads: indexed.finalThreads,
    },
    selectedCount: selected.length,
    createdProjects: indexed.createdProjects,
    createdTabs: indexed.createdTabs,
    updatedTabs: indexed.updatedTabs,
    skippedMissingDirectories,
    prunedTabs: cleanup.prunedTabs,
    prunedWorkspaces: cleanup.prunedWorkspaces,
    removedThreadIds: cleanup.removedThreadIds,
    retainedStale: stale.filter(
      (item) => !cleanup.removedThreadIds.has(item.threadId),
    ).length,
  };
}

export function mergeSynchronizedState(current, initial, synchronized) {
  const desired = synchronized.finalState;
  const initialThreadIds = new Set(Object.keys(initial.threads));

  for (const threadId of initialThreadIds) {
    if (
      !desired.threads[threadId] &&
      samePlacement(current.threads[threadId], initial.threads[threadId])
    ) {
      delete current.threads[threadId];
    }
  }
  for (const [threadId, record] of Object.entries(desired.threads)) {
    const latest = current.threads[threadId] || {};
    current.threads[threadId] = {
      ...record,
      lastFocusedAt: Math.max(
        Number(record.lastFocusedAt) || 0,
        Number(latest.lastFocusedAt) || 0,
      ),
      lastParkedAt: Math.max(
        Number(record.lastParkedAt) || 0,
        Number(latest.lastParkedAt) || 0,
      ),
    };
  }

  for (const [cwd, project] of Object.entries(initial.projects)) {
    if (
      !desired.projects[cwd] &&
      current.projects[cwd]?.workspaceId === project.workspaceId
    ) {
      delete current.projects[cwd];
    }
  }
  for (const [cwd, project] of Object.entries(desired.projects)) {
    current.projects[cwd] = project;
  }
  current.version = 3;
}

export function selectRecentThreads(
  threads,
  config,
  directoryExists = isDirectory,
) {
  const perProject = new Map();
  const selected = [];
  let skippedMissingDirectories = 0;

  for (const thread of threads) {
    if (thread.ephemeral === true) {
      continue;
    }
    const cwd = normalizeCwd(thread.cwd);
    if (!cwd) {
      continue;
    }
    if (!directoryExists(cwd)) {
      skippedMissingDirectories += 1;
      continue;
    }
    const count = perProject.get(cwd) || 0;
    if (count >= config.maxIndexedChatsPerProject) {
      continue;
    }
    perProject.set(cwd, count + 1);
    selected.push(thread);
    if (selected.length >= config.maxIndexedChats) {
      break;
    }
  }
  return { selected, skippedMissingDirectories };
}

function indexSelectedThreads({
  selected,
  topology,
  initialState,
  usedLabels,
  runHerdr,
  reportPlaceholder,
}) {
  const result = {
    finalThreads: {},
    createdProjects: 0,
    createdTabs: 0,
    updatedTabs: 0,
  };
  for (const thread of selected) {
    const indexed =
      indexExistingThread({
        thread,
        topology,
        initialState,
        runHerdr,
        reportPlaceholder,
      }) ||
      indexNewThread({
        thread,
        topology,
        initialState,
        usedLabels,
        runHerdr,
        reportPlaceholder,
      });
    result.finalThreads[thread.id] = indexed.record;
    result.createdProjects += indexed.createdProject ? 1 : 0;
    result.createdTabs += indexed.createdTab ? 1 : 0;
    result.updatedTabs += indexed.updatedTab ? 1 : 0;
  }
  return result;
}

function indexExistingThread({
  thread,
  topology,
  initialState,
  runHerdr,
  reportPlaceholder,
}) {
  const placement = findThreadPlacement(topology, thread.id);
  if (!placement) {
    return null;
  }

  const title = threadTitle(thread);
  let updatedTab = false;
  if (placement.tab.label !== title) {
    runHerdr(["tab", "rename", placement.tab.tab_id, title]);
    placement.tab.label = title;
    updatedTab = true;
  }
  const managedTab = placementIsManaged(
    topology,
    initialState.threads[thread.id],
    placement,
  );
  markPane({
    pane: placement.pane,
    thread,
    title,
    managedTab,
    runHerdr,
    reportPlaceholder,
  });
  return {
    record: threadRecord({
      thread,
      placement,
      managedTab,
      previous: initialState.threads[thread.id],
    }),
    createdProject: false,
    createdTab: false,
    updatedTab,
  };
}

function indexNewThread({
  thread,
  topology,
  initialState,
  usedLabels,
  runHerdr,
  reportPlaceholder,
}) {
  const cwd = normalizeCwd(thread.cwd);
  const title = threadTitle(thread);
  const project = ensureProject({
    topology,
    initialState,
    cwd,
    usedLabels,
    runHerdr,
  });
  const placement = allocateThreadTab(project, title, runHerdr);
  markPane({
    pane: placement.pane,
    thread,
    title,
    managedTab: true,
    runHerdr,
    reportPlaceholder,
  });
  return {
    record: threadRecord({
      thread,
      placement: {
        ...placement,
        workspace: project.workspace,
      },
      managedTab: true,
      previous: initialState.threads[thread.id],
    }),
    createdProject: project.created,
    createdTab: placement.created,
    updatedTab: false,
  };
}

function ensureProject({
  topology,
  initialState,
  cwd,
  usedLabels,
  runHerdr,
}) {
  const storedWorkspace = initialState.projects[cwd]?.workspaceId;
  let workspace = storedWorkspace
    ? topology.workspacesById.get(storedWorkspace)
    : null;
  if (!workspace) {
    workspace = topology.workspaces.find(
      (candidate) =>
        candidate.tokens?.codex_project_cwd === cwd ||
        candidate.identityCwd === cwd,
    );
  }
  if (workspace) {
    return { workspace, created: false };
  }

  const label = projectLabel(cwd, usedLabels);
  const response = runHerdr([
    "workspace",
    "create",
    "--cwd",
    cwd,
    "--label",
    label,
    "--no-focus",
  ]);
  const workspaceInfo = response.result.workspace;
  const tab = response.result.tab;
  const pane = response.result.root_pane;
  workspace = {
    ...workspaceInfo,
    tabs: [tab],
    panes: [pane],
    identityCwd: cwd,
    createdRoot: { tab, pane, used: false },
  };

  reportManagedWorkspace({ workspace, cwd, runHerdr });

  topology.workspaces.push(workspace);
  topology.workspacesById.set(workspace.workspace_id, workspace);
  topology.tabsById.set(tab.tab_id, tab);
  topology.panesById.set(pane.pane_id, pane);
  usedLabels.add(label);
  return { workspace, created: true };
}

function reportManagedWorkspace({ workspace, cwd, runHerdr }) {
  runHerdr([
    "workspace",
    "report-metadata",
    workspace.workspace_id,
    "--source",
    METADATA_SOURCE,
    "--token",
    `${MANAGED_TOKEN}=1`,
    "--token",
    `codex_project_cwd=${cwd}`,
  ]);
  workspace.tokens = {
    ...(workspace.tokens || {}),
    [MANAGED_TOKEN]: "1",
    codex_project_cwd: cwd,
  };
}

function allocateThreadTab(project, title, runHerdr) {
  const workspace = project.workspace;
  if (workspace.createdRoot && !workspace.createdRoot.used) {
    workspace.createdRoot.used = true;
    runHerdr(["tab", "rename", workspace.createdRoot.tab.tab_id, title]);
    workspace.createdRoot.tab.label = title;
    return {
      tab: workspace.createdRoot.tab,
      pane: workspace.createdRoot.pane,
      created: false,
    };
  }

  const response = runHerdr([
    "tab",
    "create",
    "--workspace",
    workspace.workspace_id,
    "--cwd",
    workspace.identityCwd,
    "--label",
    title,
    "--no-focus",
  ]);
  const tab = response.result.tab;
  const pane = response.result.root_pane;
  workspace.tabs.push(tab);
  workspace.panes.push(pane);
  return { tab, pane, created: true };
}

function markPane({
  pane,
  thread,
  title,
  managedTab,
  runHerdr,
  reportPlaceholder,
}) {
  if (pane.label !== "Codex") {
    runHerdr(["pane", "rename", pane.pane_id, "Codex"]);
    pane.label = "Codex";
  }
  const metadataArgs = paneMetadataArgs(pane, thread, title, managedTab);
  runHerdr(metadataArgs);
  pane.tokens = {
    ...(pane.tokens || {}),
    [MANAGED_TOKEN]: "1",
    [THREAD_TOKEN]: thread.id,
    ...(managedTab ? { [MANAGED_TAB_TOKEN]: "1" } : {}),
  };

  // A synthetic idle row keeps indexed chats visible without running a TUI.
  if (!pane.agent && !pane.agent_session) {
    reportPlaceholder(pane.pane_id);
    pane.agent = PLACEHOLDER_AGENT;
    pane.agent_status = "idle";
  }
}

function paneMetadataArgs(pane, thread, title, managedTab) {
  const args = [
    "pane",
    "report-metadata",
    pane.pane_id,
    "--source",
    METADATA_SOURCE,
    "--title",
    title,
    "--display-agent",
    "Codex",
    "--token",
    `${MANAGED_TOKEN}=1`,
    "--token",
    `${THREAD_TOKEN}=${thread.id}`,
    "--token",
    `codex_recency=${String(
      thread.recencyAt || thread.updatedAt || thread.createdAt || 0,
    )}`,
  ];
  if (managedTab) {
    args.push("--token", `${MANAGED_TAB_TOKEN}=1`);
  }
  return args;
}

function threadRecord({ thread, placement, managedTab, previous = {} }) {
  return {
    cwd: normalizeCwd(thread.cwd),
    workspaceId: placement.workspace.workspace_id,
    tabId: placement.tab.tab_id,
    paneId: placement.pane.pane_id,
    title: threadTitle(thread),
    recencyAt: thread.recencyAt || thread.updatedAt || thread.createdAt || 0,
    lastFocusedAt: previous.lastFocusedAt || 0,
    lastParkedAt: previous.lastParkedAt || 0,
    managedTab,
  };
}

function retainUnsafeStaleThreads(finalThreads, stale, removedThreadIds) {
  for (const item of stale) {
    if (!removedThreadIds.has(item.threadId) && item.placement) {
      finalThreads[item.threadId] = retainedThreadRecord(item);
    }
  }
}

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}
