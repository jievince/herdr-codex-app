# Herdr Codex App

[English](README.md) | 简体中文

**在 Herdr 原生工作区和标签页中浏览并恢复 Codex 对话。**

Herdr 内置的 Codex integration 负责识别正在运行的 Codex Agent。本插件把
已保存的 Codex 对话历史加入 Herdr 原生导航：

- 每个精确的项目目录对应一个工作区；
- 每个已索引的 Codex 对话对应一个标签页；
- 聚焦前只保留轻量历史占位；
- 聚焦标签页时通过共享 Codex app server 按需恢复；
- 用软 LRU 限制正在运行的 Codex TUI 数量。

## 界面效果

```text
+ HERDR ---------------------------------------------------------------+
| 工作区 / 项目                | 当前工作区：project-1                   |
|                             |                                        |
| > project-1                 | 标签页                                 |
|   project-2                 | [功能*] [测试：历史]                     |
|   herdr-codex-app           | [编写文档：历史]                        |
|                             +----------------------------------------+
| AGENT                       | 当前窗格                                |
|                             |                                        |
| Codex          工作中       | Codex                                  |
| Codex history  空闲         | 状态：工作中                            |
| Codex history  空闲         | cwd: ~/project-1                       |
|                             |                                        |
|                             | > 实现这个功能……                        |
+---------------------------------------------------------------------+

  Codex 项目目录 -> Herdr 工作区
  已保存的对话   -> 工作区标签页
  聚焦历史标签页 -> 恢复对应的 Codex TUI
  超过 TUI 上限  -> 停放最近最少使用且安全的 TUI
```

实际颜色和尺寸由用户的 Herdr 主题及终端决定。

## 环境要求

- Herdr 0.7.5 或更新版本；
- Linux；
- Node.js 20 或更新版本；
- Codex CLI 0.146.0 或更新版本。

安装前会检查 Node.js 和 Codex CLI 版本。Codex CLI 0.146.0 是本项目验证过
的最旧版本。

## 安装

先安装 Herdr 的 Codex integration：

```bash
herdr integration install codex
herdr plugin install jievince/herdr-codex-app
herdr plugin action invoke jievince.herdr-codex-app.sync
```

首次需要显式刷新。Herdr 的 startup hook 只会在 server 启动或 live handoff
后运行，不会因为 `plugin install` 或 `plugin link` 完成而立即运行。

刷新后打开 Herdr 工作区浏览器，进入插件生成的项目工作区，再聚焦历史标签页
即可恢复对应对话。

## 配置

查询插件配置目录：

```bash
herdr plugin config-dir jievince.herdr-codex-app
```

在该目录创建 `config.json`。所有字段均可省略：

```json
{
  "maxIndexedChats": 40,
  "maxIndexedChatsPerProject": 8,
  "maxActiveTuis": 8,
  "codexRemoteEndpoint": "unix://",
  "sourceKinds": ["cli", "vscode", "appServer"]
}
```

| 字段 | 默认值 | 作用 |
| --- | ---: | --- |
| `maxIndexedChats` | `40` | 所有项目最多展示的近期对话数。 |
| `maxIndexedChatsPerProject` | `8` | 单个精确项目目录最多展示的近期对话数。 |
| `maxActiveTuis` | `8` | 正在运行的受管 Codex TUI 软上限。 |
| `codexRemoteEndpoint` | `"unix://"` | 传给 `codex resume --remote` 的端点。 |
| `sourceKinds` | `["cli", "vscode", "appServer"]` | 请求 `thread/list` 时使用的交互式 Codex thread 来源。 |

每次 startup hook、刷新动作和焦点事件都会重新读取配置。修改历史数量或
source kinds 后执行一次刷新；LRU 和端点修改会在下一个相关焦点事件生效。

JSON 格式错误会明确失败。不是正整数的数量限制、空端点，以及空数组或
非数组的 `sourceKinds` 会使用文档中的默认值。

### 活跃 TUI LRU

TUI 上限是刻意设计的软限制：

- 永不停止当前聚焦的窗格；
- 永不停止 `working`、`blocked` 或 `unknown` Codex TUI；
- 只选择未聚焦且状态为 `idle` 或 `done` 的受管 TUI；
- 停放时发送 `/quit`，等待 TUI 退出，再恢复历史占位。

如果没有更多 TUI 可以安全停放，插件会报告剩余超量，不会杀死繁忙或身份不明
的进程。

## 安全与隐私

插件修改的是 Herdr 导航，不是 Codex 历史：

- 按精确项目目录创建或复用工作区；
- 只拥有带有自身 metadata 的标签页和占位；
- 清理前立即重新验证所有权、窗格数量、焦点和 thread ID；
- 永不关闭用户标签页或仍运行 Codex TUI 的标签页；
- 永不修改或删除 Codex transcript。

插件状态包含本地项目路径、Codex thread ID、对话标题、Herdr ID，以及聚焦/
停放时间戳，不保存对话 transcript。配置和状态均位于 Herdr 为本插件分配的
独立目录。

## 已知边界

插件只能安全恢复和管理带有精确 `codex_thread_id` 的窗格；由插件索引的历史
标签页始终具有该 metadata。

全新启动的独立 `codex` TUI 不会在进程参数中暴露新 thread ID。在 Herdr
获得精确 thread metadata 前，插件不会接管该窗格。带有精确 metadata 的旧式
`codex resume <thread-id>` 进程，只有在 `idle` 或 `done` 状态下才会迁移到
共享 app server。

## 开发

```bash
npm ci
npm run check
npm test
npm run preflight
```

测试只使用临时目录和假的 Herdr/Codex 可执行文件，不会修改正在运行的 Herdr
session。发布流程见 [RELEASING.md](RELEASING.md)。

## 许可证

Apache-2.0，详见 [LICENSE](LICENSE)。
