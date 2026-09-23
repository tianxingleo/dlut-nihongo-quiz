"""S4/S5 离线验收：跨页拼接、题组归一化、判断题补选项、去重、契约门禁。

跑法：`python pdf-ocr/tests/test_p4_build.py`（不联网、0 token）。
用构造的假 `merge.json`，并把 `WORK_ROOT`/`RAW_ROOT` 指到沙箱，**绝不碰真的 `data/raw`**。
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

SANDBOX = c.TOOL_ROOT / "work" / ".tmp" / "p4"
if SANDBOX.exists():
    shutil.rmtree(SANDBOX)
FAKE_WORK = SANDBOX / "work"
FAKE_RAW = SANDBOX / "raw"
for d in (FAKE_WORK, FAKE_RAW):
    d.mkdir(parents=True, exist_ok=True)

CATEGORY = "_p4fixture"


def load(name):
    spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load("4_build_md")
check = load("5_check")

# ── 造数据 ──────────────────────────────────────────────────────────────
PAGES = {
    1: [
        dict(number=1, group="一、测试题组", groupTitle="测试题组（共 9 题）", stem="第一题前半",
             options=[{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
             answerKey="", continued=True, source={"page": 1}),
        dict(number=2, group="一、测试题组", groupTitle="测试题组（共 9 题）", stem="第二题完整",
             options=[{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
             answerKey="B", continued=False, source={"page": 1}),
    ],
    2: [
        dict(number=1, group="", groupTitle="", stem="第一题后半",
             options=[{"key": "C", "text": "丙"}, {"key": "D", "text": "丁"}],
             answerKey="A", answerText="甲", continued=False, source={"page": 2}),
        dict(number=2, group="", groupTitle="", stem="第二题完整",       # 与 page1 同题号同题干 → 去重
             options=[{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
             answerKey="B", continued=False, source={"page": 2}),
        dict(number=3, group="", groupTitle="", stem="第三题前半",
             options=[{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
             answerKey="A", continued=True, source={"page": 2}),
    ],
    3: [
        # completed=True 但**答案缺失** → 真·跨页断题，必须标待复核并进报告
        dict(number=5, group="二", groupTitle="第二组", stem="第五题（跨页断题）",
             options=[{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
             answerKey="", continued=True, source={"page": 3}),
        # completed=True 但**字段完整**（选项 ≥2 且有答案）→ 模型误标，不该惊动人工
        dict(number=6, group="二", groupTitle="第二组", stem="第六题（模型误标 continued）",
             options=[{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
             answerKey="A", continued=True, source={"page": 3}),
        dict(number=9, group="二", groupTitle="第二组（判断题）", stem="地球是圆的",
             options=[], answerKey="A", continued=False, source={"page": 3}),
    ],
    4: [
        dict(number=8, group="", groupTitle="", stem="第七题？其实是第八题",
             options=[{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
             answerKey="B", continued=False, source={"page": 4}),
        dict(number=10, group="", groupTitle="", stem="只有 1 个选项的坏题",
             options=[{"key": "A", "text": "甲"}], answerKey="A", continued=False, source={"page": 4}),
    ],
}

# S3 的删除 / 字段格式化留痕（S4 要汇总进 report.md，见 §32.2 / §33.2）
DEDUPED = {
    1: [dict(number=99, keptNumber=2, reason="题干与选项完全相同（判为重复，已删除）")],
}
NORMALIZED = {
    2: [
        dict(number=1, field="answerKey", before="c,a", after="AC"),
        dict(number=1, field="questionType", before="多选题", after="multi"),
        dict(number=3, field="answerKey", before="E", after=""),
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
                    "pages": 4,
                    "rendered_pages": [1, 2, 3, 4],
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
        q.setdefault("questionType", "single")
    (pages_dir / f"page-{page:03d}.merge.json").write_text(
        json.dumps(
            {
                "page": page,
                "paper_identity": {"title": "fixture", "date": "", "variant": ""},
                "conflicts": [],
                "questions": questions,
                "deduped": DEDUPED.get(page, []),
                "normalized": NORMALIZED.get(page, []),
                "notes": [],
                "needs_review": False,
                "call": {},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
# 第 3 页给一份带"页首残缺片段"的转写（供 §8.2 第 2 步用）
for label in ("a", "b"):
    (pages_dir / f"page-003.{label}.review.json").write_text(
        json.dumps({"page": 3, "transcription_md": "补足的后半段\n\n5. 第五题"}, ensure_ascii=False),
        encoding="utf-8",
    )

# ── 跑 S4（把两个根目录指到沙箱，绝不碰真的 data/raw）────────────────────
c.WORK_ROOT = FAKE_WORK
c.RAW_ROOT = FAKE_RAW
c.TEMP_ROOT = SANDBOX / "tmp"
sys.argv = ["4_build_md.py", "--category", CATEGORY, "--force", "--quiet", "--no-ai-review", "--group-by", "type"]
buffer = io.StringIO()
with redirect_stdout(buffer):
    code = build.main()
out = buffer.getvalue()
assert code == 0, (code, out)

md = (FAKE_RAW / CATEGORY / f"{CATEGORY}.md").read_text(encoding="utf-8")
report_md = (work / "report.md").read_text(encoding="utf-8")
trans_md = (work / "transcription.md").read_text(encoding="utf-8")

# 1) 拼接（按题号配对）：第 1 题两半合成一题、选项 2→4
assert md.count("### 第1题") == 1
first = md[md.index("### 第1题") : md.index("### 第2题")]
assert "第一题前半" in first and "第一题后半" in first, first
assert all(f"{k}. " in first for k in "ABCD"), first
assert "**正确答案：A 甲**" in first, first
# 2) 去重：同题号同题干只留一份
assert md.count("### 第2题") == 1
# 3) 拼接（页首片段）：第 3 题并入了下一页的页首文本，且带待核对标记
third = md[md.index("### 第3题") : md.index("### 第5题")]
assert "补足的后半段" in third and "待核对" in third, third
# 4) 拼接兜底：第 5 题（缺答案）没得拼 → 保留 + 待核对 + 进报告；第 6 题字段完整 → 只记"误标"
fifth = md[md.index("### 第5题") : md.index("### 第6题")]
assert "疑似跨页断题，未能自动拼接" in fifth, fifth
assert "跨页拼接失败" in report_md and "第 5 题" in report_md, report_md
assert "模型误标 continued 的题" in report_md and "第 6 题" in report_md, report_md
assert "疑似跨页断题" not in md[md.index("### 第6题") : md.index("### 第8题")]
# 5) 题组归一化：乱写的 group 归到中文题组号，空 group 沿用上一题
assert "## 题组一：测试题组（共 9 题）" in md and "## 题组二：第二组" in md, md[:400]
# 6) 判断题补选项
ninth = md[md.index("### 第9题") : md.index("### 第10题")]
assert "A. 正确" in ninth and "B. 错误" in ninth and "**正确答案：A 正确**" in ninth, ninth
# 7) 不丢题：只有 1 个选项的坏题照样输出
assert "### 第10题" in md
# 8) 题组题数核对：标题说「共 9 题」，实际 3 题 → 进报告
assert "题组题数与标题声明不符" in report_md and "共 9 题，实际 3 题" in report_md, report_md
# 9) 其它产物
assert "## PDF 第 1 页" in trans_md and "缺该路结果" in trans_md
print("[1-9] S4 通过（拼接×3 分支 / 误标 continued / 去重 / 归一化 / 补选项 / 不丢题 / 题数不符）")

# ── S5：第 5 题（缺答案）与第 10 题（选项不足）都会被丢弃 → 退出码 3 ──
sys.argv = ["5_check.py", "--md", str(FAKE_RAW / CATEGORY / f"{CATEGORY}.md")]
buffer = io.StringIO()
with redirect_stdout(buffer):
    code = check.main()
s5 = buffer.getvalue()
assert code == 3, (code, s5)
assert "第 10 题" in s5 and "选项不足 2 个" in s5, s5
assert "第 5 题" in s5 and "缺 `**正确答案" in s5, s5
assert "会被丢弃 2" in s5, s5
assert "题数与题组标题声明不符" in s5, s5
print("[10] S5 通过：两道坏题都被点名「会被丢弃」+ 题数不符，退出码 3")
print("     " + s5.strip().splitlines()[-2])

# ── S5：真·截断风险（解析区里混入裸 ## 行）→ 硬错误 + 警告 ─────────────
bad = FAKE_RAW / CATEGORY / "trunc.md"
bad.write_text(
    "## 题组一：T\n\n### 第1题\n\n#### 题目\n\n题干\n\nA. 甲\nB. 乙\n\n#### 答案与解析\n\n"
    "**正确答案：A 甲**\n\n解析第一段\n\n## 小标题\n\n这段会被解析端静默切掉\n",
    encoding="utf-8",
)
sys.argv = ["5_check.py", "--md", str(bad)]
buffer = io.StringIO()
with redirect_stdout(buffer):
    code = check.main()
s5 = buffer.getvalue()
assert code == 3, (code, s5)
assert "题组标题不合规 1 行" in s5 and "截断风险 1 题" in s5, s5
print("[11] S5 通过：解析区混入裸 `## ` 同时报硬错误 + 截断警告")

# ── S5：两题之间的**合规**题组标题不算截断（这是真数据踩过的假阳性）──
between = FAKE_RAW / CATEGORY / "between.md"
between.write_text(
    "## 题组一：T\n\n### 第1题\n\n#### 题目\n\n题干\n\nA. 甲\nB. 乙\n\n#### 答案与解析\n\n"
    "**正确答案：A 甲**\n\n解析\n\n## 题组二：下一组\n\n### 第2题\n\n#### 题目\n\n题干2\n\nA. 甲\nB. 乙\n\n"
    "#### 答案与解析\n\n**正确答案：B 乙**\n",
    encoding="utf-8",
)
sys.argv = ["5_check.py", "--md", str(between)]
buffer = io.StringIO()
with redirect_stdout(buffer):
    code = check.main()
assert code == 0, (code, buffer.getvalue())
print("[12] S5 通过：题组标题夹在两题之间不误报（无截断警告，退出码 0）")

# ── S5：合规 md → 全绿 ─────────────────────────────────────────────────
good = FAKE_RAW / CATEGORY / "good.md"
good.write_text(
    "## 题组一：T（共 1 题）\n\n### 第1题\n\n#### 题目\n\n题干\n\nA. 甲\nB. 乙\n\n#### 答案与解析\n\n"
    "**正确答案：A 甲**\n\n解析\n",
    encoding="utf-8",
)
sys.argv = ["5_check.py", "--md", str(good)]
buffer = io.StringIO()
with redirect_stdout(buffer):
    code = check.main()
assert code == 0, (code, buffer.getvalue())
print("[13] S5 通过：合规 md 全绿（含题组题数声明一致，退出码 0）")

# ── 场景 2：公共题干（文章）+ 题组号解析 ────────────────────────────────
CAT2 = "_p4shared"
work2 = FAKE_WORK / CAT2
pages2 = work2 / "pages"
pages2.mkdir(parents=True, exist_ok=True)
(work2 / "source-manifest.json").write_text(
    json.dumps(
        {
            "category": CAT2,
            "documents": [
                {"source": "shared.pdf", "sha256": "f" * 64, "pages": 1, "rendered_pages": [1]}
            ],
            "errors": [],
        },
        ensure_ascii=False,
    ),
    encoding="utf-8",
)


def q2(number, group, title, stem, answer):
    return {
        "number": number,
        "group": group,
        "groupTitle": title,
        "stem": stem,
        "options": [{"key": k, "text": t} for k, t in zip("ABCD", "甲乙丙丁")],
        "answerKey": answer,
        "answerText": "",
        "explanation": "",
        "translation": "",
        "confidence": "high",
        "needs_review": False,
        "continued": False,
        "questionType": "single",
        "source": {"page": 1},
    }


(pages2 / "page-001.merge.json").write_text(
    json.dumps(
        {
            "page": 1,
            "paper_identity": {"title": "shared", "date": "", "variant": ""},
            "conflicts": [],
            "questions": [
                q2(1, "七、题组三", "题组三", "swは何形式か。", "A"),
                # group 只有「题组二」没有行首题组号 → 必须靠转写里的 `六、题组二` 定出「六」
                q2(20, "题组二", "题组二", "(20) の選択肢：", "A"),
                q2(21, "", "", "(21) の選択肢：", "B"),
            ],
            "notes": [],
            "needs_review": False,
            "call": {},
        },
        ensure_ascii=False,
    ),
    encoding="utf-8",
)
TRANSCRIPTION = (
    "七、题组三\n\nswは何形式か。\n\n六、题组二\n\n"
    "以下は共通の設問である。コードを読んで解け。\n\n20. (20) の選択肢：\n"
)
(pages2 / "page-001.a.review.json").write_text(
    json.dumps({"page": 1, "transcription_md": TRANSCRIPTION}, ensure_ascii=False), encoding="utf-8"
)

sys.argv = ["4_build_md.py", "--category", CAT2, "--force", "--quiet", "--no-ai-review", "--group-by", "type"]
buffer = io.StringIO()
with redirect_stdout(buffer):
    code = build.main()
assert code == 0, (code, buffer.getvalue())
md2 = (FAKE_RAW / CAT2 / f"{CAT2}.md").read_text(encoding="utf-8")
report2 = (work2 / "report.md").read_text(encoding="utf-8")

# 14) 题组号：group='题组二' 不能按"取第一个中文数字"变成「二」，要用转写里的 `六、题组二`
assert "## 题组六：题组二" in md2, md2
assert "## 题组七：题组三" in md2, md2
# 15) 公共题干**复制**进每道小题的题干（不再用 `**文章：**`），独立成题
assert "**文章：**" not in md2, md2
for number in (20, 21):
    start = md2.index(f"### 第{number}题")
    nxt = md2.find("### 第", start + 5)
    block = md2[start : nxt if nxt != -1 else len(md2)]
    assert block.count("以下は共通の設問である。コードを読んで解け。") == 1, block
assert "已复制到" in report2 and "公共题干（题组导言）" in report2, report2
# 16) 解析端收下后，每道小题的题干都自带导言（独立可读），且不误伤题组七
kept2, _drops2 = check.parse_like_parser(md2)
assert [q["number"] for q in kept2] == [1, 20, 21], [q["number"] for q in kept2]
for item2 in kept2:
    if item2["number"] in (20, 21):
        assert item2["stem"].startswith("以下は共通の設問である"), item2["stem"]
assert "以下は共通の設問である" not in kept2[0]["stem"], kept2[0]
assert kept2[0]["article"] == "" and "swは何形式か。" in kept2[0]["stem"], kept2[0]
print("[14-16] 公共题干通过（题组号从转写定出 / 复制进每道小题 / 不误伤题组七）")

# ── 场景 3：默认 `--group-by paper` —— 取消题型分题组，全卷 1 张题单 ──────
sys.argv = ["4_build_md.py", "--category", CAT2, "--force", "--quiet", "--no-ai-review"]
buffer = io.StringIO()
with redirect_stdout(buffer):
    code = build.main()
assert code == 0, (code, buffer.getvalue())
md3 = (FAKE_RAW / CAT2 / f"{CAT2}.md").read_text(encoding="utf-8")
report3 = (work2 / "report.md").read_text(encoding="utf-8")
# 17) 只剩 1 个题组标题，且用卷名；题量不变；导言照样复制进每道小题
headings = [line for line in md3.splitlines() if line.startswith("## ")]
assert headings == ["## 题组一：shared"], headings
assert md3.count("### 第") == 3, md3
assert md3.count("以下は共通の設問である。コードを読んで解け。") == 2, md3
assert "已取消题型分题组" in report3, report3
kept3, _ = check.parse_like_parser(md3)
assert {q["group"] for q in kept3} == {"一"}, {q["group"] for q in kept3}
print("[17] 默认分组通过：题型题组被取消 → 全卷 1 张题单「shared」，导言与题量都不变")

# 18) S3 的字段修正被 S4 聚合进 report.md（含"被清空 → 需人工补答案"的提醒）
assert "S3 页内判重删除" in report_md and "保留第 2 题" in report_md, report_md
assert "S3 字段格式化" in report_md, report_md
assert "| answerKey | `c,a` | `AC` | 1 |" in report_md, report_md
assert "| questionType | `多选题` | `multi` | 1 |" in report_md, report_md
assert "| answerKey | `E` | `（空）` | 1 |" in report_md, report_md
assert "需要人工补答案" in report_md, report_md
assert "字段格式化：3 次" in report_md, report_md
print("[18] S3 字段格式化汇总进 report.md（表格聚合 + 被清空的 ⚠ 提醒）")

shutil.rmtree(SANDBOX)
print("\n全部通过：18 组断言 / 沙箱已清理")
