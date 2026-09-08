# cursor-loc

为 **Cursor IDE 专有界面**提供简体中文汉化：覆盖 Settings、Agent、Composer、Review 等 Microsoft 官方语言包无法触及的区域。

> **0.0.9 变更**：注入引擎重写为**增量翻译**——移除每 100ms 定时全页扫描、attachShadow 原型劫持与「每次 DOM 变更全页重扫」三个卡顿根源；exact 词条走 O(1) Map，变更只处理涉及节点。汉化能力不变，打字与滚动不再被拖慢。「应用界面汉化」改为纯手动命令，启动时不再自动修改安装目录。

**扩展标识**：`ggbdpq.cursor-language-pack-zh-hans` · **当前平台**：Windows / macOS（beta）

---

## 背景

Cursor 基于 VS Code，但大量界面（设置页、Agent、Composer 等）由 Cursor 自行维护，**不在** MS 中文语言包的 NLS 覆盖范围内。本仓库历史版本通过「词典 + 安装目录补丁」补齐这部分专有界面，因性能问题于 0.0.9 停止维护该机制。

| | MS 中文语言包 | 本仓库 |
|---|---|---|
| 覆盖 | 菜单、命令面板、通用设置 | Cursor Settings / Agent / Composer / Review 等 |
| 机制 | 官方 NLS | 安装目录补丁（0.0.9 增量 DOM 引擎） |
| 显示语言 | 需 `locale: zh-cn` | 与显示语言无关，英文界面下也可使用 |

---

## 快速开始

### 1. 界面中文（推荐）

安装 [Microsoft 中文语言包](https://marketplace.visualstudio.com/items?itemName=MS-CEINTL.vscode-language-pack-zh-hans)，执行 **Configure Display Language** → 选择 **zh-cn** → 重启 Cursor。

### 2. 安装本扩展并应用汉化

在 Cursor 扩展市场搜索 **Cursor 专有界面汉化**，或从 VSIX 侧载。然后 `Ctrl+Shift+P` → **Cursor 中文：应用界面汉化** → 按提示**完整重启** Cursor（Reload Window 无效）。

> **说明**：补丁只在你手动执行「应用」时写入 Cursor 安装目录；卸载扩展时会**自动移除补丁并重启**。恢复入口可重复执行；缺少备份时如实报告受限项，不猜测、不拼接原始文件。

更多命令、配置项与卸载说明，见扩展目录 [i18n/cursor-language-pack-zh-hans/README.md](./i18n/cursor-language-pack-zh-hans/README.md)。

---

## 仓库结构

```text
cursor-loc/
├── i18n/cursor-language-pack-zh-hans/   # VSIX 扩展（用户安装入口）
│   ├── src/                             # 扩展逻辑：应用 / 恢复 / 状态 / 重启 / 诊断
│   ├── translations/                    # 词典 SSOT（*.i18n.json）
│   └── README.md                        # 面向终端用户的完整说明
├── packages/
│   ├── patch-core/                      # 补丁引擎（增量 DOM 翻译 + 残留恢复）
│   └── patch-cli/                       # 命令行：apply / revert / status / doctor
├── tools/                               # 词典构建与校验脚本
├── package.json                         # monorepo 根脚本
└── LICENSE
```

**数据流**：`translations/` → `npm run build:i18n` → `generated/replacements.bundle.json` → 扩展或 CLI 调用 `patch-core` 写入/恢复 Cursor 补丁。

---

## 开发

**环境**：Node.js ≥ 18（推荐 22），npm workspaces。

```bash
npm install
npm run build          # 构建 patch-core、词典 bundle、patch-cli
npm run test:all       # 校验词典 + 扩展单元测试
npm run package:ext    # 产出 VSIX
```

| 命令 | 用途 |
|------|------|
| `npm run apply` / `revert` / `status` / `doctor` | CLI 侧调试补丁 |
| `npm run validate:i18n` | 校验词典格式与完整性 |
| `npm run extract` | 从 Cursor 产物提取待翻译候选 |

扩展 F5 调试：在 `i18n/cursor-language-pack-zh-hans` 目录打开，使用 `.vscode/launch.json`。维护者细节见 [README.developer.md](./i18n/cursor-language-pack-zh-hans/README.developer.md)。

---

## 参与贡献

1. 在 `i18n/cursor-language-pack-zh-hans/translations/**/*.i18n.json` 修改或补充词条  
   - 译法先看 [术语表 TERMS.md](./i18n/cursor-language-pack-zh-hans/TERMS.md)  
   - 词条格式与流程见 [贡献指南 CONTRIBUTING.md](./i18n/cursor-language-pack-zh-hans/CONTRIBUTING.md)  
2. 根目录执行 `npm run build` → `npm run package:ext`  
3. 重新安装 VSIX 并执行「应用界面汉化」

漏翻请用 [漏翻报告模板](https://github.com/ggbdpq/cursor-loc/issues/new?template=missing-translation.yml)（附截图与逐字符原文最有效）。

欢迎通过 [Issues / PR](https://github.com/ggbdpq/cursor-loc/issues) 反馈漏译、性能问题或提交词典改进。

---

## 许可证

[MIT License](./LICENSE)
