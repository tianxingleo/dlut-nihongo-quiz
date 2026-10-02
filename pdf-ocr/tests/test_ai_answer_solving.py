"""S4「卷面没有答案 → AI 两路解题」（`--answers ai/auto`）的离线验收（不联网、0 token）。

跑法：`python pdf-ocr/tests/test_ai_answer_solving.py`

覆盖：
  * `solve_targets`：只挑"卷面无答案 + ≥2 个选项"的客观题；**主观题一律不碰**
    （给它塞字母答案，站上就是假答案）
  * 两路一致 → 落 `answerProvenance='generated'` + `needs_review` + 非空依据，md 里带
    「答案由 AI 推得」标记，且 **S5 的解析预演能收下这道题**
  * 两路不一致 → **采用 A 路但标 low 并进报告**（不静默、不丢题）
  * B 路把选项顺序打乱、**只给选项原文不给字母**（否则等于没交叉校验），且打乱是确定性的
  * A 路给的答案不在本题选项里 → 拒绝落盘
  * 缓存 `ai-answers.json`：第二次跑**不再调模型**
  * `resolve_answers_mode`：`auto` 按"卷面答案覆盖率"在 paper / ai 之间选
  * S5 发布门禁：AI 推得的答案 > 1/2 → 硬错误（要 `--allow-ai-answers` 才放行）
"""

import argparse
import importlib.util
import json
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


build = load("4_build_md")
check = load("5_check")

OPTIONS = [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}, {"key": "C", "text": "丙"}]
CFG = {"api_key": "test-key", "base_url": "http://example.invalid", "model": "deepseek-flash"}


def make_q(number, options=None, answer="", answer_text="", stem=None, **over):
    q = {
        "number": number,
        "stem": stem or f"第{number}题：下列说法正确的是（题干足够长，不是占位符）",
        "options": OPTIONS if options is None else options,
        "answerKey": answer,
        "answerText": answer_text,
        "explanation": "",
        "group": "一、单项选择题",
        "groupTitle": "",
    }
    q.update(over)
    return {"page": 1, "index": number, "numeral": "一", "q": q}


def new_report():
    report = {
        key: []
        for key in (
            "ai_solve_applied",
            "ai_solve_disagreed",
            "ai_solve_rejected",
            "ai_solve_skipped",
            "ai_solve_cached",
        )
    }
    report["ai_solve_calls"] = 0
    report["ai_usage"] = 0
    return report


def solve_args(passes=2, refresh=False):
    return argparse.Namespace(
        answers="ai", solve_passes=passes, refresh_answers=refresh, ai_max_tokens=4096, ai_timeout=30
    )


class FakeApi:
    """假端点：按请求里出现的是 `answerKey` 还是 `answerText` 判 A/B 路，回预先编好的答案。"""

    def __init__(self, answers_a, answers_b=None):
        self.answers_a = answers_a
        self.answers_b = answers_b
        self.calls = 0
        self.payloads = []

    def __call__(self, url, payload, api_key, timeout=120):
        self.calls += 1
        user = payload["messages"][1]["content"]
        self.payloads.append(user)
        items = self.answers_b if "answerText" in user else self.answers_a
        body = json.dumps({"answers": items or []}, ensure_ascii=False)
        return {
            "choices": [{"message": {"content": body}, "finish_reason": "stop"}],
            "usage": {"total_tokens": 7},
        }


def run_solver(entries, api, report, args, work):
    original = c.post_json
    c.post_json = api
    try:
        build.ai_solve_answers(entries, work, CFG, args, report)
    finally:
        c.post_json = original


# ── 1) 只解客观题：主观题 / 已有答案的题都不碰 ────────────────────────────
report = new_report()
subjective = make_q(2, options=[], answer_text="评分标准：答出要点即得分")
already = make_q(3, answer="A")
targets = build.solve_targets([subjective, already], report)
assert targets == [], targets
assert len(report["ai_solve_skipped"]) == 1, report["ai_solve_skipped"]
assert "没有选项" in report["ai_solve_skipped"][0][2]
print("[1] 只挑客观题：主观题（无选项）与已有答案的题都不解")

# ── 2) 两路一致 → 落 generated + 待复核 + 依据；md 带标记；S5 能收下 ──────
entry = make_q(1)
report = new_report()
api = FakeApi(
    [{"index": 1, "answerKey": "B", "confidence": "high", "rationale": "乙是唯一正确的说法"}],
    [{"index": 1, "answerText": "乙", "confidence": "high", "rationale": "同上"}],
)
with tempfile.TemporaryDirectory() as tmp:
    run_solver([entry], api, report, solve_args(), Path(tmp))
q = entry["q"]
assert api.calls == 2, api.calls
assert q["answerKey"] == "B", q["answerKey"]
assert q["answerText"] == "乙", q["answerText"]
assert build.is_ai_answer(q) and q["needs_review"] is True
assert q["explanation"], "解析端要求 generated 的题必须有非空 explanation"
assert q["explanationSource"] == "generated"
assert report["ai_solve_applied"] == [(1, 1, "B", "high", True)], report["ai_solve_applied"]
assert report["ai_solve_disagreed"] == [] and report["ai_solve_rejected"] == []

md = build.render_question(entry)
assert c.AI_ANSWER_NOTE in md, md
assert "**正确答案：B 乙**" in md, md
kept, drops = check.parse_like_parser("# 分类\n\n## 题组一：单项选择题\n\n" + md + "\n")
assert [item["number"] for item in kept] == [1] and not drops, (kept, drops)
assert kept[0]["answerKey"] == "B", kept[0]
print("[2] 两路一致 → generated + 待复核 + 依据；md 带「答案由 AI 推得」，S5 能收下")

# ── 3) B 路：选项顺序打乱、只给原文（不给字母）；打乱是确定性的 ────────────
payload_a = build.build_solve_payload("m", [(1, entry)], False, 1024)["messages"][1]["content"]
payload_b = build.build_solve_payload("m", [(1, entry)], True, 1024)["messages"][1]["content"]
assert "A. 甲" in payload_a and "answerKey" in payload_a
assert "A. 甲" not in payload_b and "answerText" in payload_b, payload_b
assert payload_b == build.build_solve_payload("m", [(1, entry)], True, 1024)["messages"][1]["content"]
four = [{"key": key, "text": text} for key, text in zip("ABCD", ["甲", "乙", "丙", "丁"])]
orders = {tuple(o["key"] for o in build.shuffle_options(four, index)) for index in range(1, 9)}
assert len(orders) > 1, orders
print("[3] B 路给打乱后的选项原文（不给字母），打乱按题号确定性生成")

# ── 4) 两路不一致 → 采用 A 路 + 标 low + 进报告（不静默） ─────────────────
entry = make_q(1)
report = new_report()
api = FakeApi(
    [{"index": 1, "answerKey": "B", "confidence": "high", "rationale": "选乙"}],
    [{"index": 1, "answerText": "丙", "confidence": "high", "rationale": "选丙"}],
)
with tempfile.TemporaryDirectory() as tmp:
    run_solver([entry], api, report, solve_args(), Path(tmp))
q = entry["q"]
assert q["answerKey"] == "B", q["answerKey"]
assert "不一致" in q["explanation"], q["explanation"]
assert report["ai_solve_disagreed"][0][2] == "B", report["ai_solve_disagreed"]
assert report["ai_solve_disagreed"][0][3] == "C", report["ai_solve_disagreed"]
assert report["ai_solve_applied"][0][4] is False
print("[4] 两路不一致 → 采用 A 路、标 low、写进报告（宁留一道标红的题，不丢题）")

# ── 5) A 路的答案不在本题选项里 → 拒绝落盘 ────────────────────────────────
entry = make_q(1)
report = new_report()
api = FakeApi([{"index": 1, "answerKey": "E", "confidence": "high", "rationale": "乱给"}], [])
with tempfile.TemporaryDirectory() as tmp:
    run_solver([entry], api, report, solve_args(), Path(tmp))
assert entry["q"]["answerKey"] == "", entry["q"]["answerKey"]
assert report["ai_solve_rejected"] and not report["ai_solve_applied"]
print("[5] 答案不在选项里 → 拒绝落盘（不让假字母答案进题库）")

# ── 6) 原文 → 字母的对位（多选 / 对不上就放弃） ───────────────────────────
assert build.answer_text_to_key(OPTIONS, "乙") == "B"
assert build.answer_text_to_key(OPTIONS, "甲、丙") == "AC"
assert build.answer_text_to_key(OPTIONS, "丙、甲") == "AC"
assert build.answer_text_to_key(OPTIONS, "不知道选啥") == ""
assert build.answer_text_to_key(OPTIONS, "") == ""
# 选项文本自带分隔符（「が/が」「を/に」）时整串要优先匹配，否则会被按 `/` 拆开而误判成"两路不一致"
SLASH = [{"key": "A", "text": "が/が"}, {"key": "B", "text": "を/に"}]
assert build.answer_text_to_key(SLASH, "が/が") == "A"
assert build.answer_text_to_key(SLASH, "を/に") == "B"
print("[6] 选项原文 → 字母：单选/多选对得上，对不上就整题放弃")

# ── 7) 缓存：第二次跑不再调模型 ──────────────────────────────────────────
report = new_report()
entry = make_q(1)
api = FakeApi([{"index": 1, "answerKey": "C", "confidence": "high", "rationale": "选丙"}],
              [{"index": 1, "answerText": "丙", "confidence": "high", "rationale": "选丙"}])
with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp)
    run_solver([entry], api, report, solve_args(), work)
    assert api.calls == 2, api.calls
    again = make_q(1)
    report2 = new_report()
    run_solver([again], api, report2, solve_args(), work)
    assert api.calls == 2, f"第二次应命中缓存，却又调了模型：{api.calls}"
    assert again["q"]["answerKey"] == "C", again["q"]
    assert report2["ai_solve_cached"], report2["ai_solve_cached"]
    # 单路（--solve-passes 1）也能用；加了 --refresh-answers 才会重问
    report3 = new_report()
    run_solver([make_q(1)], api, report3, solve_args(passes=1, refresh=True), work)
    assert api.calls > 2, api.calls
print("[7] 缓存 ai-answers.json 命中 → 不再花钱；--refresh-answers 才重问")

# ── 8) --answers auto：按卷面答案覆盖率选 paper / ai ──────────────────────
low = [make_q(n, answer="") for n in range(1, 6)] + [make_q(6, answer="A")]
mode = build.resolve_answers_mode(low, argparse.Namespace(answers="auto"), new_report())
assert mode == "ai", mode
# 卷面答案很多但**仍有缺口** → auto 也走 ai（只补缺的那几道，已有的不动）
high = [make_q(n, answer="A") for n in range(1, 6)] + [make_q(6, answer="")]
mode = build.resolve_answers_mode(high, argparse.Namespace(answers="auto"), new_report())
assert mode == "ai", mode
# 整卷每题都有答案 → 纯 paper
full = [make_q(n, answer="A") for n in range(1, 6)]
assert build.resolve_answers_mode(full, argparse.Namespace(answers="auto"), new_report()) == "paper"
assert build.resolve_answers_mode(low, argparse.Namespace(answers="paper"), new_report()) == "paper"
assert build.resolve_answers_mode(high, argparse.Namespace(answers="ai"), new_report()) == "ai"
print("[8] --answers auto：整卷都有答案才走 paper；有缺口就交给 AI 补齐（只补缺的）")

# ── 9) S5 发布门禁：AI 推得的答案 > 1/2 → 硬错误 ─────────────────────────
with tempfile.TemporaryDirectory() as tmp:
    md_path = Path(tmp) / "ai-heavy.md"
    blocks = []
    for number in (1, 2):
        item = make_q(number)
        item["q"]["answerKey"] = "B"
        item["q"]["answerText"] = "乙"
        build.mark_ai_answer(item["q"], "AI 依据", "high")
        blocks.append(build.render_question(item))
    md_path.write_text("# 分类\n\n## 题组一：单项选择题\n\n" + "\n".join(blocks) + "\n", encoding="utf-8")

    def run_check(*extra):
        argv = sys.argv[:]
        sys.argv = ["5_check.py", "--md", str(md_path), *extra]
        try:
            return check.main()
        finally:
            sys.argv = argv

    assert run_check() == 3, "AI 答案占 100%，默认必须拒发"
    assert run_check("--allow-ai-answers") == 2, "显式放行后降级成警告（exit 2 = 通过）"
print("[9] S5 门禁：AI 推得答案 >1/2 拒发；--allow-ai-answers 才放行（降为警告）")

print("\n全部通过：AI 两路解题（来源标记 / 交叉校验 / 缓存 / 发布门禁）✓")
