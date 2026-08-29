# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.0.4] - 2026-08-29

### Fixed

- 修复 Cursor 3.17+ 应用失败（「workbench.js 无法识别启动入口」）：压缩产物重命名了变量（`t`/`m` → `esModule`/`baseUrl`），启动器锚点由精确字符串匹配改为按结构匹配的正则，兼容后续变量名变化
- 修复首次安装后每次启动反复弹「应用并重启」引导（同一根因：apply 静默失败，补丁始终未装上）；同一 Cursor 版本内 apply 失败后不再重复弹窗
- 真正抑制「Your Cursor installation appears to be corrupt」启动提示（0.0.3 曾误记已修复）：apply 时同步更新 product.json 中启动器的校验和（IntegrityService 的完整性判定），恢复英文时从备份还原
- apply 写入顺序重排（先写翻译副本/拦截器等无害产物，最后才翻转启动入口）+ 任一步失败自动回滚到入刀前状态，杜绝「半补丁」状态导致 Cursor 无法启动

### Added

- 启动时静默自愈：Cursor 升级、补丁丢失或词典过期时自动重新应用并冷重启（元数据现记录 apply 时的 Cursor 版本）；`npm run regression` apply/revert 回归脚本（发版前必跑）
- 词典新增：退出超时对话框（Quitting the application is taking a bit longer... / 仍然退出等）、损坏提示词条兜底、Connected to Browser Tab、Loading Chat、下拉选项 High/Medium/Low
- 补充 Settings 漏译：自动批准模式切换、审查提供方（Graphite 新旧两种文案）、警告通知的描述
- 清理词典 10 处历史冲突/重复（validate:i18n 自迁移 JSON 后一直失败），统一为 MERGE_ORDER 运行时实际生效的译文，CI 转绿

> 版本约定：同一天内的多次修改统一使用当日同一个版本号。

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
