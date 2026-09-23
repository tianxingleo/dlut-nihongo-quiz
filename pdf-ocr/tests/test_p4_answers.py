"""S4 新逻辑的离线验收：参考答案页 → 答案表、材料题拼接、题型按大题标题补正。

跑法：`python pdf-ocr/tests/test_p4_answers.py`（不联网、0 token）

背景（用户 2026-09-22 报的三个问题，对应三组断言）：
  1. 「拼接功能消失」—— 「五、案例分析题」的整段材料在第 5 页最后一道题，三个小问在第 6 页，
     两页**题组名不同**（`五、案例分析题` vs `思考题`），`attach_shared_stems()` 贴不上去；
  2. 「很多多选题的 questionType 不对」—— 卷面写着「二、多项选择题」，模型逐题给了 `single`；
  3. 「answerKey 没有显示」—— 答案单独印在最后一页「试卷评分标准」上，以前那一页被当成
     一堆"题干为空、只有答案"的伪题目输出，真正的题目反而大面积缺答案。
"""

import importlib.util
import io
import json
import shutil
import sys
from contextlib import redirect_stdout
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))

import _common as c  # noqa: E402

SANDBOX = c.TOOL_ROOT / "work" / ".tmp" / "p4answers"
if SANDBOX.exists():
    shutil.rmtree(SANDBOX)
FAKE_WORK = SANDBOX / "work"
FAKE_RAW = SANDBOX / "raw"
for d in (FAKE_WORK, FAKE_RAW):
    d.mkdir(parents=True, exist_ok=True)

CATEGORY = "_p4answerfixture"
MATERIAL = (
    "五、案例分析题。（共10分）\n\n远未成为历史的马克思\n\n"
    "镜头一：马克思被西方媒体评为“千年风云人物”。在千年交替之际，西方媒体纷纷推出"
    "自己评选的千年风云人物，马克思主义的创始人卡尔·马克思名列第一或第二。\n\n"
    "镜头二：马克思被德国《图片报》评为“最伟大的德国人”。\n\n思考题："
)

PAGES = {
    # 第 1 页：两道单选（答案在最后一页）+ 一道多选（模型误标 single）+ 材料题
    1: [
        dict(number=1, group="题组一", groupTitle="一、单项选择题", stem="第一题的题干文字",
             options=[{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"},
                      {"key": "C", "text": "丙"}, {"key": "D", "text": "丁"}],
             answerKey="", questionType="single"),
        dict(number=2, group="题组一", groupTitle="一、单项选择题", stem="第二题的题干文字",
             options=[{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"},
                      {"key": "C", "text": "丙"}, {"key": "D", "text": "丁"}],
             answerKey="", questionType="single"),
        dict(number=3, group="二、多项选择题", groupTitle="二、多项选择题", stem="多选题的题干文字",
             options=[{"key": k, "text": t} for k, t in zip("ABCDE", ["甲", "乙", "丙", "丁", "戊"])],
             answerKey="", questionType="single"),   # ← 模型误标：卷面是多项选择
        dict(number=4, group="五、案例分析题", groupTitle="五、案例分析题", stem=MATERIAL,
             options=[], answerKey="", questionType="fill", continued=True),
    ],
    # 第 2 页：材料的三个小问（题组名与材料页不同 —— 旧代码就是在这里贴不上的）
    2: [
        dict(number=1, group="思考题", groupTitle="思考题", stem="为什么马克思能高居榜首？",
             options=[], answerKey="", questionType="fill"),
        dict(number=2, group="思考题", groupTitle="思考题", stem="这给我们什么启示？",
             options=[], answerKey="", questionType="fill"),
        dict(number=3, group="思考题", groupTitle="思考题", stem="《共产党宣言》为何入选？",
             options=[], answerKey="", questionType="fill"),
    ],
    # 第 3 页：参考答案 / 评分标准页（题干全空、只有答案）
    3: [
        dict(number=1, group="一、单项选择题", groupTitle="单项选择题", stem="", options=[],
             answerKey="C", questionType="fill"),
        dict(number=2, group="一、单项选择题", groupTitle="单项选择题", stem="", options=[],
             answerKey="A", questionType="fill"),
        dict(number=3, group="二、多项选择题", groupTitle="多项选择题", stem="", options=[],
             answerKey="AC", questionType="fill"),
        dict(number=9, group="一、单项选择题", groupTitle="单项选择题", stem="", options=[],
             answerKey="B", questionType="fill"),
    ],
}

work = FAKE_WORK / CATEGORY
pages_dir = work / "pages"
pages_dir.mkdir(parents=True, exist_ok=True)
(work / "source-manifest.json").write_text(
    json.dumps(
        {
            "category": CATEGORY,
            "created_at": c.now_iso(),
            "updated_at": c.now_iso(),
            "documents": [
                {
                    "source": "fixture.pdf",
                    "sha256": "deadbeef" + "0" * 56,
                    "pages": 3,
                    "rendered_pages": [1, 2, 3],
                }
            ],
            "errors": [],
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)
for page, questions in PAGES.items():
    for q in questions:
        q.setdefault("answerText", "")
        q.setdefault("explanation", "")
        q.setdefault("translation", "")
        q.setdefault("confidence", "high")
        q.setdefault("needs_review", False)
        q.setdefault("continued", False)
        q.setdefault("source", {"page": page})
    (pages_dir / f"page-{page:03d}.merge.json").write_text(
        json.dumps(
            {
                "page": page,
                "paper_identity": (
                    {"title": "《原理概论》试卷评分标准", "date": "", "variant": ""}
                    if page == 3
                    else {"title": "原理概论（闭卷）", "date": "", "variant": ""}
                ),
                "conflicts": [],
                "deduped": [],
                "normalized": [],
                "questions": questions,
                "notes": [],
                "needs_review": False,
                "call": {},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

# 两路 OCR 转写（**答案的确定性来源**：`1-2 CA` 区间写法 + `3.AC` 逐题写法）
ANSWER_TRANSCRIPTION = (
    "【参考答案】\n\n《原理概论》试卷评分标准\n\n"
    "一、单项选择题（每题1分，共15分）\n1-2 CA\n\n"
    "二、多项选择题（每题1分，共5分）\n3.AC\n\n"
    "三、论述题（共10分） 要求给两次小分\n1. 对 2分\n社会存在决定社会意识 5分\n"
)
for label in ("a", "b"):
    (pages_dir / f"page-003.{label}.review.json").write_text(
        json.dumps(
            {"page": 3, "transcription_md": ANSWER_TRANSCRIPTION}, ensure_ascii=False
        ),
        encoding="utf-8",
    )

spec = importlib.util.spec_from_file_location("build4", TOOL / "4_build_md.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

# ── 跑 S4（把两个根目录指到沙箱，绝不碰真的 data/raw）────────────────────
c.WORK_ROOT = FAKE_WORK
c.RAW_ROOT = FAKE_RAW
c.TEMP_ROOT = SANDBOX / "tmp"
sys.argv = ["4_build_md.py", "--category", CATEGORY, "--force", "--quiet", "--no-ai-review"]
buffer = io.StringIO()
with redirect_stdout(buffer):
    code = build.main()
out = buffer.getvalue()
assert code == 0, (code, out)

md = (FAKE_RAW / CATEGORY / f"{CATEGORY}.md").read_text(encoding="utf-8")
report_md = (work / "report.md").read_text(encoding="utf-8")

def block_of(text: str, start: int) -> str:
    """切出从 start 开始的那一个 `### 第N题` 题块。

    注意本题卷**每个大题都从 1 重新编号**，md 里 `### 第1题` 会出现两次，
    所以不能用「下一个题号」当边界，只能用「下一个 `### 第`」。
    """
    nxt = text.find("### 第", start + 5)
    return text[start : nxt if nxt != -1 else len(text)]


# 1) 参考答案页 → 答案表：真题目拿到答案，空题干伪题目不再输出
first = block_of(md, md.index("### 第1题"))
second = block_of(md, md.index("### 第2题"))
assert "**正确答案：C 丙**" in first, first
assert "**正确答案：A 甲**" in second, second
assert "（待补）" not in first and "（待补）" not in second, first + second
assert "参考答案 / 评分标准页" in report_md and "模型给了 4 条" in report_md, report_md
# 转写里 `1-2 CA`（区间写法）挖到 2 条；逐题写法 `3.AC` 另算 —— 只要确实挖到了就行
assert "转写挖到" in report_md, report_md
# 答案页的伪题目不能变成题块（旧版会输出 4 个"题干为空 + 裸答案"的题）
assert md.count("### 第") == 6, md  # 单选 1,2 + 多选 3 + 材料下 3 个小问（材料本身已撤）
print("[1] 参考答案页 → 答案表：2 道单选拿到答案，4 条空题干伪题目不再输出")

# 2) 多选题：按「二、多项选择题」补正题型 + 答案表里的 AC 要落上
assert "**正确答案：AC " in md, md
assert "| page 1 | 3 | single | multi |" in report_md, report_md
# 只按题号回退会把单选的答案贴到主观题上（每个大题都从 1 重编号）—— 必须没贴
assert "| page 2 | 1 |" not in report_md and "| page 2 | 2 |" not in report_md, report_md
assert "贴回 3 道题" in report_md, report_md
print("[2] 多选题按卷面大题标题补正为 multi，答案 AC 与选项 E 都在；主观题没被错贴")

# 3) 材料题：整段材料复制到下一题的三个小问，材料本身不再单独成题
for stem in ("为什么马克思能高居榜首？", "这给我们什么启示？", "《共产党宣言》为何入选？"):
    start = md.index(stem)
    block = block_of(md, md.rindex("### 第", 0, start))
    assert "远未成为历史的马克思" in block, block
assert "材料题：1 段材料已复制到 3 道小题的题干上方" in report_md, report_md
assert "## 材料题：整段材料已复制到后续小题的题干上方" in report_md, report_md
# 材料题撤掉后，它那条"跨页拼接失败"也不该再留在报告里
assert "跨页拼接失败" not in report_md, report_md
print("[3] 材料题：1 段材料复制进 3 道小题（跨题组名也能贴上），材料本身撤出题单")

# 4) 填空题不再被误报"选项不足 / 答案不在选项里"，题型补正写进报告
assert "## 题型按「卷面大题标题」补正（S3 旧数据兜底）" in report_md, report_md
assert "题型补正 1 处" in report_md, report_md
assert "选项不足 2 个（0）" not in report_md, report_md
print("[4] 填空/主观题不再被误报为字段不完整；题型补正写进 report.md")

# ── 5) 判断/辨析题（√/×）与主观题评分标准（marxism-5/7 被 S5 拒发的两个真凶）─────
# 5a) 大题归一键：答案页那行常常 group==groupTitle（「四、论述题」「四、论述题」），
#     压平后会变成「论述题论述题」，与题目侧的「论述题」永远对不上 → 标准一条都贴不回去。
assert build.section_bucket("四、论述题", "四、论述题") == "论述题", build.section_bucket(
    "四、论述题", "四、论述题"
)
assert build.section_bucket("四", "论述题") == "论述题"
assert (
    build.section_bucket("三、案例分析题", "案例分析题（共10分，要求给三次小分）")
    == "案例分析题"
), build.section_bucket("三、案例分析题", "案例分析题（共10分，要求给三次小分）")
assert build.section_bucket("一、单项选择题", "单项选择题") == "single"

# 5b) √/× 认得出；答案块（挤在同一行的答案表原文）不许当导言/材料
assert build.judgement_letter("×") == "B" and build.judgement_letter("√") == "A"
assert build.judgement_letter("正确") == "A" and build.judgement_letter("错") == "B"
assert build.judgement_letter("对 2分\n这是由真理的本性和实践的特点决定的") == ""
ANSWER_BLOCK = (
    "1-5 CBDBD 6-10 CDDDA 11-15 CCDDD 二、多项选择题(每题1分,共5分) 1-5 BDE CD CDE ACE AC"
)
assert build.looks_like_answer_dump(ANSWER_BLOCK), ANSWER_BLOCK
assert not build.looks_like_answer_dump(MATERIAL), MATERIAL

# 5c) "只有 √/× 的答案行"要进答案表（A=正确、B=错误），不能跑进评分标准里
table5 = build.answer_rows_to_table(
    [
        dict(number=5, group="三、辨析题", groupTitle="辨析题", answerKey="", answerText="√"),
        dict(number=6, group="三、辨析题", groupTitle="辨析题", answerKey="", answerText="×"),
    ]
)
assert table5 == {("辨析题", 5): "A", ("辨析题", 6): "B"}, table5

# 5d) 答案写在 answerText 里的判断题 → 补「A. 正确 / B. 错误」+ 字母答案
judge_entries = [
    {
        "page": 3,
        "q": dict(number=3, group="题组二", groupTitle="辨析题", stem="因为……（ ）",
                  options=[], answerKey="", answerText="错误"),
    }
]
rep5 = {"judgement_filled": []}
build.fill_judgement_options(judge_entries, rep5)
jq = judge_entries[0]["q"]
assert [o["text"] for o in jq["options"]] == ["正确", "错误"], jq["options"]
assert jq["answerKey"] == "B" and jq["answerText"] == "错误" and jq["questionType"] == "judgement", jq
assert rep5["judgement_filled"] == [(3, 3)], rep5

# 5e) 评分标准贴回：同桶数量相等按顺序（论述 1 道）+ 材料桶 → 思考讨论桶（案例 2 道）
crit_entries = [
    {"page": 4, "q": dict(number=4, group="四", groupTitle="论述题", stem="试述……的原理", options=[],
                          answerKey="", answerText="")},
    {"page": 6, "q": dict(number=1, group="思考讨论", groupTitle="思考讨论", stem="引力波说明了什么？",
                          options=[], answerKey="", answerText="")},
    {"page": 6, "q": dict(number=2, group="思考讨论", groupTitle="思考讨论", stem="是不是终极真理？",
                          options=[], answerKey="", answerText="")},
]
criteria5 = {
    ("论述题", 1): "社会存在决定社会意识 5分",
    ("案例分析题", 1): "实践是检验真理的唯一标准。（2分）",
    ("案例分析题", 2): "不是，真理具有绝对性和相对性。（2分）",
}
rep6 = {"criteria_attached": [], "criteria_by_order": 0, "criteria_unmatched": []}
build.apply_criteria(crit_entries, criteria5, rep6)
assert crit_entries[0]["q"]["answerText"] == "社会存在决定社会意识 5分", crit_entries[0]["q"]
assert crit_entries[1]["q"]["answerText"].startswith("实践是检验真理"), crit_entries[1]["q"]
assert crit_entries[2]["q"]["answerText"].startswith("不是，真理"), crit_entries[2]["q"]
assert rep6["criteria_unmatched"] == [], rep6
assert rep6["criteria_by_order"] == 3, rep6

# 5f) 零信息条目（空题干 + 无答案 + 无选项）要丢掉，别让它把材料贴到"不存在的题"上
junk = [
    {"page": 4, "q": dict(number=1, group="", groupTitle="", stem="", options=[], answerKey="",
                          answerText="")},
    {"page": 4, "q": dict(number=2, group="", groupTitle="", stem="被截断的真题干", options=[],
                          answerKey="", answerText="")},
]
rep7 = {"dropped_empty_rows": []}
kept = build.drop_empty_rows(junk, rep7)
assert len(kept) == 1 and kept[0]["q"]["stem"] == "被截断的真题干", kept
assert rep7["dropped_empty_rows"] == [(4, 1)], rep7
print("[5] √/× 判断题与主观题评分标准都能贴回题目（含答案块不许当导言/材料）")

# ── 6) 答案页"不印题号"的两种形态：裸字母块 + 整段小问标准 ─────────────────
# 6a) 裸字母块（`CCBBB CDBDD CDACB CCDAC` ＋ 多选 5 组）也要判成答案块：
#     它挤在一行里、没有题号，旧判据（要 ≥3 行"像答案行"）一个都匹配不到，于是被当成
#     题组公共题干复制到 20 道小题头上（实测 marxism-7 第 23–34 题的题干里全是答案）。
BARE_BLOCK = (
    "一、单项选择题（每题2分，共40分） CCBBB CDBDD CDACB CCDAC "
    "二、多项选择题（每题2分，共10分） ADE ACDE ABCDE ABCDE ABCDE"
)
assert build.looks_like_answer_dump(BARE_BLOCK), BARE_BLOCK
assert build.looks_like_answer_dump("三、辨析题（每题2分，共10分） ×××√×")
assert not build.looks_like_answer_dump(MATERIAL), MATERIAL

# 6b) 大题名要在 group / groupTitle 里挑"像大题名"的那一个：
#     `group='案例分析题'` + `groupTitle='引力波：…拼图'`（OCR 把文章标题填进了 groupTitle），
#     取最长的会串桶 → 案例分析的标准贴不到案例分析题上。
assert (
    build.section_bucket("案例分析题", "引力波：广义相对论的最后一块“拼图”") == "案例分析题"
), build.section_bucket("案例分析题", "引力波：广义相对论的最后一块“拼图”")

# 6c) 答案表题号体系对不上时：**同一个大题里数量相等就按顺序配**
#     （marxism-7：答案页把辨析题答案顺延编号成 26–30，卷面却是 1–5）
table7 = {
    ("辨析题", 26): "B",
    ("辨析题", 27): "B",
    ("辨析题", 28): "B",
    ("辨析题", 29): "A",
    ("辨析题", 30): "B",
}
entries7 = [
    {
        "page": 3,
        "q": dict(number=i, group="题组三", groupTitle="辨析题", stem=f"辨析第{i}题（ ）",
                  options=[], answerKey="", answerText=""),
    }
    for i in range(1, 6)
]
rep8 = {"answers_from_table": [], "answers_by_order": [], "answer_overrides": []}
build.apply_answer_table(entries7, table7, rep8)
assert [e["q"]["answerKey"] for e in entries7] == ["B", "B", "B", "A", "B"], entries7
assert len(rep8["answers_by_order"]) == 5, rep8
# 数量不等就一律不贴（宁缺勿错）：3 条答案配 2 道题 → 一道都不动。
# 题号也要故意错开（1–3 vs 7–8），否则会被①的精确匹配贴上，测不到"按顺序配"这一层。
table_odd = {("辨析题", 1): "A", ("辨析题", 2): "A", ("辨析题", 3): "A"}
entries_odd = [
    {
        "page": 3,
        "q": dict(number=n, group="题组三", groupTitle="辨析题", stem=f"辨析第{n}题（ ）",
                  options=[], answerKey="", answerText=""),
    }
    for n in (7, 8)
]
build.apply_answer_table(
    entries_odd,
    table_odd,
    {"answers_from_table": [], "answers_by_order": [], "answer_overrides": []},
)
assert [e["q"]["answerKey"] for e in entries_odd] == ["", ""], entries_odd

# 6d) 一段标准里塞了两个小问（`1. … 2. …`）→ 拆开贴给两道小题
follow_entries = [
    {"page": 6, "q": dict(number=1, group="思考讨论", groupTitle="思考讨论",
                          stem="引力波的最终证实说明了什么？", options=[], answerKey="", answerText="")},
    {"page": 6, "q": dict(number=2, group="思考讨论", groupTitle="思考讨论",
                          stem="是不是终极真理？为什么？", options=[], answerKey="", answerText="")},
]
criteria7 = {
    ("案例分析题", 32): (
        "1. 共计10分。\n\n引力波的最终证实说明了实践是检验真理的唯一标准。（2分）\n\n"
        "2. 共计10分。\n\n不是。（2分）因为真理具有绝对性和相对性。"
    )
}
rep9 = {"criteria_attached": [], "criteria_by_order": 0, "criteria_unmatched": []}
build.apply_criteria(follow_entries, criteria7, rep9)
assert follow_entries[0]["q"]["answerText"].startswith("1. 共计10分"), follow_entries[0]["q"]
assert follow_entries[1]["q"]["answerText"].startswith("2. 共计10分"), follow_entries[1]["q"]
assert rep9["criteria_unmatched"] == [], rep9
print("[6] 裸字母答案块不当导言；答案表按顺序配对；一段两个小问的标准会拆开贴")

# ── 7) 大题说明（说明句）不是题：丢掉、并把同大题的题号前移、再按术语重合补标准 ──
material_entry = {
    "page": 1,
    "q": dict(number=4, group="五、案例分析题", groupTitle="五、案例分析题", stem=MATERIAL,
              options=[], answerKey="", answerText=""),
}
instr = {
    "page": 6,
    "q": dict(number=1, group="五、辨析题", groupTitle="辨析题",
              stem="五、辨析题。运用马克思主义的基本原理，判断下列各题的对错，并说明理由。（每题5分，共10分）",
              options=[], answerKey="", answerText=""),
}
real = {
    "page": 6,
    "q": dict(number=2, group="五、辨析题", groupTitle="辨析题",
              stem="社会实践是检验认识真理性的唯一标准", options=[], answerKey="", answerText=""),
}
rep10 = {"dropped_instruction_rows": [], "instruction_renumbered": []}
kept7 = build.drop_instruction_rows([material_entry, instr, real], rep10)
# 案例材料（长、没有说明句措辞）绝不能当说明丢掉
assert len(kept7) == 2 and kept7[0] is material_entry, kept7
assert rep10["dropped_instruction_rows"] == [(6, 1)], rep10
# 说明句占了第 1 题 → 真题目从 2 前移回 1，否则答案会按题号贴到下一条上
assert real["q"]["number"] == 1, real
assert rep10["instruction_renumbered"] == [(6, 2, 1)], rep10

# 7b) 题号已经对上了 → 直接精确匹配，拿到的是**第一条**（"对 2分 …"），不是第二条
crit7 = {
    ("辨析题", 1): "对 2分 这是由真理的本性和实践的特点决定的。真理的本性：主观和客观相符合",
    ("辨析题", 2): "错 2分 资本主义基本矛盾是资本主义经济危机爆发的根本原因。",
}
rep11 = {"criteria_attached": [], "criteria_by_order": 0, "criteria_by_content": [],
         "criteria_unmatched": []}
build.apply_criteria([real], crit7, rep11)
assert real["q"]["answerText"].startswith("对 2分"), real["q"]
assert rep11["criteria_unmatched"] == [("辨析题", 2, crit7[("辨析题", 2)][:60])], rep11

# 7c) 题号真对不上、只剩一道候选却有两条标准 → 按术语重合挑**严格领先**的那一条
lone = {
    "page": 6,
    "q": dict(number=9, group="五、辨析题", groupTitle="辨析题",
              stem="社会实践是检验认识真理性的唯一标准", options=[], answerKey="", answerText=""),
}
rep12 = {"criteria_attached": [], "criteria_by_order": 0, "criteria_by_content": [],
         "criteria_unmatched": []}
build.apply_criteria([lone], crit7, rep12)
assert lone["q"]["answerText"].startswith("对 2分"), lone["q"]
assert [row[:2] for row in rep12["criteria_by_content"]] == [("辨析题", 1)], rep12
print("[7] 大题说明丢掉并回退题号；标准按题号/术语重合贴对那一条")

shutil.rmtree(SANDBOX)
print("\n全部通过：7 组断言 / 沙箱已清理")
