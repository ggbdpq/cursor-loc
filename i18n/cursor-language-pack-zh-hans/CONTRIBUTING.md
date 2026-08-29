# 贡献指南（词典）

感谢补翻/修正！词典是本项目的唯一事实源（SSOT），改词条 = 改 `translations/**/*.i18n.json`，不需要碰任何代码。

## 快速流程

1. 认领任务：维护者会不定期把 `tools/output/pending/index.md`（漏翻清单）贴到 issue；有 Windows + Cursor 环境也可以自己跑 `npm run coverage` 生成。
2. 找到词条所属页面，在 `translations/` 下选对应模块文件（`settings/general.i18n.json`、`agent/composer.i18n.json`、`dialogs.i18n.json` 等，按文件名即可判断）。
3. 按下述格式追加词条，**译法遵循 [TERMS.md](./TERMS.md)**。
4. 仓库根目录运行 `npm run validate:i18n`，必须通过。
5. 提交 PR，说明「页面 + 原文 + 译文」即可。

## 词条格式

```json
{
  "originalText": "Quit Anyway",
  "changeText": "仍然退出",
  "searchType": "exact"
}
```

- `originalText`：**Cursor 界面上实际渲染的英文**，逐字符一致（大小写、标点、末尾句号、`...`）。拿不准就打开对应界面 F12 检查文本节点。
- `changeText`：中文译文。
- `searchType`：见下表。
- `flags`（仅 regex）：默认 `g`，一般不用填。

## searchType 怎么选

| 类型 | 何时用 | 例子 |
|---|---|---|
| `exact` | **默认**。原文是完整、固定的文本节点 | `Quit Anyway → 仍然退出` |
| `partial` | 原文只是更长句子中的一段，或同一句有截断变体 | `Saving UI state → 正在保存 UI 状态` |
| `regex` | 文案含变化部分（数字、模式名等），用 `$1` 引用捕获组 | `View (\d+) More → 查看 $1 项更多` |

渲染时 `{0}`/`{1}` 已被替换成实际值，词典里要写替换后的形态；对含数字等变化的句子用 regex。

## 质量红线

- **exact 原文必须逐字符匹配渲染文本**——多数「翻了没生效」都是原文抄错。
- 同一原文在全词典只能有一种译文（校验器会拒绝冲突）。
- 术语必须遵循 [TERMS.md](./TERMS.md)。
- 不要为「可能有用」的词批量加词条；只加你亲眼见过出现在界面上的。

## 本地验证

```bash
npm install          # 首次
npm run validate:i18n   # 词条格式与冲突校验（必须通过）
npm run build           # 重新生成词典 bundle（可选，CI 会跑）
```

维护者负责打包发版与版本号（每日一版），贡献者无需关心。
