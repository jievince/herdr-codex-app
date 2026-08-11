export function createFakeHerdr(initial = {}) {
  const state = structuredClone({
    workspaces: initial.workspaces || [],
    tabs: initial.tabs || [],
    panes: initial.panes || [],
  });
  const calls = [];
  let nextWorkspace = nextNumber(state.workspaces, "workspace_id");
  let nextTab = nextNumber(state.tabs, "tab_id");
  let nextPane = nextNumber(state.panes, "pane_id");
  let beforeCommand = null;

  function run(args) {
    calls.push([...args]);
    beforeCommand?.(args, state);
    const [group, command] = args;

    if (group === "workspace" && command === "list") {
      return response({ workspaces: state.workspaces });
    }
    if (group === "workspace" && command === "get") {
      return response({
        workspace:
          state.workspaces.find((item) => item.workspace_id === args[2]) || null,
      });
    }
    if (group === "workspace" && command === "create") {
      const cwd = valueAfter(args, "--cwd");
      const workspaceId = `w${nextWorkspace++}`;
      const tabId = `${workspaceId}:t${nextTab++}`;
      const paneId = `${workspaceId}:p${nextPane++}`;
      const workspace = {
        workspace_id: workspaceId,
        label: valueAfter(args, "--label"),
        tokens: {},
      };
      const tab = {
        tab_id: tabId,
        workspace_id: workspaceId,
        label: "shell",
        number: 1,
      };
      const pane = {
        pane_id: paneId,
        workspace_id: workspaceId,
        tab_id: tabId,
        cwd,
        label: "shell",
        focused: false,
        agent: null,
        agent_status: "unknown",
        tokens: {},
      };
      state.workspaces.push(workspace);
      state.tabs.push(tab);
      state.panes.push(pane);
      return response({ workspace, tab, root_pane: pane });
    }
    if (group === "workspace" && command === "report-metadata") {
      const workspace = requireItem(
        state.workspaces,
        "workspace_id",
        args[2],
      );
      applyTokens(workspace, args);
      return response({});
    }
    if (group === "workspace" && command === "close") {
      const workspaceId = args[2];
      state.workspaces = state.workspaces.filter(
        (item) => item.workspace_id !== workspaceId,
      );
      state.tabs = state.tabs.filter(
        (item) => item.workspace_id !== workspaceId,
      );
      state.panes = state.panes.filter(
        (item) => item.workspace_id !== workspaceId,
      );
      return response({});
    }
    if (group === "tab" && command === "list") {
      const workspaceId = valueAfter(args, "--workspace");
      return response({
        tabs: state.tabs.filter((item) => item.workspace_id === workspaceId),
      });
    }
    if (group === "tab" && command === "get") {
      return response({
        tab: state.tabs.find((item) => item.tab_id === args[2]) || null,
      });
    }
    if (group === "tab" && command === "create") {
      const workspaceId = valueAfter(args, "--workspace");
      const tabId = `${workspaceId}:t${nextTab++}`;
      const paneId = `${workspaceId}:p${nextPane++}`;
      const tab = {
        tab_id: tabId,
        workspace_id: workspaceId,
        label: valueAfter(args, "--label"),
        number:
          state.tabs.filter((item) => item.workspace_id === workspaceId).length +
          1,
      };
      const pane = {
        pane_id: paneId,
        workspace_id: workspaceId,
        tab_id: tabId,
        cwd: valueAfter(args, "--cwd"),
        label: "shell",
        focused: false,
        agent: null,
        agent_status: "unknown",
        tokens: {},
      };
      state.tabs.push(tab);
      state.panes.push(pane);
      return response({ tab, root_pane: pane });
    }
    if (group === "tab" && command === "rename") {
      requireItem(state.tabs, "tab_id", args[2]).label = args[3];
      return response({});
    }
    if (group === "tab" && command === "close") {
      const tabId = args[2];
      state.tabs = state.tabs.filter((item) => item.tab_id !== tabId);
      state.panes = state.panes.filter((item) => item.tab_id !== tabId);
      return response({});
    }
    if (group === "pane" && command === "list") {
      const workspaceId = valueAfter(args, "--workspace");
      return response({
        panes: state.panes.filter((item) => item.workspace_id === workspaceId),
      });
    }
    if (group === "pane" && command === "get") {
      return response({
        pane: state.panes.find((item) => item.pane_id === args[2]) || null,
      });
    }
    if (group === "pane" && command === "process-info") {
      const paneId = valueAfter(args, "--pane");
      const pane = requireItem(state.panes, "pane_id", paneId);
      const shellPid = 10_000 + Number(paneId.match(/\d+/g)?.at(-1) || 1);
      const foregroundPid = pane.busy ? shellPid + 1 : shellPid;
      return response({
        process_info: {
          pane_id: paneId,
          shell_pid: shellPid,
          foreground_process_group_id: foregroundPid,
          foreground_processes: [
            {
              pid: foregroundPid,
              name: pane.busy ? "test" : "sh",
              argv: [pane.busy ? "test" : "sh"],
              cwd: pane.cwd,
            },
          ],
        },
      });
    }
    if (group === "pane" && command === "rename") {
      requireItem(state.panes, "pane_id", args[2]).label = args[3];
      return response({});
    }
    if (group === "pane" && command === "report-metadata") {
      const pane = requireItem(state.panes, "pane_id", args[2]);
      applyTokens(pane, args);
      const title = valueAfter(args, "--title", false);
      if (title !== undefined) {
        pane.title = title;
      }
      return response({});
    }
    if (group === "pane" && command === "report-agent") {
      const pane = requireItem(state.panes, "pane_id", args[2]);
      pane.agent = valueAfter(args, "--agent");
      pane.agent_status = valueAfter(args, "--state");
      return response({});
    }
    if (group === "pane" && command === "release-agent") {
      const pane = requireItem(state.panes, "pane_id", args[2]);
      pane.agent = null;
      pane.agent_status = "unknown";
      return response({});
    }
    throw new Error(`unsupported fake Herdr command: ${args.join(" ")}`);
  }

  return {
    state,
    calls,
    run,
    setBeforeCommand(callback) {
      beforeCommand = callback;
    },
  };
}

export function userWorkspace(cwd = "/project/a") {
  return {
    workspaces: [{ workspace_id: "w1", label: "a", tokens: {} }],
    tabs: [
      {
        tab_id: "w1:t1",
        workspace_id: "w1",
        label: "shell",
        number: 1,
      },
    ],
    panes: [
      {
        pane_id: "w1:p1",
        workspace_id: "w1",
        tab_id: "w1:t1",
        cwd,
        label: "shell",
        focused: false,
        agent: null,
        agent_status: "unknown",
        tokens: {},
      },
    ],
  };
}

function applyTokens(item, args) {
  item.tokens ||= {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--token") {
      continue;
    }
    const [name, ...value] = args[index + 1].split("=");
    // Match Herdr's metadata token value contract.
    item.tokens[name] = Array.from(value.join("=")).slice(0, 80).join("");
  }
}

function valueAfter(args, flag, required = true) {
  const index = args.indexOf(flag);
  if (index < 0 || index + 1 >= args.length) {
    if (required) {
      throw new Error(`missing ${flag}: ${args.join(" ")}`);
    }
    return undefined;
  }
  return args[index + 1];
}

function requireItem(items, field, value) {
  const item = items.find((candidate) => candidate[field] === value);
  if (!item) {
    throw new Error(`missing fake item ${field}=${value}`);
  }
  return item;
}

function response(result) {
  return { result: structuredClone(result) };
}

function nextNumber(items, field) {
  const maximum = items.reduce((current, item) => {
    const matches = String(item[field]).match(/\d+/g);
    const candidate = matches ? Number(matches.at(-1)) : 0;
    return Math.max(current, candidate);
  }, 0);
  return maximum + 1;
}
