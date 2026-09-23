# pdf-ocr：PDF 试卷 → 站点题库

把一堆 PDF 试卷变成站点上能刷的题库卡。**用法看 [`../docs/pdf-ocr-import-guide.md`](../docs/pdf-ocr-import-guide.md)**；
每步的 JSON 契约与踩坑记录看 [`../docs/pdf-ocr-pipeline.md`](../docs/pdf-ocr-pipeline.md)。

```bash
python pdf-ocr/7_import.py --folder "C:\path\to\试卷" --entry "入口名" --entry-key entry-key --dry-run   # 先看计划
python pdf-ocr/7_import.py --folder "C:\path\to\试卷" --entry "入口名" --entry-key entry-key            # 正式跑
```

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

测试（离线、不联网、0 token）：

```bash
python pdf-ocr/tests/test_p2_parallel.py     # 也可以逐个跑
python pdf-ocr/tests/test_s3_normalize.py
python pdf-ocr/tests/test_s3_coverage.py
python pdf-ocr/tests/test_p4_build.py
python pdf-ocr/tests/test_p4_answers.py
python pdf-ocr/tests/test_p4_ai_review.py
python pdf-ocr/tests/test_p6_publish.py
python pdf-ocr/tests/test_p7_import.py
```
