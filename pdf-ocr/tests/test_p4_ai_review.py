"""S3 页内判重 + S4 全卷 AI 终审的离线验收（不联网、0 token）。

跑法：`python pdf-ocr/tests/test_p4_ai_review.py`

覆盖：
  * S3 `dedupe_questions`：题干+选项完全相同 → 删掉后面的；占位符题干/选项不同 → **不误删**
  * S4 `apply_ai_review`：删重复 → **后面题号整体前移（顺延）** → 答案按新题号重新对位
  * 没删题时**不重编号**（不能把原卷本来就缺号/跳号的地方也改了）
  * `answer_table_snippets`：能从 OCR 转写里挑出 `1-5 DDDBC` 这类答案表
"""

import importlib.util
import json
import shutil
import sys
import tempfile
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


def q(number, stem, options=None, answer="A", numeral="一", title="单选题"):
    return {
        "page": 1,
        "index": number,
        "numeral": numeral,
        "group_title": title,
        "q": {
            "number": number,
            "stem": stem,
            "options": options if options is not None else [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
            "answerKey": answer,
            "answerText": "",
            "explanation": "",
        },
    }


# ── 1) S3 页内判重 ─────────────────────────────────────────────────────
STEM = "法国科学家巴斯德说机遇偏爱有准备的头脑意指什么"
same_a = {"number": 7, "stem": STEM, "options": [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}], "answerKey": "B"}
same_b = {"number": 8, "stem": STEM, "options": [{"key": "B", "text": "乙"}, {"key": "A", "text": "甲"}], "answerKey": "D"}
other = {"number": 9, "stem": STEM + "（另一道）", "options": [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}], "answerKey": "A"}
placeholder_a = {"number": 30, "stem": "(30) の選択肢：", "options": [], "answerKey": "A"}
placeholder_b = {"number": 31, "stem": "(31) の選択肢：", "options": [], "answerKey": "B"}

kept, removed = merge3.dedupe_questions([same_a, same_b, other, placeholder_a, placeholder_b])
# **题号不同、题干相同 → 两道都保留**（判为"疑似卷面重号 / OCR 重编号"）。删了会丢真题：
# 实测卷面把「7.」印了两遍，两路 OCR 把它读成 7、8，于是卷面真正的第 8 题被挤没了。
assert [x["number"] for x in kept] == [7, 8, 9, 30, 31], [x["number"] for x in kept]
assert removed == [], removed
# 题号**相同**、题干与选项也全同 → 这才是真重复，照删
dup_a = {"number": 7, "stem": STEM, "options": [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}], "answerKey": "B"}
dup_b = {"number": 7, "stem": STEM, "options": [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}], "answerKey": "B"}
kept_dup, removed_dup = merge3.dedupe_questions([dup_a, dup_b])
assert [x["number"] for x in kept_dup] == [7] and len(removed_dup) == 1, (kept_dup, removed_dup)
print("[1] S3 判重：题号不同→两道都留（防丢题）；题号相同+题干选项全同→删重复")

# 同题干、不同选项（匹配题的各小问）→ 都留
long_stem = "以下は MIPS コードの空欄について答えよ"
m1 = {"number": 10, "stem": long_stem, "options": [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}], "answerKey": "A"}
m2 = {"number": 11, "stem": long_stem, "options": [{"key": "A", "text": "丙"}, {"key": "B", "text": "丁"}], "answerKey": "B"}
kept_m, removed_m = merge3.dedupe_questions([m1, m2])
assert [x["number"] for x in kept_m] == [10, 11] and not removed_m, [x["number"] for x in kept_m]
print("[1b] S3 判重：同题干但选项不同 → 两道不同的题，都保留")

# 信息更全的那份胜出（**题号必须相同**才算同一道题的重复副本）
thin = {"number": 1, "stem": STEM, "options": [], "answerKey": ""}
fat = {"number": 1, "stem": STEM, "options": [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}], "answerKey": "A"}
kept2, removed2 = merge3.dedupe_questions([thin, fat])
assert [x["number"] for x in kept2] == [1], [x["number"] for x in kept2]
print("[2] S3 判重：信息更全的那份胜出（保留第 2 题）")

# ── 2) S4 全卷终审：删 → 顺延 → 答案对位 ────────────────────────────────
entries = [q(n, f"第{n}题的题干内容足够长了吧", answer=old) for n, old in zip(range(1, 6), "DDBDD")]
entries[3]["q"]["stem"] = entries[2]["q"]["stem"]  # 第 4 题与第 3 题题干相同
entries[3]["q"]["options"] = entries[2]["q"]["options"]
report = {
    "ai_duplicates": [],
    "ai_answers": [],
    "ai_answer_conflicts": [],
    "ai_answer_ignored": [],
    "ai_review_skipped": [],
}
review = {
    "duplicates": [{"number": 4, "keepNumber": 3, "reason": "与第 3 题完全相同"}],
    "answers": [
        {"number": 3, "answerKey": "B", "reason": "答案表位置 3 是 B"},
        {"number": 4, "answerKey": "B", "reason": "顺延后原来的第 5 题"},
    ],
}
result = build.apply_ai_review(entries, review, report)
assert [e["q"]["number"] for e in result] == [1, 2, 3, 4], [e["q"]["number"] for e in result]
assert len(result) == 4, len(result)
by_number = {e["q"]["number"]: e["q"] for e in result}
assert by_number[3]["answerKey"] == "B", by_number[3]["answerKey"]
assert report["ai_duplicates"] == [(4, 3, "与第 3 题完全相同")], report["ai_duplicates"]
# **已有答案的题不会被 AI 覆盖**：实测 AI 把「单项选择 第4题=B」贴到了「多项选择 第4题」上，
# 把卷面答案表给的 ABC 改成了 B。现在只记冲突、不改答案。
assert by_number[4]["answerKey"] == "D", by_number[4]["answerKey"]
assert report["ai_answers"] == [], report["ai_answers"]
assert report["ai_answer_conflicts"] == [(1, 4, "D", "B")], report["ai_answer_conflicts"]
print("[3] S4 终审：删掉第 4 题 → 题号顺延为 1..4；AI 只能补空缺、不能覆盖已有答案")

# AI 给"卷面没答案"的题补答案 —— 这是它该干的事
gap = [q(1, "第一题题干够长了吧", answer="")]
report_gap = {
    "ai_duplicates": [],
    "ai_answers": [],
    "ai_answer_conflicts": [],
    "ai_answer_ignored": [],
    "ai_review_skipped": [],
}
build.apply_ai_review(gap, {"duplicates": [], "answers": [{"number": 1, "answerKey": "B", "reason": "卷面没印"}]}, report_gap)
assert gap[0]["q"]["answerKey"] == "B" and gap[0]["q"]["answerText"] == "乙", gap[0]["q"]
assert report_gap["ai_answers"][0][:4] == (1, "（无）", "B", "乙"), report_gap["ai_answers"]
print("[3b] S4 终审：卷面没给答案的题，由 AI 补上（answerText 跟着重算）")

# ── 3) 没删题时**不重编号**（原卷本来就跳号的地方不能被动）────────────────
entries2 = [q(1, "第一题题干够长了吧"), q(5, "第五题题干够长了吧")]
report2 = {
    "ai_duplicates": [],
    "ai_answers": [],
    "ai_answer_conflicts": [],
    "ai_answer_ignored": [],
    "ai_review_skipped": [],
}
result2 = build.apply_ai_review(entries2, {"duplicates": [], "answers": []}, report2)
assert [e["q"]["number"] for e in result2] == [1, 5], [e["q"]["number"] for e in result2]
print("[4] S4 终审：没有删题时不动题号（1,5 保持 1,5）")

# ── 4) 答案表片段提取 ──────────────────────────────────────────────────
sandbox = Path(tempfile.mkdtemp(prefix="p4ai-"))
try:
    pages_dir = sandbox / "pages"
    pages_dir.mkdir(parents=True)
    (pages_dir / "page-001.a.review.json").write_text(
        json.dumps(
            {
                "page": 1,
                "transcription_md": "一、单向选择题（每题1分，共15分）\n1-5 DDDBC\n6-10 ABDDB\n11-15 ABCAC\n",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    snippets = build.answer_table_snippets(pages_dir, [1])
    assert snippets and "1-5 DDDBC" in snippets[0], snippets
    print("[5] 答案表片段：", snippets[0].replace("\n", " / "))
finally:
    shutil.rmtree(sandbox, ignore_errors=True)


# ── 5) AI 判型：答案表不标"哪道是多选"，每道题又都挂着好几个选项 ────────
def ai_entry(number, group, quiz_type, answer, page=1):
    return {
        "page": page,
        "index": number,
        "numeral": "一",
        "group_title": group,
        "q": {
            "number": number,
            "group": group,
            "groupTitle": group,
            "stem": f"第{number}题的题干内容足够长",
            "options": [{"key": k, "text": t} for k, t in zip("ABCDE", "甲乙丙丁戊")],
            "answerKey": answer,
            "answerText": "",
            "explanation": "",
            "questionType": quiz_type,
        },
    }


report_t = {
    key: []
    for key in (
        "ai_types",
        "type_from_ai",
        "ai_type_conflicts",
        "ai_answer_conflicts",
        "answers_from_ai",
        "multi_answer_suspect",
        "incomplete",
        "ai_duplicates",
        "ai_answers",
        "ai_review_skipped",
    )
}
entries_t = [
    ai_entry(1, "一、单项选择题", "single", "B"),   # 卷面标题写「单项选择」→ AI 说多选也不听它的
    ai_entry(2, "第2组", "single", "AC"),           # 标题认不出题型 → 采用 AI 判定
    ai_entry(3, "二、多项选择题", "multi", "C"),     # 多选却只抄到一个字母 → 报警
    ai_entry(4, "二、多项选择题", "multi", ""),      # 卷面没给答案 → 用 AI 的
]
review_t = {
    "questionTypes": [
        {"number": 1, "group": "一、单项选择题", "questionType": "multi", "answerKey": "AB", "reason": "看起来像多选"},
        {"number": 2, "group": "第2组", "questionType": "multi", "answerKey": "AC", "reason": "选项互不排斥"},
        {"number": 3, "group": "二、多项选择题", "questionType": "multi", "answerKey": "CE", "reason": "C、E 都对"},
        {"number": 4, "group": "二、多项选择题", "questionType": "multi", "answerKey": "AB", "reason": "A、B 都对"},
    ]
}
build.apply_ai_types(entries_t, review_t, report_t)
assert entries_t[0]["q"]["questionType"] == "single", entries_t[0]["q"]["questionType"]
assert entries_t[1]["q"]["questionType"] == "multi", entries_t[1]["q"]["questionType"]
assert report_t["type_from_ai"] == [(1, 2, "single", "multi", "选项互不排斥")], report_t["type_from_ai"]
assert len(report_t["ai_type_conflicts"]) == 1, report_t["ai_type_conflicts"]
assert report_t["ai_type_conflicts"][0][2:6] == ("single", "multi", "single", "看起来像多选"), report_t[
    "ai_type_conflicts"
]
# 多选却只有一个字母：**不偷偷改答案**，但标 needs_review + 报告
assert entries_t[2]["q"]["answerKey"] == "C" and entries_t[2]["q"]["needs_review"] is True, entries_t[2]["q"]
assert report_t["multi_answer_suspect"] == [(1, 3, "C", "CE")], report_t["multi_answer_suspect"]
# 卷面没答案时，AI 给的答案才采用（并重算 answerText）
assert entries_t[3]["q"]["answerKey"] == "AB", entries_t[3]["q"]["answerKey"]
assert entries_t[3]["q"]["answerText"] == "甲、乙", entries_t[3]["q"]["answerText"]
assert report_t["answers_from_ai"] == [(1, 4, "AB")], report_t["answers_from_ai"]
assert len(report_t["ai_types"]) == 4, report_t["ai_types"]
print("[6] AI 判型：卷面大题标题优先 / 标题认不出才听 AI / 多选只抄到一个字母要报警")

# ── 7) 主观题（没有选项）不能被 AI 塞字母答案 ──────────────────────────────
# 实测 marxism-5：案例分析题没有选项、答案是评分标准，AI 却按"答案项数"塞了 `CD`/`CDE`，
# md 里就成了 `**正确答案：CD 想问题做事情要一切从实际出发…**`（半截假答案）。
subjective = {
    "page": 5,
    "index": 9,
    "numeral": "一",
    "group_title": "三、案例分析题",
    "q": {
        "number": 9,
        "group": "三、案例分析题",
        "groupTitle": "案例分析题",
        "stem": "阅读材料并回答问题（答案就是评分标准）",
        "options": [],
        "answerKey": "",
        "answerText": "弄虚作假，违背农作物的生长规律。3分",
        "explanation": "",
        "questionType": "fill",
    },
}
report_u = {
    key: []
    for key in (
        "ai_types",
        "type_from_ai",
        "ai_type_conflicts",
        "ai_answer_conflicts",
        "answers_from_ai",
        "multi_answer_suspect",
        "ai_answer_ignored",
    )
}
build.apply_ai_types(
    [subjective],
    {
        "questionTypes": [
            {"index": 9, "number": 9, "group": "三、案例分析题", "questionType": "fill",
             "answerKey": "CD", "reason": "答案两项，与多项选择第2题一致"},
        ]
    },
    report_u,
)
assert subjective["q"]["answerKey"] == "", subjective["q"]
assert report_u["answers_from_ai"] == [], report_u
assert report_u["ai_answer_ignored"] == [(5, 9, "CD", 0)], report_u
print("[7] AI 判型：主观题（0 选项）不被塞字母答案，记进 ai_answer_ignored")

print("\n全部通过：9 组断言")

