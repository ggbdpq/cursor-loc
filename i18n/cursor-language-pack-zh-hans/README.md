# 适用于 Cursor 的专有界面中文（简体）语言包

此扩展为 Cursor IDE 的**专有界面**提供简体中文，包括 Cursor Settings、Agent、Composer、Review 等 Microsoft 官方语言包无法覆盖的区域。

> **0.0.9 变更**：注入引擎重写为**增量翻译**（移除定时全页扫描、原型劫持与「每次变更全页重扫」），汉化能力不变，打字与滚动不再被拖慢。「应用界面汉化」改为纯手动命令，扩展启动时不再修改安装目录。

---

## 使用方法

### 第一步：界面中文（推荐）

安装 Microsoft 官方扩展：

**[Chinese (Simplified) Language Pack for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=MS-CEINTL.vscode-language-pack-zh-hans)**（发布者 MS-CEINTL）

然后按 `Ctrl+Shift+P`，运行 **Configure Display Language**，选择 **zh-cn**，并按提示重启 Cursor。
菜单、命令面板等界面将显示为中文。详见 [官方文档](https://go.microsoft.com/fwlink/?LinkId=761051)。

### 第二步：安装本扩展

在 Cursor 扩展视图中搜索 **Cursor 专有界面汉化**，或从 VSIX 安装。

### 第三步：应用专有界面汉化

按 `Ctrl+Shift+P` 打开命令面板，输入 **Cursor 中文**，选择：

**Cursor 中文：应用界面汉化**

应用成功后扩展会**自动调度重启**，无需其他操作。若出现 Cursor 自带的 **Quit Cursor?** 确认框，点击 **Quit** 即可（建议勾选 **Don't ask again**，此后重启全程免确认）；即使不点击，约 25 秒后也会自动完成重启。

> **注意**：「Reload Window」无法使汉化生效；须完整退出并重新打开 Cursor。

### 其他命令

| 命令 | 说明 |
|------|------|
| Cursor 中文：查看汉化状态 | 检查补丁是否已安装 |
| Cursor 中文：环境诊断 | 检查路径与写权限 |
| Cursor 中文：恢复英文界面 | 移除补丁并恢复英文（可重复执行） |

日志输出：**输出面板 → Cursor 专有界面汉化**。

---

## 与 Microsoft 中文语言包的关系

界面中文完全由 **Microsoft 官方语言包**提供；本扩展只做历史残留清理。

---

## 常见问题

**恢复时提示「未检测到残留」？**  
安装目录已是原始状态，无须任何操作。

**恢复时提示缺少备份 / 校验和无法还原？**  
这是旧版补丁的备份文件丢失所致。恢复入口绝不猜测或拼接原始文件；按提示重装或升级 Cursor 即可修复。

**Cursor 升级后需要做什么？**  
无需操作。0.0.9 起扩展不写安装目录，升级不受影响。

---

## 配置

在设置中搜索 `cursorZh`：

| 设置项 | 说明 |
|--------|------|
| `cursorZh.appRoot` | Cursor 安装根目录，留空自动检测 |

---

## 卸载与恢复英文

卸载本扩展时，会自动移除补丁并重启 Cursor，专有界面恢复英文。

**禁用**本扩展时，请先执行 **Cursor 中文：恢复英文界面**，否则安装目录中的补丁可能仍保留（专有界面继续显示中文）。

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
# 产物：cursor-language-pack-zh-hans-0.0.9.vsix
```

F5 调试：在 `i18n/cursor-language-pack-zh-hans` 打开，使用 `.vscode/launch.json`。

维护者文档见 [README.developer.md](./README.developer.md)。

---

## 许可证

源代码与词典采用 [MIT License](./LICENSE) 授权。

---

**标识符**：`ggbdpq.cursor-language-pack-zh-hans` · **平台**：Windows / macOS（beta）
