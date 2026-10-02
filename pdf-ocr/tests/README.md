# pdf-ocr 测试

离线、不联网、**0 token**：断言全部跑在构造的假 `merge.json` / 沙箱目录上，**不碰真的 `data/raw`**。

```bash
python pdf-ocr/tests/run_all.py            # 全跑一遍（推荐）
python pdf-ocr/tests/run_all.py --quiet     # 只打印每行结果
python pdf-ocr/tests/test_answer_matching.py   # 单个文件也可以直接跑
```

文件名按**它测的行为**命名；括号里是对应的流水线阶段（S1–S6 只是脚本编号，不是命名依据）。

| 文件                             | 测什么                                                                                                             | 阶段    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------- |
| `test_ocr_concurrency.py`        | 两路 OCR 的并发/退避、预算护栏（跑满 `--max-tokens` 就停）                                                         | S2      |
| `test_image_input.py`            | 输入识别（PDF/图片/文件夹，按文件头）、自然序页序、S1 把原图**复制**进工作目录（源文件夹删掉也能跑）、`--max-side` | S1      |
| `test_question_normalization.py` | `answerKey`（含 `√`/`×` 判断题）与 `questionType` 规范化、答案行不参与判重                                         | S3      |
| `test_question_coverage.py`      | 题号覆盖核对：答案表里有、题目里没有 → 报警；少题护栏                                                              | S3      |
| `test_markdown_build.py`         | md 渲染与格式契约：跨页拼接、题组、字段完整性                                                                      | S4      |
| `test_answer_matching.py`        | 答案表 / 评分标准贴回题目（含不印题号的答案页、`√`/`×`、材料题）                                                   | S4      |
| `test_dedupe_and_ai_review.py`   | 页内判重 + 全卷 AI 终审、判型、AI 答案护栏                                                                         | S3 + S4 |
| `test_ai_answer_solving.py`      | 卷面没答案时的 AI 两路解题：只解客观题、两路一致/分歧、原文→字母对位、答案来源标记、缓存、S5 的 AI 答案门禁         | S4 + S5 |
| `test_publish.py`                | 发布与下架：7 处注册点、课程树分组、叶子标题刷新                                                                   | S6      |
| `test_batch_import.py`           | 批量导入计划、图片分组（`--images one/each`）、退出码三桶、失败/放弃后自动继续                                     | S7      |

## 不是测试的两个文件

| 文件                     | 用途                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `run_all.py`             | 测试运行器（见上）                                                                                                                    |
| `prepare_real_parser.py` | **辅助工具**：复制一份 `scripts/parse-japanese-2024-markdown.ts`、只替换两行路径，生成打补丁的 TS 解析器，用来拿**真实解析端**验收 md |

```bash
# 用真实解析器验收某份 md（产物落在 pdf-ocr/work/.tmp/，已 gitignore）
python pdf-ocr/tests/prepare_real_parser.py --category marxism-7
npx tsx pdf-ocr/work/.tmp/realparse.ts
```

## 加新测试

1. 文件叫 `test_<行为>.py`（例：`test_ai_explanations.py`），别用阶段号；
2. 顶部写清「跑法 + 覆盖了什么」，断言失败时把上下文一起 assert 出去（`assert x == y, (x, y)`）；
3. 需要文件系统就开 `tempfile.mkdtemp()` 沙箱并用 `try/finally` 清理；
4. 需要跑主流程时，把 `c.WORK_ROOT` / `c.RAW_ROOT` 指到沙箱（参照 `test_markdown_build.py`），**绝不写真的 `data/raw`**；
5. 跑 `python pdf-ocr/tests/run_all.py` 确认没把别的测试带崩。
