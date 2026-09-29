# 项目结构

本文档描述仓库的目录布局与各部分职责。如果你只想跑起来，看 [README](../README.md) 的「快速开始」就够了；这里是给想深入了解或贡献代码的人看的。

## 顶层布局

```
dlut-nihongo-quiz/
├── data/                     # 题库源（single source of truth）
│   ├── raw/                  # Markdown 原始题库
│   │   ├── 日语期末复习题目答案解析_题目选项在上版.md   # 语法
│   │   ├── 日语汉字单词选择题-第26-28课.md             # 单词（旧分类，已合并入 japanese2）
│   │   ├── 日语汉字单词选择题-第28-31课.md
│   │   ├── 日语汉字单词选择题-第32-36课.md
│   │   ├── japanese/         # 日语（2024 年真题等）
│   │   ├── history/          # 中国近现代史（多个刷题单）
│   │   ├── party/            # 党史
│   │   └── military/         # 军事理论
│   └── processed/            # 解析器输出的验证报告（自动生成）
│
├── scripts/                  # md → JSON 解析脚本（npm run parse:*）
│   ├── parse-markdown.ts             # 语法（旧分类，已合并入 japanese2）
│   ├── parse-word-markdown.ts        # 单词（旧分类，已合并入 japanese2）
│   ├── merge-japanese2-banks.ts      # 合并语法 + 单词为综合日语2
│   ├── parse-history-markdown.ts     # 历史
│   ├── parse-party-markdown.ts       # 党史
│   └── parse-military-markdown.ts    # 军事
│
├── pdf-ocr/                  # PDF 试卷 → 题库 md 的导入工具（Python，见 README）
│   ├── README.md                       # 目录速查
│   ├── 1_render.py … 7_import.py        # S1 渲染 / S2 双路 OCR / S3 比对 / S4 成文 /
│   │                                   # S5 契约门禁 / S6 发布(含 --unpublish) / S7 批量导入
│   ├── work/                           # 中间产物（页图、逐页 JSON、报告、AI 缓存；gitignore）
│   └── tests/                          # 8 个离线验收脚本（不联网、0 token）
│
├── public/                   # 解析后的 JSON 题库（运行时读取，自动生成）
│   ├── japanese2-question-bank.json  # 综合日语2 963 题（单词 + 语法）
│   ├── history-question-bank.json    # 历史 2872 题
│   ├── party-question-bank.json      # 党史 1615 题
│   └── military-question-bank.json   # 军事 407 题
│
├── src/
│   ├── App.vue
│   ├── main.ts               # 应用入口（注册 router、挂载 Dexie）
│   ├── style.css             # 全局样式
│   ├── components/           # 复用组件
│   │   ├── QuestionCard.vue          # 题干 + 选项 + 解析展示
│   │   ├── ProgressBar.vue           # 顶部进度条
│   │   ├── StatCard.vue              # 数据卡片
│   │   └── TagBadge.vue              # 标签徽章
│   ├── pages/                # 五个页面
│   │   ├── HomePage.vue              # 首页：学科入口 + 总览
│   │   ├── QuizPage.vue              # 刷题
│   │   ├── WrongBookPage.vue         # 错题本
│   │   ├── AnalysisPage.vue          # 统计分析
│   │   └── SettingsPage.vue          # 设置（清空数据、重置进度等）
│   ├── router/
│   │   └── index.ts                 # Vue Router（hash history）
│   ├── db/
│   │   └── database.ts              # Dexie (IndexedDB) 数据层
│   ├── services/                    # 业务逻辑
│   │   ├── categoryStore.ts         # 当前激活学科 + 持久化
│   │   ├── quizEngine.ts            # 出题、判分、会话管理
│   │   ├── reviewScheduler.ts       # 复习调度（按掌握度）
│   │   └── sessionResume.ts         # 中断会话恢复
│   ├── types/
│   │   └── question.ts              # Question / Attempt / Stats 类型
│   └── utils/
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   # PR/push 构建
│   │   └── deploy.yml               # main 分支自动部署 Pages
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
│
├── docs/                     # 你正在看的目录
│   ├── screenshots/                  # README 引用的截图
│   ├── project-structure.md          # 本文件
│   ├── deployment.md                 # 部署细节
│   └── question-bank.md              # 题库维护流程
│
├── index.html                # Vite 入口 HTML
├── package.json
├── tsconfig*.json            # TypeScript 配置（app / node）
├── vite.config.ts
├── .editorconfig             # 编辑器约定（2 空格、单引号）
└── LICENSE                   # Apache-2.0
```

## 数据流

```
PDF 试卷 ──[ pdf-ocr/7_import.py ]──▶ data/raw/<分类>/<分类>.md
                                            │
data/raw/*.md  ──[ npm run parse:* ]──▶  public/*-question-bank.json
                                              │
                                              ▼
                            浏览器 fetch ──▶ Dexie (IndexedDB)
                                              │
                                              ▼
                                       Vue 组件渲染
```

- `data/raw/` 是**唯一可信源**，永远不要手改 `public/*.json`
- 每个 parser 都会输出验证报告到 `data/processed/`，发现格式错误时会非零退出
- 前端首次加载时把 JSON 灌进 IndexedDB，后续读本地，离线可用
- 来自 PDF 的题库由 `pdf-ocr/` 生成（S1→S6 + S7 批量），用法见
  [PDF 试卷导入工具](pdf-ocr-import-guide.md)；中间产物都在 `pdf-ocr/work/`，不入库

## 学科分类（Category）

定义在 [`src/types/question.ts`](../src/types/question.ts)：

```ts
export type Category = 'japanese2' | 'history' | 'party' | 'military'
```

每个分类对应：

- 一个 `parse-<category>-markdown.ts` 脚本（japanese2 例外，使用 `parse-word-markdown.ts` + `parse-markdown.ts`）
- 一个 `public/<category>-question-bank.json`
- `categoryStore.ts` 中的激活态切换 + Dexie 持久化

新增分类的最小步骤见 [question-bank.md#新增学科分类](question-bank.md#新增学科分类)。
