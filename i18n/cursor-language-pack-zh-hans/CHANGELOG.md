# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.0.8] - 2026-08-20

### Fixed

- 修复协议拦截器安装时序：`cursorTranslatorMain.js` 在 `import main.js` 之前同步劫持，避免 workbench 翻译副本未加载
- 修复 `patchStale` 变量声明顺序导致的 TypeScript 编译错误
- 增强 `cursor.inject.js`：强制 open Shadow DOM、MutationObserver、始终扫描 `document.body`、运行时 `window.__cursorZhPatch` 自检
- `npm run apply` 改为完整 `npm run build`，确保 patch-core 与词典同步写入安装目录
- status 增加补丁元数据对比与 DOM 注入脚本检测，提示过期补丁

### Added

- 新建 `agent/agents-window.i18n.json`，覆盖 Agent Window 侧栏、并行/云端/工作树、用量提示等词条
- 扩展 Settings / Composer / Customize / Git PR 等模块近 2–3 个月新增英文词条
- apply 成功后输出写入路径与 Console 自检说明

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

[0.0.8]: https://github.com/ggbdpq/cursor-loc/releases/tag/v0.0.8
[0.0.2]: https://github.com/ggbdpq/cursor-loc/releases/tag/v0.0.2
[0.0.1]: https://github.com/ggbdpq/cursor-loc/releases/tag/v0.0.1
