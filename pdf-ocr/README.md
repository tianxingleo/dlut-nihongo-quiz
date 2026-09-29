# pdf-ocr：PDF 试卷 → 站点题库

把一堆 PDF 试卷变成站点上能刷的题库卡。**用法看 [`../docs/pdf-ocr-import-guide.md`](../docs/pdf-ocr-import-guide.md)**。

```bash
python pdf-ocr/7_import.py --folder "C:\path\to\试卷" --entry "入口名" --entry-key entry-key --dry-run   # 先看计划
python pdf-ocr/7_import.py --folder "C:\path\to\试卷" --entry "入口名" --entry-key entry-key            # 正式跑
```

## 脚本

| 脚本            | 作用                                                                           |
| --------------- | ------------------------------------------------------------------------------ |
| `1_render.py`   | PDF → 每页 PNG（`work/<分类>/pages/`）                                         |
| `2_ocr.py`      | 每页**两路** OCR → `page-00N.{a,b}.review.json`                                |
| `3_merge.py`    | 两路比对 → `page-00N.merge.json`（答案/题型字段规范化）                        |
| `4_build_md.py` | 汇总成 `data/raw/<分类>/<分类>.md` + `report.md`（答案贴回、AI 终审、AI 解析） |
| `5_check.py`    | 离线契约校验 = **发布门禁**（与解析端同一套口径）                              |
| `6_publish.py`  | 生成题库 + 拼接进站点源码 + 类型检查/审计/构建；`--unpublish` 下架             |
| `7_import.py`   | 批量入口：一个文件夹 = 一个入口，逐份 PDF 串起 S1→S6                           |
| `_common.py`    | 共用工具：`.env` 解析、HTTP 重试、进度行、JSON 读写                            |

产物：**只有** `data/raw/<分类>/<分类>.md`、`data/processed/<分类>-*.json`、`public/<分类>-question-bank.json`
与站点源码的注册点入库；页图/逐页 JSON/AI 缓存都在 `work/`（已 gitignore）。

## 测试

离线、不联网、0 token。文件名按**它测的行为**命名（不再按开发阶段 S1–S7）：

```bash
python pdf-ocr/tests/run_all.py                        # 全跑一遍（推荐）
python pdf-ocr/tests/test_ocr_concurrency.py           # 也可以单个跑
```

| 文件                             | 覆盖                                                            |
| -------------------------------- | --------------------------------------------------------------- |
| `test_ocr_concurrency.py`        | 两路 OCR 的并发、退避与预算护栏                                 |
| `test_question_normalization.py` | `answerKey` / 题型规范化（含 `√`/`×` 判断题）、答案行不参与判重 |
| `test_question_coverage.py`      | 题号覆盖核对（丢题检测 + 少题护栏）                             |
| `test_markdown_build.py`         | md 渲染与格式契约（跨页拼接、题组、字段完整性）                 |
| `test_answer_matching.py`        | 答案表 / 评分标准贴回题目（含不印题号的答案页）                 |
| `test_dedupe_and_ai_review.py`   | 页内判重 + 全卷 AI 终审 / 判型 / 答案护栏                       |
| `test_publish.py`                | 发布与下架：课程树分组、7 处注册点                              |
| `test_batch_import.py`           | 批量导入计划、退出码三桶、`--only`、失败后自动继续              |

`prepare_real_parser.py` 不是测试，是**辅助工具**：生成一份打补丁的 TS 解析器副本，
用来拿真实解析端验收 md（用法见 [`tests/README.md`](tests/README.md)）。
