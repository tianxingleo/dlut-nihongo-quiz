# 大连理工日语期末复习题库 · DLUT Nihongo Quiz

[![CI](https://github.com/tianxingleo/dlut-nihongo-quiz/actions/workflows/ci.yml/badge.svg)](https://github.com/tianxingleo/dlut-nihongo-quiz/actions/workflows/ci.yml)
[![Deploy](https://github.com/tianxingleo/dlut-nihongo-quiz/actions/workflows/deploy.yml/badge.svg)](https://github.com/tianxingleo/dlut-nihongo-quiz/actions/workflows/deploy.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Made with Vue](https://img.shields.io/badge/made%20with-Vue%203-42b883.svg)](https://vuejs.org/)

> 一句话：大连理工大学国际信息与软件学院大一下学期《大家的日语》第 26-36 课期末复习用的 Web App。

## ✨ 特性

- **题库完整**：80 道语法题 + 单词选择题，覆盖《大家的日语》第 26-36 课全部内容
- **双分类切换**：📝 语法题 / 📖 单词题 一键切换
- **刷题模式**：随机出题、即时反馈、答案解析
- **错题本**：自动收集错题，方便针对性复习
- **统计分析**：按课次/题型统计正确率，可视化学习进度
- **离线运行**：所有进度存储在 IndexedDB，关闭浏览器也不丢
- **移动端友好**：手机上刷题体验流畅

## 📚 课程范围

- **学校**：大连理工大学（DUT）国际信息与软件学院
- **学期**：大一下学期
- **教材**：《大家的日语》（スリーエーネットワーク出版）第 26-36 课
- **用途**：期末考试复习

## 🎯 在线使用

直接访问 GitHub Pages 部署：

**👉 https://tianxingleo.top/dlut-nihongo-quiz/**

无需安装，打开就刷。

## 📸 截图

| 首页 | 刷题 |
|---|---|
| <img src="docs/screenshots/home.png" width="600" alt="首页" /> | <img src="docs/screenshots/quiz.png" width="600" alt="刷题" /> |

| 错题本 | 分析 |
|---|---|
| <img src="docs/screenshots/wrong.png" width="600" alt="错题本" /> | <img src="docs/screenshots/analysis.png" width="600" alt="分析" /> |

## 🚀 本地开发

需要 Node.js 18+。

```bash
git clone https://github.com/tianxingleo/dlut-nihongo-quiz.git
cd dlut-nihongo-quiz
npm install
npm run dev
```

打开 http://localhost:5173/ 即可。

### 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建（base 为 `/dlut-nihongo-quiz/`） |
| `npm run preview` | 本地预览生产构建 |
| `npm run parse:grammar` | 从 `data/raw/` 解析语法题到 `public/question-bank.json` |
| `npm run parse:words` | 从 `data/raw/` 解析单词题到 `public/word-question-bank.json` |

## 📁 项目结构

```
dlut-nihongo-quiz/
├── data/raw/              # 题库 Markdown 源文件（Single Source of Truth）
├── data/processed/        # 解析器输出的验证报告
├── public/                # 解析后的 JSON 题库（运行时读取）
│   ├── question-bank.json
│   └── word-question-bank.json
├── scripts/               # md → JSON 解析脚本
│   ├── parse-markdown.ts
│   └── parse-word-markdown.ts
├── src/
│   ├── components/        # 复用组件（QuestionCard, ProgressBar 等）
│   ├── pages/             # 五个页面（Home / Quiz / WrongBook / Analysis / Settings）
│   ├── router/            # Vue Router 配置（hash history）
│   ├── db/                # Dexie (IndexedDB) 数据层
│   ├── services/          # 业务逻辑（题库加载、分类切换、统计）
│   ├── types/             # TypeScript 类型定义
│   └── utils/             # 工具函数
├── .github/workflows/     # CI/CD
└── docs/                  # 截图、设计文档
```

## 🔧 题库维护流程

题库的 single source of truth 是 `data/raw/*.md` 下的 Markdown 文件。**永远不要直接编辑 `public/*.json`** —— 它们是自动生成的。

加题 / 改题步骤：

1. 编辑 `data/raw/日语期末复习题目答案解析_题目选项在上版.md`（语法）或对应的 `日语汉字单词选择题-第XX-YY课.md`
2. 运行 `npm run parse:grammar`（或 `npm run parse:words`）
3. 检查 `data/processed/validation-report.json` 是否报错
4. 提交：`git add data/raw public data/processed` + `git commit`

详细的题库格式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 🌐 部署

本项目使用 GitHub Actions 自动部署到 GitHub Pages。

- **触发条件**：push 到 `main` 分支
- **Workflow**：[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
- **生产 URL**：https://tianxingleo.top/dlut-nihongo-quiz/
- **Vite base**：production 下为 `/dlut-nihongo-quiz/`，dev 下为 `/`
- **路由**：使用 hash routing（`/#/quiz`），刷新任意页面都不会 404

## 🤝 贡献

欢迎提 Issue 报 bug 或建议新功能，也欢迎 PR。

- 报 bug / 建议功能：直接开 [Issue](https://github.com/tianxingleo/dlut-nihongo-quiz/issues/new/choose)
- 加题 / 改代码：fork → 改 → 提 PR（详见 [CONTRIBUTING.md](CONTRIBUTING.md)）

## ⚠️ 版权与免责声明

- **代码**：采用 [Apache License 2.0](LICENSE) 授权。
- **题目内容**：题目来源于《大家的日语》（スリーエーネットワーク出版）教材及大连理工大学课堂复习资料，**版权归原著作权人所有**。本项目仅出于**学习交流与个人复习目的**使用（fair use），不用于任何商业用途。
- **侵权处理**：若原著作权人认为本项目侵犯其权益，请通过 [Issues](https://github.com/tianxingleo/dlut-nihongo-quiz/issues) 联系仓库所有者，确认后将在 48 小时内删除相关内容。
- **学术诚信**：本项目用于**期末复习**，不鼓励、不协助任何形式的考试作弊。

## 📝 License

代码部分采用 [Apache License 2.0](LICENSE) 授权。

## 🙏 Acknowledgments

- 大连理工大学国际信息与软件学院日语教学组的老师们
- 《大家的日语》教材编写组
- 所有为本项目贡献过题目与代码的同学

---

## English Summary

A Vue 3 + Vite + TypeScript + Dexie single-page Japanese quiz app built for freshman-spring final-exam review at the International Information & Software College, Dalian University of Technology (DLUT). It covers lessons 26–36 of《大家的日语》(Minna no Nihongo).

**Features:** 80 grammar questions + vocabulary questions, grammar/vocabulary category switching, quiz mode, wrong-answer book, statistics analysis, offline-first via IndexedDB, mobile-friendly UI.

**Live:** https://tianxingleo.top/dlut-nihongo-quiz/

**Run locally:** `git clone`, `npm install`, `npm run dev`.

**License:** Apache-2.0 for code. Question content is copyrighted by the original textbook publisher and used here for educational review only.

**Contributions:** Issues and PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
