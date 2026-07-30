# Herdr Codex App

[English](README.md) | 简体中文

**自动把最近活跃的 Codex 会话和项目同步到 [Herdr](https://herdr.dev)。**

插件读取最近活跃的 Codex 会话，并将它们加入 Herdr：

- 每个精确的项目目录对应一个 Herdr workspace；
- 每个 Codex 会话对应该 workspace 中的一个 tab；
- 聚焦会话 tab，即可恢复对应的 Codex TUI。

## 界面效果

```text
┌ Herdr ──────────────────────┬───────────────────────────────────────────┐
│ spaces                      │ < [Fix login] | Add tests | Update docs > │
│                             ├───────────────────────────────────────────┤
│ ● project-1                 │                                           │
│   main                      │                                           │
│ ○ project-2                 │                 Codex TUI                 │
│   feature/search            │                                           │
│ ○ project-3                 │  Focus a chat tab to resume it.           │
│   main                      │                                           │
│ ○ project-4                 │                                           │
│   release                   │                                           │
│ ○ project-5                 │                                           │
│   docs                      │                                           │
│                             │                                           │
│ agents             priority │                                           │
│ > project-1        working  │                                           │
│   Fix login...     focused  │                                           │
│ ✓ project-1           idle  │                                           │
│   Add tests...              │                                           │
│ ✓ project-1           idle  │                                           │
│   Update docs...            │                                           │
│ ✓ project-2           idle  │                                           │
│   Improve search...         │                                           │
│ ! project-3        blocked  │                                           │
│   Refactor cache...         │                                           │
│ ✓ project-4           idle  │                                           │
│   Prepare release...        │                                           │
│ ✓ project-5           idle  │                                           │
│   Review docs...            │                                           │
└─────────────────────────────┴───────────────────────────────────────────┘
```

项目显示在 `spaces`，会话显示为顶部 tab 和 `agents` 条目，选中的会话运行在
右侧主 pane。`>` 和 `[Fix login]` 表示当前聚焦的会话，`working` 和
`blocked` 展示非空闲会话。历史 tab 在聚焦前只占用轻量资源。

## 安装与首次同步

需要 Linux、Herdr 0.7.5+、Node.js 20+ 和 Codex CLI 0.146.0+。

如果 Herdr 已经在运行，请执行：

```bash
herdr integration install codex
herdr plugin install jievince/herdr-codex-app && \
  herdr plugin action invoke jievince.herdr-codex-app.sync
```

第二条命令会安装插件并立即完成首次同步，不需要重启 Herdr。

如果 Herdr 尚未运行，安装插件时去掉 `&& ...sync` 后缀；首次启动 Herdr 时会
自动完成首次同步。

Herdr 0.7.5 不会在运行中的 server 安装插件后执行插件的 startup hook。如果
漏掉了显式首次同步，下一次 pane 聚焦也会自动请求同步。

## 使用

1. 打开 Herdr 的 workspace 浏览器。
2. 选择项目对应的 workspace。
3. 聚焦一个 Codex 会话 tab，即可恢复该会话。

插件会在以下时机自动后台同步：

- Herdr server 启动时；
- 尚无成功同步记录时，在 pane 聚焦后补做一次。

也可以随时执行 **Sync recent Codex chats**：

```bash
herdr plugin action invoke jievince.herdr-codex-app.sync
```

如果同一会话已经在其他 pane 中运行，插件会直接聚焦那个 pane，不会重复启动
第二个 TUI。

## 配置

查询配置目录：

```bash
herdr plugin config-dir jievince.herdr-codex-app
```

在该目录创建 `config.json`。所有字段都可省略：

```json
{
  "maxIndexedChats": 40,
  "maxIndexedChatsPerProject": 8,
  "maxActiveTuis": 8,
  "codexRemoteEndpoint": "unix://",
  "sourceKinds": ["cli", "vscode", "appServer"]
}
```

| 字段 | 默认值 | 含义 |
| --- | ---: | --- |
| `maxIndexedChats` | `40` | 所有项目保留的最近会话数。 |
| `maxIndexedChatsPerProject` | `8` | 单个精确项目目录保留的最近会话数。 |
| `maxActiveTuis` | `8` | 正在运行的受管 Codex TUI 软上限。 |
| `codexRemoteEndpoint` | `"unix://"` | `codex resume --remote` 使用的端点。 |
| `sourceKinds` | `["cli", "vscode", "appServer"]` | 同步时包含的 Codex 会话来源。 |

### 可选手动同步快捷键

Herdr 0.7.5 的插件 manifest 不能注册默认快捷键。如需使用推荐的
`prefix+Shift+U`，请将以下内容加入 Herdr 的 `config.toml`：

```toml
[[keys.command]]
key = "prefix+shift+u"
type = "plugin_action"
command = "jievince.herdr-codex-app.sync"
description = "sync recent Codex chats"
```

添加后，使用 Herdr 默认的 `prefix+Shift+R` 重新加载一次配置，或执行：

```bash
herdr server reload-config
```

此后按 `prefix+Shift+U` 即会执行 **Sync recent Codex chats**。重新加载
配置只负责让快捷键生效，不会执行同步动作。

修改索引数量或会话来源后，请执行一次刷新；其他配置会在下次聚焦会话时生效。

## 补充说明

- 插件保存项目路径、会话 ID、标题和 Herdr 位置元数据，但不保存或修改 Codex
  对话原文。
- 活跃 TUI 上限只会停放未聚焦且状态为 `idle` 或 `done` 的受管 TUI；不会终止
  工作中、阻塞、已聚焦或状态未知的进程。
- JSON 格式错误会明确失败；字段值无效时使用文档中的默认值。

## 开发

```bash
npm ci
npm run check
npm test
npm run preflight
```

发布检查清单见 [RELEASING.md](RELEASING.md)。

## 许可证

Apache-2.0，详见 [LICENSE](LICENSE)。
