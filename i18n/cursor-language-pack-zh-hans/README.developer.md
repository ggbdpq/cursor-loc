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
├── packages/patch-core/     补丁引擎 @cursor-loc/patch-core（增量 DOM 翻译 + 残留恢复）
├── packages/patch-cli/      CLI：cursor-zh apply/revert/status/doctor
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
| 覆盖率/漏翻清单 | `npm run coverage` → `tools/output/coverage.json` + `tools/output/pending/index.md`（Cursor 更新后跑一次；清单供 issue 认领，产出物不入库） |

| 发版回归 | `npm run regression`（apply → 断言四件套/checksums → revert → 断言字节级还原；发版前必跑，结束时为未打补丁状态） |

0.0.9 起注入引擎为增量模式（无定时轮询、无原型劫持、变更只处理涉及节点），性能契约见 `src/__tests__/inject.performance-contract.test.ts`——改动注入脚本前先读它。

## 源码阅读顺序

1. `src/extension.ts` — 命令注册（手动 apply / revert / status / doctor）、deactivate 卸载清理  
2. `src/patchService.ts` — 动态加载 patch-core + 读取 bundle  
3. `packages/patch-core/src/index.ts` — apply/revert/status/doctor API  
4. `packages/patch-core/src/assets/cursor.inject.js` — 增量 DOM 翻译引擎（性能契约锁定）  
5. `packages/patch-core/src/services/DesktopTranslator.ts` — 补丁写入与残留恢复  
6. `src/restartCursor.ts` — Windows 冷重启调度  

各文件顶部与关键函数均含 JSDoc，风格参考 `tools/extract-candidates.ts` 与 `chunk-planner.js` 的行内说明。

## 冷重启（维护者）

扩展无法调用 Cursor 内部 `app.relaunch()`，使用 `schtasks + VBS + .bat` 看门狗。  
日志：输出面板 `[restart]`、`%TEMP%\cursor-zh-restart-*.log`。

实现：`src/restartCursor.ts` · 测试：`src/__tests__/restartCursor.*.test.ts`

## 发布（Open VSX）

Cursor 的扩展市场基于 [Open VSX](https://open-vsx.org)，发布流程：

```bash
npm run package        # 产出 cursor-language-pack-zh-hans-x.y.z.vsix
npx ovsx publish --pat <token>   # 需要 open-vsx.org 的 ggbdpq 命名空间令牌
# 或先create再publish；发错可用 npx ovsx prune/delete 处理
```

**Open VSX 版本不可覆盖**：同一版本号发布过一次即冻结，重新发布必须先递增 `package.json` 的 `version` 再打包。发布前必过：`npm run test:all` + `npm run regression`。市场文案的口径：**0.0.9 增量引擎修复打字/滚动卡顿，汉化保留；补丁仅手动应用，卸载扩展自动还原**（见 README.md 顶部说明）。

## 版本约定

**同一天内的多次修改，统一使用当日同一个版本号**（按日期递增，而非按次数递增）：
`package.json` 的 `version` 当天保持不变，所有改动合并写入 CHANGELOG 当日同一条目；
打包产物（VSIX）同日覆盖发布。跨天才递增次版本号。
