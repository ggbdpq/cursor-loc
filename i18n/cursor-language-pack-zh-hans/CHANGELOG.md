# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.0.1] - 2026-06-20

### Added

- Cursor 专有界面简体中文汉化扩展（Settings、Agent、Composer、Review、确认对话框等）
- 补丁引擎 `patch-core` 与 CLI（apply / revert / status / doctor）
- 扩展内命令：应用汉化、恢复英文、查看状态、环境诊断
- 卸载或禁用时自动 revert 补丁并冷重启 Cursor
- Windows 冷重启 schtasks 看门狗方案
- 词典 SSOT（`translations/**/*.i18n.json`）与构建校验工具链
- GitHub Actions CI（build / validate:i18n / test）

[0.0.1]: https://github.com/ggbdpq/cursor-loc/releases/tag/v0.0.1
