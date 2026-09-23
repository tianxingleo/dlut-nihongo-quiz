"""S3 字段约束的离线验收：`answerKey` / `questionType` 必须收敛到合法值（不联网、0 token）。

跑法：`python pdf-ocr/tests/test_s3_normalize.py`

背景：这两个字段以前是"模型给什么就存什么" —— 实测会出现 `other`（不是合法题型）、
全角 `Ａ`、`c,a`、`正确` 这类写法，直接进库会让站上判分与渲染都出错。
现在 S3 用确定性规则收敛，并把每次纠正记进 merge.json 的 `normalized[]`。
"""

import importlib.util
import pathlib
import sys

TOOL = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))

spec = importlib.util.spec_from_file_location("merge3", TOOL / "3_merge.py")
merge3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge3)

OPTS = [{"key": k, "text": t} for k, t in zip("ABCD", ["甲", "乙", "丙", "丁"])]
JUDGE = [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]


def norm(raw_key, raw_type, options, stem="题干内容足够长了吧"):
    record = []
    q = merge3.normalize_question(
        {"number": 1, "stem": stem, "answerKey": raw_key, "questionType": raw_type, "options": options},
        1,
        record,
    )
    return q, record


# ── 1) 各种"模型随口写法"都要收敛 ──────────────────────────────────────
CASES = [
    ("b", "单选", OPTS, "B", "single"),
    ("Ａ", "single choice", OPTS, "A", "single"),
    ("C、A", "多选题", OPTS, "AC", "multi"),
    ("c,a", "multiple", OPTS, "AC", "multi"),
    ("D 和 B", "multi", OPTS, "BD", "multi"),
    ("正确", "判断题", JUDGE, "A", "judgement"),
    ("√", "judgement", JUDGE, "A", "judgement"),
    ("×", "判断", JUDGE, "B", "judgement"),
    ("错", "", JUDGE, "B", "judgement"),
    ("B", "", OPTS, "B", "single"),
    ("", "简答题", [], "", "fill"),
    ("", "other", [], "", "fill"),
    ("", "填空", [], "", "fill"),
    ("", "", OPTS, "", "single"),
    ("E", "single", OPTS, "", "single"),
]
for raw_key, raw_type, options, want_key, want_type in CASES:
    q, _record = norm(raw_key, raw_type, options)
    assert q["answerKey"] == want_key, (raw_key, raw_type, q["answerKey"], want_key)
    assert q["questionType"] == want_type, (raw_key, raw_type, q["questionType"], want_type)
    assert q["questionType"] in merge3.QUIZ_TYPES, q["questionType"]
print(f"[1] {len(CASES)} 种写法的 answerKey / questionType 全部收敛到合法值")

# ── 2) 非法/无法识别的答案 → 清空 + 标 needs_review（不留假答案）────────
q, _ = norm("E", "single", OPTS)
assert q["answerKey"] == "" and q["needs_review"] is True, q
q, _ = norm("ABC", "single", OPTS)
assert q["answerKey"] == "ABC" and q["needs_review"] is True, q  # A-D 之外的组合要人看
print("[2] 认不出的答案 → 清空或保留但标 needs_review")

# ── 3) 多选自动补 answerText（md 的答案行要求"答案后面至少一个字符"）────
q, _ = norm("AC", "多选题", OPTS)
assert q["answerText"] == "甲、丙", q["answerText"]
print("[3] 多选自动拼 answerText：", q["answerText"])

# ── 4) 每次纠正都记进 normalized[]（S4 的 report.md 会汇总）────────────
_q, record = norm("c,a", "多选题", OPTS)
assert {r["field"] for r in record} == {"answerKey", "questionType"}, record
assert all({"number", "field", "before", "after"} <= set(r) for r in record), record
print("[4] 纠正记录字段齐全：", record)

# ── 5) QUIZ_TYPES 与前端 Question 类型的联合一致 ───────────────────────
QUESTION_TS = (TOOL.parent / "src" / "types" / "question.ts").read_text(encoding="utf-8")
line = next(x for x in QUESTION_TS.splitlines() if "questionType?:" in x)
for value in merge3.QUIZ_TYPES:
    assert f"'{value}'" in line, f"{value} 不在 src/types/question.ts 的联合类型里"
print("[5] QUIZ_TYPES 与 src/types/question.ts 的 questionType 联合类型一致")


# ── 6) 卷面大题标题 > 模型逐题声明 ─────────────────────────────────────
# 实测（Principles-of-Marxism）：第二大题写着「二、多项选择题」、每题 5 个选项，
# 模型却逐题给了 `single` / `other` —— 用户报"很多多选题的 questionType 不对"。
OPTS5 = [{"key": k, "text": t} for k, t in zip("ABCDE", ["甲", "乙", "丙", "丁", "戊"])]
SECTION_CASES = [
    # (题组名, 模型给的题型, 选项, 答案, 期望题型)
    ("题组二 二、多项选择题", "single", OPTS5, "", "multi"),
    ("二、多项选择题", "other", OPTS5, "AC", "multi"),
    ("题组一 一、单项选择题", "single", OPTS, "B", "single"),
    ("三、判断题", "", JUDGE, "A", "judgement"),
    ("四、填空题", "", [], "", "fill"),
    ("五、案例分析题", "other", [], "", "fill"),
    ("六、论述题", "", [], "", "fill"),
    # 题组名认不出题型 → 退回模型声明
    ("题组七", "judgement", JUDGE, "B", "judgement"),
]
for section, raw_type, options, raw_key, want in SECTION_CASES:
    record: list = []
    q = merge3.normalize_question(
        {
            "number": 1,
            "group": section,
            "groupTitle": section,
            "stem": "题干内容足够长了吧",
            "answerKey": raw_key,
            "questionType": raw_type,
            "options": options,
        },
        1,
        record,
    )
    assert q["questionType"] == want, (section, raw_type, q["questionType"], want)
    assert q["questionType"] in merge3.QUIZ_TYPES, q["questionType"]
print(f"[6] {len(SECTION_CASES)} 种「大题标题 + 模型声明」组合的题型判定正确")

# 题干里的"多项选择"不能反过来影响别的题：分区关键词只认题组名
assert merge3.question_type_from_section("一、单项选择题") == "single"
assert merge3.question_type_from_section("二、多项选择题") == "multi"
assert merge3.question_type_from_section("七、名词解释") == "fill"
assert merge3.question_type_from_section("随便一个题组名") == ""
print("[7] question_type_from_section 的关键词映射正确（认不出返回空串）")


# ── 8) 参考答案页：每行题干都是同一句占位符，但答案不同 → 不能当重复删掉 ──
# 实测（Principles-of-Marxism page 7）：模型把每一行的题干都写成
# "（本页未印题干，仅有答案）"，旧版页内判重把它当"同题干重复"，23 条答案删到只剩 1 条。
def _answer_row(number: int, key: str) -> dict:
    return {
        "number": number,
        "group": "一、单项选择题",
        "groupTitle": "一、单项选择题",
        "stem": "（本页未印题干，仅有答案）",
        "options": [],
        "answerKey": key,
        "questionType": "",
        "confidence": "high",
        "needs_review": False,
        "continued": False,
    }


rows = [merge3.normalize_question(_answer_row(n, k), 7) for n, k in [(1, "D"), (2, "D"), (4, "B"), (5, "C")]]
kept_rows, removed_rows = merge3.dedupe_questions(rows)
assert len(kept_rows) == 4, [q.get("answerKey") for q in kept_rows]
assert removed_rows == [], removed_rows
# 但**真题**的判重不能被削弱：题干+选项都一样的两条仍然要删掉一条
def _real(number: int) -> dict:
    return {
        "number": number,
        "group": "一、单项选择题",
        "groupTitle": "一、单项选择题",
        "stem": "这是一道真真正正的单选题题干",
        "options": [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
        "answerKey": "A",
        "questionType": "single",
        "confidence": "high",
        "needs_review": False,
        "continued": False,
    }


kept_same, removed_same = merge3.dedupe_questions(
    [merge3.normalize_question(_real(7), 1), merge3.normalize_question(_real(7), 1)]
)
assert len(kept_same) == 1 and len(removed_same) == 1, (kept_same, removed_same)
# **题号不同**、题干相同的两条必须都留（疑似卷面重号 / OCR 重编号，删了会丢真题）
kept_diff, removed_diff = merge3.dedupe_questions(
    [merge3.normalize_question(_real(7), 1), merge3.normalize_question(_real(8), 1)]
)
assert len(kept_diff) == 2 and removed_diff == [], (kept_diff, removed_diff)
print("[8] 答案行占位题干不参与判重；真题判重只在**题号相同**时生效")

# ── 9) 判断题的 √/×：**没有"正确/错误"选项时也不能清空**，改成写进答案文本 ──
# 实测（marxism-7）：卷面辨析题是「……（ ）」、答案页给一串 `×××√×`，没有 A/B 选项；
# 旧版把 `×`/`√` 当非法值清空 → 第 14–18 题变成"没选项没答案" → S5 按"会被解析端丢弃"
# 计数，9/34 = 26.5% > 1/5 直接拒发。
q, record = norm("×", "判断题", [])
assert q["answerKey"] == "" and q["answerText"] == "错误", q
# 记录里必须是"转成答案文本"，不能是"（已清空）" —— 清空就是这次要修的病
assert any("转成答案文本" in str(r["after"]) for r in record), record
assert not any("已清空" in str(r["after"]) for r in record), record
q, record = norm("√", "判断题", [])
assert q["answerText"] == "正确", q
# 有「正确/错误」选项时，仍然映射成字母（选项是权威；answerText 由 S4 按选项补）
q, _ = norm("×", "判断题", JUDGE)
assert q["answerKey"] == "B" and q["answerText"] == "", q
# 真正认不出的（不是判断题答案）还是清空 + 待复核，不能因为这条放宽就留假答案
q, _ = norm("？？", "判断题", [])
assert q["answerKey"] == "" and q["answerText"] == "" and q["needs_review"] is True, q
print("[9] √/×/正确/错误 没选项时转成答案文本（不再清空）；真的认不出才清空")

print("\n全部通过：9 组断言")
