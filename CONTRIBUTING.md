# 贡献指南

感谢你对 DLUT 多学科复习题库（dlut-nihongo-quiz）的兴趣！本文档介绍如何参与贡献。

## 🐛 报告 Bug / 提建议

请通过 [GitHub Issues](https://github.com/tianxingleo/dlut-nihongo-quiz/issues/new/choose) 提交。

提交前请：

1. 搜索现有 Issue，避免重复
2. 使用对应的模板（Bug Report 或 Feature Request）
3. 提供尽可能详细的信息（环境、复现步骤、截图）

## 📝 添加 / 修改题目

题库的 single source of truth 是 `data/raw/` 下的 Markdown 文件。**永远不要直接编辑 `public/*.json`** —— 它们是 parser 生成的。

本项目支持 5 个学科，每个学科有自己的源目录和 parser：

| 学科 | 源 md | Parser 命令 |
|---|---|---|
| 日语语法 | `data/raw/日语期末复习题目答案解析_题目选项在上版.md` | `npm run parse:grammar` |
| 日语单词 | `data/raw/日语汉字单词选择题-第XX-YY课.md` | `npm run parse:words` |
| 中国近现代史 | `data/raw/history/*.md` | `npm run parse:history` |
| 党史 | `data/raw/party/*.md` | `npm run parse:party` |
| 军事理论 | `data/raw/military/*.md` | `npm run parse:military` |

完整流程（单选 / 多选 / 判断三种题型的 Markdown 格式、验证报告、新增学科的步骤、跨文件去重说明）在 **[docs/question-bank.md](docs/question-bank.md)**。

加题的快速 checklist：

1. 编辑对应 md 文件
2. 跑 `npm run parse:<category>`
3. 检查 `data/processed/validation-report.json` 有没有报错
4. `git add data/raw public/ data/processed/`
5. commit 用 `content:` 前缀（见下方 Commit 规范）

## 💻 开发流程

```bash
# 1. Fork & clone
git clone https://github.com/<your-name>/dlut-nihongo-quiz.git
cd dlut-nihongo-quiz

# 2. 安装依赖（需 Node.js 18+，CI 使用 Node 24）
npm install

# 3. 启动 dev server
npm run dev

# 4. 改代码、加题目...

# 5. 本地构建验证
npm run build

# 6. 提交（参考下方 Commit 规范）
git add ...
git commit -m "..."

# 7. Push 并发起 PR
git push origin my-feature-branch
```

## 🎨 代码风格

- TypeScript + Vue 3 `<script setup>`
- 2 空格缩进
- 单引号字符串
- 文件末尾保留空行

`.editorconfig` 已配置，主流编辑器会自动识别。

## 📤 Commit 规范

参考 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

| 前缀 | 用途 |
|---|---|
| `feat:` | 新功能（`feat: add fill-in-blank mode`） |
| `fix:` | Bug 修复（`fix: wrong analysis chart on empty history`） |
| `docs:` | 文档（`docs: update README screenshots`） |
| `refactor:` | 重构 |
| `chore:` | 杂项 |
| `content:` | 题库内容变更（`content: add grammar questions for lesson 30`） |

## 🚦 PR 流程

1. 从 `main` 拉新分支
2. 改完跑一遍 `npm run build` 确保不破坏构建
3. 填写 PR 模板
4. 等待 CI 通过 + review

## 📜 行为准则

参与本项目即代表你同意遵守 [Code of Conduct](CODE_OF_CONDUCT.md)。请在交流中保持友善和尊重。
