# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.0.4] - 2026-08-29

### Fixed

- 修复 Cursor 3.17+ 应用失败（「workbench.js 无法识别启动入口」）：压缩产物重命名了变量（`t`/`m` → `esModule`/`baseUrl`），启动器锚点由精确字符串匹配改为按结构匹配的正则，兼容后续变量名变化
- 同一根因曾导致首次安装后每次启动反复弹「应用并重启」引导（apply 静默失败，补丁始终未装上）

## [0.0.3] - 2026-08-20

### Fixed

- 修复协议拦截器安装时序：`cursorTranslatorMain.js` 在 `import main.js` 之前同步劫持，避免 workbench 翻译副本未加载
- 修复 Cursor 3.16+ workbench 通过 ESM `import()` 加载、协议拦截失效的问题（改 `workbench.js` 加载 `*_translated.js`）
- 抑制「Your Cursor installation appears to be corrupt」启动提示（汉化补丁触发的完整性校验误报）
- 增强 `cursor.inject.js`：强制 open Shadow DOM、扩展 Settings/菜单选择器、运行时 `window.__cursorZhPatch` 自检

### Added

- 补全 Settings 多页汉化：General / Profile / Appearance / Code Intelligence / Worktrees / Plan & Usage / Browser & Network 等
- 新建 `profile.i18n.json`、`appearance.i18n.json`、`worktrees.i18n.json` 词典模块
- 新建 `agent/agents-window.i18n.json`，覆盖 Agent Window 菜单与侧栏词条
- 词典条目增至 1300+，apply 成功后输出 Console 自检说明

## [0.0.2] - 2026-06-20

### Fixed

- 修复正常退出 / Reload Window 时误 revert 补丁，导致 Settings 仍英文且每次启动重复弹重启提示
- 卸载扩展时仍自动 revert 并冷重启

## [0.0.1] - 2026-06-20

### Added

- Cursor 专有界面简体中文汉化扩展（Settings、Agent、Composer、Review、确认对话框等）
- 补丁引擎 `patch-core` 与 CLI（apply / revert / status / doctor）
- 扩展内命令：应用汉化、恢复英文、查看状态、环境诊断
- 卸载或禁用时自动 revert 补丁并冷重启 Cursor
- Windows 冷重启 schtasks 看门狗方案
- 词典 SSOT（`translations/**/*.i18n.json`）与构建校验工具链
- GitHub Actions CI（build / validate:i18n / test）

[0.0.3]: https://github.com/ggbdpq/cursor-loc/releases/tag/v0.0.3
[0.0.2]: https://github.com/ggbdpq/cursor-loc/releases/tag/v0.0.2
[0.0.1]: https://github.com/ggbdpq/cursor-loc/releases/tag/v0.0.1
