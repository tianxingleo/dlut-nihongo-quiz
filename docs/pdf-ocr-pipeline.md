# PDF → 双 OCR → 比对提取 → 题库 .md　工作流设计文档

> **只是想用它**？看 [`pdf-ocr-import-guide.md`](pdf-ocr-import-guide.md)（用法/参数/退出码/门禁/下架）。
> **这份**是设计与实测日志：每步的 JSON 契约、为什么这么取舍、踩过的坑与修法（§1–§34）。
>
> 状态：**待评审**（本文档只是设计，尚未写任何脚本）
> 位置约定：工作流脚本与**全部中间产物**都在仓库根的独立目录 `pdf-ocr/`（中间产物在 `pdf-ocr/work/`）；`data/raw/<分类名>/` 只接收最终的 `<分类名>.md`
> 目标格式：与 `data/raw/japanese/*.md` 一致，能被现有 parser 直接消费

---

## 1. 目标与硬约束

### 1.1 目标

输入一个 PDF（试卷扫描/电子版），输出**可以直接进题库**的 markdown：

```
PDF ──▶ 每页 PNG ──▶ 两路 step-3.7-flash OCR ──▶ deepseek-flash 比对+题目提取 ──▶ 单个 .md
```

### 1.2 硬约束

| # | 约束 | 落实方式 |
|---|---|---|
| 1 | **格式硬契约必须遵守** | §2.1 的正则是不可协商的规格。工具**只允许产出 100% 合规的 .md**：宁可报错退出，也不产出"差不多能解析"的文件；每次生成后由 §9 离线校验器强制门禁 |
| 2 | 比对/提取模型 = **`deepseek-flash`** | `DEEPSEEK_MODEL` 默认值。⚠️ 原定的 `deepseek-v4.1-flash` 在该端点**不存在**（§20 实测：`/v1/models` 只返回 `deepseek-flash` 与 `deepseek-v4-pro`，写别的名字 HTTP 400），已按 flash 档改为 `deepseek-flash`；想换 pro 档只需改 `.env` 一行 |
| 3 | PDF 拆分**允许下载外部库/工具** | `pip install pymupdf`（本机 Python 3.14.2 + pip 26.0.1 可用） |
| 4 | 输出到 **`data/raw/{分类名}`**，分类名由**用户输入或 AI 总结** | 传了 `--category` 就用它；没传则由 AI 从首页 `paper_identity` 提议，**必须由用户确认**（回车采用 / 输入覆盖 / Ctrl+C 取消）；非交互环境未传 `--category` 直接报错退出。详见 §4.1 |
| 5 | **不改动现有数据** | `data/raw/` 下**只新增**最终 `<分类名>.md`；该目录已存在且非空一律拒绝覆盖（除 `--force`）；中间产物写到 `pdf-ocr/work/`；**绝不写** `public/*.json`，不碰任何既有 raw/processed 文件 |
| 6 | **题目最终输出不分批：全部写入一个文件** | `data/raw/<分类名>/<分类名>.md` 单文件；无 `--batch-size`，无分批边界逻辑 |
| 7 | **双路提示词"适度"异构** | 两路共用同一角色设定与同一输出 schema，只在 2–3 条侧重指令上不同（§7.1）；保证"可比"，同时避免两路错误完全相关 |
| 8 | **跨页断题必须拼接** | §8.2 定义了必须执行的拼接算法；拼接成功才产出该题，失败则该题标 `needs_review` 但仍输出（不丢题） |
| 9 | **Python 脚本 + 工作流方式，不过度打包** | 5 个小脚本，`python pdf-ocr/1_render.py …` 逐个跑；无包、无 `pyproject`、无 CLI 框架；风格对齐 `C:\Users\64247\Desktop\机组\_extract.py` |
| 10 | **`.env` 只放 API 相关三项 × 2**（base_url / 模型版本 / 密钥），并直接写进 `.env.example` | §2.4；dpi、页范围、重试次数等**一律走命令行参数**，不得进 `.env` |
| 11 | OCR 约定沿用 **`data/raw/computer-organization/ocr/`** | 目录结构、`source-manifest.json`、`page-XXX.review.json` 字段名全部镜像 |
| 12 | 每页独立执行；每页每阶段打印进度 `(?/n)` | 见 §6 输出规范 |

### 1.3 非目标（P1–P5 不做）

- 不接 `scripts/parse-japanese-2024-markdown.ts` 的读取列表 —— **整块挪到 P6**（md → 题库 JSON → 网页注册，调研见 §22）。
- 不改 `package.json` / npm 脚本；P5 之后再改 `.env.example`（P5 已追加，见 §13）。
- 不生成 `public/*.json`（P6 才做）。
- 不动 `src/` 下任何文件（P6 才做）。
- 不做图形界面、不做打包分发。

---

## 2. 现状调研结论（决定设计的事实）

### 2.1 目标格式契约（强制，来自真实 parser）

生成的 `.md` 必须满足 `scripts/parse-japanese-2024-markdown.ts`：

| 元素 | 必须写法 | 依据 |
|---|---|---|
| 题块分隔 | `### 第{N}题`（阿拉伯数字） | `:219` `:222` |
| 题组标题 | `## 题组{一…十}：<名称>`（**必须中文数字**） | `:225` `:365` |
| 题干区 | `#### 题目` | `:240` |
| 选项 | 行首 `A.` / `A、` / `A `（`^[A-E][\.\s、]`，一行一个；**到 E**，多选题实测 5 个选项） | `:277` `:304` |
| 翻译（可选） | `题目翻译：…` | `:283` |
| 公共题干（题组导言） | **复制**进该题组每道小题的 `#### 题目` 正文最前面（每个小问独立成题） | §8.4 |
| 备选：`**文章：**` + 导言正文，写在题组标题之后、小题之前；解析端会把它补到每一道小题的题干前面（可保留换行） | `:170` `:350-351`（§8.4 已评估未采用） |
| 答案区 | `#### 答案与解析` + **必须含** `**正确答案：D ちこく**` | `:251` `:323` |
| 解析 | 答案行之后的普通行 | `:336` |
| ⚠ 禁忌 | 解析区不能出现 `## ` 开头行 / `### 本组核心知识点总结`（会被截断） | `:262` |
| 收录条件 | 题干非空 + 选项 ≥ 2 + 有答案，否则该题**被静默丢弃** | `:349` |

黄金样例片段（摘自 `data/raw/japanese/2024年日语期末试卷.md`）：

```markdown
## 题组一：汉字读音选择

### 第1题

#### 题目

駅で財布を**拾った**んだけど、だれが落としたのでしょうか。

A. 【不清】
B. ひろった
C. さがった
D. もどった

#### 答案与解析

**正确答案：B ひろった**

「拾う」（ひろう）＝ 捡、拣。句形为「拾った」。…
```

> 这条约束不只是"文档"，而是**写入工具的硬门禁**：`5_check.py` 按上表逐条校验，任何一条不通过就退出码 `3`，并要求修完再入库。

### 2.2 OCR 约定（镜像 `data/raw/computer-organization/ocr/`）

现有产物形态（真实文件实测）：

```
data/raw/computer-organization/ocr/
├── source-manifest.json          # model / endpoint / documents[{source,pages,sha256,completed_pages}] / errors[]
├── computer-2024-final.md        # 合并后的整页转写
├── <试卷>/
│   └── page-001.review.json      # 每页一份
```

`page-001.review.json` 字段：`printed_page_labels[]`、`paper_identity{title,date,variant,declared_printed_pages}`、`question_ranges[]`、`page_condition`、`transcription_md`、`corrections[{location,before,after,evidence,confidence}]`。

**本工作流完全沿用这套字段**，只扩展两处：
- 每页 OCR 分两路：`page-001.a.review.json` / `page-001.b.review.json`。
- 新增 `page-001.merge.json` 保存比对 + 题目提取结论（§7.2）。

### 2.3 本机环境实测

| 项 | 现状 |
|---|---|
| Python | ✅ 3.14.2；pip 26.0.1 |
| 已装库 | ✅ `requests`、`httpx`、`python-dotenv`、`PIL` |
| PDF 库 | ❌ 未装 `pymupdf`（需 `pip install pymupdf`，允许） |
| poppler / ImageMagick / Ghostscript | ❌ 均无（不需要，PyMuPDF 自带渲染） |
| `.env` | ❌ 目前不存在（需新建；`.gitignore` 已忽略 `.env`，只放行 `.env.example`） |
| 既有同类脚本风格 | `机组/_extract.py`：单文件、`os.makedirs('_text')`、`print(f'{f}: N pages')`、UTF-8 stdout 包装 |

### 2.4 `.env`：只放 API 三项 × 2

`.env` **只允许**出现下面 6 行（端点 / 模型版本 / 密钥），其它任何配置都不进 `.env`：

```dotenv
STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1/chat/completions
STEPFUN_MODEL=step-3.7-flash
STEPFUN_API_KEY=sk-...

DEEPSEEK_BASE_URL=https://api.deepseek.com/v1/chat/completions
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_API_KEY=sk-...
```

**默认值（已定稿）** —— `.env` 不提供时使用：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `STEPFUN_BASE_URL` | `https://api.stepfun.com/step_plan/v1/chat/completions` | **沿用原来那个端点**（`data/raw/computer-organization/ocr/source-manifest.json` 里记录的就是它） |
| `STEPFUN_MODEL` | `step-3.7-flash` | 两路 OCR 都用它 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1/chat/completions` | 比对+提取 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 比对+提取。端点实测只认 `deepseek-flash` / `deepseek-v4-pro`（原定的 `deepseek-v4.1-flash` 报 HTTP 400，见 §20） |

- **变量命名**：`STEPFUN_*` / `DEEPSEEK_*`（已定稿）。
- **取值优先级**：`.env` > 进程环境变量 > 上表默认值 > 既有 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 回退（仅当 `DEEPSEEK_*` 全缺时启用；`.env` 优先于环境变量这一点沿用 `scripts/enrich-explanations.mjs` 的既有做法）。
- `--dpi` / `--pages` / `--max-retries` / `--category` 等**全部走命令行参数**，不写进 `.env`。
- 这 6 行已**追加到 `.env.example`**（保留既有 `ANTHROPIC_*` 三项不动，`scripts/enrich-explanations.mjs` 仍在用），作为模板提交；仓库根 `.env` 已按此建好、**密钥留空**待填，且被 `.gitignore` 忽略（不入库）。

---

## 3. 产物与目录布局

**分工原则：中间产物全部留在工具的 `pdf-ocr/work/`，`data/raw/` 只接收最终 `.md`。**

```
pdf-ocr/                                 # 代码 + 工作区（都在仓库根的独立目录里）
├── _common.py
├── 1_render.py … 5_check.py
└── work/<分类名>/                        # ★ 全部中间产物（.gitignore 已忽略）
    ├── source-manifest.json             # 账本：sha256 / pages / dpi / model / endpoint / completed_pages / errors
    ├── pages/
    │   ├── page-001.png                 # 渲染出的页图（保留，便于人工复核）
    │   ├── page-001.a.review.json       # OCR 路 A（沿用 review.json 字段）
    │   ├── page-001.b.review.json       # OCR 路 B
    │   └── page-001.merge.json          # 比对 + 题目提取结果
    ├── transcription.md                 # 所有页转写拼接（对齐现有 computer-*.md 的做法）
    └── report.md                        # 待人工复核清单（冲突 / 低置信 / 拼接失败）

data/raw/<分类名>/                        # 最终结果唯一落点：只放一个 .md
└── <分类名>.md                          # ★ 全部题目写在这一个文件里（不分批）
```

命名（目录与文件同名，镜像 `data/raw/japanese/2024年日语期末试卷.md` 的"文件夹=学科、文件=试卷"习惯）：

- 目录：`data/raw/<分类名>/`（**只有最终 .md**）
- 文件：`data/raw/<分类名>/<分类名>.md`（**单文件**，题号从小到大连续排列）
- 中间产物：`pdf-ocr/work/<分类名>/…`；渲染前的一次性暂存 `pdf-ocr/work/.tmp/<sha8>/`

**安全护栏**（对应硬约束 5）：
- 最终产物 `data/raw/<分类名>/` 已存在且非空 → **报错退出**，除非显式 `--force`（不动既有数据）。
- 写入路径白名单：最终产物必须在 `data/raw/` 之下，中间产物必须在 `pdf-ocr/work/` 之下（两道都防 `..` 逃逸）。
- 只 `open(...,'x')`（独占创建）或"临时文件 + 原子改名"。
- 不触碰 `public/`、`src/`、`data/processed/` 以及 `data/raw/` 下任何既有文件。

---

## 4. 工作流脚本（Python，逐个可跑）

```
pdf-ocr/                      # 仓库根的独立目录，便于单独管理这条工作流
├── _common.py         # .env 解析、HTTP POST + 重试、进度打印、JSON 读写（约 120 行）
├── 1_render.py        # PDF → pages/page-00N.png（PyMuPDF）+ 写 source-manifest.json
├── 2_ocr.py           # 每页两路 OCR → page-00N.{a,b}.review.json
├── 3_merge.py         # 每页 deepseek-flash 比对+提取 → page-00N.merge.json
├── 4_build_md.py      # 跨页拼接 + 汇总 → 单个 <分类名>.md + transcription.md + report.md
├── 5_check.py         # 离线契约校验（不调 API）→ 写 data/processed/<分类名>-check.json
├── 6_publish.py       # 发布上站：生成题库 + 把分类"拼接"进站点源码（§29）
└── tests/             # 离线回归（不联网、0 token、沙箱化，绝不碰真的 data/raw）
    ├── test_s3_coverage.py   # 缺号护栏 + 题数匹配（8 组断言；用真实 page 4 的声明）
    ├── test_p4_build.py      # 拼接三条分支 / 归一化 / 补选项 / 去重 / 公共题干 / 门禁（16 组断言）
    └── prepare_real_parser.py # 生成"真实 TS 解析器跑我们的 md"的临时副本（验收用，见 §23.3）
```

- 每个脚本可**单独运行**：`python pdf-ocr/2_ocr.py --category 2025年日语期末试卷`
- 统一参数：`--category`、`--force`、`--pages 1-12`、`--dpi 200`、`--quiet`、`--from N`（从第 N 步续跑）。
- **成本护栏参数**（P2/P3，详见 §18.5）：`--max-tokens`（单次响应上限，**OCR 默认 10000000 / merge 默认 393216**，即各端点允许的上限，见 §20.5）、`--budget-tokens`（本次运行累计上限，0=不限）、`--total-budget-tokens`（跨运行累计上限，0=不限）。
- **S4 专有参数**：`--group-by paper|type`（默认 `paper`＝全卷 1 张题单，取消题型分题组；见 §8.1 规则 5 / §26）。
- **S6 专有参数**：`--short/--long/--desc/--icon`（卡片展示信息）、`--dry-run`（只打印改动）、`--no-build`、`--no-verify`（见 §29）。
- 脚本之间**只通过磁盘产物耦合**（工作流方式：可中断、可重跑、可人工介入中间产物）。
- 依赖只写进本文档（`pip install pymupdf requests`），不做 `requirements.txt`/打包。

**退出码（各脚本统一）**

| 码 | 含义 |
|---|---|
| `0` | 成功（`5_check.py` 另有 `2` 表示"有警告/待复核"） |
| `1` | 参数或环境错误（缺 `--category`、缺密钥、找不到 S1 产物、PDF 不存在…） |
| `2` | 校验有警告：有待复核项但无硬错误（`5_check.py`） |
| `3` | 有页/有项失败（错误已记入 `source-manifest.json.errors`，可续跑补齐） |
| `4` | **成本预算用尽**（`--budget-tokens` 本次超限停在当前页，或 `--total-budget-tokens` 跨运行已超而拒绝开工） |

### 4.1 分类名如何确定（硬约束 4）

1. 传了 `--category 2025年日语期末试卷` → 直接用它（并先检查该目录是否已存在）。
2. 没传 → `1_render.py` 先把页图渲染到**一次性暂存目录** `pdf-ocr/work/.tmp/<sha256前8位>/`（该目录在 `.gitignore` 覆盖范围内），把**第 1 页**交给模型读出卷名，然后在命令行**停下来等用户确认**：

```
[分类名] 首页识别到：2025年日语期末试卷（2025-01-08 · A卷）
[分类名] 建议目录：data/raw/2025年日语期末试卷/
[分类名] 回车采用 / 直接输入别的名字 / Ctrl+C 取消： _
```

3. 确认之后才创建 `pdf-ocr/work/<分类名>/pages/`，把页图移入，并写同目录下的 `source-manifest.json`。
   `data/raw/<分类名>/` 在这一步**不会被创建**，它只等到 S4 写最终 `.md` 时才出现。
4. 目标目录已存在 → **报错退出**并列出该目录已有文件（不改动、不覆盖）；确实要重做须显式 `--force`。
5. 非交互环境（无 TTY）且未传 `--category` → 直接报错退出，提示显式传参（保证无人值守时不会静默写错目录）。
6. 分类名做 Windows 非法字符过滤（`\ / : * ? " < > |`），并去掉首尾空白。

---

## 5. 执行步骤（每步的输入/输出）

| 步 | 脚本 | 输入 | 输出 | 是否需要网络 |
|---|---|---|---|---|
| S1 | `1_render.py` | `.pdf`、`--dpi` | 先渲染到 `pdf-ocr/work/.tmp/<sha8>/`，**确认分类名（§4.1）**后移入 `pdf-ocr/work/<分类名>/pages/page-00N.png`，并写 `pdf-ocr/work/<分类名>/source-manifest.json`（**不写 data/raw**） | ❌ 本地 |
| S2 | `2_ocr.py` | 页图 | `page-00N.a.review.json`、`page-00N.b.review.json` | ✅ StepFun ×2/页 |
| S3 | `3_merge.py` | 两路 review JSON | `page-00N.merge.json` | ✅ DeepSeek ×1/页 |
| S4 | `4_build_md.py` | 全部 merge JSON | `<分类名>.md`（单文件）、`transcription.md`、`report.md` | ✅ DeepSeek ×1（**全卷终审**：判重/题号顺延/答案对位；`--no-ai-review` 可跳过，结果缓存在 `paper-review.json`） |
| S5 | `5_check.py` | 生成的 .md | 控制台校验报告 + 退出码 + `data/processed/<分类名>-check.json` | ❌ 本地 |
| S6 | `6_publish.py`（内部调 `scripts/parse-computer-paper.ts`） | **通过 S5 的** .md + check.json | `public/<分类名>-question-bank.json` + `data/processed/<分类名>-validation-report.json` + **站点源码 6 处注册** | ❌ 本地 |

**每页独立**：S2/S3 逐页执行，页间不共享上下文，单页失败不污染其它页；S4 才做跨页拼接与全局排序。

---

## 6. 进度输出规范（硬要求）

### 6.1 行格式

```
[<阶段>] page <i>/<n> (<i>/<n>) <状态> <耗时>ms <附加信息>
```

- `<状态>`：`✓` 成功 / `↻` 重试中 / `⚠` 需复核 / `✗` 失败
- 页进度**始终**以 `(i/n)` 出现（i = 当前页，n = 总页数）
- 阶段编号固定 `S1/4`、`S2/4`、`S3/4`、`S4/4`，OCR 两路标 `A`/`B`
- 每页四阶段结束后，额外打印一行**当前步骤 + 总进度**：

```
== 第 3/12 页完成：渲染 ✓ | OCR-A ✓ | OCR-B ✓ | 比对提取 ⚠（2 处冲突）| 校验 ✓ | 累计题数 27 ==
```

### 6.2 输出示例（12 页 PDF）

```
[S1/4 渲染] page  1/12 (1/12)  ✓ 412ms  page-001.png 1654×2339
[S1/4 渲染] page  2/12 (2/12)  ✓ 388ms  page-002.png 1654×2339
…
[S1/4 渲染] 完成 (12/12) ✓ 总耗时 4.9s
[S2/4 OCR-A] page  1/12 (1/12)  ✓ 2180ms 1.9KB  q=1-4
[S2/4 OCR-B] page  1/12 (1/12)  ✓ 2310ms 2.1KB  q=1-4
[S3/4 比对提取] page  1/12 (1/12)  ✓ 11240ms 提取 4 题（冲突 0）
== 第 1/12 页完成：渲染 ✓ | OCR-A ✓ | OCR-B ✓ | 比对提取 ✓ | 校验 ✓ | 累计题数 4 ==
[S2/4 OCR-A] page  2/12 (2/12)  ✓ 2055ms 1.7KB  q=5-8
[S2/4 OCR-B] page  2/12 (2/12)  ↻ 重试 1/3（HTTP 429）3200ms
[S2/4 OCR-B] page  2/12 (2/12)  ✓ 1980ms 1.8KB  q=5-8
[S3/4 比对提取] page  2/12 (2/12)  ⚠ 提取 4 题（冲突 2：第6题选项A / 第8题答案）
== 第 2/12 页完成：渲染 ✓ | OCR-A ✓ | OCR-B ✓ | 比对提取 ⚠ | 校验 ⚠ | 累计题数 8 ==
…
[S4/4 汇总写盘] 跨页拼接 2 题 / 去重 1 题 → 单文件
[S4/4 汇总写盘] data/raw/<分类名>/<分类名>.md ✓ 100 题
[S5/5 校验] 契约检查：题块 100 / 题组 8 / 缺答案 0 / 会被丢弃 0  ✓
[完成] 共 100 题 | 待复核 3 | 失败 0 | 总耗时 6m12s
```

`--quiet` 只保留 `== 第 i/n 页完成 … ==` 与最终摘要。

---

## 7. 中间产物 JSON 契约

### 7.1 OCR 两路（`page-00N.{a,b}.review.json`）

字段与现有 `page-XXX.review.json` **同名同义**，附加调用元信息：

```jsonc
{
  "page": 1,
  "printed_page_labels": ["A-1"],
  "paper_identity": { "title": "…", "date": "…", "variant": "A", "declared_printed_pages": "10" },
  "question_ranges": ["1-4"],
  "page_condition": "clear",              // clear | blurry | cropped | handwritten | mixed
  "transcription_md": "……整页转写（保留原版面）……",
  "corrections": [ { "location": "…", "before": "…", "after": "…", "evidence": "…", "confidence": "high" } ],
  "uncertain": [ { "location": "第1题选项A", "note": "模糊，疑似 ひろった" } ],
  "call": { "pass": "a", "model": "step-3.7-flash", "endpoint": "…", "elapsed_ms": 2180, "usage": {} }
}
```

**提示词：适度异构**（硬约束 7）。两路必须"可比但不相关"：

| | 完全一致的部分（保证可比） | 允许不同的部分（仅 2–3 条，制造差异） |
|---|---|---|
| 角色 | 系统提示词同一句：`你是在做试卷整页转写与结构化提取的助手` | — |
| 输出 | **同一 JSON schema**（上表字段）、同一 `temperature` 与 `max_tokens`、同一图片分辨率 | — |
| 任务 | 都要输出整页 `transcription_md`、都要标 `uncertain` | A 路：强调**逐字转写、保留原版面与换行、先转写后理解**；不确定处尽量只标位置不改字<br>B 路：强调**按题目为单位整理（题干/选项/答案）**、逐项给置信度、允许在明显错字处给出"更可能的读法" |
| 顺序 | 同一字段顺序 | A 路先整页转写再列题目；B 路先列题目再补整页转写 |

> 依据：两路若提示词完全相同，同一模型的错误会高度相关，互校退化为"互相印证错误"；但若差异过大（不同 schema、不同角色），两路结果又无法逐字段比对。所以取"同 schema + 同角色 + 2–3 条侧重差异"的折中。

### 7.2 比对 + 提取（`page-00N.merge.json`，DeepSeek 单次调用）

```jsonc
{
  "page": 1,
  "paper_identity": { "title": "…", "date": "…", "variant": "A" },
  "conflicts": [
    { "question": 6, "field": "options.A", "a": "ちゅうし", "b": "ちょうし",
      "chosen": "ちゅうし", "reason": "A 路该处未标 uncertain，且与题干汉字一致",
      "confidence": "medium" }
  ],
  "deduped": [                                  // 页内判重删掉的题（§32.2）
    { "number": 8, "keptNumber": 7, "stem": "…", "reason": "题干与选项完全相同（判为重复，已删除）" }
  ],
  "normalized": [                               // 确定性字段格式化（§33）
    { "number": 1, "field": "answerKey", "before": "c,a", "after": "AC" },
    { "number": 1, "field": "questionType", "before": "多选题", "after": "multi" }
  ],
  "questions": [
    {
      "number": 1, "group": "题组一", "groupTitle": "汉字读音选择",
      "stem": "駅で財布を**拾った**んだけど、…",
      "options": [ { "key": "A", "text": "…" }, { "key": "B", "text": "ひろった" } ],
      "answerKey": "B", "answerText": "ひろった",
      "explanation": "…", "translation": "…",
      "confidence": "high", "needs_review": false,
      "continued": false,                    // 是否跨页断题（题干/选项被页边界切开）
      "source": { "page": 1 }
    }
  ]
}
```

判定规则：
- 同一题同一字段两路不一致 → **必进** `conflicts[]`，模型须给出 `chosen` 与 `reason`。
- `confidence != high` 或存在未消解冲突 → 该题 `needs_review: true`，进 `report.md`（附 A/B 原文对照）。
- 页边界处题干/选项不完整 → `continued: true`，交给 S4 拼接。
- **确定性兜底**：两路在"格式无关字段"（`printed_page_labels` / `question_ranges` / `page_condition` / `paper_identity`）上不一致时，即使模型没报冲突，工具也补一条 synthetic conflict 并把整页标 `needs_review`。
  > 为什么不比转写文本：两路提示词刻意异构（A 逐字保版面、B 按题结构化），`transcription_md` 的排版本来就不同，做文本相似度会大量误报；只有上面这几个字段可以稳定逐字段比。
- **题号覆盖 / 题数匹配兜底（P4 后补，见 §24）**：把两路 `question_ranges` 的**并集**与"实际提出的题号"对账 ——
  少了（模型静默漏抽）/ 多了（编题号）/ 同页重复 → 补 synthetic conflict（`field` 为 `question_coverage`
  或 `question_number_duplicate`）并整页标 `needs_review`。
- **只有一路成功**时（另一路失败）仍照常提取，但整页标 `needs_review`，并在 `notes[]` 里注明缺哪一路。

---

## 8. `.md` 生成规则（S4）

### 8.1 基本规则

1. **排序**：跨页拼接后按全局题号升序，**全部写进同一个文件**（无分批）。
2. **题组归属**：`## 题组X：名称` 可能被页边界截断（下一页只剩"（续）"），以最近一次完整标题为准；同一题组只输出一次标题。
3. **去重**：键 = `题号 + 归一化题干`（去空白/标点/大小写，思路同 `parse-history-markdown.ts`）；命中时保留信息更全的一份并记入报告。
4. **题号优先用卷面原题号**（P6 回填 + 用户 2026-09-22 确认的口径）：
   解析端的 `parse-japanese-2024-markdown.ts:355` 把 `### 第N题` 的 N 直接当 `numberInGroup` 存库，
   所以**尽量**照卷面写（这份期中卷是 1–41 连续编号）。
   但**不强求一一对应**：一道大题拆成多个小题时，各小题各自编号即可；
   题号有缺口不算硬错误（`5_check.py` 只报警告，见 §9）。
   > 实现上就是"`number` 直接用 `merge.json` 的原始题号"，S4 不做重编号 —— 所以拆题/跳号都天然支持。
5. **题组怎么分**（`--group-by`，默认 `paper`）：
   - `paper`（默认）＝ **全卷 1 张题单** —— 取消「选择题 / 判断题 / 数值转换题」这类题型划分（用户 2026-09-22 要求）。
     md 里只留一个 `## 题组一：<卷名>` 标题（不留的话解析端会把所有题挂到 `g00`、题单名为空字符串）。
   - `type` ＝ 按原卷题型分题组（`## 题组一：数值转换题`、`## 题组二：选择题`…）。
   > 注意：**题组标题里 `：` 后面的名字，参考解析器其实取不到**（见 §26.2）—— 题单名是 P6 的 parser 自己决定的。

### 8.2 跨页断题拼接（硬约束 8，必须执行）

识别：`merge.json` 中 `continued: true` 的题目（页尾题干被切断，或选项/答案出现在下一页页首）。

拼接算法（按序尝试，第一条成功即停）：

1. **按题号配对**：第 i 页尾部的 `continued` 题（题号 N）与第 i+1 页首部同为题号 N 的片段 → 两者合并：题干按顺序拼接、选项按 key 去重合并、答案取有值的一侧、解析两侧拼接。
2. **按"题号缺失"配对**：若下一页首部的第一个题目编号 ≠ N+1（说明第 N 题的剩余部分没有独立编号）→ 把下一页首部（在第一个 `### 第N+1题` 之前的全部内容）并入第 N 题。
3. **兜底**：以上都不成立 → 该题保持现状、置 `needs_review = true`，在 `report.md` 记录"疑似跨页断题未拼接"，**但仍输出**（不丢题）。

拼接后必须重新做一次字段完整性检查（题干非空、选项 ≥ 2、有答案），不满足则同样标 `needs_review` 并进报告。

### 8.3 输出模板

```markdown
# <分类名>

> 来源：`<原 PDF 文件名>`（sha256 前 8 位：`9f3c1a2b`，共 12 页）
> 生成：双路 step-3.7-flash OCR + deepseek-flash 比对提取；待复核项见 `ocr/report.md`

## 题组一：汉字读音选择

### 第1题

#### 题目

<题干>

A. …
B. …
C. …
D. …

#### 答案与解析

**正确答案：B ひろった**

<解析正文>
```

待复核标记（**不破坏 parser**，引用行会被跳过，依据 `:289`）：

```markdown
> ⚠ 待核对（OCR 冲突）：选项 A 两路不一致（A 路「ちゅうし」/ B 路「ちょうし」），详见 report.md
```

### 8.4 公共题干（题组导言）复制到每一道小题

**问题**：匹配题 / 代码填空题里，一个题组的小题共用一段导言（说明 + 代码块），
小题自己的文字只剩 `(30) の選択肢：` 这样的占位符。导言只出现一次，**不补的话每道小题都读不懂**。

**做法（用户 2026-09-22 明确要求）**：**把导言原样复制进该题组每一道小题的 `#### 题目` 正文最前面**，
让每个小问**独立成题** —— 单看任意一题（错题本、单题分享、搜索命中）都不缺上下文。

```markdown
## 题组五：题组一

### 第30题

#### 题目

以下は C 言語と対応する MIPS コードの空欄を A～D で答えよ。…

```
1  sll $t0, $s2, (31)
2  (30) $t0, $t0, $s0
```

(30) の選択肢：

A. add
B. sll
```

> **备选方案（已评估，未采用）**：md 里用 `**文章：**` 只写一次，让解析端的 `extractArticles()`
> （`:150-209`）自动粘到其后每一道题上（`stemWithArticle`，`:350-351`）。
> 好处是**存库的题干保留导言原换行**（代码块能渲染成代码块）；
> 坏处是 md 里看不到"每个小问的完整题干"，且小题与题组强耦合。用户选择了复制方案。

**⚠️ 副作用（必须知道，已定处理方式）**：参考解析端拼存库题干时会把行内换行压成空格
（`cleanStem += (cleanStem ? ' ' : '') + trimmed`，`:296`），所以复制进 `#### 题目` 的导言
**在题库里会变成一整行**，代码围栏会以 ```` ``` ```` 字面文本出现在题面里。

> **决定（用户 2026-09-22）**：**保持复制**，**P6 的 parser 必须保留题干换行**（不要照抄 `:296` 的压平逻辑）。
> 这样 md 与站点都是代码块：每个小问独立成题 + 渲染正常。已列入 §22.6 的 P6 待办。

**导言从哪来**（按可靠性排序，S4 自动取）：

| 来源 | 说明 |
|---|---|
| 1. **第一道小题的题干** | 提示词规则 6a 要求模型把导言抄在该题组**第一道**小题的 stem 开头。S4 从那里切：① 以**最后一个代码围栏**收尾 ② 以小题占位符（`(30) の選択肢：`）开头。这份最完整（带代码围栏） |
| 2. `merge.json` 的 `groupTitle` | 模型偶尔会把整段导言塞进题组标题（实测出现过 176 字的标题）。S4 检测到就把它挪出来，题组标题改回 `题组X` |
| 3. **整页 OCR 转写** | 取"`X、<题组名>` 标题行 → 该题组第一个小题行"之间的文本。用于模型没按 6a 抄导言的情况 |

**防误伤**：只有当题组"确实像共用导言"时才复制——导言取自第一道小题题干、或 ≥2 道小题题干是占位符、
或导言含代码块、或导言较长。实测题组七（`swは何形式か。` 这种"短但自足"的题干）不会被误伤。

**防重复**：某一题的题干开头已经把导言抄了一遍时，按**归一化后的最长公共前缀**切掉原有那份，
再补上标准的一份 —— 保证每道小题的题干里导言**恰好出现一次**（实测：41 题里 30–37 各 1 份，其余 0 份）。

**题组号必须解析对**：模型的 `group` 写法不稳定，同一页两次运行分别给出 `'六、题组二'` 和 `'题组二'`。
后者如果按"取第一个中文数字"会被当成**题组二**，把第 36/37 题并进前面真正的题组二里。
S4 的解析顺序是：① 行首 `六、` ② 光秃秃只有一个号码 `二` ③ **回整页转写里找 `X、<题组名>`** ④ 都没有才沿用上一题。

**其它两个必须处理的坑**（`sanitize_block()`）：

- 行首 `#` 会被解析端跳过（`:289`）→ 去掉行首井号；
- 行首 `A.` 会被解析端**当成选项**、并把它后面的题干整段丢掉（`:277-297`）→ 前面加一个 HTML 注释挡住（渲染时不可见）。

### 8.5 答案解析（`explanation`）与来源标记

**卷面大多只印答案、不印解析**，所以 S3（`3_merge.py`）的提示词规则 7 要求模型：

| 情况 | `explanation` | `explanationSource` |
|---|---|---|
| 卷面印了解析 | 原样抄录 | `"printed"` |
| 卷面没印 | **自己写一句 ≤80 字的解析**（说清为什么选它、错在哪，不许写"根据题意可知"） | `"generated"` |
| 没读懂 / 没把握 | 留空 | `"none"`（**不许编造**） |

S4 把 `generated` 的解析末尾补一行可见标记：

```markdown
**正确答案：B 105**

01101001=64+32+8+1=105，故选 B。A 项漏算高位…

> ⚙ 解析由 AI 生成（未经人工核对）
```

**P6 靠这一行判 `explanationSource`**（站上 `answerProvenance` 是个纯数据字段、UI 不显示，
所以标记留在解析正文里，读者看得见）；同时把 S3 的 `explanationSource` 写进题库的 `Question.explanationSource`。

> ⚠️ **两个解析端的历史坑**（P6 的薄入口已经处理）：
> 1. 解析端把 `#### 答案与解析` 之后的**全部内容**（含开头那行 `**正确答案：X …**`）都塞进 `explanation`，
>    而仓库既有题库（`computer-midterms` / `japanese2`）的 `explanation` **不含答案行** ——
>    不剥掉会在站上把答案显示两遍。
> 2. 解析是从原始行拼的，**CRLF 会原样留在每行末尾** → 统一转成 LF。

---

## 9. 离线契约校验（`5_check.py`）—— 硬门禁

复用 parser 的同一套正则，对生成的 `.md` 做**不调 API、不写盘**的检查；**不通过就不允许入库**：

| 检查项 | 说明 |
|---|---|
| 题块数 / 题号连续性 | `### 第N题` 数量与编号是否缺号、重号 |
| 题组标题规范 | 是否 `## 题组{中文数字}：…` |
| 选项与答案 | 选项 ≥ 2；`**正确答案：X**` 存在且 X 落在选项内（**X 可以是多个字母**，如 `AC`，最多 5 个；字母到 E） |
| **会被 parser 丢弃的题** | 按 `:349` 条件预演，任何会被丢弃的题**必须报出** |
| 截断风险 | 解析区内是否混入 `## ` 开头行 |
| 跨页拼接结果 | `continued` 题是否都已拼接或已标 `needs_review` |
| 题组题数与标题声明 | 题组标题写了「共 N 题」的，按**整份 md**数一遍实际题数（一个题组可能横跨两页，所以只能在 S5 数） |

退出码：`0` 全绿；`2` 有警告（待复核）；`3` 有硬错误（缺答案/重复题号/会被丢弃）。

**校验结论落盘**（S6 的发布门禁读它）：`data/processed/<分类名>-check.json`
（放在 `data/processed/` 而不是 gitignore 的 `pdf-ocr/work/`，**随仓库入库**，新克隆也能直接发布）：

```jsonc
{ "category": "…", "md": "data/raw/…/….md", "md_sha256": "…", "checked_at": "…",
  "exit_code": 2, "passed": true, "questions": 41, "groups": 1,
  "parser_kept": 41, "parser_dropped": 0, "hard_errors": [], "warnings": ["带待复核标记 8 处"] }
```

---

## 10. 失败、重试与续跑

- 重试：`429/5xx/超时` 指数退避（默认 3 次，`--max-retries`）；`4xx` 直接记失败。
- 单页失败不阻断：记入 `source-manifest.json.errors` 与 `report.md`；最终退出码 `3`。
- 续跑：默认按 `completed_pages` + 产物存在性跳过已完成步骤；`--force` 全量重跑。
- 幂等：重跑不重复写 `.md`（临时文件 + 原子改名）；已存在的目标文件默认拒绝覆盖。
- **成本护栏（§18.5）**：每次请求带 `max_tokens`；`--budget-tokens` 在每次调用前检查，超了**停在当前页**（已完成页全部落盘，可续跑）并返回退出码 **4**；`--total-budget-tokens` 基于 manifest 里累计的 `usage`，已超则**拒绝开工**（退出码 4）。`usage` 跨运行累加，可用来看历史消耗。

## 11. 依赖与安装

```bash
pip install pymupdf requests
# requests 本机已装；pymupdf 需新装（本机已装 1.28.2）。
# .env 由脚本自行解析，不需要 python-dotenv。
# 可选（图片预处理/去噪）：pip install pillow
```

无需 poppler / ImageMagick / Ghostscript；无需 Node 侧新增依赖。Token 消耗评测见 §18。

## 12. 安全

- 密钥只从 `.env` / 环境变量读取；**不打印、不写进任何产物**；日志对 `Authorization` 脱敏。
- 两条路径白名单：最终产物必须落在 `data/raw/` 下、中间产物必须落在 `pdf-ocr/work/` 下，都拒绝 `..` 与绝对路径逃逸。
- 文件名过滤 Windows 非法字符（`\ / : * ? " < > |`）。
- 全程 `encoding='utf-8'`；`setup_stdio()` 把 stdout/stderr **和 stdin** 都固定为 UTF-8（对齐既有 `_extract.py` 写法；stdin 若不固定，管道传入的中文会按 ANSI 代码页解码成乱码）。

## 13. 实施计划（评审通过后按序做）

| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| **P1** | `_common.py` + `1_render.py`：PyMuPDF 渲染、**分类名确认流程（§4.1）**、manifest、进度输出 | 对真 PDF 跑通 S1，控制台输出符合 §6；两条路径都验证：①交互确认后建目录并写 manifest；②目标目录已存在时报错退出、不动既有文件 | ✅ 见 §15 |
| **P2** | `2_ocr.py`：两路"适度异构"提示词 + 重试 + `review.json` | 单页两路产物齐全；断网能看到 `↻` 重试行 | ✅ 见 §16（含 §18.5 成本护栏） |
| **P3** | `3_merge.py`：DeepSeek 比对+提取 + schema 校验 | 构造两路故意不一致的输入，能产出 `conflicts[]` 且 `needs_review` 正确 | ✅ 见 §17（含 §18.5 成本护栏） |
| **P4** | `4_build_md.py` + `5_check.py`：跨页拼接 + 单文件成文 + 契约门禁（**范围不变：只产出 `data/raw/<分类名>/<分类名>.md`，不碰网页**） | `5_check.py` 全绿；抽查题号/答案与页图一致 | ✅ 见 §23（真·TS 解析器端到端验收通过） |
| **P5** | 追加 `.env.example` 的 6 行 API 配置（保留既有 `ANTHROPIC_*`）+ 本文档回填实测命令与耗时 | `.env.example` 内容与 §2.4 一致；文档与实际行为一致 | ✅ `.env.example` 已追加、`.env` 已建（密钥留空）；实测记录见 §15/§16 |
| **P6** | **网页接线**（本轮新增，从 P4 拆出）：md → `public/<key>-question-bank.json` → 5 处注册，让新试卷在网站上出现 | 落地页多一张卡片、`/home` 能进去刷题、`_meta.json` 计数正确、`vitest` 全绿 | ⏳ 排在 P4 之后，调研见 §22 |

## 14. 决策记录（已定稿）

| 项 | 结论 |
|---|---|
| StepFun 端点 | **沿用原来的**：`https://api.stepfun.com/step_plan/v1/chat/completions` |
| 模型版本默认 | `STEPFUN_MODEL=step-3.7-flash`（两路 OCR）／`DEEPSEEK_MODEL=deepseek-flash`（比对+提取） |
| `.env` 变量命名 | `STEPFUN_*` / `DEEPSEEK_*`；`.env` 只放那 6 行，其余配置走命令行参数 |
| 分类名 | 未传 `--category` 时：AI 提议 → **用户确认**（§4.1）；非交互环境必须显式传参 |
| 最终输出 | **单文件** `data/raw/<分类名>/<分类名>.md`，不分批 |
| 格式 | 硬契约（§2.1），由 `5_check.py` 强制门禁（§9），不合规不产出 |
| 双路提示词 | 同角色 / 同 schema / 同采样参数，仅 2–3 条侧重异构（§7.1） |
| 跨页断题 | **必须拼接**（§8.2 三步算法），失败则标 `needs_review` 但不丢题 |
| OCR 产物约定 | 镜像 `data/raw/computer-organization/ocr/`（§2.2） |
| 现有数据 | 一律不改：`data/raw/` 下只新增最终的 `<分类名>.md`；中间产物全部留在 `pdf-ocr/work/` |

**下一步**：P1–P5 全部完成（见 §15 / §16 / §17 / §23）。接着做 **P6**（把 md 接进网站：题库 JSON + 5 处注册），
调研结论见 §22。开工前建议先补掉 §23.5 里那两个问题（S3 漏抽的 2 题）。

---

## 15. P1 实测记录

环境：Python 3.14.2 · PyMuPDF 1.28.2（`pip install pymupdf`）· 输入用 `Desktop\机组\4.pdf`（28 页）与 `3.pdf`（29 页）

| 用例 | 命令要点 | 结果 |
|---|---|---|
| A 显式分类名 | `1_render.py "…\4.pdf" --category _p1-smoke --dpi 150` | 退出码 0；28 张 PNG + `source-manifest.json`；**17 项格式/manifest 断言全通过**（进度行匹配 §6 正则、`page i/n` 与 `(i/n)` 自洽、每页一行完成行、manifest 沿用现有约定字段并附 `ocr_passes`/`merge_model`） |
| B 目标目录已存在 | 同 A 再跑一次 | 退出码 1，列出已有文件；既有 `source-manifest.json` 哈希不变（**未动既有数据**） |
| C 交互确认（管道给名字） | `'2025年日语期末试卷' \| 1_render.py "…\3.pdf" --dpi 100 --pages 1-2` | 退出码 0；中文分类名正确；第 1 页从 `pdf-ocr/work/.tmp/<sha8>/` 移入工作目录后暂存目录清空 |
| D 无人值守无分类名 | stdin=DEVNULL | 退出码 1，提示「请显式传 `--category`」，**未创建任何目录** |
| E 只渲染部分页 | `--pages 1-3` | 退出码 0，只生成 3 页 |

实测中发现并修掉的两个 bug（都属于"换个环境就会炸"的类型）：

1. **管道传中文被按 ANSI 代码页解码**：分类名变成乱码且带孤立代理字符 → `setup_stdio()` 现在把 **stdin 也显式按 UTF-8 读取**（真实控制台输入走 Windows 宽字符 API，不受影响）。
2. **`pixmap.save(路径)` 走 C 字符串**：遇到不可编码字符报 `argument 2 of type 'char const *'` → 改为 `pixmap.tobytes("png")` + `Path.write_bytes()`。

另外记录两个环境事实，便于以后复现：

- PowerShell `>` 重定向会把子进程输出写成 **UTF-16LE**（脚本自身输出是 UTF-8），校验脚本需自动识别编码。
- 仓库根 `.env` 已建好（**密钥留空，等你填**）：`STEPFUN_API_KEY` 为空时，分类名提议会回退到 PDF 文件名，`2_ocr.py` 会直接提示缺密钥。填上密钥后再验证"模型读图"与真实 OCR 调用。

---

## 16. P2 实测记录

产物：`pdf-ocr/2_ocr.py`（+ `_common.py` 的 HTTP 层重构：单次 `post_json` 抛 `ApiError(retryable)`、`call_with_retry` 负责退避、`image_data_url`、`extract_json_object`）

**验收方式**：本机没有密钥，所以用**离线桩**替掉 `_common.post_json`（记录每次请求的 system/user/温度/模型/图片长度，并让 B 路第一次返回 `HTTP 429`），跑 `2_ocr.py` 的真实主流程。**22 项断言全部通过**：

| 类别 | 断言要点 | 结果 |
|---|---|---|
| 流程 | 退出码 0；共 **7 次调用** = 3 页 × 2 路 + 1 次 429 重试；输出含 `↻ 重试 1/3`；进度行含 `(i/n)` | ✅ |
| 产物 | 6 个 `page-00N.{a,b}.review.json`；键与现有 `review.json` 约定一致（另加 `uncertain[]`/`call{}`）；`paper_identity` 四键齐全；`call` 记录 pass/model/端点/耗时 | ✅ |
| 提示词异构 | **系统提示词两路完全一致**、schema 块一致、temperature 一致、model/端点一致；**只有侧重文本不同**（A 含"逐字转写"、B 含"按题结构化"，互不包含）；同一页两路用同一张图（data URL 长度相同） | ✅ |
| 失败路径 | 让桩恒返回 `HTTP 400` → 退出码 **3**，输出行含 `✗`，错误写进 `manifest.errors` | ✅ |
| 缺密钥路径 | 无 `STEPFUN_API_KEY` → 退出码 **1**，提示"在仓库根 `.env` 里填 `STEPFUN_API_KEY`" | ✅ |
| 续跑 | 已存在的 `review.json` 默认跳过（`--force` 才重跑）；`manifest.documents[0].ocr_pages` 回写为已完成两路的页号 | ✅ |

**待真实密钥冒烟确认的一处（唯一外部不确定项）**：StepFun `step_plan/v1/chat/completions` 的**请求体形态**（我按 OpenAI 兼容 vision 实现：`messages[0]=system`、`messages[1].content=[{type:text},{type:image_url}]`、`temperature: 0`）。拿到密钥后先跑单页：

```bash
python pdf-ocr/2_ocr.py --category <分类名> --pages 1
```

若报 400/422，只需改 `2_ocr.py` 的 `build_payload()` 一处；`normalize_review()`、进度输出、重试与账本逻辑都不用动。

---

## 17. P3 实测记录

产物：`pdf-ocr/3_merge.py`（每页一次 `deepseek-flash` 调用 → `page-00N.merge.json`）

**验收方式**：同样用离线桩替掉 HTTP（`_common.post_json`），并**手写两路故意不一致的 review.json** 造场景。**33 项断言全部通过**：

| 类别 | 断言要点 | 结果 |
|---|---|---|
| 流程 | 退出码 0；4 次调用 = 3 页 + 1 次 429 重试；输出含 `↻ 重试 1/3`；进度行含「提取 N 题（冲突 M）」；有冲突页显示 `⚠` | ✅ |
| 冲突识别（P3 验收项） | 第 1 页：模型报的冲突原样保留（`options.A`），`chosen`/`reason` 齐全 | ✅ |
| **确定性兜底** | 第 2 页故意让两路 `question_ranges` 不一致（`3-4` vs `3`）而**让桩返回 0 冲突** → 工具补出 `field=question_ranges` 的 synthetic conflict、`confidence=low`、`notes` 注明来源、整页 `needs_review=true` | ✅ |
| 缺一路 | 第 3 页只有 A 路 → `notes` 写"缺少 OCR 路 B…"、整页 `needs_review=true`，**仍提取到题目** | ✅ |
| 归一化 | 题号转 int、`answerKey` 转大写、`source.page` 记录；**答案不在选项里 → `needs_review` 收紧为 true**；无选项的题 `options=[]` 且答案进 `answerText` | ✅ |
| 跨页信号 | `continued: true` 原样透传给 S4 | ✅ |
| 提示词 | 同时含两路转写正文（各自独有标记都能在提示里找到）、含 schema 与规则、`temperature=0`、带 Authorization、系统提示词统一、**未把图片塞进 merge 请求**（纯文本比对） | ✅ |
| 续跑 | 第二次运行 0 次调用、打印「已存在，跳过」 | ✅ |
| 失败/缺密钥 | 恒 `HTTP 400` → 退出码 3 且写进 `manifest.errors`；缺 `DEEPSEEK_API_KEY` → 退出码 1 并提示写进 `.env` | ✅ |
| 账本 | `manifest.documents[0].merge_pages` 回写为已完成页号 | ✅ |

---

## 18. Token 消耗评测（实测口径）

> ⚠️ **本章是"按字符数推算"的估算，已被 §21.4 的真实账单替换**：一份 4 页试卷实测 **24.2k token/页**
> （OCR 15.2k + merge 9.0k），明显高于本章的区间 —— 差在**推理模型的思维链**（merge 出参的 40%~86%）。
> 做预算请用 §21.4 的数。

**测量方法**（不调 API、不写盘）：

- **页图**：用 PyMuPDF 对真实 PDF（`Desktop\机组\3.pdf` 第 1 页）在 150/200/300 dpi 下真实渲染，取像素与 PNG 字节；
- **提示词与出参**：直接调用 `pdf-ocr` 里的真实代码取长度 —— `2_ocr.build_payload()` / `3_merge.build_payload()` / `normalize_question()`；
- **文本语料**：`data/raw/japanese/2024年日语期末试卷_整理版.md`（99 题），实测每题"题目+选项"= **131.7 字符**。

### 18.1 每页账本（一页按 5 题、页图 200 dpi）

| 阶段 | 输入 | 输出 | 备注 |
|---|---|---|---|
| OCR-A | 625~1,043（文本）+ **1,105~2,316（图）** | 转写（进下一步） | 提示词实测 1,043 字符（系统 65 + schema 802 + 侧重 176） |
| OCR-B | 同 A（两路等量） | 同上 | |
| merge | 1,665~2,775 | 1,293~2,155 | 输入实测 2,775 字符 = 两路转写 + schema/规则（`build_payload` 真实输出） |
| **每页合计** | | | **≈ 6.4k ~ 11.6k token**，其中图像占 **38%~46%** |

整卷：**15 页（≈100 题）≈ 96k ~ 175k**；28 页 ≈ 180k ~ 326k。平均每题约 **1.3k ~ 2.3k** token。

### 18.2 两个口径的不确定性（这是区间宽的原因）

- **图像 token** 按两种主流口径给区间：OpenAI 分块式（短边缩到 768、按 512 分块，`85+170×块数`）≈ **1,105/页**；Anthropic 面积式（长边缩到 1568，`面积/750`）≈ **2,316/页**。StepFun 的真实口径未知。
- **CJK 文本** 按 **0.6~1.0 token/字符** 给区间（中文/日文 BPE 通常在这个范围）。
- **真实值以接口返回的 `usage` 为准**：P2/P3 已经把每次调用的 `usage` 写进 `call.usage`（`page-00N.{a,b}.review.json` 与 `page-00N.merge.json`），跑通一页后即可按页求和标定。

### 18.3 三个实测结论

1. **提高 dpi 几乎不增加 token**：150→200→300 dpi，两种口径的图像 token 都不变（都被服务端/口径缩放到阈值内），涨的只是上传体积 —— PNG 69/97/158 KB，base64 后 92/129/211 KB。所以 OCR 认不清小字时，**提高 dpi 的 token 代价很小，代价在传输与耗时**。
2. **文本占了过半**：图像只占 38%~46%，其余是"两路转写（进 merge）+ merge 出参 + 提示词"。所以省 token 的重点不只是图。
3. **提示词本身很小**（OCR 1,043 字符 / merge 1,107 字符），相对每页 660 字符的转写量，属于固定成本，**不必为它做缓存优化**。

### 18.4 降本杠杆（同一页 5 题）

| 做法 | 效果 | 代价 |
|---|---|---|
| 只跑一路 OCR（`--passes a`） | 每页约 **−38%** | 失去互校；`merge` 会把整页标 `needs_review`（已在实现里兜住） |
| merge 只喂题干+选项、不喂整页转写 | merge 输入约 **−30~40%** | 失去版面互校能力，冲突更难发现 |
| dpi 从 200 降到 150 | token ≈ 不变，上传 −29% | 小字识别率可能下降 |
| 页图先二值化/裁白边（未实现） | 若能把短边压到 768 以下可减少分块 | 需加 PIL 预处理，增加一道风险 |

### 18.5 成本护栏（已实现，P2/P3）

**问题**：`max_tokens` 不设时模型可以话痨，多余内容虽然会被 `extract_json_object()` 丢掉，**但照样计费**；重试与反复重跑也会把账放大。

| 护栏 | 位置 | 默认 | 行为 |
|---|---|---|---|
| `--max-tokens` | 每次请求体 | OCR **10000000** / merge **393216** | 单次响应上限。**2026-09-22 按用户要求放开到各端点允许的最大值**（详见 §20.5）：OCR 侧 StepFun 不校验、自设 10,000,000；merge 侧 DeepSeek 合法区间恰为 `[1, 393216]`，写 10000000 会被 HTTP 400 打回。历史沿革：OCR 2048 → 4096 → 放开；merge 4096 → 6144 → 放开。超过上限时脚本**在发请求前**就报错退出（退出码 1），不会变成"每页刷一次 HTTP 400" |
| `--budget-tokens` | 每次调用**之前** | `0`（不限） | 本次运行累计上限。超了**停在当前页**（已完成页全部落盘、可续跑），打印 `预算已用尽…`，退出码 **4** |
| `--total-budget-tokens` | 开工前 | `0`（不限） | 跨运行累计上限，读 manifest 里的 `usage`；已超则**拒绝开工**（退出码 4），避免"反复调用"把账烧穿 |
| `--max-retries` | 每次调用 | `3` | 429/5xx 才重试；4xx 直接记失败不重试。**第 2 次起自动追加纠偏提示**（见 §19） |
| 续跑 | 每页 | 开 | 已存在的 `review/merge.json` 默认跳过，只有 `--force` 才重烧 |
| Ctrl+C | 进程级 | — | 友好退出（退出码 **130**），提示产物已落盘、重跑自动续跑 |

**用量账本**：每次调用把接口返回的 `usage` 累加进 `pdf-ocr/work/<分类名>/source-manifest.json` 的 `usage` 块（`calls` / `tokens` / `updated_at`，跨运行累加）；每页完成行与脚本结尾都会打印 `[用量] 本次调用 N 次 / X tok；该分类累计 M 次 / Y tok`。`usage_tokens()` 兼容 `total_tokens`、`prompt+completion`、`input+output` 三种字段形态。

**验收（30 项断言全过）**：预算 5000 + 每次 2000 → 第 3 次调用前停下、退出码 4、已完成的 3 个产物落盘、`usage` 记为 3 次/6000 tok；续跑只补剩余 3 次；累计超限时拒绝开工且**一次调用都不发**；`--max-tokens 777` 确实进请求体；P3 同样行为（含 `input/output` 口径累加）。

---

## 19. 真实冒烟记录（第一次，StepFun 已配上密钥）

**跑法**：`python pdf-ocr/2_ocr.py --category LL11512 --pages 3`（S1 已把 37 页渲染进 `pdf-ocr/work/LL11512/`）

### 19.1 好消息：外部不确定项解决了

- 端点/模型/密钥**全部可用**：真实回复、单次耗时 15~18s。
- **请求体形态确认无误**（OpenAI 兼容 vision：`messages[0]=system`、`messages[1].content=[{text},{image_url}]`）—— 这是之前唯一没验证的外部假设。

### 19.2 暴露的三个问题与修复

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | `↻ 重试 1/3（JSON 解析失败：Expecting ',' delimiter: line 3 column 91）` | 模型把整页转写写进 JSON 字符串时用了**裸换行**（不是 `\n`）→ 非法 JSON。长转写必然撞上 | `extract_json()` 新增容错：字符串内控制字符自动转义、去尾随逗号、**逐步回退的截断修复**；并返回 `{repaired, truncated}` 元信息 |
| 2 | `↻ 重试 2/3（回复里找不到 JSON 对象）`，且**看不到模型到底回了什么** | 模型这次回的是纯文字（或正文在别的字段里，如 `reasoning_content`）。原来只读 `message.content`，失败时也不打印原文 | `response_text()` 依次尝试 `content` / `reasoning_content` / `reasoning` / `text`（支持分段数组）；失败信息里**带上原文预览**（`preview()` 压成一行，200 字） |
| 3 | 同一路连续重试 3 次 = 烧 3 倍 token | 重试时原样重发，模型很可能重蹈覆辙 | 第 2 次起自动在提示词末尾追加**纠偏提示**：「只输出一个 JSON 对象、不要围栏、字符串内换行写成 `\n`」 |
| 4 | 之前那个 Traceback | 大概率是 Ctrl+C（`KeyboardInterrupt` 未处理） | `KeyboardInterrupt` 友好退出（退出码 130），提示产物已落盘、可续跑 |
| 5 | 密排页更可能被截断 | `max_tokens=2048` 对长转写不够（该 PDF 第 3 页原图 434KB、第 32 页 1.35MB） | 默认上调 **OCR 2048→4096 / merge 4096→6144**；并记录 `finish_reason`，`length` 时打告警提示加大 `--max-tokens`（这两个默认值后来已按 §20.5 放开到端点上限） |

产物里新增三个可核查字段（都在 `call{}` 里）：`finish_reason`、`json_repaired`、`json_truncated` —— 出现 `truncated: true` 就说明该页该调大 `--max-tokens`（**§20.5 之后默认值已是端点上限**；此时再截断说明撞的是模型自身生成长度，只能拆页或换模型）。

### 19.3 验收（21 项断言全过，全部离线复现上述形态）

- **裸换行**：`{"transcription_md": "第一行␊第二行"}` → 自动转义后解析成功，标 `repaired: true`
- **截断**：切在字符串中间 → 保住半截文本；切在 `"title": ` 之后 → 丢掉不完整键值，仍返回可用对象；两种情况都标 `truncated: true`
- **纯文字回复** → 报错带原文预览（`抱歉…`）；**正文在 `reasoning_content`** → 能正确取到
- **端到端**：第 1 页 A 路裸换行、B 路纯文字（触发纠偏重试后成功）、第 2 页 A 路截断 + `finish_reason=length` → **全部落盘、退出码 0**，`json_repaired` / `json_truncated` / `finish_reason` 都记对
- **持续失败** → 退出码 3，错误行里能看到模型原文（便于定位）

### 19.4 下一步

直接重跑同一页即可（已完成的页会自动跳过，不重复计费）：

```bash
python pdf-ocr/2_ocr.py --category LL11512 --pages 3
```

如果仍失败：日志现在会带**模型原文预览**与 `finish_reason`；若预览显示是**半截 JSON**，说明被截断 → 调大 `--max-tokens`（如 `--max-tokens 8192`）；若是**纯文字**，把预览发我，按模型的真实回复形态再调整提示词。

---

## 20. 真实冒烟记录（第二次：S3 比对阶段）

**跑法**：`python pdf-ocr/3_merge.py --category LL11512 --budget-tokens 200000`（首跑 37 页全部 ✗）

### 20.1 拦路错误：模型名不存在

```
HTTP 400：{"error":{"message":"The supported API model names are deepseek-flash,
deepseek-v4-pro, but you passed deepseek-v4.1-flash."}}
```

**排查**（不猜，直接问端点）：

```bash
python -c "import json,urllib.request; ... 'https://api.deepseek.com/v1/models'"
# → {"data":[{"id":"deepseek-flash"},{"id":"deepseek-v4-pro"}]}
```

该端点**只有两个名字**，原定的 `deepseek-v4.1-flash` 是想象出来的版本号。

| 处置 | 位置 |
|---|---|
| 默认值与 `.env` 全部改为 **`deepseek-flash`**（flash 档，对应"比对用便宜快模型"的初衷） | `.env`、`.env.example`、`pdf-ocr/_common.py` `DEFAULTS` |
| 想换 pro 档只改 `.env` 一行 `DEEPSEEK_MODEL=deepseek-v4-pro`（实测同样可用，延迟约 2×） | — |

> 顺带发现：`.env.example` 里既有的 `ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash` 也是不存在的名字，`scripts/enrich-explanations.mjs` 若要真跑得先确认可用模型。本轮按要求未动该文件的那三行。

### 20.2 更隐蔽的坑：这个端点只提供**推理模型**

连上以后 `call.usage` 里出现 `completion_tokens_details.reasoning_tokens`（第 1 页 103、第 3 页 874），
且极小 `max_tokens` 的探针回复是 `content: ""` + `reasoning_content: "<思维链>"` + `finish_reason: "length"` ——
即 **max_tokens 会先被思维链吃掉**，正文可能一个字符都不剩。

`response_text()` 恰好会把 `reasoning_content` 当正文兜底，于是这种情况的表现是
`回复里找不到 JSON 对象（原文预览：我先想想……）` —— 和 §19.2 里查了三轮的那个坑一模一样，
只是这次根因是 **max_tokens 不够**，不是模型话痨。

**修复**：
- 拆出 `response_text_ex(response)` → `(正文, 取到的字段名)`，`response_text()` 变为薄封装；
- 新增 `reasoning_hint(field, finish_reason, max_tokens, stage_key)`，在 `2_ocr.py` / `3_merge.py` 的 JSON 解析失败处拼接；
- 报错现在直接写出结论与动作，且会看**是否已经顶到端点上限**再给建议（§20.5 之后默认值就在上限上）：
  - 未到顶：`…；正文为空、只取到 reasoning_content，且 finish_reason=length ——该模型是推理模型，max_tokens 被思维链吃光：请调大 --max-tokens 重跑（当前 8192）`
  - 已到顶：`…：当前 --max-tokens 393216 已经是该端点允许的上限，加大没用 —— 这是模型侧的生成长度限制，只能拆页/拆请求或换模型`

**验收**：离线断言 19 项（`content` 优先 / 退到 `reasoning*` / 分段数组 / 裸 `text` / 未到顶与已到顶两种 hint / 5 种非法 `--max-tokens` 被拒）+
集成桩（假 `post_json` 只回思维链、`finish_reason=length`）→ 默认值确实进了请求体、重试 1 次即停且报错含"加到顶也没用"的结论；
随后**真实重跑** page 1 `--force` 走通正常路径（`✓ 1914ms 提取 0 题`）。

### 20.3 首次成功的比对结果（pages 1–3）

```bash
python pdf-ocr/3_merge.py --category LL11512 --pages 0-3 --budget-tokens 200000
# ✓ 1/3 提取 0 题  ✓ 2/3 提取 0 题  ⚠ 3/3 提取 0 题（冲突 5）  合计 5.5k tok
```

**0 题不是 bug**：LL11512 的 1–3 页是封面 / 目录 / 教員紹介，本来就没有题目
（第 1 页 `a` 路转写只有标题、第 3 页是山下茂老师的履历）。第 3 页那 5 条 `conflicts` 全是
`question: 0` 的**整页级分歧**（`paper_identity.title`、阅读顺序、Markdown 强调风格），
模型都给了 `chosen` + `reason`，并且**没有**把版面排版差异误判成内容差异 —— 判定逻辑符合 §7.2。

实测单页成本（对 §18 估算的校正）：

| 页 | OCR-A | OCR-B | merge | 备注 |
|---|---|---|---|---|
| 1 | 3783 | — | 928 | 封面，入参极短 |
| 3 | 6388 | — | 3629 | 密排页；merge 里 874 是思维链 |

### 20.4 遗留风险（下一步要盯）

1. **OCR 截断**：第 3 页 `a` 路曾出现 `finish_reason=length`、`json_truncated=true`（`completion_tokens` 顶到当时的 4096）。
   该页转写末尾恰好完整（截在收尾字段上），**但真正的密排题目页会丢末尾题目**。
   → 已由 §20.5 把默认上限放开解决；再出现 `json_truncated: true` 就说明撞的是**模型自身生成长度**，不是我们的截止线。
2. **跨页拼接与题号抽取尚未验证**：1–3 页无题，`4_build_md.py` 只有拿真实题目页才能验收。
   → 建议先跑 `--pages 4-8`（OCR 两路 + merge）攒出含题页面，再进 P4。

### 20.5 `--max-tokens` 放开到端点上限（用户要求）

**要求**：`--max-tokens` 改为 `10000000`。

**先探边界再改**（两个端点逐个试，`max_tokens` 只影响请求体，探针只花几十 token）：

| 端点 | 8192 | 65536 | 131072 | 393216 | 393217 | 10000000 | 2000000000 |
|---|---|---|---|---|---|---|---|
| `deepseek-flash` | OK | OK | OK | OK | ❌ 400 | ❌ 400 | — |
| `step-3.7-flash` | OK | OK | — | — | — | OK | OK |

- DeepSeek 的报错把合法区间直接写出来了：`the valid range of max_tokens is [1, 393216]`。
  **所以 merge 阶段不能写 10000000** —— 那会让 37 页各报一次 HTTP 400（4xx 不重试，但照样刷屏）。
- StepFun **完全不做校验**（连 2000000000 都照收），10,000,000 是我们自设的兜底值。

**结论（已实现）**：

```python
DEFAULT_MAX_TOKENS = {"ocr": 10_000_000, "merge": 393_216}
MAX_TOKENS_CEILING = {"ocr": 10_000_000, "merge": 393_216}
check_max_tokens(stage_key, value)   # 发请求前校验，超上限 → 退出码 1 + 写明合法区间
```

`--max-tokens` 的 help 文本、`reasoning_hint()` 的建议、以及 OCR 截断告警（原先写"请加大 --max-tokens"）
都已同步改成"已是端点上限"的说法，避免给出一个照做也没用的建议。

**关于"放开会不会更贵"**：不会。`max_tokens` 是**截止线不是预扣**，没生成的 token 不计费；
数字大一点唯一的效果是"模型真话痨/死循环时最多能产多少"。所以主闸门仍然是
`--budget-tokens` / `--total-budget-tokens`（每次调用**之前**检查）。

**验收**：
- 离线断言 **19 项**全过（含 `check_max_tokens` 的 5 种非法输入：`merge` 写 10000000 / 393217、`ocr` 写 10000001、写 0、写负数）
- `3_merge.py --max-tokens 10000000` → 退出码 **1**，**一次请求都没发**，报错写明 `DeepSeek 的合法区间是 [1, 393216]…`
- `2_ocr.py --max-tokens 10000000` → 校验通过（继续走后面的流程）
- 默认值真实冒烟：`merge --pages 1 --force` → `✓ 3254ms`、`finish_reason=stop`、996 tok（其中思维链 210）；
  `ocr --pages 1 --passes a --force` → `✓ 9522ms`、`finish_reason=stop`、`json_truncated=false`、3.3k tok

**顺带发现的账本问题**：`source-manifest.json` 的 `usage` 累计块被重置过
（`created_at=11:59:35` 晚于页图的 `11:30:33`，说明该 manifest 是中途重建的），
所以"该分类累计"从 0 重新算起。代码本身没问题（S1 用 `manifest.update()` 会保留 `usage`，
`usage_block()/add_usage()` 也是累加，`read_json()` 坏了会抛错而不是静默返回空），
但**删掉/重建 manifest 就会丢历史账**，`--total-budget-tokens` 的跨运行约束随之复位 —— 别再手工删它。
页图与 `review/merge.json` 都在，不需要重跑任何阶段。

---

## 21. 真实冒烟记录（第三次：换 PDF、超时事件、4 页跑通）

### 21.1 换了 PDF，且沿用了旧分类名（⚠️ 先说这个）

12:34 的 S1 跑的是一个**新 PDF**：

| | 旧 | 新 |
|---|---|---|
| 文件 | `C:\Users\64247\Desktop\机组\1.pdf`（943KB） | `C:\Users\64247\Desktop\机组\软国计组期中2026-电子签名.pdf`（151KB） |
| 页数 | 37 | **4** |
| sha256 | `e13843b2…` | `27fcf19a…` |
| 分类名 | `LL11512` | `LL11512`（**同名**） |

S1 不删文件，但 `work/LL11512/` 是被**重建**的（manifest 的 `created_at` 与 4 张页图都是 12:33–12:34，
`usage` 键整个消失），所以**旧的 37 页页图 + 已做的 3 页 OCR/merge 已经不在了**。
源 PDF 还在，随时能重跑（代价见 §21.4 的 24.2k token/页 → 37 页约 **0.9M**）。

→ 建议：**一个试卷一个分类名**。否则 `data/raw/<分类名>/<分类名>.md` 会把两份卷子写到同一个名字下。

### 21.2 超时事件：`ReadTimeout … 181015ms`

```
[S2/4 OCR-A] page   1/4 (1/4)  ↻ 重试 1/3（ReadTimeout: HTTPSConnectionPool(host='api.stepfun.com', port=443): Read timed out. (read timeout=180)）181015ms
```

**诊断（用跑完的产物反查，不猜）**：

| 事实 | 数值 |
|---|---|
| 该页重试后 | **29,035ms 成功**（`finish_reason=stop`） |
| 同一 PDF 后续 7 次调用 | 25.7s / 29.2s / 36.3s / 40.0s / 44.1s / 49.8s / 61.1s，**全部成功** |
| 8 次 OCR 出参 | 4,162 ~ 8,210 tokens |

→ 这是 **StepFun 偶发卡住**（180s 里一个字节都没回），**不是** `max_tokens=10000000` 让模型不收敛：
同一个默认值下 8 次调用全部自然收尾，出参离上限差**三个数量级**。
→ 结论：`--timeout 180` **保持不动**（已经是正常耗时的 4~6 倍，调大只会让真卡住的请求多等）；
**看到这行不要手动中断** —— 脚本会自动重试，重试一般 30s 内就回来。

**修复（体验层面）**：新增 `_common.is_timeout()` / `timeout_hint()`；
`2_ocr.py` / `3_merge.py` 在首次超时后补一行：

```
[提示] 这是服务端偶发卡住（本 PDF 正常单页 30~45s），不是参数/密钥问题；脚本会自动重试，重试一般 30s 内就返回，不用手动中断
```

验收：离线桩（第 1 次抛 `ReadTimeout`、第 2 次返回正常 JSON）→ 输出里出现重试行 + 提示行、最终成功；
`is_timeout()` 对 `ReadTimeout` / `ConnectTimeout` / `HTTP 400` / 空串 判定正确。

### 21.3 4 页全流程跑通（S2 + S3 完成）

```bash
python pdf-ocr/2_ocr.py  --category LL11512 --pages 1-4      # 8 次调用
python pdf-ocr/3_merge.py --category LL11512 --pages 1-4     # 4 次调用
```

- S2：4 页 × 2 路 **全部 ✓**，`finish_reason=stop`、`json_truncated=false`（一次都没截断）。
- S3：4 页共提出 **41 题**（9 / 12 / 12 / 8），`answerKey` 从题干里的 `（ B ）` 正确提取；
  只有 page 1 第 8 题（选项 D 是 15 位还是 16 位）被标 `needs_review` —— 这正是双路互校该抓的。
- 唯一"噪音"是 page 1 的 `printed_page_labels` 分歧（A 写 `第1页`、B 写 `试题第1页`，其实是同一件事）。

### 21.4 实测成本（替换 §18 的估算，这才是能拿去算账的数）

| 阶段 | 调用 | 耗时 | token 合计 | **单页** |
|---|---|---|---|---|
| S2 OCR-A | 4 | 25.7~49.8s | 28.8k | — |
| S2 OCR-B | 4 | 29.2~61.1s | 31.9k | — |
| S2 小计 | 8 | | **60.7k** | **15.2k / 页** |
| S3 merge | 4 | 12.1~38.1s | **36.0k** | **9.0k / 页** |
| **合计** | 12 | 约 5.5 分钟 | **96.7k** | **24.2k / 页** |

**这组数据反过来证明了 4096 / 6144 确实太小**（也就是 §20.5 放开上限是对的）：

| 阶段 | 出参（逐次） | 旧默认 | 会截断几次 |
|---|---|---|---|
| OCR | 4162 / 4490 / 6653 / 7296 / 4162 / 8210 / 7152 / 5386 | 4096 | **8 次里 6 次** |
| merge | 3081 / 7897 / 7447 / 9192 | 6144 | **4 次里 3 次** |

另外：merge 的出参里**思维链占了 40%~86%**（1241/3081、5575/7897、4784/7447、7879/9192）——
推理模型的这部分开销是实打实的钱，而且**不计入"看得见的题面长度"**。

### 21.5 顺带修掉的重复 conflict

`structural_diffs()` 的确定性补漏不检查模型是不是已经报过同一个字段，
于是 page 1 的 `paper_identity.date` 在 `conflicts[]` 里**出现了两次**（一条带 `chosen`、一条 `chosen=""`）。

修复：按 `field` 去重，模型已报过的不再补。验收：`--pages 1 --force` 重跑 →
`conflicts` **4 → 3 条**，`notes` 从"另发现 2 处"变成"另发现 1 处"，9 题 / 1 题待复核不变。

---

## 22. P6 预备调研：md 怎么变成网站上的一个页面

**结论：不会自动出现。** 这个站是固定路由 SPA + 代码里写死的分类清单，**没有任何运行时发现机制**
（没有 `import.meta.glob('public/*.json')` 之类的动态扫描）。`data/raw/<分类名>/<分类名>.md` 在 P6 之前是一份没人读的文件。

### 22.1 第一道坎：现有 parser 都不吃这份 md

| 管线 | 读什么 | 写什么 |
|---|---|---|
| 日语线 `scripts/parse-japanese-2024-markdown.ts:379-380` | **markdown**，但路径**硬编码**成 `data/raw/japanese/2024年日语期末试卷.md` | `public/question-bank.json` |
| 计算机组成线 `scripts/parse-computer-banks.mjs:148,156` | `data/raw/computer-organization/<key>.json`（**手写 JSON，不是 markdown**） | `public/<key>-question-bank.json` |
| 其它 | `parse-markdown.ts:311` / `parse-word-markdown.ts:243-251` 硬编码单文件；`parse-history|party|military-markdown.ts:514/331/438` 扫目录 | 各自一个 `public/*-question-bank.json` |

### 22.2 第二道坎：分类必须在代码里注册

| 必改 | 位置 | 不改会怎样 |
|---|---|---|
| ① `Category` 联合类型 | `src/types/question.ts:1-9` | TS 编译失败 |
| ② `CATEGORIES` 数组 | `src/config/categories.ts:16` | 落地页不会出现这张卡片 |
| ③ `COURSE_TREE` 叶子 | `src/config/courseTree.ts:15` | 侧栏/课程树里点不进去 |
| ④ 硬编码 key 列表的测试 | `src/config/categories.test.ts:11-20` | `vitest` 直接红 |
| ⑤ `_meta.json` 生成名单 | `scripts/generate-meta.mjs:16-24` | 首页题数显示 0，并**回退全量加载所有题库**（~8MB） |

| 可选 | 位置 | 作用 |
|---|---|---|
| `parse:all` 挂载 | `package.json:40` | 一条命令重建全部 |
| SW 缓存版本 | `scripts/bump-sw-cache.mjs` | 不 bump 用户可能吃到旧缓存 |
| `public/sitemap.xml` | — | SEO |

**"新页面"的准确含义**：`src/router/index.ts` 只有 `/`、`/home`、`/quiz` 等固定路由，**没有 per-category 页面**。
落地页多一张学科卡片（`LandingPage.vue:99-102` 直接 `v-for CATEGORIES`），点进去 = `setActiveCategory(cat)` + `router.push('/home')`（`:86-89`）。

### 22.3 好消息：注册之后，题组/题单是自动的

`HomePage.vue:519-538`：题单列表 = `groupOrder` 里列的 + **其余自动追加**：

```js
for (const g of groups) if (!seen.has(g.groupId)) ordered.push(...)   // 533-537 行
```

`groups` 来自 `getAllGroups()`，从题目自身的 `groupId/groupTitle` 聚合。所以 md 里的 `## 题组一：…`
会自动变成一张题单，`groupOrder` 只用来控制排序。

### 22.4 决定：沿用既有解析逻辑，不重写解析器

三条 md 管线用的是**三套不同方言**：

| parser | 题目标题正则 | 答案格式 |
|---|---|---|
| **japanese-2024（＝ 本项目的硬契约 §2.1）** | `### 第N题` + `#### 题目` | `**正确答案：X text**` |
| history | `#### 12. stem`（`parse-history-markdown.ts:82`） | `**答案：xxx**` |
| military | `**12. stem**`（`parse-military-markdown.ts:109`） | `**答案**：xxx` |

→ **不能**直接把 history/military 那两个"扫目录"的脚本套上来（一条正则都不匹配）。
能沿用的是 japanese 那条，而本项目的 md 契约本来就是照它定的。`parse-japanese-2024-markdown.ts:211` 的
`parseMarkdown(filePath)` **已经按路径传参**，逐条核对可复用度：

| 部件 | 行 | 能否直接用 |
|---|---|---|
| `parseMarkdown(filePath)` | 211 | ✅ 直接调 |
| 题组 `## 题组一：` → `g01`（中文数字推导） | 225-230, 365-370 | ✅ 无硬编码 |
| 块切分 `### 第N题` / `#### 题目` / `#### 答案与解析` | 219, 240-260 | ✅ 就是硬契约 |
| 选项 `^[A-D][\.\s、]` + 从解析段兜底取选项 | 277, 304, 312-321 | ✅ |
| 答案 `**正确答案：X text**` + 表格兜底 | 323, 330 | ✅ |
| 阅读题 `**文章：**` / `### 文章（X）` 挂载 | 170-198, 350-351 | ✅ 试卷无阅读题时空转 |
| `tagQuestion()` 日语语法点表 | 33-… | ⚠️ 无意义 → 返回空 `tags` |
| `GROUP_OFFSET = 20`、`g01→g21` 偏移 | 376, 388-389 | ❌ 为避开学习通 g01–g10，必须去掉 |
| `id = g21-q01`、`groupTitle = '2024 · …'` | 391-393 | ❌ 改成本项目的命名 |
| 路径 + 合并进 `public/question-bank.json` + `filter(g2*)` | 379-380, 419 | ❌ 换成自己的库文件 |

**P6 落地形态（最小改动）**：

```
scripts/lib/parse-jp-exam-md.ts           ← 原样搬 parseMarkdown + extractArticles + CHINESE_NUM_MAP
scripts/parse-<key>-md.ts                 ← ~40 行：读 data/raw/<分类名>/<分类名>.md → 调 parseMarkdown → 写 public/<key>-question-bank.json
scripts/parse-japanese-2024-markdown.ts   ← 改成 import 共享版（防两份正则漂移）
```

字段映射（唯一需要动脑的地方）：

```ts
id: `${key}-q${String(q.numberInGroup).padStart(3, '0')}`,  // 必须全局唯一 + 必须以 <key>- 开头
category: key,
groupId: `${key}-${q.groupId}`,
groupTitle: q.groupTitle,
grammarPoints: [], tags: [],
status: 'ready',
answerProvenance: 'printed',                                // 答案印在卷面上（（ B ）那种）
source: { file: '<分类名>.md', group: q.groupTitle, position: i + 1 },
```

**免费的回归测试（黄金样本）**：`data/raw/japanese/2024年日语期末试卷.md` + `public/question-bank.json` 里现成的
g21–g28。先把 `parseMarkdown` 搬到共享模块，再拿那份 md 跑一遍，只取 `groupId.startsWith('g2')` 的题目，
与现有库**逐字节对比** —— 一致即证明搬迁没坏。**不花 API 钱，也不碰新试卷。**

### 22.5 P6 硬要求（是代码在查，不是约定）

1. `id` **必须以 `<categoryKey>-` 开头**：`parse-computer-banks.mjs:24` 校验它，`LandingPage.vue:65` 靠它匹配进度 ——
   不满足则卡片永远显示"未做"。
2. 每题 `groupId` 必须在 `groups` 里存在且 `groupTitle` 一致。
3. **`### 第N题` 的 N 必须是卷面原题号**（这份期中卷是 1–41 连续编号，跨题组不断）。
   `parseMarkdown` 把它直接当 `numberInGroup`，所以这条**同时约束 P4 的 `4_build_md.py` 输出**：
   不要把每个题组重新从 1 编号。
4. 不改任何既有数据：新分类用自己的 `data/raw/<分类名>/` 与新 `public/<key>-question-bank.json`。

### 22.6 P6 待办清单（**2026-09-22 已完成，实测见 §27**）

- [x] `scripts/lib/parse-exam-markdown.ts`（抽共享）+ 黄金样本回归
- [x] `scripts/parse-computer-paper.ts` 薄入口 + `package.json` 加 `parse:computerPaper`
- [x] `src/types/question.ts` 加 `Category`
- [x] `src/config/categories.ts` 加条目（`bankFile` / `short` / `long` / `desc` / `icon` / `groupViewTitle`）
- [x] `src/config/courseTree.ts` 加叶子
- [x] `src/config/categories.test.ts` 更新硬编码 key 列表
- [x] `scripts/generate-meta.mjs` 的 `banks` 加一行 → 重跑 `npm run generate:meta`
- [ ] **浏览器里实点一遍**（落地页卡片 → `/home` → 刷题 → 错题本）—— 待用户在有浏览器的环境验证
- [x] **parser 保留题干换行**（§8.4 的决定 A）
- [x] **parser 自己从 `## 题组X：<名字>` 取题单名**（§26.2 的怪癖）
- [x] **额外发现的两处注册点**：`scripts/audit-banks.mjs` 的 `BANKS`、`package.json` 的 `parse:all`

---

## 23. P4 实测记录（`4_build_md.py` + `5_check.py`）

### 23.1 产物

| 文件 | 内容 |
|---|---|
| `data/raw/<分类名>/<分类名>.md` | **唯一最终产物**（单文件） |
| `pdf-ocr/work/<分类名>/transcription.md` | 每页两路转写汇总（`## PDF 第 N 页` + A/B 两路，对齐既有 `computer-*.md` 做法） |
| `pdf-ocr/work/<分类名>/report.md` | 待复核清单：字段不完整 / 待复核题表 / OCR 冲突表 / 拼接失败 / 去重记录 |

### 23.2 跑法

```bash
python pdf-ocr/4_build_md.py --category LL11512      # 纯本地，0 token
python pdf-ocr/5_check.py   --category LL11512      # 硬门禁
```

实测（LL11512，4 页）：

```
[S4/4 汇总写盘] 跨页拼接 0 题 / 去重 0 题 → 单文件
[S4/4 汇总写盘] data/raw/LL11512/LL11512.md ✓ 39 题
[S4/4 汇总写盘] 题组 7 / 缺答案 0 / 待复核 10 / 缺产物 0
[警告] 题号缺口 1 处：33→36
[S5/5 校验] 契约检查：题块 39 / 题组 7 / 会被丢弃 0 / 硬错误 0 / 警告 1  ⚠
```

### 23.3 真·端到端验收：拿**真实 TS 解析器**跑我们生成的 md

不信任"自己写的校验器说没问题"。把 `scripts/parse-japanese-2024-markdown.ts` 复制一份、
**只改两行路径**（读我们的 md、写临时库），用 `npx tsx` 真跑一遍——解析逻辑一个字没动：

```
2024新增: 39 题        合并后: 39 题
  g21: 10题   g22: 9题   g23: 5题   g24: 5题   g25: 4题   g26: 2题   g27: 4题
✅ 合并完成
```

**与 `5_check.py` 预告的"解析端可收下 39 题"完全一致**，题组分布也与卷面吻合
（题组一 10 题＝「数值转换题（共10题）」、题组二 9 题＝「选择题（共9题）」、题组三 5 题＝「判断题（共5题）」…）。

抽查解析结果：`numberInGroup` 就是**卷面原题号**（1/20/23/30/38）；判断题选项被还原成 `A.正确 / B.错误`；
`answerKey` / `answerText` / `translation` 全部落位。

> 复现方式见 §23.4 的验收脚本思路：`realparse.ts` 只替换 `rawPath` 与 `existingBankPath` 两行，
> 跑完删掉即可（脚本与临时库都已清理，不进仓库）。

### 23.4 实现要点（以及和 §8 的两处偏差）

1. **题组归一化**：`merge.json` 的 `group` 实测极不规整（`'一、数值转换题'` / `'二'` / `'六、题组二'` / `''`）。
   统一取其中的中文题组号；**模型漏填的按"沿用上一题题组"补**（跨页续题必然漏填）。
   实测补对了：第 10 题回到题组一，第 22–24 题回到题组三（正好凑满"共5题"）。
2. **判断题补选项**（必须做）：卷面自己写着「正确的选A，错误的选B」，但 OCR 抽出来 `options=[]`；
   不补的话解析端 `:349` 会把 **5 道题全部静默丢弃**。补的内容直接来自卷面声明，不算编造。
   实测 `g23` 收下 5 题。
3. **题干末尾答案标记清理**：卷面把答案印在题干末尾（`…である。 ( B )`），OCR 会一起抄进来。
   当末尾 `（X）` 的字母**与 answerKey 完全一致**时才删（防误删填空题的 `（　）`）。实测删掉 3 处（第 22/23/24 题）。
4. **答案文本兜底**：`merge.json` 的 `answerText` 常为空，而解析端正则要求 `**正确答案：X …**` 里
   答案后面**至少要有一个字符**（`.+?`），只写 `**正确答案：B**` 会匹配失败 → 用选项原文兜底。
5. **题干压成一行**：解析端本来就会把多行题干用空格拼起来（`:296`），压成一行既等价，
   又能避免"题干里某行以 `A.` 开头被误判成选项"。

**与 §8.2 的偏差（1 处，已如实记录）**：第 2 步「按题号缺失配对」需要"下一页第一个题号之前的全部内容"，
但 `merge.json` **没有**"页首未归属文本"这个字段。实现改为：回落到该页 `review.json` 的 `transcription_md`，
取到第一个题号之前、且 ≤1200 字的片段并入，并且**一律标 `needs_review` + 写进 `report.md`**；
取不到就退到第 3 步兜底。**宁可交给人工，也不猜。**

**与 §9 的一处收紧**：解析区里混入 `## ` 开头的行，既算"题组标题不合规"（硬错误，退出码 3），
也算"该题解析会被静默切掉"（警告）。两条都报——静默丢解析比报错更糟。

### 23.5 验收

- **离线 11 组断言全过**（构造假 `merge.json`，`WORK_ROOT`/`RAW_ROOT` 都指到沙箱，不碰真 `data/raw`）：
  拼接三条分支（同题号配对 / 页首片段并入 / 兜底标待复核）、去重、题组归一化（含空 group 沿用）、
  判断题补选项、坏题照常输出不丢、`transcription.md` 缺路占位；
  `5_check.py` 三种结局（会被丢弃→3 / 截断风险→3+警告 / 合规→0）。
- **真实数据**：`5_check.py` 硬错误 0、会被丢弃 0，退出码 2（唯一警告是下面的题号缺口）。
- **真实解析器**：见 §23.3，39 题全收。

### 23.6 ⚠️ 这份卷子暴露的两个待办

1. **S3 漏抽了第 34、35 题**：`page-004` 的 OCR 自己声明 `question_ranges = ["34-41"]`（8 题），
   但 `page-004.merge.json` 只给出 36–41（6 题）。第一次跑 S3 时是 8 题，用户重跑后变成 6 题 ——
   **模型在 S3 这一层不稳定，会静默少抽**。
   → **已在 §24 实现**：`3_merge.py` 现在会把两路 `question_ranges` 的并集与实际提出的题号对账，
   缺号/多号/同页重复都补 synthetic conflict 并标 `needs_review`。
   → 重跑一页也没能捞回（实测：再跑一次仍只提出 6 题）—— 这 2 题的公共题干在第 3 页，
   模型会整段跳过，属于**模型能力**问题，只能人工补或换提示词。
2. **题组五（第 30–33 题）的题干是 `(30) の選択肢：`**：这是"匹配题"，题干在上一段公共说明里，
   OCR 只抄到了小题占位符。这 4 题已标 `needs_review` 并在 `report.md` 里，需要人工把公共题干补进第 30 题。

---

## 24. S3 缺号护栏 + 题数匹配（P4 之后补，用户要求）

### 24.1 为什么必须加

S3 的模型输出**不稳定，会静默少抽题**：同一页 `page-004`，第一次跑提出 8 题（34–41），
重跑一次只剩 6 题（36–41）——而两路 OCR **都**白纸黑字声明了 `question_ranges = ["34-41"]`。
在此之前这种丢失没有任何提示：S4 只会输出 39 题，谁也不知道少了 2 题。

### 24.2 实现（`3_merge.py`，默认开启，无新参数）

```python
declared_numbers(reviews)   # 两路 question_ranges 的并集 → 期望题号集合（复用已有的 normalize_range）
coverage_diffs(reviews, questions)   # 期望 vs 实际 → conflicts
```

接在 `normalize_merge()` 之后（**不发新请求，纯本地比对**）：

| 情形 | 产出的 conflict | 效果 |
|---|---|---|
| 少了 | `field=question_coverage` | 整页 `needs_review` |
| 多了（未声明题号） | `field=question_coverage` | 同上 |
| 同页重复题号 | `field=question_number_duplicate` | 同上 |

冲突里的文案是照着"下一步该干什么"写的：

```
题数不匹配：缺 2 题（34-35）。来源：A 路：34-41；B 路：34-41。
少题通常是模型静默漏抽 —— 请对照页图补抽，或确认该题号是 OCR 笔误
```

同时往 `notes[]` 里加一条 `题号覆盖核对发现 N 处不一致`，整页 `needs_review = true`。

### 24.3 题数匹配做在两处（各有各的边界）

| 层 | 检查 | 为什么在这一层 |
|---|---|---|
| **S3（页级）** | 两路 `question_ranges` 并集 vs 实际提出 | 声明本身就是**每页**的，边界安全 |
| **S4 / S5（全局）** | 题组标题「共 N 题」vs 该题组实际题数 | 一个题组可能**横跨两页**（实测题组三 2+3=5），页级数必然误报 |

S5 那条是**从 md 自己数**的（`## 题组一：数值转换题（共10题）` 就带着声明），不依赖任何中间产物。
实测这份卷子：题组一 共10→10、题组二 共9→9、题组三 共5→5、题组四 共 5→5，全部相符。

### 24.4 真实运行结果

```bash
python pdf-ocr/3_merge.py --category LL11512 --pages 4 --force
# ⚠ 33034ms 提取 6 题（冲突 4）| 本次累计 11.3k tok
```

`page-004.merge.json` 里现在多了：

```json
{ "field": "question_coverage",
  "a": "OCR 声明本页 8 题：34-41",
  "b": "实际提出 6 题：36-41",
  "reason": "题数不匹配：缺 2 题（34-35）。…" }
```

`needs_review = true`、`notes = ["题号覆盖核对发现 1 处不一致"]`，S4 生成的 `report.md` 冲突表里也出现了这一行。

> **重跑并没能捞回那 2 题**（还是 6 题）。原因看 `transcription` 就明白：第 34/35 题是"匹配题"的最后两个空，
> 公共题干（含代码块）在第 3 页，模型到第 4 页面对孤立的两行小题就直接跳过了。
> **护栏的价值是"不再静默"**，不是"自动修复"。

### 24.5 验收与顺手修掉的两个假阳性

- `pdf-ocr/tests/test_s3_coverage.py`：**8 组断言全过**，其中第 1 组直接跑**真实** `page-004` 数据，
  断言必须报出「缺 2 题（34-35）」；其余覆盖"一致不报 / 多号 / 重复 / 缺声明不误报 / 范围写法兼容"，
  外加一个桩掉 `post_json` 的端到端（1 次调用即落盘、冲突确实写进产物）。
- `pdf-ocr/tests/test_p4_build.py`：**13 组断言全过**（新增"题组题数不符"与"合规题组标题不算截断"两组）。
- **假阳性 1**：S5 的"解析区截断风险"原先把 `## 题组二：…` 这种**合规**题组标题也当成截断边界。
  已改为：边界行是合规题组标题就不报（它本来就该出现在两题之间，切掉的只是下一组的导言）。
- **假阳性 2**：S5 的题组标题行规检查原先用带 `^` 的正则去 `finditer` 一个多行题块，
  结果**一个都匹配不到**（解析端用的是不带锚点的 `block.matchAll`）。已拆成两个正则修好。
- **新发现**：重跑 S3 后题组六的 `groupTitle` 变成 176 字的整段公共题干（模型把导言塞进了标题）。
  S4 现在会 `[警告]` 并写进 `report.md` 的"其它"节，建议人工改短 —— 不替它编名字（那属于编造）。

---

## 25. 公共题干挂到每个小题 + 找回第 34/35 题（用户要求）

> 要求原文：「公共题干的小题也提取，在 P4 统一拼接，每个小题都补充上公共题干」。

### 25.1 现象与代价

第 30–35 题是**匹配题**：导言（说明 + MIPS 代码块）写在题组开头，
小题自己的文字只剩 `(30) の選択肢：` / `(34)の選択肢:` 这样的占位符。
第 34/35 题的占位符落在**第 4 页**，导言在第 3 页 —— 模型两次跑都直接跳过了这两题（丢失 2 题）。
即使抽出来的 30–33，题干也只有占位符，**脱离了导言根本读不懂**。

### 25.2 S3：提示词里明说"小题不许跳过"

`3_merge.py` 的规则加了第 6 条：

> a. 题组导言原样抄到该题组**第一道**小题的 stem 开头（保留换行和 ``` 代码围栏）；
> b. `groupTitle` 只写题组**短名**，不要把整段导言塞进去；
> c. **该题组下的每一个小题都必须单独成题**，即使小题自己的文字只是「(34) の選択肢：」这样的占位符、
>    或者小题的题干不在这页 —— **不许跳过**。

**实测有效**：重跑 `--pages 4 --force`（34.2s / **11.1k token**）后，第 4 页从 6 题（36–41）变回 **8 题（34–41）**，
题号缺口消失。模型这次也把 `groupTitle` 写干净了（`题组二`，不再是 176 字的导言）。

### 25.3 S4：把导言**复制**进每道小题（§8.4）

1. **先找导言**（按可靠性）：
   ① 第一道小题的题干里（提示词 6a 要求模型抄在那儿）——从**最后一个代码围栏**或**小题占位符**处切开；
   ② `groupTitle` 里被模型塞的整段导言；
   ③ 整页转写里"`X、题组名` 标题行 → 第一个小题行"之间的文本。
2. **复制到每道小题**：`entry["stem"] = 导言 + "\n\n" + 该小题自己的题干` → 每个小问独立成题。
3. **防重复**：某题题干开头已经抄过导言时，按归一化最长公共前缀切掉原有那份再补标准的，
   保证导言**恰好出现一次**（实测 30–37 各 1 份、其余 0 份）。
4. **题组号解析**修了个真 bug：模型这次给的 `group` 是 `'题组二'`（没有 `六、` 前缀），
   按"取第一个中文数字"会解析成**题组二**，把 36/37 并进第 2 页那个真正的题组二里。
   现在的顺序是：① 行首 `六、` → ② 光秃秃单个号码 `二` → ③ **回整页转写里找 `X、<题组名>`** → ④ 沿用上一题。
5. **题干清洗**（`sanitize_block()`）：保留换行（导言里有代码块），但去掉行首 `#`（会被解析端跳过）、
   给行首 `A.` 的行加 HTML 注释挡一下（会被解析端当成选项并丢掉后面的题干）。

### 25.4 真·端到端验收（真实 TS 解析器）

`pdf-ocr/tests/prepare_real_parser.py --category LL11512` → `npx tsx pdf-ocr/work/.tmp/realparse.ts`：

```
合并后: 41 题
  g21: 10题  g22: 9题  g23: 5题  g24: 5题  g25: 6题  g26: 2题  g27: 4题
```

md 里每道小题的块（导言份数 / 代码围栏数）：

| 题 | 导言 | 围栏 | 块字数 |
|---|---|---|---|
| 29（普通题） | 0 | 0 | 111 |
| 30 / 31 / 33 | **1** | 2 | 355–365 |
| 34 / 35 | **1** | 2 | 388 / 392 |
| 36 / 37 | **1** | 1 | 304 / 369 |
| 38（题组七，短但自足） | 0 | 0 | 79 |

真实解析器存库后：41 题，`g25` 6 题（30–35）、`g26` 2 题（36–37）每题题干都含导言一份。

### 25.5 验收与回归

```
[S5/5 校验] 契约检查：题块 41 / 题组 7 / 会被丢弃 0 / 公共题干 0 段 / 硬错误 0 / 警告 1  ⚠
```

（"公共题干 0 段"是因为已经不再用 `**文章：**`；S5 里的文章机制移植留着，用于预演备用方案的效果。）

- 回归套件 **24 组断言**（`test_s3_coverage.py` 8 + `test_p4_build.py` 16），新增覆盖：
  题组号必须从 `六、题组二` 定出「六」、导言在每道小题里**恰好一份**、md 里**没有** `**文章：**`、
  解析端收下后每道小题题干都自带导言、**不误伤**"题干短但自足"的题组七。
- `test_s3_coverage.py` 的基线改成**用真实声明 + 人为去掉 34/35** 来断言，
  不再依赖"当前恰好少 2 题"（提示词改进后它已经不缺了）。

### 25.6 现状

`data/raw/LL11512/LL11512.md`：**41 题 / 7 题组**，题号 1–41 连续无缺口，
`5_check.py` 硬错误 0、会被丢弃 0，唯一警告是 2 处待复核标记。
累计消耗 **142.1k token**（其中本轮 1 次 S3 = 11.1k）。

`report.md` 新增一节：**公共题干（题组导言）已复制到每道小题的题干上方**（含来源与字数）。

---

## 26. 取消题型分题组（用户要求）

> 要求原文：「取消题组二：选择题等划分」。

### 26.1 做法

`4_build_md.py` 新增 `--group-by paper|type`（**默认 `paper`**）：

| 模式 | md 里的标题 | 结果 |
|---|---|---|
| `paper`（默认） | 只有 `## 题组一：计算机组织与结构（软国）2026年` | 全卷 **1 张题单**，41 题平铺 |
| `type` | `## 题组一：数值转换题` … `## 题组七：题组三` | 按原卷题型 **7 张题单** |

**为什么还留一个 `## 题组一：` 标题**：解析端没有 `## 题组X：` 时会把所有题挂到 `g00`
且 `groupTitle` 为空字符串 —— 站上的题单名会是空白。留一个标题至少给出一个正常的 `groupId`。

**顺序很关键**：`collapse_groups()` 必须在 `attach_shared_stems()` 与 `check_group_counts()` **之后**跑 ——
那两步依赖"按题型分的题组"来定位公共题干、核对「共 N 题」。先收拢的话公共题干会被当成"整个卷子共用一个导言"。

### 26.2 ⚠️ 真实解析器的一个怪癖（P6 必须知道）

拿真实解析器跑我们的单题单 md，存进库的是：

```
合并后: 41 题        g21: 41题
groupTitle = {'2024 · 题组一：': 41}
```

注意 `groupTitle` 是 **`题组一：`（连冒号，没有名字）**。原因在解析端 `:229` / `:369`：

```js
const gMatches = [...block.matchAll(/## 题组([一二三四五六七八九十])[：:]/g)]
currentGroupTitle = last[0].replace(/^##\s*/, '').trim()   // last[0] = 匹配到的 "## 题组一："，不是整行！
```

`matchAll` 的 `last[0]` 是**匹配子串**，不含 `：` 后面的名字 —— 所以：

- **md 里题组标题 `：` 后面写什么，参考解析器都拿不到**（它只用来定 `groupId` 的数字）；
- 站上的题单名因此会是 `题组一：` 这种残名；
- **P6 的 parser 必须自己把标题文本取出来**（扫 `^## 题组(.)：(.*)$` 映射 中文数字 → 名字），
  否则题单名一律是 `题组N：`。

### 26.3 验收

- `5_check.py`：**41 题 / 1 题组 / 会被丢弃 0 / 硬错误 0 / 警告 0 ✓**（全绿）。
- 真实解析器：41 题全在 `g21`，题号 1–41 连续。
- 回归 `test_p4_build.py` 新增场景 3（默认 `paper` 模式）：断言只剩 1 个 `## ` 标题且用卷名、
  题量与导言份数都不变、解析端所有题的题组都是「一」。
- 回归合计 **25 组断言**（`test_s3_coverage.py` 8 + `test_p4_build.py` 17），全过。

### 26.4 现状

`data/raw/LL11512/LL11512.md`：**41 题 / 1 张题单 / 题号 1–41 连续**，
公共题干已复制进 30–37 每道小题，待复核 5 处。

---

## 27. P6 实测记录：md 接进网站（复用原解析器）

> 目标原文：「开工 P6，尝试复用原有的 md to json 转换器」。

### 27.1 复用方式：抽共享解析器，而不是再写一套正则

新增 `scripts/lib/parse-exam-markdown.ts`，把 `parse-japanese-2024-markdown.ts` 里的
`extractArticles()` + `parseMarkdown()` **原样抽出**（正则与判定条件一字不改），另加两个**可选**能力：

| 能力 | 默认 | 为什么 |
|---|---|---|
| `groupName` | 总是返回 | 参考实现用 `matchAll` 的 `last[0]` 当标题，只能拿到 `题组一：`；新增 `GROUP_LINE`（行首锚定）把 `：` 后面的真名也抓下来（§26.2） |
| `keepStemNewlines` | `false` | `true` 时题干保留换行（公共题干里的代码块要能渲染）；`false` 与原实现逐字节一致 |

`parse-japanese-2024-markdown.ts` 随后也改成引用它（本地那 230 行删除），**一份正则，两处复用**。

**黄金样本回归**（重构的安全网）：重跑 `npx tsx scripts/parse-japanese-2024-markdown.ts`，与 HEAD 对比：

```
HEAD 题数=277  重跑题数=277
同 id 但内容不同: 0      只在 HEAD / 只在重跑: 0
顺序是否一致 = False     ← 唯一差异
```

顺序差异**不是重构引起的**：单独跑 `parse:japanese2024` 时 `existing.filter(去掉 g2*) + 追加` 会把
g11（2021 卷，由后一步的 `parse:japanese2021` 追加）挪到 g21 前面；按 `parse:all` 的规范顺序重跑就一致。
**结论：277 题内容逐字节相同，重构安全**（已 `git checkout` 还原）。

### 27.2 新薄入口

`scripts/parse-computer-paper.ts`：读 `data/raw/<key>/<key>.md` → `parseExamMarkdown(..., {keepStemNewlines:true})`
→ 写 `public/<key>-question-bank.json` + `data/processed/<key>-validation-report.json`。只做三件新卷特有的事：

1. 题干保留换行（决定 A）；
2. 题单名用 `groupName`（拿不到才用兜底名）；
3. 把 md 里的 `> ⚠ 待核对：…` 翻成 `status: 'needs_review'` + `reviewNotes`
   —— 否则 S4 标的待复核信息在解析这一步就丢了。

字段映射：`id = <key>-q<3位题号>`（重号时补 `-2`）、`category = key`、
`groupId = <key>-<gNN>`、`answerProvenance: 'printed'`、`questionType` 按答案长度/选项数判断。

### 27.3 注册点比预计的多两处

| # | 位置 | 说明 |
|---|---|---|
| 1 | `src/types/question.ts` | `Category` 联合加 `'computer-2026-midterm'` |
| 2 | `src/config/categories.ts` | `short/long/desc/icon/bankFile/groupViewTitle/groupViewHint` |
| 3 | `src/config/courseTree.ts` | `computer-organization` 组下加叶子 |
| 4 | `src/config/categories.test.ts` | 硬编码 key 列表 |
| 5 | `scripts/generate-meta.mjs` | `banks` 列表 → `public/_meta.json` |
| **6** | **`scripts/audit-banks.mjs`** | **`BANKS` 列表 —— §22 漏了这一个，跑 `npm run audit:banks` 才发现新库根本不在审计范围内** |
| **7** | **`package.json`** | `parse:computerPaper` + 插进 `parse:all`（放在 `parse:computer` 之后、`generate:meta` 之前） |

`public/sw.js` 按后缀 `-question-bank.json` 匹配，**不需要**加清单 ✓。

### 27.4 分类名与目录

用户选定 **`computer-2026-midterm`**（以 `computer-` 开头 → 自动进落地页的「计算机组成」试卷区、
自动进 `NO_SHUFFLE_CATEGORIES`、自动启用 markdown 渲染 `technicalQuestion`）。
`data/raw/LL11512/` 与 `pdf-ocr/work/LL11512/` 同步改名，manifest 的 `category` 字段一并更新，重跑 S4（0 token）。

### 27.5 顺手修掉的一个真 bug

S4 渲染判断题时 `answerText` 沿用了模型填的 `A`/`B`，输出成 **`**正确答案：A A**`**（实测第 22/23/24 题）。
两处修复：

- `fill_judgement_options()`：选项换成「正确/错误」后**必须重算** `answerText`（旧的 A/B 已无意义）；
- 新增 `normalize_answer_text()`：单选题的 `answerText` 必须等于所选选项原文
  （解析端存的是 `answerText || 选项文本`，非空但错的会被原样带进题库；`parse-computer-banks.mjs:79` 也这么断言）。

### 27.6 验收（全绿）

| 检查 | 结果 |
|---|---|
| `npx vue-tsc -b` | ✅ exit 0（`Category` 联合/注册类型全对） |
| `npx vitest run --pool=threads` | ✅ **17 文件 / 133 测试全过** |
| `npm run test:computer` | ✅ 15/15 |
| `npm run audit:banks` | ✅ 通过，且**已覆盖新库**：`computer-2026-midterm-question-bank.json 题数: 41 / schema: OK / id 唯一性: OK` |
| `npx vite build` | ✅ `built in 1.29s`（sw 缓存版本自动 bump） |
| `npx tsx scripts/parse-computer-paper.ts` | ✅ `41 题 / 1 个题组 / 待复核 7`，题组名 = `计算机组织与结构（软国）2026年` |
| 题库形状自检 | ✅ 41 题 id 唯一、`answerKey` 都落在选项里、`answerText` 与选项一致、8 题题干含换行（代码块保留） |

### 27.7 只剩一步：浏览器实点

构建与数据链路都验证过了，但"落地页出现卡片 → 点进 `/home` → 刷题 → 错题本"需要**浏览器**。
请在有浏览器的环境跑 `npm run dev`，确认：

1. 落地页「计算机组成」区多一张 **2026期中（软国）** 卡片，题数 41；
2. 点进去能看到题单「计算机组织与结构（软国）2026年」，开始练习能出题；
3. 第 30–37 题的题干里有**代码块**（不是一行行内文本）；
4. 错题本/收藏能正常记录（`questionId` 前缀匹配靠 `computer-2026-midterm-`）。

---

## 28. S6 发布门禁 + S3 生成答案解析（用户要求）

> 要求原文：「加入一个通过 p5 的结果就能生成网页上题目卡片的 p6，p3 加入解析功能」。

### 28.1 S3：生成答案解析（提示词规则 7）

卷面大多只印答案、不印解析（这份期中卷 41 题里 **0 题**有印刷解析）。
`3_merge.py` 现在要求模型：卷面有解析就抄（`printed`）、没有就**自己写一句 ≤80 字的解析**（`generated`）、
没把握就留空（`none`）。新增字段 `explanationSource` 一并存进 `page-00N.merge.json`。

```python
def explanation_source(raw) -> str:   # printed / generated / none
    # 模型没写 provenance 时保守判成 printed（旧产物都是这个语义）
```

进度行与收尾行都会报数：`提取 9 题（冲突 3，生成解析 9）` / `[完成] … | AI 生成解析 39 题`。

### 28.2 S4：把 AI 解析标出来

`generated` 的解析末尾补一行 `> ⚙ 解析由 AI 生成（未经人工核对）` ——
站上 `answerProvenance` / `explanationSource` 都是纯数据字段、UI 不显示，所以标记必须留在正文里读者才看得见。
`report.md` 头部也多了"解析来源：卷面原文 x 题 / AI 生成 y 题"。

### 28.3 S5：校验结论落盘（发布门禁的依据）

`5_check.py` 现在写 `data/processed/<分类名>-check.json`：

```jsonc
{ "md": "data/raw/<分类名>/<分类名>.md", "md_sha256": "2f2135ba…", "checked_at": "…",
  "exit_code": 2, "passed": true, "questions": 41, "parser_kept": 41, "parser_dropped": 0,
  "hard_errors": [], "warnings": ["带待复核标记 8 处"] }
```

放 `data/processed/`（入库）而不是 `pdf-ocr/work/`（gitignore）——新克隆也能直接发布。

> ⚠️ **只在按 `--category` 校验时才写结论**：`--md <路径>` 是临时的单文件检查
> （回归测试也走那条路），给它写 `<文件名>-check.json` 会污染 `data/processed/`（实测踩过）。

### 28.4 S6：只发布"通过 S5 且之后没再改过"的 md

`parse-computer-paper.ts` 在解析前先过三道闸（`requireCheckVerdict()`）：

| 闸 | 拒绝条件 | 实测报错 |
|---|---|---|
| ① 有没有结论 | `data/processed/<key>-check.json` 不存在 | `没有 S5 校验结论…请先跑 python pdf-ocr/5_check.py --category <key>` |
| ② 过没过 | `passed !== true`（即 S5 报硬错误、退出码 3） | `S5 校验未通过（2 条硬错误），拒绝生成题库：- 会被解析端丢弃的题 2 道` |
| ③ 是不是同一份 md | `md_sha256` 与当前 md 不符 | `md 在 S5 校验之后又变了（sha256 不一致），拒绝用旧结论发布：校验时: 2f2135ba… / 现在: …` |

另加一道**自洽闸**：`parseExamMarkdown` 这次收下的题数必须等于 verdict 里的 `parser_kept`
（md 或解析器偷偷变过就报错，而不是安静地发一份不一样的题库）。

**三条路径都实测过**：正常 → exit 0；篡改 md 不加校验 → 拦住；把 verdict 改成 `passed:false` → 拦住。

### 28.5 顺手修掉两个解析端的历史坑（§8.5）

1. **解析正文带着答案行**：解析端把 `#### 答案与解析` 之后的全部内容塞进 `explanation`，开头那行
   `**正确答案：B 105**` 也进去了。而仓库既有题库（`computer-midterms` / `japanese2`）的 `explanation`
   **不含**答案行 —— 留着会在站上把答案显示两遍。现在 P6 会剥掉。
   > 顺带修掉了 `q34/q35` 被误判成 `printed` 的问题：它们没有解析，剥掉答案行后才正确判成 `none`。
2. **CRLF 泄漏**：解析是从原始行拼的，`\r` 会留在每行末尾 → P6 统一转 LF。

### 28.6 真实重跑数据

```bash
python pdf-ocr/3_merge.py --category computer-2026-midterm --pages 1-4 --force
# ⚠ 提取 41 题（34/35 保住了）| 冲突 8 | AI 生成解析 39 题 | 4 次调用 34.1k tok
```

| 指标 | 值 |
|---|---|
| 题数 | 41（题号 1–41 连续） |
| 解析来源 | **generated 39 / none 2**（第 34/35 题：模型自评没把握，按要求留空） |
| 曾丢失的第 34/35 题 | ✅ 仍在（提示词规则 6c 生效） |
| 累计消耗 | 该分类 **253.2k token**（28 次调用） |

抽查第 1 题的解析：`01101001=64+32+8+1=105，故选 B。A 项漏算高位，C、D 项数值均对不上各位权值之和。` ——
是真正讲清道理的一句话，不是"根据题意可知"。

### 28.7 验收

| 检查 | 结果 |
|---|---|
| `python pdf-ocr/5_check.py` | ✅ 硬错误 0 / 会被丢弃 0，退出码 2，写出 verdict |
| `npx tsx scripts/parse-computer-paper.ts` | ✅ `41 题 / 1 题组 / 待复核 6 / 解析 generated 39 · none 2` |
| 题库自检 | ✅ 无答案行、无 CR、`explanationSource` 分布正确 |
| `npx vue-tsc -b` | ✅ exit 0（`Question` 新增 `explanationSource`） |
| `npx vitest run --pool=threads` | ✅ 17 文件 / 133 测试 |
| `npm run test:computer` | ✅ 15/15 |
| `npm run audit:banks` | ✅ 覆盖新库，schema / id 唯一性 / 题干+答案 全 OK |

---

## 29. S6 发布器：一条命令完成"网页生成 + 拼接"（用户要求）

> 要求原文：「写一个程序，使得它可以直接作为工作流的一部分，进行网页的生成和拼接」。

### 29.1 一条命令

```bash
python pdf-ocr/5_check.py --category computer-2026-midterm        # 门禁（必须先跑）
python pdf-ocr/6_publish.py --category computer-2026-midterm      # 发布上站
```

`6_publish.py` 是工作流的第 6 环，6 个步骤：

| 步 | 做什么 | 失败就退出 |
|---|---|---|
| 1 | **门禁**：读 `data/processed/<key>-check.json`，校验 `passed` + md sha256 | 码 1（缺结论）/ 码 3（未通过或 md 变过） |
| 2 | **生成题库**：调 `npx tsx scripts/parse-computer-paper.ts --key <key>` | 码 3 |
| 3 | **拼接进站点源码**（6 处，幂等） | 码 1/3 |
| 4 | 重建 `public/_meta.json`（首页题数） | 码 3 |
| 5 | `npx vue-tsc -b` 类型检查 + `npm run audit:banks` 题库审计 | 码 3 |
| 6 | `npx vite build` 构建网页 | 码 3 |

输出沿用统一进度格式：`[S6/6 发布上站] step 3/6 (3/6)  ✓ 2ms  站点源码 6 处：改动 1 处 → …`

### 29.2 拼接的 6 处（少一处卡片就不出现 / 或不被审计覆盖）

| 文件 | 拼什么 |
|---|---|
| `src/types/question.ts` | `Category` 联合类型（**追加到末尾**） |
| `src/config/categories.ts` | `CATEGORIES` 条目（短名/长名/描述/图标/bankFile/题单视图） |
| `src/config/courseTree.ts` | `computer-organization` 组下的叶子（侧栏/课程树入口） |
| `src/config/categories.test.ts` | 硬编码的 key 列表（排序插入，不然测试红） |
| `scripts/generate-meta.mjs` | `banks` 列表 → `_meta.json`（首页题数） |
| `scripts/audit-banks.mjs` | `BANKS` 列表（**追加到末尾**） |

**试卷清单本身不需要登记**：`parse-computer-paper.ts` 从 `data/processed/*-check.json`（S5 的结论）
自动发现所有已通过校验的试卷 —— 所以 `npm run parse:computerPaper`（无参数）会把所有已发布试卷刷一遍。

展示信息默认从 md 的 `## 题组一：<卷名>` 取，可用 `--short/--long/--desc/--icon` 覆盖。

### 29.3 三个"少惹麻烦"的实现细节

1. **幂等**：每个 patcher 先查 key 是否已存在，在就跳过 → 重复跑输出 `改动 0 处（都已在位）`。
2. **最小 diff**：联合类型与 `BANKS` **只追加、不重排**（顺序无语义）；
   `generate-meta.mjs` 的数组是单行就单行插入（1 行 diff），多行才整段重排。
   > 一开始写的是"整段重排成有序"，实测会造出 8 行无关改动 —— 已改掉。
3. **保留行尾符**：读源码时把 `\r\n` 归一成 `\n` 处理，写回时按原样还原（仓库里两种行尾并存，
   统一改写会造出一堆假 diff）。

### 29.4 实测

**从 HEAD 的干净注册状态**（把 6 处注册全撤掉）跑一遍：

```
[S6/6 发布上站] step 1/6 (1/6)  ✓ 门禁通过（exit 2，警告 1）
[S6/6 发布上站] step 2/6 (2/6)  ✓ 1018ms  public\computer-2026-midterm-question-bank.json ✓ 52344 字节
  6 处：改动 6 处
[S6/6 发布上站] step 4/6 (4/6)  ✓ 563ms   public/_meta.json → computer-2026-midterm: 41 题
[S6/6 发布上站] step 5/6 (5/6)  ✓ 4214ms  vue-tsc ✓ / 审计 ✓
[S6/6 发布上站] step 6/6 (6/6)  ✓ 1755ms  ✓ built in 657ms
[完成] 发布上站 ✓ | 总耗时 8.0s
```

再跑一次 → `改动 0 处（都已在位）`；`git diff` 确认产物与手写版一致（22 行插入 / 1 行删除）。

**这一步测试抓到一个真 bug**：`patch_meta_keys` 的结束锚点原先写死成 `"].map((key) =>"`，
而仓库里那个数组在 HEAD 上是**单行**（`.map(` 后面直接换行），锚点根本不存在 → 直接崩。
改成用数组自己的 `]` 收尾、并按"单行/多行"分别插入。**所以这类 patcher 必须从 HEAD 的原始形态测**，
不能只在自己改过的形态上测。

### 29.5 验收

| 检查 | 结果 |
|---|---|
| 从干净状态跑发布器 | ✅ 6 处全插入，`vue-tsc` / `audit:banks` / `vite build` 全绿，8.0s |
| 再跑一次（幂等） | ✅ 改动 0 处 |
| `git diff` 6 个注册文件 | ✅ 22 insertions / 1 deletion（全是必要的） |
| `npx vitest run` | ✅ 17 文件 / 133 测试 |
| `_meta.json` | ✅ 9 个分类，新分类 41 题 |

---

## 30. 用命令行控制卡片位置（`6_publish.py`）

### 30.1 位置由什么决定

首页那张硬编码入口卡「计算机组成（软国际）」点进去才是「选择试卷」区（`/#/computer-organization`，
见 `LandingPage.vue:12-13`）。区里卡片的顺序 **就是我们这份试卷在 `CATEGORIES` 数组里的相对顺序**
（`filter` 保序）。侧栏/课程树的顺序同理，看 `COURSE_TREE` 里那个分组 children 的顺序。

所以"控制位置" = 控制这两处数组里的插入点。`6_publish.py` 用四个参数控制，**默认追加到最后一张**：

| 参数 | 含义 | 例 |
|---|---|---|
| 不给 | 追加到同类末尾 **（默认）** | — |
| `--position N` | 同类第 N 张（`1` = 最前；超过总数则追加） | `--position 1` |
| `--before <分类名>` | 放到某份试卷**之前** | `--before computer-midterms` |
| `--after <分类名>` | 放到某份试卷**之后** | `--after computer-2021-final` |
| `--last` | 挪回同类最后一张 | `--last` |

「同类」＝都以 `computer-` 开头（或都不以它开头）。所以 `--position 1` 是"计算机试卷里的第 1 张"，
不是"整个 CATEGORIES 的第 1 条"（第一条是日语）。

### 30.2 例子（都实测过）

```bash
# ① 放到「选择试卷」区第一张
python pdf-ocr/6_publish.py --category computer-2026-midterm --position 1
#    计算机组织与结构（软国）2026年 → 2021期末 → 2024期末（部分试卷） → C卷 → 期中三年合集

# ② 放到第 3 张
python pdf-ocr/6_publish.py --category computer-2026-midterm --position 3

# ③ 放到「期中三年合集」之前
python pdf-ocr/6_publish.py --category computer-2026-midterm --before computer-midterms
#    2021期末 → 2024期末 → C卷 → 计算机组织与结构（软国）2026年 → 期中三年合集

# ④ 放到「2021期末」之后
python pdf-ocr/6_publish.py --category computer-2026-midterm --after computer-2021-final
#    2021期末 → 计算机组织与结构（软国）2026年 → 2024期末 → C卷 → 期中三年合集

# ⑤ 挪回最后一张（= 默认行为）
python pdf-ocr/6_publish.py --category computer-2026-midterm --last

# ⑥ 先看会怎么动，不写盘
python pdf-ocr/6_publish.py --category computer-2026-midterm --position 1 --dry-run
#    src/config/categories.ts：将移动到第 1 张（computer-2021-final 之前）
#    src/config/courseTree.ts：将移动到第 1 张（computer-2021-final 之前）

# ⑦ 不给位置参数 = 幂等（已注册就什么都不动）
python pdf-ocr/6_publish.py --category computer-2026-midterm
#    src/config/categories.ts：已存在（位置不变）
```

每次跑完都会打印结果顺序，方便核对：

```
    「选择试卷」区顺序：2021期末 → 2024期末（部分试卷） → C卷（日期待核对） → 期中三年合集 → 计算机组织与结构（软国）2026年
```

### 30.3 两个实现细节

1. **两处一起动**：`CATEGORIES`（卡片顺序）和 `courseTree.ts` 的叶子（侧栏顺序）用**同一个位置规则**，
   所以不会再出现"卡片排在最后、侧栏排在第一"的不一致（改造前就是这样）。
   > 实测：`--position 1` / `--before` / `--after` / `--last` 四种情况下，两处顺序完全一致。
2. **已注册也能挪**：位置参数会让 patcher **先摘掉旧条目再插到新位置**（也就是"移动"），
   而不是像其它拼接点那样"已存在就跳过"。挪到原位时输出 `已在该位置（第 N 张）`，不算改动。

### 30.4 位置之外的名字

卡片的**标题**用的是 `short`（`LandingPage.vue:105`），侧栏叶子用 `courseTree.ts` 的 `label`，
副标题用 `desc`，图标用 `icon`，右侧题数来自 `public/_meta.json`。
这些可以用 `--short/--long/--desc/--icon` 在**首次发布**时定；**已注册的条目不会被覆盖**
（拼接是幂等的），要改名请直接改 `src/config/categories.ts` / `courseTree.ts`，或先删掉那条再重跑。

> 约束：`short` 必须全局唯一（`src/config/categories.test.ts:23-27` 会失败）；
> 位置只影响顺序，不影响任何校验。

---

## 31. 入口卡 + 试卷卡（两层结构，命令行管理）

> 要求原文：「能否先新建入口卡，再加入卡片，命令行中给出入口名和试卷名，若存在入口，则添加试卷，若不存在，则新建入口」。

### 31.1 结构：入口不再写死

首页是两层：

| 层 | 内容 | 路由 | 配置 |
|---|---|---|---|
| 第一层 | **入口卡**（学科/试卷集合）+ 不归属任何入口的学科 | `/` | `src/config/entries.ts` 的 `ENTRIES` + `CATEGORIES` |
| 第二层 | 该入口下的**试卷卡** | `/<入口 key>` | `ENTRIES[].papers`（**顺序即卡片顺序**） |

- 入口清单从「`LandingPage.vue` 里写死一张计算机组成卡 + 用 `computer-` 前缀分组」改成了
  数据驱动：`entries.ts` 的 `ENTRIES`，`entryOfCategory()` 决定一个分类是第一层学科还是某入口下的试卷。
- 路由改成通用的 `/:entryKey`（放在所有静态路由之后，不认识就回首页）——**新建入口不需要动 router**。
- `entries.test.ts` 守住三条不变量：入口引用的分类必须存在、一个分类只能属于一个入口、
  `computer-*` 必须都已归入入口。

### 31.2 命令行：给入口名和试卷名

```bash
python pdf-ocr/6_publish.py --category <分类 key> \
  --entry "<入口名>" [--entry-key <key>] [--entry-icon <字>] [--entry-desc <副标题>] \
  [--paper "<试卷名>"] [位置参数]
```

| 情形 | 行为 |
|---|---|
| **入口已存在**（按 `--entry-key` 或 `--entry` 名精确匹配） | 把试卷加进它的 `papers[]`（默认追加到最后一张） |
| **入口不存在** | **先新建入口**（key 取 `--entry-key`，或从入口名抽 ASCII），再把试卷挂上 |
| `--entry` / `--entry-key` 都不给 | 沿用这份试卷**当前所在的入口**（新试卷则报错） |
| 中文入口名且没给 `--entry-key` | **直接报错退出**（不猜 key），提示加 `--entry-key` |
| 一份试卷已在别的入口 | 先从旧入口摘掉，再挂到新入口（**一个分类只属于一个入口**） |

### 31.3 例子（都实测过）

```bash
# ① 入口已存在 → 只加试卷（默认追加到最后一张）
python pdf-ocr/6_publish.py --category computer-2026-midterm \
  --entry "计算机组成（软国际）" --paper "2026期中（软国）"
#   入口：已有 「计算机组成（软国际）」（/computer-organization）
#   src/config/entries.ts：入口「计算机组成（软国际）」：试卷插入到第 5 张（computer-midterms 之后）

# ② 入口不存在 → 新建入口 + 挂试卷
python pdf-ocr/6_publish.py --category english-cet4 \
  --entry "英语四级" --entry-key english-cet4 --entry-icon 英 --paper "2026年6月真题"
#   入口：新建 「英语四级」（/english-cet4），图标 英
#   src/config/entries.ts：新建入口「英语四级」（/english-cet4）并把试卷挂到第 1 张
#   → 首页立刻多一张「英语四级」入口卡，路由 /english-cet4 自动可用

# ③ 中文入口名但漏了 --entry-key → 直接报错（不猜 key）
python pdf-ocr/6_publish.py --category english-cet4 --entry "英语四级"
#   [错误] 要新建入口「英语四级」，但推不出合法的 key（只能用 a-z 0-9 -）。
#          请加 --entry-key，例如 --entry-key cs-organization

# ④ 控制这张试卷卡在入口里的位置（同一入口内）
python pdf-ocr/6_publish.py --category computer-2026-midterm --entry "计算机组成（软国际）" --position 1
python pdf-ocr/6_publish.py --category computer-2026-midterm --before computer-midterms
python pdf-ocr/6_publish.py --category computer-2026-midterm --after computer-2021-final
python pdf-ocr/6_publish.py --category computer-2026-midterm --last

# ⑤ 先看会怎么动（不写盘）
python pdf-ocr/6_publish.py --category computer-2026-midterm --entry "计算机组成（软国际）" --position 1 --dry-run
```

跑完一定会打印结果顺序，便于核对：

```
    「选择试卷」区顺序：2021期末 → 2024期末（部分试卷） → C卷（日期待核对） → 期中三年合集 → 计算机组织与结构（软国）2026年
```

### 31.4 实现细节

- `parse_entries()` / `render_entries()` 直接解析/渲染 `entries.ts` 的结构（它是我们生成的文件，格式固定），
  比正则手术稳。数组里的人类注释会在重写时丢掉 —— 注释请写在文件头的文档串里。
  > **边界坑**：数组内部文本结尾是 `  },` **不带换行**（那个换行属于后面的 `\n]`）——
  > 解析正则写成 `\n  },\n` 会数出 **0 个入口**（实测踩过）。
- `CATEGORIES` 数组里那份条目只管展示信息（`short/long/desc/icon/bankFile`），**顺序不再影响卡片顺序**，
  所以发布器只做"没有就追加"（1 行 diff、不重排）。
- `courseTree.ts` 的叶子仍按同一个位置规则插入，保证侧栏顺序和「选择试卷」区一致。
- 拼接点从 6 处变成 **7 处**（多了 `src/config/entries.ts`）。

### 31.5 验收

| 检查 | 结果 |
|---|---|
| `python pdf-ocr/tests/test_p6_publish.py`（新增） | ✅ **7 组断言**：往返解析、入口已存在/不存在、中文名缺 key 报错、四种位置、幂等、跨入口移动 |
| 发布器幂等复跑 | ✅ `站点源码 7 处：改动 0 处` |
| `npx vue-tsc -b` | ✅ exit 0 |
| `npx vitest run` | ✅ **18 文件 / 138 测试**（新增 `entries.test.ts` 5 组不变量） |
| `npm run audit:banks` / `vite build` | ✅ 通过 |

---

## 32. 截断题保留 + 判重删除 + 全卷 AI 终审（用户要求）

> 要求原文：「在 p3 时保留被截断的题目和对应选项，不要直接删去，同时遇到疑似相同的题，直接删去」
> ＋「答案顺延，跳过重复题目」＋「S4 部分也介入 deepseek」。

### 32.1 S3：被截断的题**保留**，不再整题丢掉

`normalize_question()` 以前在"题干为空"时**整题返回 None**（等于静默删除）—— 而截断（页底被切断、
JSON 被 `max_tokens` 切掉）正好就是这种形态。现在：

- **只对"根本不是对象"的条目返回 None**；题干为空也**保留**、标 `needs_review`，让 S4/S5 与人工看到。
- 提示词规则 3 写死："哪怕只看见半截题干、只剩一两个选项，也照原样抄下来，**不许因为不完整就整题省略**"。

### 32.2 S3：页内判重**直接删**

- 判据（`dedupe_questions()`）：**归一化题干完全相同**，且选项"相同 **或** 有一方没给"。
  - 题干 <10 字不参与 —— 匹配题的小题题干常是 `(30) の選択肢：`，会撞车（实测踩过，会删真题）。
  - 同题干但**两边都有选项且不同** → 判为"同题干不同小问"，两道都留。
- 信息更全的那份胜出；删除记录写进 `merge.json` 的 `deduped[]`，**不**因此标 `needs_review`（用户："直接删去"）。
- **只删、不改题号** —— "删掉后面题号整体前移"是跨页操作，只有 S4 看得到全卷。

### 32.3 S4：全卷 AI 终审（DeepSeek **一次**调用）

`4_build_md.py` 新增 `ai_review()`：

- **输入**：全卷题目（题号/题组/题干/选项/答案）+ 从各页转写里挑出来的**答案表片段**
  （`answer_table_snippets()`：抓 `1-5 DDDBC` 这类行，以及含"参考答案/评分标准"的段落）。
- **输出**：`duplicates[]`（疑似重复的题 + 保留哪条 + 理由）、`answers[]`（**顺延后**的答案对位 + 依据）、
  `notes[]`。
- **S4 应用**（`apply_ai_review()`）三步：
  1. **删重复**（按题号匹配，`keepNumber` 优先保留 → 直接删、不动 `needs_review`）；
  2. **题号顺延**：**按题组**把题号重新连续编号（从该组第一题的原题号起）——
     等价于"被删题之后的所有题号减 1"，且**只在真的删过题时才做**（原卷本来就跳号的地方不动）；
  3. **答案重新对位**：`answers[]` 给的是顺延后的题号 → 逐条覆盖 `answerKey`，`answerText` 跟着选项重算。
- **缓存**：结果落在 `work/<分类名>/paper-review.json`，默认**复用**（重跑不重复花钱）；
  `--refresh-review` 重跑，`--no-ai-review` 完全跳过（纯离线、0 token）。
- 放在**公共题干挂载之后**：那一步要用"卷面原题号"回查转写定位导言，重编号后就不准了。

### 32.4 为什么必须"答案重新对位"

这份 Marxism 卷的答案是**按位置**给的（卷首就印着）：

```
一、单向选择题（每题1分，共15分）
1-5 DDDBC   6-10 ABDDB   11-15 ABCAC
```

而 OCR/模型把第 7、8 题读成了**一模一样**（题干+选项全同，答案 B / D）。删掉第 8 题后，
若不重编号，第 9 题以后的**答案就整体错位一位**。所以 S4 必须：删 → 顺延题号 → 按新题号重发答案。

### 32.5 验收

| 检查 | 结果 |
|---|---|
| `pdf-ocr/tests/test_p4_ai_review.py`（新增） | ✅ **5 组断言**：判重不误删（占位符题干 / 同题干不同选项）、信息更全者胜出、删→顺延→答案对位、没删题时不动题号、答案表片段提取 |
| 全部 pdf-ocr 套件 | ✅ 8 + 17 + 5 + 7 + 4 = **41 组断言** |
| 回归测试是否离线 | ✅ 3 处 S4 调用都加了 `--no-ai-review`，跑完**没有**生成 `paper-review.json`（确认没偷偷调 API） |

---

## 33. `answerKey` / `questionType` 的确定性约束（S3，用户要求）

> 要求原文：「p3 的 questiontype 和 answerKey 有错误，进行约束，使其完整的格式化」。

以前这两个字段是**模型给什么就存什么**。实测（`Principles-of-Marxism` 卷）出现的写法：
`b`、`Ａ`（全角）、`C、A`、`c,a`、`D 和 B`、`正确`、`√`、`×`、`错`、`简答题`、`other`、
`multiple`、`single choice`、空串 —— 直接进库会让**判分和渲染都出错**（前端只认 `'single' | 'multi' | 'judgement' | 'fill'`，
答案比对按 `answerKey` 逐字符比）。

### 33.1 收敛规则（`3_merge.py` 的 `normalize_answer_key()` / `infer_question_type()` / `normalize_question_type()`）

`answerKey`：

| 输入形态 | 处理 |
|---|---|
| 单个字母，半角/全角、大小写混用（`b`、`Ａ`） | 转半角大写 |
| 多字母带分隔符（`c,a`、`C、A`、`C/A`、`D 和 B`、`AC`、`A B`） | 拆出字母 → 去重 → **升序**拼成 `AC` |
| 判断题的中文词（`正确`/`对`/`是`/`√`/`T`） | → `A`（配合 `判断题` 的 `A=正确 B=错误`） |
| 判断题的否定词（`错误`/`错`/`否`/`×`/`F`） | → `B` |
| 字母不在该题选项里 | **清空** + `needs_review: true`（不猜） |
| 多字母但该题选项 <2 或题型是单选 | 保留原键但标 `needs_review: true`（交人工） |

`questionType`（只允许 `QUIZ_TYPES = ("single", "multi", "judgement", "fill")`）：

- 先按答案形态推断：多字母 → `multi`；`A`/`B` 且选项是 `正确/错误` → `judgement`；无选项且无答案 → `fill`；其余 → `single`。
- 中文/英文别名归一：`单选`/`单项选择`/`single choice` → `single`；`多选`/`multiple` → `multi`；
  `判断`/`正误` → `judgement`；`填空`/`简答`/`主观题`/`other`/无法识别 → `fill`。
  > `other` 之所以落到 `fill`：卷面上它总是主观题；落 `fill` 至少前端能正常渲染成"无选项题"，
  > 而留着 `other` 会让渲染分支落空。
- 多选题的 `answerText` **自动重算**（按选项文本用 `、` 连接，如 `甲、丙`）——
  md 契约要求 `**正确答案：X text**` 的 text **至少 1 个字符**，模型给的答案文本常是空的。

### 33.2 改动留痕

每次纠正记一笔进 `merge.json` 的 `normalized[]`：

```jsonc
{ "number": 1, "field": "answerKey", "before": "c,a", "after": "AC" }
```

S4 读入后**按 (字段, 原值, 规范值) 聚合**写进 `report.md` 的
「S3 字段格式化」小节（表格：字段 / 原值 / 规范为 / 次数），不逐条刷屏；
有值被**清空**时额外加一行 ⚠ 提醒需要人工补答案。S3 / S4 的进度行也带上计数
（S3：`…，格式化 N`；S4：`… / 字段格式化 N / …`）。

### 33.3 验收

| 检查 | 结果 |
|---|---|
| `pdf-ocr/tests/test_s3_normalize.py`（新增） | ✅ **5 组断言**：15 种写法全部收敛到合法值、认不出的答案清空或标 `needs_review`、多选自动拼 `answerText`、纠正记录字段齐全、`QUIZ_TYPES` 与 `src/types/question.ts` 的联合类型一致 |
| `pdf-ocr/tests/test_p4_build.py` 第 18 组（新增） | ✅ S4 把 `normalized[]` 聚合成 report.md 的表格，并在有值被清空时加 ⚠「需要人工补答案」 |
| 全部 pdf-ocr 套件 | ✅ 4 + 8 + 5 + **18** + 5 + 7 = **47 组断言**（0 失败） |
| 是否联网 | ✅ 该测试**纯离线**，0 token |

---

## 35. 文件夹批量导入 `7_import.py`（用户要求：一个文件夹 = 一个入口）

> 要求原文：「再加入一个文件夹内批量导入功能，默认文件夹名就是入口名，也可以通过命令行
> 批量导入一个入口（将几个过程全自动来那个接在一起）」。

把 S1→S6 串成一条命令：**一个文件夹 = 一个入口，文件夹里的每个 PDF = 一张试卷卡**。

```powershell
# 入口名默认取文件夹名
python pdf-ocr/7_import.py --folder "C:\Users\me\Desktop\马原试卷" --entry-icon 马

# 用一个文件夹批量导入到指定入口（多份 PDF 都挂到同一入口下）
python pdf-ocr/7_import.py --folder .\inbox --entry "英语四级" --entry-key english-cet4 --entry-icon 英

python pdf-ocr/7_import.py --folder .\inbox --dry-run          # 只列计划
python pdf-ocr/7_import.py --folder .\inbox --from-step 3      # 断点续跑
python pdf-ocr/7_import.py --folder .\inbox --only-step 5      # 只跑某一步
```

| 项 | 规则 |
|---|---|
| **入口名** | 默认 = **文件夹名**；`--entry` 覆盖 |
| 入口 key（路由） | `--entry-key`，或由入口名推（只留 `a-z 0-9 -`）。**纯中文推不出来时自动兜底成 `entry-<6 位名字哈希>`** 并给警告 —— 同一个文件夹名永远得到同一个 key，续跑/重跑幂等；想换好记的路由再显式给 `--entry-key` |
| **试卷卡标题** | 默认 = **PDF 文件名**（去扩展名）；`--paper-prefix` 可加前缀 |
| **分类名**（数据目录 / 题库文件名 key） | `<entry-key>-<序号>`；只有一份 PDF 时就是 `<entry-key>`；`--category-prefix` 可换前缀 |
| 卡片顺序 | 按 PDF 文件名的排序（稳定），`--position <序号>` 传给 S6 |
| 失败处理 | 默认**停下**并打印续跑命令；`--keep-going` 跳过失败项继续 |
| 透传 | `--dpi`（S1）、`--force`（S1/S4 覆盖已有产物）、`--no-build` / `--no-verify`（S6）、`--quiet` |

实现要点：**不把各阶段改造成可 import 的模块**，而是用 `subprocess` 顺序调用既有的六个脚本
（`sys.executable pdf-ocr/<脚本> …`，`cwd=仓库根`）——它们本来就有稳定的 CLI 与退出码，
**stdio 直接继承**（不捕获，避免破坏 §6 的进度行）。退出码透传：0 全成功 / 1 参数环境 / 3 有试卷失败。

验收：`pdf-ocr/tests/test_p7_import.py`（**5 组断言**：slug 规则、多份带序号与排序、单份不带序号、
dry-run 的入口名与兜底 key、非法 `--category-prefix` 与空文件夹各返回 1）。

---

## 34. 参考答案页 / 材料题 / 题型：一张"马原卷"暴露的三个坑（用户要求）

> 用户原话：「为何拼接功能消失，很多多选题的 questionType 不对，且 answerKey 没有显示」
> ＋「可以删改代码」。

用 `pdf-ocr/work/Principles-of-Marxism/`（《马克思主义基本原理概论》，9 页）复现出来的**三个独立缺陷**。
这张卷子很典型：**答案单独印在最后一页**、**多选题有 5 个选项**、**材料题跨页**。
修复前的 S4 输出是：52 条提取 → 44 题 / **37 道缺答案** / 38 待复核 / 公共题干 0。

### 34.1 「拼接功能消失」＝ 材料题贴不上去

第 5 页最后一道题是「五、案例分析题」的**整段材料**（`continued: true`），三个小问在第 6 页，
两页的**题组名不同**（`五、案例分析题` vs `思考题`）—— 而 `attach_shared_stems()` 是按"题组"找导言的，
于是材料贴不到小问上，站上三个小问成了"没头没尾"的孤儿题。

新增 `attach_material_passages()`（在 `attach_shared_stems()` 之后跑），判据全满足才动手：

1. 该题**没有选项**、题干压平后 ≥ 120 字、且带材料味关键词（案例/材料/阅读/分析/论述/思考题…）；
2. 它是**所在页的最后一道题**；
3. **下一页**至少 2 道题，且这些题自己都还没有材料（题干短、无代码围栏）。

材料**复制**进每个小问的题干（与 §8.4 的公共题干同一个原则：单看任意一题都不缺上下文）；
材料本身（只有材料、没有答案，不是一道能作答的题）**从题单里撤掉**，它名下的
"跨页拼接失败"记录也一并撤掉，免得报告里留噪音。

### 34.2 「answerKey 没有显示」＝ 答案页被当成题目抄了

这份卷子的答案是**单独印在最后一页**的「试卷评分标准」：模型把那一页抄成了 23 条
「题干为空、只有答案」的伪题目 —— 于是**真正的题目 37 道缺答案**，而站上多出一堆空题 + 裸答案。

新增 `is_answer_key_page()` ＋ `harvest_answer_table()` ＋ `apply_answer_table()`：

- **识别**（满足其一）：`paper_identity.title` 命中 `评分标准|参考答案|标准答案|…`；
  或该页提出的题**题干全空**且 **≥ 3 道**带着 answerKey。
- **收获**：抽成 `{(大题键, 题号): 答案}`，答案页**不再产出任何题目**（只记进 report.md）。
- **贴回**：按 `(大题键, 题号)` 匹配；`大题键` 由 `section_bucket()` 归一
  （`题组一 一、单项选择题` 与 `一、单项选择题` 归到同一个键；认得出题型就用题型当键）。
  **回退条款**：只有当答案表**只有一个大题**时，才允许"只按题号"匹配 ——
  很多卷子每个大题都从 1 重新编号（单选 1-15、多选 1-5、论述 1…），
  无脑按题号回退会把单选的答案贴到主观题上（实测踩过，写进测试）。

实测效果：**贴回 12 道题**（单选 9/10-15 + 多选 5 道），缺答案 37 → 10。

### 34.2b 第二轮：答案页的"逐题抄"不能指望模型（用户："还是没改"）

用户重跑 S3（真实 AI）后反馈 `questionType` / `answerKey` 仍未修好。查下来是**新的两个坑**：

1. **模型把整页答案概括了**：这一次它只提出 5 条，把单选写成一条
   `#5 … ans='C'（OCR 原写作 "DDDB C"，按五个答案断为 D/D/D/B/C）`，
   多选写成一条 `#1 ans='CE'` —— 逐题答案（14 条）全丢，答案表没东西可贴。
2. **S3 的页内判重把答案行吃掉了**：参考答案页每一行的题干都是同一句占位
   `（本页未印题干，仅有答案）`，模型本来提出的 23 行被"同题干 = 重复"删到只剩 1 行。

三条修复（**前两条让已有数据 0 token 就能修好**）：

- **S4 增加"答案表的确定性来源"**（`mine_answers_from_transcription()`）：
  直接读两路 OCR 的**转写**，解析
  ```
  一、单项选择题（每题1分，共15分）
  1-5 DDDB C          → 区间写法，展开成 5 条（空格是排版断行）
  二、多项选择题（每题1分，共5分）
  1-5 1.CE 2.AC 3.ABC 4.ABC 5.DE   → 逐题写法，按 `题号.答案` 抄
  ```
  只挖**客观题**大题（单选/多选/判断）；主观题那几段是评分标准，
  硬挖会把"1. 对 2分""4分"当成答案。区间字母数与题号跨度对不上就不采信，记进
  `answer_table_odd[]`；两路答案不一致记进 `answer_table_conflicts[]`，都要人看。
  哪些页是答案页也不再依赖模型 —— `transcription_answer_pages()` 看转写里有没有
  `参考答案 / 评分标准`。
- **占位题干不参与判重**（`_common.is_placeholder_stem()`）：`dup_key()` 遇到
  "这一页没有题干"的占位直接返回 `None`。注意**不能**改成"答案不同就不判重" ——
  那会把真题的判重也削弱掉（`test_p4_ai_review` 立刻抓到）。
- **S3 提示词规则 8**：明确要求答案页**逐题一条**地抄（区间要展开、不许合并总结、
  stem 留空、主观题把评分标准写进 `answerText`）。重跑第 7 页验证：
  **5 条 → 23 条**（单选 15 + 多选 5 + 论述/辨析 3），8.5k token / 22.5s。

### 34.2c 答案表是权威：与题目页冲突时按它改正

实测第 9 题的选项被页边界切掉一半（只剩 A/B），模型自己在题目页猜了个 `B`，
而评分标准写的是 `D`。所以 `apply_answer_table()` **允许覆盖**题目页上已有的答案，
改动记进 `answer_overrides[]`（report.md 里单独一张"模型写的 / 评分标准"对照表）。
配套：`review_completeness()` 会因此报"答案 D 不在选项里"并把该题标 `needs_review` ——
正确，因为那条题目的选项本身就是残缺的。

**答案页原文经视觉核对**（`read_image` 读 `work/<分类名>/pages/page-007.png`）：
```
一、单项选择题（每题1分，共15分）  1-5 DDDBC  6-10 ABDDB  11-15 ABCAC
二、多项选择题（每题1分，共5分）  1-5 1.CE 2.AC 3.ABC 4.ABC 5.DE
```
与转写一字不差 —— 也顺便证明**上一轮 S3 给的 `1.C / 5.D` 是错的**，这一轮的 `CE / DE` 才是对的。

### 34.3 「很多多选题的 questionType 不对」＝ 谁说了算

卷面写着「二、多项选择题」、每题 5 个选项，模型却逐题给了 `single`；旧代码还额外有一条
"声明 multi 但答案不足 2 个字母 → 改回 single"的**自洽性检查**，而这份卷子的多选答案
恰好没抽到 ⇒ 全军覆没成 `single`。

现在题型的优先级是：

```
卷面大题标题  >  模型逐题声明  >  内容推断
```

外加一条**单向**硬证据：答案里有 ≥2 个字母 ⇒ 一定是 `multi`（旧的"反向纠偏"删掉了）。
规则本体放在 `_common.py`（`SECTION_TYPE_RULES` / `question_type_from_section()`），
**S3 与 S4 共用**：S3 对新跑的页生效，S4 的 `normalize_question_types()` 对**已有的 merge.json**
再兜一次 —— 这样用户手里那批旧数据不改一行就能修好（0 token）。实测补正 8 处。

### 34.4 顺带：填空题不再被误报"字段不完整"

`review_completeness()` 以前对**所有**题都报「选项不足 2 个」、且 `答案 X` 要求整体落在
选项 key 集合里 —— 主观题/填空题本来就不给选项，会被整片标成待复核（实测 13 道）。
现在：`fill` 题型不检查选项数量；没有选项的题不检查"答案在不在选项里"；
多选答案**逐字母**检查。待复核 38 → 14。

### 34.5 解析端：`[A-D]` 与"只捕获一个字母"（`scripts/lib/parse-exam-markdown.ts`）

站上拿到的是 `public/<key>-question-bank.json`，它由共享解析器产出。解析器里有两个写死的假设：

| 旧写法 | 后果 | 现在 |
|---|---|---|
| 答案正则 `([A-D])\s*(.+?)` | `**正确答案：AC 甲、丙**` → `answerKey='A'`、`answerText='C 甲、丙'`：**第二个正确选项丢了**，且 `answerKey.length > 1` 永远不成立 ⇒ `multi` 是**死代码**，多选题在站上永远是单选 | `([A-E]{1,5})` + `normalizeAnswerKey()`（去重升序） |
| 选项正则 `[A-D]` | 第 5 个选项（E）被当成题干正文吞掉 | `[A-E]` |
| `questionType` 联合类型缺 `judgement` | 判断题（A.正确/B.错误）只能落 `single` | 补 `judgement`，`inferQuestionType()` 按"多字母 / 两选项恰为正确错误 / 无选项"判 |

`pdf-ocr/5_check.py`（解析端的 Python 影子实现）同步改，否则 S5 的结论和 S6 的实际行为会不一致。

### 34.7 AI 判题型（用户："答案表不给出多选，但是每个题选项是多个，怎么判断（用ai）"）

**问题**：答案表只按题号给字母（`1-5 DDDBC`、`1.CE 2.AC`），**它不标哪道是多选**；
而每道题又都挂着好几个选项 —— 光看"选项有几个"分不出单选/多选。

**判据层级**（越上面越硬）：

| 层级 | 判据 | 谁来做 |
|---|---|---|
| 1 | **卷面大题标题**（"二、多项选择题" → multi、"单项选择题" → single、"判断题" → judgement） | S3/S4 的确定性规则（0 token） |
| 2 | **答案的字母个数**：≥2 个字母 ⇒ 一定是 multi | 同上 |
| 3 | 上面两条都不成立（模型没写大题名、答案也没有） | **AI 逐题判** |

**实现**：`AI_REVIEW_SCHEMA` 里加 `questionTypes[]`（对**每一道有选项的题**给一条：
`{number, group, questionType, answerKey, reason}`）。`group` 必须原样抄回 ——
很多卷子每个大题都从 1 重新编号，只写题号对不上号（实测 AI 就在这儿栽过，见 §34.8）。

`apply_ai_types()` 的应用规则：

- 卷面大题标题**认得出题型** → 以**卷面为准**；AI 不同意就记 `ai_type_conflicts[]` 让人看；
- 标题**认不出** → 采用 AI 的判定，记 `type_from_ai[]`；
- **交叉验证**：最终判定为 `multi` 但答案只有一个字母 → 答案表很可能漏读，
  记 `multi_answer_suspect[]` **并标 `needs_review`**（这正是"多选只抄到一个字母"的形态）。

**实测**（马原卷，deepseek-flash，**15.5k token / 46.6s**，结果缓存进 `paper-review.json`）：

| 项 | 结果 |
|---|---|
| AI 判型 | **19 题**（每道有选项的题都判了） |
| 与卷面大题标题冲突 | **0 处** —— 卷面标题判出来的题型和 AI 判的**完全一致** |
| 由此改掉的题型 | 0 处（这份卷子大题名齐全，符合预期） |
| 多选却只有一个答案字母 | **2 处** → 见 §34.8 第 1 条 |

### 34.8 这次真实 AI 调用暴露出的两个 bug（都已修）

**① `answers[]` 把卷面答案表给的答案改错了。**

这份卷子每个大题都从 1 重新编号（一、单项 1-15；二、多项 1-5；三、论述 1…）。
AI 终审的 `answers[]` 是"按位置对位"，于是它把「**一、单项选择题** 第4题=B」
贴到了「**二、多项选择题** 第4题」上 —— 卷面答案表明明写着 `4.ABC`、`5.DE`，
被覆盖成了 `B`、`C`（报告里那两条"多选却只有一个字母"就是这么来的）。

修法：**已经有答案的题一律不覆盖**，只记 `ai_answer_conflicts[]`；
`answers[]` 只用来补"卷面根本没给答案"的题（顺延对位那件事已经由 §34.2 的
`apply_answer_table()` 在删题**之前**按大题贴好了，题目对象带着答案走，重编号也不会错位）。
schema 里也补了一句警告，让 AI 别再犯。

**② AI 给没有选项的主观题塞字母答案。**

page 8 是评分标准页的续页（案例分析题的三条评分标准），那三行**没有选项**，
却被 AI 按题号补了个 `D` —— 站上就成了"正确答案 D"加一段评分标准正文。

修法：**字母答案必须落在该题的选项里**（`options` 为空或字母不在选项里 → 记
`ai_answer_ignored[]` 并忽略）。顺带这也守住了所有"AI 编答案"的路径。

### 34.9 已知待办（这份卷子还剩的事）

page 8 那三行**评分标准**目前仍被当成 3 道"题目"输出（答案待补）。
它们其实应该作为**案例分析题三个小问的解析**（page 6 的 `思考题` 1/2/3 ←→ page 8 的
评分标准 1/2/3，位置一一对应）—— 但两页的题组名不同（`思考题` vs `五、案例分析题`），
要像 §34.1 那样按"材料块"配对。留给下一步做。

### 34.10 验收

| 检查 | 结果 |
|---|---|
| `pdf-ocr/tests/test_p4_answers.py`（新增） | ✅ 4 组：答案页→答案表（伪题目不再输出、真题目拿到答案、**按题号回退不越界**）、多选题按大题标题补正、材料跨题组贴上且材料撤出题单、填空题不再被误报 |
| `pdf-ocr/tests/test_s3_normalize.py` | ✅ 5 → **8 组**：新增 8 种「大题标题 × 模型声明」组合、`question_type_from_section` 关键词映射、答案页占位题干不参与判重（且真题判重不受影响） |
| `pdf-ocr/tests/test_p4_ai_review.py` | ✅ 5 → **8 组**：新增 AI 判型（卷面标题优先 / 标题认不出才听 AI / 多选只抄到一个字母要报警）、AI 只能补空缺不能覆盖已有答案、字母答案必须落在选项里 |
| `scripts/lib/parse-exam-markdown.test.ts`（新增，vitest） | ✅ **9 个用例**：多字母答案完整收下、`CA`→`AC`、选项到 E、旧格式/CRLF、答案文本用选项兜底、`inferQuestionType` 四种判型 |
| `vitest.config.ts` | `include` 加上 `scripts/**/*.test.ts`（解析器以前**没有任何测试**） |
| 全部 pdf-ocr 套件 | ✅ 4 + 8 + 8 + 18 + 4 + 8 + 7 = **57 组断言，0 失败** |
| 全部 vitest | ✅ 19 个文件 **147 个用例** |
| 共享解析器回归 | ✅ 重跑 `npm run parse:japanese2024`，`public/japanese-2024-question-bank.json` **零差异**（A-D→A-E 没有影响日语卷） |
| 真实数据（马原卷，纯离线 `--no-ai-review`） | ✅ 44 题 / 37 缺答案 / 38 待复核 → **28 题 / 9 缺答案（全是主观题）/ 14 待复核**，材料 1 段覆盖 3 小问，答案 20 条全部贴上（单选 1-15 + 多选 CE/AC/ABC/ABC/DE），第 9 题按评分标准由 B 改正为 D |
| 真实 AI 验证（用户授权，8.5k token） | ✅ S3 只重跑第 7 页：答案页从 5 条 → **23 条**逐题答案，题型 `single/multi/fill` 全对 |
| 真实 AI 判型（用户授权，15.5k token） | ✅ AI 判 19 题，与卷面标题**零冲突**；抓到 2 处"多选只有一个字母"（实际是 §34.8 的 AI 覆盖 bug，已修）；修后用缓存重跑 **0 token**，可疑数归零 |
| 答案页视觉核对 | ✅ `read_image` 读页图，与转写逐字一致 |

---

## 34b. 「答案不输出」的四个坑（用户要求优先修）

> 用户原话：「最优先还是字母数量，所以优先修复答案不输出在 answerKey 的问题」。
> 前提：**字母个数是判题型的第一判据**，所以答案必须真的落到题上、并且真的输出到 md。

| # | 坑 | 修法 |
|---|---|---|
| 1 | **评分标准行被当成题目**：主观题的答案就是评分标准（`1. 对 2分 劳动是创造价值的唯一源泉…`），它们是答案页上的独立行（没有选项、没有字母答案、只有 `answerText`）。以前既没贴回题目，又被当成若干道"空题"输出 | 新增 `is_grading_row()`（没有选项 + 没有字母答案 + `answerText` 有正文，且题干为空或只是"纯大题标题 + 共N分/要求给…小分"）→ `harvest_criteria()` 收进答案表，**不再当题输出** |
| 2 | **答案抄到了却没贴回题目**：真正的题目（论述/辨析/案例小问）一个答案都没有 | 新增 `apply_criteria()` 三级匹配：① `(大题键, 题号)` 精确 → ② 题号缺失且该大题仅一道候选 → ③ 剩下的**数量相等**才按顺序贴（案例分析标准 1/2/3 → 材料下的思考题 1/2/3）。**必须在材料题处理之后跑** —— 材料标题本身也是"没选项没答案的题"，会混进候选（实测正是它让"数量相等"不成立） |
| 3 | **md 把有答案的题渲染成 `（待补）`**：`answerKey` 空就写待补，`answerText` 里的答案被整段丢掉 | `render_question()`：有 `answerKey` → `**正确答案：X text**`；只有文本答案 → `**正确答案：<文本>**`。解析端（`parse-exam-markdown.ts` + `5_check.py`）同步支持**省略字母的答案行**，并把"没有选项但有答案文本"的题**收进来**（主观题这才可能上站）；`（待补）` 仍按"没有答案"处理 |
| 4 | **`section_bucket()` 太粗**：把所有主观题都归成 `fill` 一个桶，答案贴到了别的大题上（论述题拿到了案例分析第 3 题的标准） | 客观题用题型当键；**主观题用大题名**（论述题 ≠ 辨析题 ≠ 案例分析题） |

顺带修的**题号重复**：这份卷子每个大题都从 1 重新编号（单选 1-15、多选 1-5、辨析 1-2…），
S5 会报"重复题号"硬错误、解析端 `id` 也会撞车。新增 `renumber_if_duplicated()`：
检测到重复就**按大题首次出现顺序重排 + 全卷编号 1..N**，原题号→新题号记进 report.md。
`5_check.py` 的"答案不在选项里"也改成**逐字母**判（否则 `CE` 会被当成不在 `{A..E}` 里 → 5 条假警告）。

**实测（马原卷，纯离线，0 token）**：28 题 / 缺答案 9 / 待复核 14
→ **25 题 / 缺答案 0 / 待复核 6**；S5 从「硬错误 1（重复题号）+ 3 警告」
→ **「硬错误 0 + 1 警告」→ `passed: true`**；解析端可收下 **25/25 题**
（含 6 道主观题及其评分标准）。md 里 25 道题的答案全部输出，`（待补）` 归零。






