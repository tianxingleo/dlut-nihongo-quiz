# PDF 试卷导入工具 · 使用说明

把一堆 PDF 试卷变成站点上能刷的题库：**渲染 → 双路 OCR → 比对提取 → 生成题库 md → 契约校验 → 发布上站**，一条命令跑完一批。

> 本页是**怎么用**。设计取舍、每步的 JSON 契约、历史踩坑记录在 [`pdf-ocr-pipeline.md`](pdf-ocr-pipeline.md)（那份是设计与实测日志，很长）。

---

## 1. 三十秒上手

```bash
# 0) 装依赖（一次即可）
pip install pymupdf requests          # requests 通常已装
npm install                            # 站点侧（发布要跑 vue-tsc / vite build）

# 1) 配 API key
cp .env.example .env                   # 填 STEPFUN_API_KEY 与 DEEPSEEK_API_KEY

# 2) 看计划（不跑、不花钱）
python pdf-ocr/7_import.py --folder "C:\Users\me\Desktop\马" --dry-run

# 3) 正式跑：一个文件夹 = 一个入口，文件夹里每份 PDF = 一张试卷卡
python pdf-ocr/7_import.py --folder "C:\Users\me\Desktop\马" --entry "马克思主义原理" --entry-key marxism --entry-icon 马
```

跑完去 `npm run dev` 打开首页：入口卡 → 试卷卡 → 进 `/home` 刷题。

**一句话规则**：入口名默认就是**文件夹名**；`--entry-key` 是路由（`/<key>`，只能 `a-z0-9-`，中文名必须显式给）。

---

## 2. 它把文件放在哪

| 路径                                                                                     | 是什么                                      | 进 git 吗           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------- |
| `pdf-ocr/work/<分类名>/pages/*.png`                                                      | S1 渲染的页图                               | ✗（`work/` 已忽略） |
| `pdf-ocr/work/<分类名>/pages/page-00N.{a,b}.review.json`                                 | S2 两路 OCR 的逐页转写                      | ✗                   |
| `pdf-ocr/work/<分类名>/pages/page-00N.merge.json`                                        | S3 比对提取后的逐页题目                     | ✗                   |
| `pdf-ocr/work/<分类名>/{transcription.md,report.md,paper-review.json,explanations.json}` | 转写稿 / 报告 / AI 缓存                     | ✗                   |
| `data/raw/<分类名>/<分类名>.md`                                                          | **唯一入库产物**（题库 md）                 | ✓                   |
| `data/processed/<分类名>-check.json`                                                     | S5 契约校验结论（发布门禁凭据）             | ✓                   |
| `data/processed/<分类名>-validation-report.json`                                         | S6 生成的校验报告                           | ✓                   |
| `public/<分类名>-question-bank.json`                                                     | 站点实际加载的题库                          | ✓                   |
| `public/_meta.json`                                                                      | 首页题数（由 `npm run generate:meta` 重建） | ✓                   |

**源 PDF 不入库**：工具只读它，不复制、不提交。想重跑就把 PDF 留在原目录。

**每份卷一个独立目录**：分类名（= 目录名 = 题库 key）默认按下面规则推：

1. 文件名能压出 ASCII（且含字母）→ 用它，例如 `2024A.pdf` → 分类 `2024a`；
2. 压不出来（纯中文，如 `马原试卷5_0_1790064454702.pdf`）→ `<前缀>-<序号>`，序号是它在文件夹里的排序位置，例如 `marxism-5`。前缀 = `--category-prefix`，默认 = `--entry-key`。

卡片标题 = 文件名去掉平台噪声（`_0_1790064454702`、结尾的 `(1)` 下载后缀）。

---

## 3. 六个步骤（想单跑也行）

| 步  | 脚本            | 作用                                                                             | 花钱 |
| --- | --------------- | -------------------------------------------------------------------------------- | ---- |
| S1  | `1_render.py`   | PDF → 每页 PNG                                                                   | 0    |
| S2  | `2_ocr.py`      | 每页两路 OCR（StepFun + DeepSeek），逐页写 `*.review.json`                       | 💰💰 |
| S3  | `3_merge.py`    | 两路比对 → 逐页 `*.merge.json`（字段规范化：答案/题型）                          | 💰   |
| S4  | `4_build_md.py` | 汇总成 `data/raw/<分类>/<分类>.md` + 报告；答案表/评分标准贴回、AI 终审、AI 解析 | 💰💰 |
| S5  | `5_check.py`    | 离线契约校验（**发布门禁**）                                                     | 0    |
| S6  | `6_publish.py`  | 生成题库 + 拼接进站点源码 + 类型检查/审计/构建                                   | 0    |
| S7  | `7_import.py`   | 把 S1–S6 串起来批量跑（本文主角）                                                | —    |

单卷调试时直接调某一步：

```bash
python pdf-ocr/1_render.py "试卷.pdf" --category my-paper --dpi 200
python pdf-ocr/4_build_md.py --category my-paper --force        # 只重做 md
python pdf-ocr/5_check.py --category my-paper                   # 看门禁结论
python pdf-ocr/6_publish.py --category my-paper --entry "某个入口" --entry-key some-entry --paper "试卷卡名" --position 3
```

---

## 4. 批量导入（`7_import.py`）全部参数

| 参数                         | 说明                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `--folder <目录>`            | **必填**，装着 PDF 的文件夹（不递归子目录）                                          |
| `--entry <名字>`             | 入口名，默认 = 文件夹名                                                              |
| `--entry-key <key>`          | 路由 key（`/<key>`）。中文入口名推不出 key，**必须显式给**                           |
| `--entry-icon <字>`          | 入口图标，1 个字（如 `马`）                                                          |
| `--entry-desc <文字>`        | 入口卡副标题，默认自动「N 份试卷 · M 题」                                            |
| `--paper-prefix <前缀>`      | 卡片标题前缀（默认空 = 就用文件名）                                                  |
| `--category-prefix <前缀>`   | 分类名前缀，默认 = `--entry-key`                                                     |
| `--dpi <数字>`               | S1 渲染分辨率，默认 200                                                              |
| `--only <子串>[,<子串>…]`    | **只跑文件名含这些子串的卷**（补跑单卷用）。分类名与卡片序号仍按全量计划算，不会错位 |
| `--from-step <1-6>`          | 从第几步开始（断点续跑）                                                             |
| `--only-step <1-6>`          | 只跑这一步                                                                           |
| `--force`                    | 让 S1 覆盖已有页图 / 让 S4 覆盖已有 md                                               |
| `--stop-on-error`            | 某份失败就停下（**默认是继续跑下一份**）                                             |
| `--no-build` / `--no-verify` | S6 跳过 `vite build` / 跳过 `vue-tsc` + 题库审计                                     |
| `--dry-run`                  | 只列计划，不执行                                                                     |
| `--quiet`                    | 只打印每份卷的完成行                                                                 |

### 典型用法

```bash
# 先看计划：每份 PDF 会得到哪个分类名、哪张卡片
python pdf-ocr/7_import.py --folder .\inbox --entry "英语四级" --entry-key english-cet4 --dry-run

# 只补跑第 5、7 卷（前面几步有产物会自动跳过）
python pdf-ocr/7_import.py --folder .\inbox --entry "马克思主义原理" --entry-key marxism --only 试卷5,试卷7

# 整条重做某两份（覆盖已有产物）
python pdf-ocr/7_import.py --folder .\inbox --entry "马克思主义原理" --entry-key marxism --only 试卷7 --force

# 从第 3 步开始（S1/S2 不用重跑）
python pdf-ocr/7_import.py --folder .\inbox --entry "马克思主义原理" --entry-key marxism --from-step 3
```

---

## 5. 退出码与"要不要管它"

| 码  | 含义                                                                     | 要不要管         |
| --- | ------------------------------------------------------------------------ | ---------------- |
| 0   | 全部成功（**含"仅放弃"**）                                               | 不用             |
| 2   | 有警告但按约定**算通过**（如"待复核 N 处"、"会被丢弃 < 1/5"）            | 看一眼报告即可   |
| 1   | 参数/环境错误（文件夹不存在、`--entry-key` 推不出来、`--only` 没匹配到） | 改参数重跑       |
| 3   | 真有试卷失败（S5 硬错误、构建/校验失败…）                                | 看失败那步的输出 |
| 4   | token 预算耗尽（`--ai-max-tokens` 太小）                                 | 加大预算重跑该卷 |

S7 结束时会给一行三桶汇总：

```
[完成] 批量导入：成功 6/7｜放弃（内容审核拦截）：marxism-4｜失败：marxism-5(码 3)｜总耗时 207.1s
```

- **放弃** = S2 连续重试仍被内容审核拦截（`HTTP 451 / censorship_blocked`），该卷数据不完整、不发布；这是既定决策，**不会让整批报错**（S7 返回 0）。
- **失败/放弃后默认自动继续**跑下一份，并打印"单独重跑这一份"的命令；要它停下来就加 `--stop-on-error`。

---

## 6. 省钱与续跑机制（重跑基本不花钱）

- S1/S2/S3 都是**有产物即跳过**（页图/逐页 JSON 在就复用）；
- S4 有**续跑预检**：`data/raw/<分类>/<分类>.md` 已存在 → S7 直接跳过 S1–S4，只补 S5/S6（要整条重做加 `--force`）；
- AI 结果有缓存：`paper-review.json`（全卷终审）、`explanations.json`（解析）。想强制重问加 `--refresh-review`（S4）；
- **"删掉之前的信息"要删对地方**：想重做提取就删 `pages/*.merge.json` + `data/raw/<分类>/*.md` + `report.md`/`transcription.md` + 两个 AI 缓存；**保留** `pages/*.png` 与 `pages/*.review.json`，这样不会重跑 OCR（最贵的一步）。

实测参考（8–9 页马原卷）：

| 卷        | S3                          | S4（终审 + 解析）       |
| --------- | --------------------------- | ----------------------- |
| marxism-5 | 8 次调用 / 70.8k tok / 216s | 16.4k + 7.4k tok / 78s  |
| marxism-7 | 9 次调用 / 65.6k tok / 173s | 19.2k + 10.4k tok / 91s |

40 页机考真题那次：S3 352k tok / 968s，S4 AI 终审 120–128k tok。

---

## 7. 质量门禁：S5 到底拦什么

`5_check.py` 用**解析端同一套口径**离线复算一遍 md，然后：

- **硬错误**（拒绝发布，退出码 3）：会被解析端丢弃的题 **> 总数的 1/5**、重复题号、题型非法…
- **警告**（放行，退出码 2）：丢弃 < 1/5、带"待复核"标记、题号缺口…

"会被解析端丢弃"就三种：题干为空、**既没有 ≥2 个选项、也没有答案文本**、答案不在选项里。所以一条铁律：

> **答案必须落在 md 里**：选择题落 `**正确答案：C 选项文本**`；判断题（无 A/B 选项）落 `**正确答案：正确**`（工具会自动补 `A. 正确 / B. 错误`）；主观题落评分标准正文。

`work/<分类>/report.md` 是排查入口，常见小节：答案来源、"主观题的评分标准（贴回 N 道 / 贴不出去 N 条）"、"字段不完整"、"待复核题目"、"OCR 两路冲突"、"大题说明（已丢掉）"、"答案表里有、题目里没有的题号"。

---

## 8. 发布与下架

```bash
# 发布（S7 的最后一步就是它；也可以单跑）
python pdf-ocr/6_publish.py --category marxism-7 --entry "马克思主义原理" --entry-key marxism --paper "马原试卷7" --position 7

# 下架一套卷（站点源码 + 题库 + 清单一起摘掉）
python pdf-ocr/6_publish.py --unpublish --category marxism-4

# 下架整个入口（它下面的试卷一起摘；入口空了连入口卡一起删）
python pdf-ocr/6_publish.py --unpublish --entry-key marxism

# 连原始材料一起删（data/raw/<分类> 与 pdf-ocr/work/<分类>，删了要重跑 OCR）
python pdf-ocr/6_publish.py --unpublish --category marxism-4 --purge
```

下架默认**保留**原始材料（`data/raw/`、`pdf-ocr/work/`）—— 花过 token 的东西，随时能重新发布。加 `--purge` 才真删。

发布/下架都会自己跑 `generate:meta` → `vue-tsc` → 题库审计 →（默认）`vite build`；本地 `npm run dev` 看到的是源码，改完刷新页面即可。

---

## 9. 常见问题

| 现象                         | 原因 / 处理                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 卡片不出现                   | S5 没过（看 `<分类>-check.json` 的 `hard_errors`）或 S6 没跑完（看 `entries.ts` / `categories.ts` 里有没有这个 key）                                    |
| 大量"缺答案"                 | 答案页没被识别（标题里没有"参考答案"时按内容判），或答案页格式是不印题号的裸字母块 —— 看 `report.md` 的"答案来源"与"贴不出去"两个小节                   |
| 判断题答案不显示             | 卷面答案是 `√`/`×`。工具会把 `√→正确`、`×→错误` 写成文本，并补 `A. 正确 / B. 错误` 两个选项                                                             |
| 答案出现在题干里             | 该整页应是答案页：`report.md` 会记 `answer_region_rejected`（导言/材料里出现答案块会被拒）                                                              |
| 侧栏出现好几个同名分组       | 老版本的自动分组每份卷新建一个组；现在按组名复用，历史数据可手工合并或重跑 S6                                                                           |
| 题号缺口 `18→21`             | 卷面本身就跳号，或 OCR 丢题；`report.md` 有"答案表里有、题目里没有的题号"表                                                                             |
| 某卷被内容审核拦（HTTP 451） | S2 会重试（默认 `--max-retries 3`）；仍不过就 `⊘ 放弃本卷`，数据不发布。想救：换模型 / 降 `--dpi` / 人工补该页的 `page-00N.{a,b}.review.json` 后重跑 S3 |
| `npm run dev` 说找不到文件   | 仓库根目录是 `dlut-nihongo-quiz/`（外层同名目录还有个空 `.git`，别在里面跑）                                                                            |

---

## 10. 测试（离线、不联网、0 token）

```bash
python pdf-ocr/tests/test_p2_parallel.py      # S2 并发与退避
python pdf-ocr/tests/test_s3_normalize.py     # answerKey / 题型规范化（含 √× 判断题）
python pdf-ocr/tests/test_s3_coverage.py      # 题号覆盖核对
python pdf-ocr/tests/test_p4_build.py         # md 渲染与格式契约
python pdf-ocr/tests/test_p4_answers.py       # 答案表 / 评分标准贴回
python pdf-ocr/tests/test_p4_ai_review.py     # S3 判重 + S4 AI 终审/判型
python pdf-ocr/tests/test_p6_publish.py       # 发布与下架（拼接点、分组、注册点）
python pdf-ocr/tests/test_p7_import.py        # 批量导入计划、退出码、--only、自动继续
```

改工具时按"改哪一步就跑哪个测试"；站点侧还有 `npm test`（vitest + `node --test`）。
