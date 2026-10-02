"""S3「`<u>` 下划线标记只认 A 路」的离线验收（不联网、0 token）。

实测两路标记数差 2~3 倍（第 1 页 53 vs 19、第 2 页 26 vs 20、第 3 页 0 vs 12），
所以按用户要求：**只采信逐字转写那路（A）**，B 路标记一律去掉。

跑法：`python pdf-ocr/tests/test_underline_marks.py`
"""

import importlib.util
import sys
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))

import _common as c  # noqa: E402

c.setup_stdio()  # Windows 控制台默认 GBK，直接跑这个文件时打印 `✓` 会崩


def load(name):
    spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


merge = load("3_merge")

# A 路：标了「欠点」和「じゅしょう」；B 路（qwen）：标了「並ぶ」（A 没标）、漏掉了「欠点」
review_a = {
    "transcription_md": "この文の<u>欠点</u>を選びなさい。\n一等賞を<u>じゅしょう</u>した。\n「並ぶ」は自動詞である。"
}
review_b = {"transcription_md": "この文の欠点を選びなさい。\n「<u>並ぶ</u>」は自動詞である。"}
questions = [
    {"number": 1, "stem": "この文の欠点を選びなさい。"},  # 两路都漏标 → 要按 A 补上
    {"number": 2, "stem": "一等賞をじゅしょうした。"},
    {"number": 3, "stem": "「<u>並ぶ</u>」は自動詞である。"},  # 只有 B 标了 → 保留（B 优先，并集）
]
notes: list[str] = []
info = merge.enforce_underlines(questions, review_a, review_b, notes)

assert questions[0]["stem"] == "この文の<u>欠点</u>を選びなさい。", questions[0]["stem"]
assert questions[1]["stem"] == "一等賞を<u>じゅしょう</u>した。", questions[1]["stem"]
assert questions[2]["stem"] == "「<u>並ぶ</u>」は自動詞である。", questions[2]["stem"]
assert info["marks"] == 3, info
assert info["from_b"] == 1 and info["from_a"] == 2, info
assert any("B 路(qwen)" in note for note in notes), notes
print("[1] B 路(qwen) 优先 + A 路补齐：两路独占的标记都保留，统计正确")

# A 路标了但合并题干里找不到（OCR 两路用字不同）→ 如实报出来，不静默
review_a2 = {"transcription_md": "「<u>けってん</u>」の読みを選べ。"}
q2 = [{"number": 1, "stem": "「欠点」の読みを選べ。"}]
notes2: list[str] = []
info2 = merge.enforce_underline_from_a(q2, review_a2, notes2)
assert info2["a_missing"] == ["けってん"], info2
assert q2[0]["stem"] == "「欠点」の読みを選べ。"
assert any("找不到" in note for note in notes2), notes2
print("[2] A 路标了、题干里对不上 → 记进 notes（不静默丢）")

# 长跨度优先：短词先贴会把长跨度切开
review_a3 = {"transcription_md": "<u>欠点のない人</u>はいない。"}
q3 = [{"number": 1, "stem": "欠点のない人はいない。"}]
merge.enforce_underline_from_a(q3, review_a3, [])
assert q3[0]["stem"] == "<u>欠点のない人</u>はいない。", q3[0]["stem"]
print("[3] 长跨度优先匹配（短词不会先吃掉长跨度的一部分）")

print("\n全部通过：`<u>` 下划线标记只认 A 路 ✓")
