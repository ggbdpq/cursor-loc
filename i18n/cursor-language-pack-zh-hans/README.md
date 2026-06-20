# 适用于 Cursor 的专有界面中文（简体）语言包

此扩展为 Cursor IDE 的**专有界面**提供简体中文，包括 Cursor Settings、Agent、Composer、Review 等 Microsoft 官方语言包无法覆盖的区域。

> **免责声明**：本扩展会向 Cursor **安装目录**写入界面补丁。卸载或禁用扩展时会自动移除补丁；Corporate 环境请先咨询 IT。

---

## 使用方法

### 第一步：安装底座中文（推荐）

为获得完整中文体验，请先安装 Microsoft 官方扩展：

**[Chinese (Simplified) Language Pack for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=MS-CEINTL.vscode-language-pack-zh-hans)**（发布者 MS-CEINTL）

然后按 `Ctrl+Shift+P`，运行 **Configure Display Language**，选择 **zh-cn**，并按提示重启 Cursor。  
菜单、命令面板等底座界面将显示为中文。详见 [官方文档](https://go.microsoft.com/fwlink/?LinkId=761051)。

### 第二步：安装本扩展

在 Cursor 扩展视图中搜索 **Cursor 专有界面汉化**，或从 VSIX 安装：

1. 扩展视图 → `…` → **从 VSIX 安装…**
2. 选择 `cursor-language-pack-zh-hans-0.0.1.vsix`

### 第三步：应用专有界面汉化

按 `Ctrl+Shift+P` 打开命令面板，输入 **Cursor 中文**，选择：

**Cursor 中文：应用界面汉化**

首次安装时，扩展也可能弹出引导，点击 **应用并重启** 即可。

应用成功后需**完整重启 Cursor**（扩展会自动调度重启）。若出现 **Quit Cursor?**，点击 **Quit**；也可等待约 25 秒由系统自动完成重启。

> **注意**：「Reload Window」无法使汉化生效；须完整退出并重新打开 Cursor。

### 其他命令

| 命令 | 说明 |
|------|------|
| Cursor 中文：查看汉化状态 | 检查补丁是否已安装 |
| Cursor 中文：环境诊断 | 检查路径与写权限 |
| Cursor 中文：恢复英文界面 | 移除补丁并恢复英文 |

日志输出：**输出面板 → Cursor 专有界面汉化**。

---

## 汉化范围

| 区域 | 示例 |
|------|------|
| Cursor Settings | 常规、智能体、模型、MCP、索引、网络等 |
| Agent / Composer | 模式切换、输入区、工具调用状态 |
| 确认对话框 | 退出 Cursor、关闭窗口等（`Quit Cursor?` 等） |
| Review | PR 审查相关界面 |

**不包含**：VS Code 底座 UI（菜单、编辑器通用文案等），由 MS 中文语言包负责。

---

## 与 Microsoft 中文语言包的关系

两者**互补**，建议同时安装：

| | MS 中文语言包 | 本扩展 |
|---|---|---|
| 覆盖 | 菜单、命令面板、通用设置 | Cursor Settings、Agent、Composer 等 |
| 机制 | 官方 NLS | 专有界面 DOM 词典补丁 |
| 显示语言 | 需 `locale: zh-cn` | **与显示语言无关**，英文界面下也可使用 |

---

## 常见问题

**应用后 Settings 仍是英文？**  
确认已完整重启；运行「查看汉化状态」，三项均为已安装。

**应用失败？**  
运行「环境诊断」；若 Cursor 装在 `Program Files`，可配置 `cursorZh.appRoot` 或以管理员运行后再应用。

**Cursor 升级后变回英文？**  
重新执行「应用界面汉化」。

**部分文案仍英文？**  
欢迎到仓库提交 Issue 或 PR 补充词典（见「参与」）。

---

## 配置

在设置中搜索 `cursorZh`：

| 设置项 | 说明 |
|--------|------|
| `cursorZh.appRoot` | Cursor 安装根目录，留空自动检测 |
| `cursorZh.autoApplyOnInstall` | 启动时是否弹出「应用并重启」引导（默认开启） |

---

## 卸载与恢复英文

卸载或**禁用**本扩展时，会自动：

1. **移除** Cursor 安装目录中的汉化补丁（无需运行 `npm run revert`）
2. **重启** Cursor，专有界面（Settings / Agent 等）恢复英文

若自动重启失败，请手动完全退出 Cursor 再打开。

**注意**：菜单、命令面板等底座中文可能来自 **Microsoft 中文语言包**（MS-CEINTL），与本扩展无关；若要底座也改回英文，请禁用 MS 语言包或将显示语言改为 English。

---

## 参与

翻译问题、漏译反馈或贡献词典，请访问 monorepo 仓库：

**https://github.com/ggbdpq/cursor-loc**

| 维护内容 | 路径 |
|----------|------|
| 词典（SSOT） | `i18n/cursor-language-pack-zh-hans/translations/**/*.i18n.json` |
| 构建产物 | `generated/replacements.bundle.json`（由 `npm run build:i18n` 生成，勿手改） |
| 补丁引擎 | `packages/patch-core/` |
| 扩展源码 | `i18n/cursor-language-pack-zh-hans/src/` |

修改词典后：`npm run build` → `npm run package:ext` → 用户重新安装 VSIX 并「应用界面汉化」。

仓库结构与开发说明见 [根目录 README](../../README.md)。

---

## 开发与打包

在 monorepo 根目录：

```bash
npm install
npm run build
cd i18n/cursor-language-pack-zh-hans
npm run package
# 产物：cursor-language-pack-zh-hans-0.0.1.vsix
```

F5 调试：在 `i18n/cursor-language-pack-zh-hans` 打开，使用 `.vscode/launch.json`。

维护者文档见 [README.developer.md](./README.developer.md)。

---

## 许可证

源代码与词典采用 [MIT License](./LICENSE) 授权。

---

**标识符**：`ggbdpq.cursor-language-pack-zh-hans` · **平台**：Windows（当前版本）
