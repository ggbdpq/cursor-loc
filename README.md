# cursor-loc

为 **Cursor IDE 专有界面**提供简体中文汉化：覆盖 Settings、Agent、Composer、Review 等 Microsoft 官方语言包无法触及的区域。

**扩展标识**：`ggbdpq.cursor-language-pack-zh-hans` · **当前平台**：Windows

---

## 背景

Cursor 基于 VS Code，但大量界面（设置页、Agent、Composer 等）由 Cursor 自行维护，**不在** MS 中文语言包的 NLS 覆盖范围内。本仓库通过「词典 + 安装目录补丁」的方式，补齐这部分专有界面的简体中文。

| | MS 中文语言包 | 本仓库 |
|---|---|---|
| 覆盖 | 菜单、命令面板、通用设置 | Cursor Settings / Agent / Composer / Review 等 |
| 机制 | 官方 NLS | DOM 词典补丁（写入 Cursor 安装目录） |
| 显示语言 | 需 `locale: zh-cn` | 与显示语言无关，英文界面下也可使用 |

两者**互补**，建议同时安装。

---

## 快速开始

### 1. 安装底座中文（推荐）

安装 [Microsoft 中文语言包](https://marketplace.visualstudio.com/items?itemName=MS-CEINTL.vscode-language-pack-zh-hans)，执行 **Configure Display Language** → 选择 **zh-cn** → 重启 Cursor。

### 2. 安装本扩展

在 Cursor 扩展市场搜索 **Cursor 专有界面汉化**，或从 VSIX 侧载：

```text
扩展视图 → … → 从 VSIX 安装… → cursor-language-pack-zh-hans-0.0.1.vsix
```

### 3. 应用汉化

`Ctrl+Shift+P` → **Cursor 中文：应用界面汉化** → 按提示**完整重启** Cursor（Reload Window 无效）。

> **说明**：本扩展会向 Cursor **安装目录**写入界面补丁。卸载或禁用扩展时会**自动移除补丁并重启**；若自动重启失败，请手动完全退出 Cursor 再打开。

更多命令、配置项、常见问题与卸载说明，见扩展目录 [i18n/cursor-language-pack-zh-hans/README.md](./i18n/cursor-language-pack-zh-hans/README.md)。

---

## 仓库结构

```text
cursor-loc/
├── i18n/cursor-language-pack-zh-hans/   # VSIX 扩展（用户安装入口）
│   ├── src/                             # 扩展逻辑：应用 / 回滚 / 重启 / 诊断
│   ├── translations/                    # 词典 SSOT（*.i18n.json）
│   └── README.md                        # 面向终端用户的完整说明
├── packages/
│   ├── patch-core/                      # 补丁引擎（注入 Cursor 安装目录）
│   └── patch-cli/                       # 命令行：apply / revert / status / doctor
├── tools/                               # 词典构建与校验脚本
├── package.json                         # monorepo 根脚本
└── LICENSE
```

**数据流**：`translations/` → `npm run build:i18n` → `generated/replacements.bundle.json` → 扩展或 CLI 调用 `patch-core` 写入 Cursor。

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
2. 根目录执行 `npm run build` → `npm run package:ext`  
3. 重新安装 VSIX 并执行「应用界面汉化」

欢迎通过 [Issues / PR](https://github.com/ggbdpq/cursor-loc/issues) 反馈漏译或提交词典改进。

---

## 许可证

[MIT License](./LICENSE)
