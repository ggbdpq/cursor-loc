# 开发者文档

面向维护者与贡献者。面向用户的说明见 [README.md](./README.md)（扩展市场「细节」页展示内容）。

## 文档索引

| 文档 | 内容 |
|------|------|
| [仓库主 README](../../README.md) | 背景、快速开始、仓库结构、开发与贡献 |
| [用户 README](./README.md) | 安装、命令、配置、卸载（扩展市场展示） |

## 仓库结构（monorepo）

```
cursor-loc/
├── packages/patch-core/     补丁引擎 @cursor-loc/patch-core
├── packages/patch-cli/      CLI：cursor-zh apply/revert/…
├── i18n/cursor-language-pack-zh-hans/
│   ├── translations/        词典 SSOT（*.i18n.json）
│   ├── generated/           build:i18n 产物（勿手改）
│   ├── bundled/patch-core/  prepare-package 产物（勿手改）
│   └── src/                 扩展 TypeScript 源码
└── tools/                   build-i18n · validate · extract
```

## 本地构建

```bash
# 仓库根
npm install
npm run build          # patch-core + 词典 bundle + patch-cli

# 扩展 VSIX
cd i18n/cursor-language-pack-zh-hans
npm run package        # compile + prepare:package + vsce
# 产物：cursor-language-pack-zh-hans-0.0.1.vsix
```

F5 调试：在 `i18n/cursor-language-pack-zh-hans` 打开，使用 `.vscode/launch.json`。

## 词典

| 步骤 | 命令 / 路径 |
|------|-------------|
| SSOT | `translations/**/*.i18n.json` |
| 构建 | 根目录 `npm run build:i18n` → `generated/replacements.bundle.json` |
| 校验 | 根目录 `npm run validate:i18n`、`npm run validate:dropdown` |
| 提取候选 | `npm run extract` → `tools/output/candidates.json` |

修改词典后须：`npm run build` → 扩展 `npm run package` → 用户重新安装 VSIX 并「应用界面汉化」。

## 源码阅读顺序

1. `src/extension.ts` — 命令注册、启动引导、deactivate 回滚  
2. `src/patchService.ts` — 动态加载 patch-core + 读取 bundle  
3. `packages/patch-core/src/index.ts` — apply/revert/status/doctor API  
4. `packages/patch-core/src/assets/cursor.inject.js` — 运行时 DOM 替换  
5. `src/restartCursor.ts` — Windows 冷重启调度  

各文件顶部与关键函数均含 JSDoc，风格参考 `tools/extract-candidates.ts` 与 `chunk-planner.js` 的行内说明。

## 冷重启（维护者）

扩展无法调用 Cursor 内部 `app.relaunch()`，使用 `schtasks + VBS + .bat` 看门狗。  
日志：输出面板 `[restart]`、`%TEMP%\cursor-zh-restart-*.log`。

实现：`src/restartCursor.ts` · 测试：`src/__tests__/restartCursor.*.test.ts`
