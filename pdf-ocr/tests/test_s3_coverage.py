"""S3 缺号护栏 + 题数匹配的离线验收。

跑法：`python pdf-ocr/tests/test_s3_coverage.py`（不联网；除第 6 组用桩外，其余纯本地）。

覆盖：
  * 真实数据（LL11512 page 4：两路声明 34-41，实际只提出 36-41）必须报「缺 2 题（34-35）」
  * 一致不报 / 多出未声明题号 / 同页重复题号 / 缺声明不误报 / 范围写法兼容
  * 端到端：桩掉 post_json，模型少答题时落盘的 merge.json 必须带 question_coverage 冲突
  * S4 与 S5 的「题组标题声明共 N 题 vs 实际题数」核对
"""

import importlib.util
import json
import sys
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))

import _common as c  # noqa: E402


def load(name):
    spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


merge3 = load("3_merge")
build = load("4_build_md")
check = load("5_check")

PAGES = c.WORK_ROOT / "computer-2026-midterm" / "pages"


def real_reviews():
    """真实页数据（LL11512 那份期中卷，后改名为 computer-2026-midterm）。

    这个目录是本地跑出来的中间产物（`pdf-ocr/work/` 已 gitignore），换机器/换卷子就没有 ——
    所以第 1 组断言在拿不到真实数据时**跳过**，其余纯合成用例照跑。
    """
    for label in ("a", "b"):
        if not (PAGES / f"page-004.{label}.review.json").exists():
            return None
    return {label: c.read_json(PAGES / f"page-004.{label}.review.json") for label in ("a", "b")}


# ── 1) 真实数据：page 4 的两路声明是 34-41 ───────────────────────────────
# 注意 baseline 会随 S3 重跑变化（改进提示词后 34/35 已经能抽出来），所以这里不写死"当前少了 2 题"，
# 而是拿真实声明 + 人为去掉 34/35 来断言，既不脆又贴合真实数据。
reviews = real_reviews()
if reviews is None:
    print(f"[1] 跳过：没有真实页数据（{PAGES.relative_to(c.REPO_ROOT)}）")
else:
    real = c.read_json(PAGES / "page-004.merge.json")
    declared = merge3.normalize_range(reviews["a"].get("question_ranges"))
    assert declared == set(range(34, 42)), declared
    assert merge3.coverage_diffs(reviews, real["questions"]) == [], "完整提取时不该报缺口"

    incomplete = [q for q in real["questions"] if q["number"] not in (34, 35)]
    diffs = merge3.coverage_diffs(reviews, incomplete)
    assert len(diffs) == 1, diffs
    reason = diffs[0]["reason"]
    assert "题数不匹配" in reason and "缺 2 题（34-35）" in reason, reason
    assert diffs[0]["a"].startswith("OCR 声明本页 8 题：34-41"), diffs[0]["a"]
    assert diffs[0]["b"].startswith("实际提出 6 题：36-41"), diffs[0]["b"]
    print("[1] 真实声明抓到缺号：", reason[:56], "…")
    reviews = {label: reviews[label] for label in ("a", "b")}
if reviews is None:
    # 拿不到真实数据时，后面几组用等价的合成声明（范围与真实一致）
    reviews = {"a": {"question_ranges": ["34-41"]}, "b": {"question_ranges": ["34-41"]}}

# ── 2) 声明与实际一致 → 不报 ────────────────────────────────────────────
full = [{"number": n} for n in range(34, 42)]
assert merge3.coverage_diffs(reviews, full) == []
# ── 3) 多出未声明的题号 / 同页重复题号 ─────────────────────────────────
extra = merge3.coverage_diffs(reviews, full + [{"number": 99}])
assert len(extra) == 1 and "多出未声明的题号（99）" in extra[0]["reason"], extra
dup = merge3.coverage_diffs(reviews, full + [{"number": 34}])
assert len(dup) == 1 and dup[0]["field"] == "question_number_duplicate", dup
# ── 4) 两路都没声明范围 → 不误报 ───────────────────────────────────────
assert merge3.coverage_diffs({"a": {}, "b": {}}, [{"number": 1}]) == []
# ── 5) 范围写法兼容（单号 / 逗号 / 全角顿号）───────────────────────────
assert (
    merge3.coverage_diffs({"a": {"question_ranges": ["3,5", "7-8"]}}, [{"number": n} for n in (3, 5, 7, 8)]) == []
)
print("[2-5] 一致不报 / 多出 / 重复 / 缺声明不误报 / 范围写法兼容 全通过")

# ── 6) 端到端：桩掉 post_json，模型只回 1 题（两路声明 8 题）──────────────
calls = []


def fake_post_json(url, payload, api_key, timeout=180):
    calls.append(url)
    return {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "paper_identity": {"title": "t", "date": "", "variant": ""},
                            "page_condition": "clear",
                            "conflicts": [],
                            "questions": [
                                {
                                    "number": 36,
                                    "group": "六、题组二",
                                    "groupTitle": "题组二",
                                    "stem": "只有一题",
                                    "options": [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
                                    "answerKey": "A",
                                    "answerText": "甲",
                                    "explanation": "",
                                    "translation": "",
                                    "confidence": "high",
                                    "needs_review": False,
                                    "continued": False,
                                }
                            ],
                            "notes": [],
                        },
                        ensure_ascii=False,
                    )
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


c.post_json = fake_post_json
cfg = {"model": "deepseek-flash", "base_url": "https://example.invalid", "api_key": "x"}
merged = merge3.merge_one_page(cfg, 4, reviews, index=1, total=1, timeout=5, max_retries=1, max_tokens=1000)
fields = [cf["field"] for cf in merged["conflicts"]]
assert "question_coverage" in fields, fields
assert merged["needs_review"] is True, merged["needs_review"]
assert any("题号覆盖核对" in n for n in merged["notes"]), merged["notes"]
assert len(calls) == 1, calls
print("[6] 端到端：1 次调用即落盘，conflicts 里有 question_coverage，needs_review=true")

# ── 7) S4 的题组题数核对：标题说「共 9 题」但只放 2 题 → 进 report ─────────
entries = [
    {
        "page": 1,
        "index": n,
        "q": {"number": n, "groupTitle": "测试（共 9 题）", "stem": "x"},
        "numeral": "一",
        "group_title": "测试（共 9 题）",
    }
    for n in (1, 2)
]
report = {"count_mismatch": [], "long_group_titles": [], "groups": [("一", "测试（共 9 题）")]}
build.check_group_counts(entries, report)
assert report["count_mismatch"] == [("一", 9, 2, "测试（共 9 题）")], report
assert report["long_group_titles"] == [], report
report2 = {"count_mismatch": [], "long_group_titles": [], "groups": [("一", "长" * 50)]}
build.check_group_counts([dict(e, q=dict(e["q"])) for e in entries], report2)
assert report2["long_group_titles"] and report2["long_group_titles"][0][1] == 50, report2
print("[7] S4 题组题数核对：声明 9 实际 2 记入报告；超长标题也记一笔")

# ── 8) S5 从 md 自己核对题组题数 ────────────────────────────────────────
md_bad = (
    "## 题组一：测试（共 9 题）\n\n### 第1题\n\n#### 题目\n\n甲\n\nA. 1\nB. 2\n\n"
    "#### 答案与解析\n\n**正确答案：A 1**\n\n### 第2题\n\n#### 题目\n\n乙\n\nA. 1\nB. 2\n\n"
    "#### 答案与解析\n\n**正确答案：B 2**\n"
)
actual, declared = check.group_count_check(md_bad)
assert declared == {"一": 9} and actual == {"一": 2}, (actual, declared)
actual, declared = check.group_count_check(md_bad.replace("共 9 题", "共 2 题"))
assert declared == {"一": 2} and actual == {"一": 2}, (actual, declared)
print("[8] S5 题组题数核对：声明 9 实际 2 能识别，声明 2 实际 2 不误报")

print("\n全部通过：8 组断言")
