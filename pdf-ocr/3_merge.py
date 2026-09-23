"""S3：把同一页的两路 OCR 结果交给 deepseek-flash 比对 + 题目提取
→ pdf-ocr/work/<分类名>/pages/page-00N.merge.json

用法：
  python pdf-ocr/3_merge.py --category <分类名> [--pages 1-3] [--force] [--quiet]
  （密钥读 .env：DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL）

设计要点（docs/pdf-ocr-pipeline.md §7.2）：
  * 每页一次调用，输入是两路的 review.json（不传图片，纯文本比对）。
  * 判定规则：同一题同一字段两路不一致 → 必进 conflicts[]，且模型须给 chosen/reason；
    confidence != high 或冲突未消解 → 该题 needs_review=true；页边界半截题 → continued=true。
  * **确定性兜底**：两路在"格式无关字段"（页码标签 / 题号范围 / page_condition / paper_identity）
    上不一致时，即使模型没报冲突，也补一条 synthetic conflict 并把整页标 needs_review ——
    因为两路提示词刻意异构，转写文本的排版本来就不同，只有这些字段可直接逐字段比。
  * 只有一路成功（另一路失败）时仍提取，但整页标 needs_review 并注明缺一路。
  * **题号覆盖 / 题数匹配兜底**：把两路 `question_ranges` 的并集与"实际提出的题号"对账，
    少了（模型静默漏抽）/ 多了（编题号）/ 同页重复 → 补 synthetic conflict 并整页标 needs_review。
    实测抓到过：page 4 两路都声明 34-41，模型只提出 36-41，丢了第 34、35 题。

产物字段见 §7.2；中间产物留在 pdf-ocr/work/，不写 data/raw。
退出码：0 成功；1 参数/环境错误；3 有页失败。
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as c  # noqa: E402

SYSTEM_PROMPT = (
    "你是试卷校对与结构化提取助手。你会看到同一页试卷的两路独立 OCR 结果，"
    "请比对它们并提取题目。只输出一个 JSON 对象，不要输出解释、不要用代码围栏。"
)

# 应答里至少要出现其中一个键，否则算"返回值格式不对"（见 merge_one_page 里的校验）
MERGE_SCHEMA_KEYS = ("questions", "paper_identity", "page_condition", "conflicts")

SCHEMA_BLOCK = """请输出如下 JSON（键名固定）：
{
  "paper_identity": {"title": "", "date": "", "variant": ""},
  "page_condition": "clear",
  "conflicts": [
    {"question": 6, "field": "options.A", "a": "", "b": "", "chosen": "", "reason": "", "confidence": "medium"}
  ],
  "questions": [
    {
      "number": 1, "group": "题组一", "groupTitle": "汉字读音选择",
      "stem": "题干原文（可含 ** 强调）",
      "options": [{"key": "A", "text": ""}, {"key": "B", "text": ""}],
      "answerKey": "B", "answerText": "",
      "explanation": "解析正文", "explanationSource": "printed|generated|none",
      "translation": "",
      "confidence": "high", "needs_review": false, "continued": false
    }
  ]
}

规则：
1) 两路一致的内容直接采用；**任何不一致**都要进 conflicts[]，field 写清楚位置
   （如 options.A / answerKey / stem / number），a、b 分别是两路的原文，chosen 是你采信的值，reason 给依据。
2) 把握不足（confidence 不是 high）或冲突未消解的题，needs_review 必须为 true。
3) 题干/选项被页边界切成两半（本页只有半截）时，continued 为 true —— 交给后续拼接，不要脑补后半截。
   **但整题必须留下**：哪怕只看见半截题干、只剩一两个选项，也照原样抄下来（题号、已有的选项、能看见的答案都给），
   **不许因为"这题不完整"就整题省略**。
4) 只提取本页真实出现的题目，number 用页面上的原始题号；选项 key 用 A/B/C/D。
   没有选项的题（填空/简答）options 给 []，answerKey 给 ""，答案写在 answerText。
   **同一页不要重复输出同一道题**：题干与选项都一样的两条，只保留一条（后面那条不要写）。
5) 两路都没写清的内容不要编造；宁可在 explanation 里留空 + needs_review=true。
6) **公共题干（题组导言 / 代码块 / 表格）与它下面的小题**：
   a. 一个题组的小题共用一段导言时（如「以下は…空欄を A～D で答えよ」+ 代码块），
      把这段导言**原样**抄到该题组**第一道小题的 stem 开头**（保留换行和 ``` 代码围栏）。
   b. `groupTitle` 只写题组的**短名**（如「题组二」）。**不要把整段导言塞进 groupTitle。**
   c. **该题组下的每一个小题都必须单独成题**，即使小题自己的文字只是「(34) の選択肢：」这样的
      占位符、或者小题的题干不在这页 —— 题号用页面上的小题号，选项/答案照抄卷面，**不许跳过**。
      宁可用占位文字 + needs_review=true，也不能少一道小题。
7) **答案解析（`explanation` + `explanationSource`）**：
   a. 卷面**印了**解析 → 原样抄进 `explanation`，`explanationSource` 写 `"printed"`。
   b. 卷面**没印**解析（只有答案）→ 你自己写一句**简短**解析（**≤80 字**，直接说为什么选它、
      错在哪；有公式/推导就给关键一步），`explanationSource` 写 `"generated"`。
      这是给网站做题的人看的，别写"根据题意可知"这种废话。
   c. 题目本身没读懂、或没有把握 → `explanation` 留空、`explanationSource` 写 `"none"`，
      **不要编造**。
   d. 生成解析**不影响** `answerKey`：答案一律以卷面为准，绝不因为解析而改答案。
8) **参考答案 / 评分标准页**（整页只有答案、没有题干）：这一页的答案要靠题号贴回前面的题目，
   所以必须**逐题一条**地抄下来，`stem` 留空、`number` 用卷面题号、`answerKey` 照抄：
   a. 写成区间的（`1-5 DDDBC`、`6-10 ABDDB`、`11-15 ABCAC`）→ **展开成一条一题**：
      number 1..5 分别 answerKey D、D、D、B、C，以此类推（区间里有空格的 `1-5 DDDB C`
      也是 5 个答案，空格是排版断行）。
   b. 逐题写的（`1-5 1.CE 2.AC 3.ABC 4.ABC 5.DE`）→ 按 `题号.答案` 逐条抄。
   c. 主观题（论述/辨析/案例/简答）没有字母答案 → `answerKey` 留空，评分标准原样写进
      `answerText`（要保留"每题几分"的小分说明）。
   d. **绝对不要合并、总结、只留一条**（"1-5 DDDB C"这种概括会让 14 道题的答案全丢）；
      也不要把占位文字写进 stem（stem 就是空的）。"""


# ── 格式无关字段的确定性比对（兜底）───────────────────────────────────────
def normalize_range(value) -> set[int]:
    """把 ["1-4"] / ["1","2"] 这类题号范围归一化成 {1,2,3,4}。"""
    out: set[int] = set()
    for item in value if isinstance(value, list) else [value]:
        for part in re.split(r"[,，、;；\s]+", str(item or "").strip()):
            if not part:
                continue
            m = re.match(r"^(\d+)\s*[-–—~]\s*(\d+)$", part)
            if m:
                out.update(range(int(m.group(1)), int(m.group(2)) + 1))
            elif part.isdigit():
                out.add(int(part))
    return out


def structural_diffs(review_a: dict, review_b: dict) -> list[dict]:
    """两路在"可直接逐字段比"的字段上的差异（转写文本排版本来就不同，不参与比较）。"""
    diffs: list[dict] = []

    def label_set(review: dict) -> set[str]:
        return {str(x).strip() for x in review.get("printed_page_labels", []) if str(x).strip()}

    if label_set(review_a) != label_set(review_b):
        diffs.append(
            {
                "question": None,
                "field": "printed_page_labels",
                "a": ", ".join(sorted(label_set(review_a))),
                "b": ", ".join(sorted(label_set(review_b))),
            }
        )

    if normalize_range(review_a.get("question_ranges")) != normalize_range(
        review_b.get("question_ranges")
    ):
        diffs.append(
            {
                "question": None,
                "field": "question_ranges",
                "a": ", ".join(review_a.get("question_ranges") or []),
                "b": ", ".join(review_b.get("question_ranges") or []),
            }
        )

    for field in ("page_condition",):
        if str(review_a.get(field, "")).strip() != str(review_b.get(field, "")).strip():
            diffs.append(
                {
                    "question": None,
                    "field": field,
                    "a": str(review_a.get(field, "")),
                    "b": str(review_b.get(field, "")),
                }
            )

    identity_a = review_a.get("paper_identity") or {}
    identity_b = review_b.get("paper_identity") or {}
    for key in ("title", "date", "variant"):
        va, vb = str(identity_a.get(key, "")).strip(), str(identity_b.get(key, "")).strip()
        if va and vb and va != vb:
            diffs.append({"question": None, "field": f"paper_identity.{key}", "a": va, "b": vb})

    for diff in diffs:
        diff.setdefault("chosen", "")
        diff.setdefault("reason", "两路在这项上不一致（确定性比对发现，模型未报）")
        diff.setdefault("confidence", "low")
    return diffs


# ── 题号覆盖 / 题数匹配的确定性兜底 ──────────────────────────────────────
def _as_int(value) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def declared_numbers(reviews: dict[str, dict]) -> tuple[set[int], list[str]]:
    """两路 `question_ranges` 的并集 → (期望题号集合, 原始声明文本)。"""
    numbers: set[int] = set()
    sources: list[str] = []
    for label in sorted(reviews):
        ranges = reviews[label].get("question_ranges") or []
        if ranges:
            sources.append(f"{label.upper()} 路：{', '.join(str(x) for x in ranges)}")
        numbers |= normalize_range(ranges)
    return numbers, sources


def coverage_diffs(reviews: dict[str, dict], questions: list[dict]) -> list[dict]:
    """题号覆盖 / 题数匹配的确定性检查（**不发新请求，纯本地比对**）。

    OCR 两路各自声明了本页含哪些题号（`question_ranges`，如 `["34-41"]`）。
    取并集，与"本次实际提出的题号"比一遍：

      * 少了 → 模型**静默漏抽**（实测：page 4 声明 34-41，只提出 36-41，丢了第 34/35 题）
      * 多了 → 模型编了题号，或 OCR 的范围写错
      * 同页重复 → 复制粘贴

    只报案、不阻断：冲突进 `conflicts[]`，整页 `needs_review`。
    """
    expected, sources = declared_numbers(reviews)
    actual = [n for n in (_as_int(q.get("number")) for q in questions) if n is not None]
    actual_set = set(actual)
    source_text = "；".join(sources) or "（两路都没声明题号范围）"
    diffs: list[dict] = []

    if expected:
        missing = sorted(expected - actual_set)
        extra = sorted(actual_set - expected)
        if missing or extra:
            detail = []
            if missing:
                detail.append(f"缺 {len(missing)} 题（{c.format_pages(missing)}）")
            if extra:
                detail.append(f"多出未声明的题号（{c.format_pages(extra)}）")
            diffs.append(
                {
                    "question": None,
                    "field": "question_coverage",
                    "a": f"OCR 声明本页 {len(expected)} 题：{c.format_pages(sorted(expected))}",
                    "b": f"实际提出 {len(actual)} 题：{c.format_pages(sorted(actual_set)) or '无'}",
                    "chosen": "",
                    "reason": (
                        f"题数不匹配：{'；'.join(detail)}。来源：{source_text}。"
                        "少题通常是模型静默漏抽 —— 请对照页图补抽，或确认该题号是 OCR 笔误"
                    ),
                    "confidence": "medium",
                }
            )

    duplicates = sorted({n for n in actual if actual.count(n) > 1})
    if duplicates:
        diffs.append(
            {
                "question": None,
                "field": "question_number_duplicate",
                "a": f"本页提出 {len(actual)} 题",
                "b": f"重复题号：{c.format_pages(duplicates)}",
                "chosen": "",
                "reason": "同页出现重复题号，模型可能复制粘贴了同一题；请对照页图确认",
                "confidence": "medium",
            }
        )
    return diffs


# ── 提示词 ──────────────────────────────────────────────────────────────
def shorten(text: str, limit: int = 12000) -> str:
    text = text or ""
    return text if len(text) <= limit else text[:limit] + "\n…（本页转写过长，已截断）"


def render_pass(label: str, review: dict) -> str:
    uncertain = review.get("uncertain") or []
    corrections = review.get("corrections") or []
    lines = [
        f"【OCR 路 {label}】",
        f"- 印刷页码标签：{', '.join(review.get('printed_page_labels') or []) or '（未标注）'}",
        f"- 题号范围：{', '.join(review.get('question_ranges') or []) or '（未标注）'}",
        f"- 页面状况：{review.get('page_condition') or '未知'}",
        f"- 卷名信息：{review.get('paper_identity') or {}}",
    ]
    if uncertain:
        lines.append(f"- 该路自报没把握的位置：{uncertain}")
    if corrections:
        lines.append(f"- 该路自报的改正：{corrections}")
    lines.append("- 整页转写：")
    lines.append(shorten(str(review.get("transcription_md") or "")))
    return "\n".join(lines)


RETRY_NOTE = (
    "\n\n【重要】上一次回复不是合法 JSON。这一次请**只输出一个 JSON 对象**："
    "不要任何解释文字、不要代码围栏；字符串内部的换行必须写成 \\n（不要出现裸换行）。"
)


def build_payload(
    model: str | None, page: int, reviews: dict[str, dict], max_tokens: int, retry_note: str = ""
) -> dict:
    parts = [f"【本页】第 {page} 页", ""]
    for label in sorted(reviews):
        parts.append(render_pass(label.upper(), reviews[label]))
        parts.append("")
    parts.append(SCHEMA_BLOCK + retry_note)
    return {
        "model": model,
        "temperature": 0,
        # 单次响应上限：merge 出参是整份题目 JSON，按实测留足余量，防止话痨计费
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "\n".join(parts)},
        ],
    }


# ── 结果归一化 ──────────────────────────────────────────────────────────
def explanation_source(raw: dict) -> str:
    """解析的来源：卷面印的 / 模型生成的 / 没有。

    这个字段决定站上的 `answerProvenance`（`printed` vs `generated`）—— 不能让 AI 写的解析
    冒充卷面原文（`scripts/parse-computer-banks.mjs:49` 就是按这个区分并额外要求非空解析的）。
    """
    text = str(raw.get("explanation") or "").strip()
    source = str(raw.get("explanationSource") or "").strip().lower()
    if source in ("printed", "generated"):
        return source if text else "none"
    if not text:
        return "none"
    # 模型没写 provenance 时保守判：默认当成卷面原文（旧产物都是这个语义）
    return "printed"


# ── answerKey / questionType 的确定性约束（用户要求：完整格式化）─────────
# 全角字母 → 半角（模型经常给 ＡＢＣＤ）
_FULLWIDTH = str.maketrans(
    "ＡＢＣＤＥＦＧＨＩＪａｂｃｄｅｆｇｈｉｊ", "ABCDEFGHIJabcdefghij"
)
# 答案里常见的分隔符（多选会写成 `C,E` / `C、E` / `CE` / `C 和 E`）
_ANSWER_SEP = re.compile(r"[\s,，、;；/|\\&+·．.。和与及]+")
# md 契约支持到 E（解析端与 5_check 的正则都是 `[A-E]`，多选题实测 5 个选项）
MD_ANSWER_LETTERS = "ABCDE"
_TRUE_WORDS = {"正确", "对", "是", "√", "T", "TRUE", "对的", "正确的"}
_FALSE_WORDS = {"错误", "错", "否", "×", "X", "F", "FALSE", "错的", "错误的"}

# questionType 允许值 = `src/types/question.ts` 里的联合类型（`other` 不是合法值）
QUIZ_TYPES = c.QUIZ_TYPES
_TYPE_ALIASES: dict[str, str] = {}
for _canonical, _aliases in {
    "single": (
        "single", "singlechoice", "choice", "radio", "单选", "单选题", "单项选择题",
        "单向选择题", "单选选择题",
    ),
    "multi": (
        "multi", "multiple", "multiplechoice", "checkbox", "多选", "多选题", "多项选择题",
        "不定项选择题", "多项选择",
    ),
    "judgement": (
        "judgement", "judgment", "judge", "truefalse", "bool", "boolean", "判断", "判断题",
        "是非题", "对错题", "判断正误",
    ),
    "fill": (
        "fill", "fillin", "blank", "填空", "填空题", "简答", "简答题", "论述", "论述题",
        "解答", "解答题", "问答", "问答题", "计算题", "other", "essay", "shortanswer",
    ),
}.items():
    for _alias in _aliases:
        _TYPE_ALIASES[_alias] = _canonical


def _squash(text: str) -> str:
    return re.sub(r"[\s_\-/]+", "", str(text or "").strip().lower())


def normalize_answer_key(
    raw, options: list[dict], record: list[dict], number
) -> tuple[str, str, bool]:
    """把 answerKey 收拾成"排序去重的大写字母"，返回 (规范化答案, 答案文本, 是否需要复核)。

    - 全角 → 半角；去掉 `,，、;；/|&+` 与空格；多选排序去重（`CA` → `AC`）。
    - 字母只在**选项实际有的 key**里取（没选项时才退回 A-D），防止把 `E` 当成有效答案。
    - 中文/符号形式（`正确`/`错`/`√`/`×`/`T`/`F`）→ 先映射到选项文本，再取该选项的 key；
      **选项里没有"正确/错误"时改成写进答案文本**（第二项返回值），不能清空 ——
      卷面上的辨析题经常就是「……（ ）」＋答案页一串 `×××√×`，根本没有 A/B 选项可映射，
      以前直接清空，整道题就变成"没选项没答案"，S5 按"会被解析端丢弃"计数
      （实测 marxism-7：5 条 `×`/`√` 被清空 → 第 14–18 题全判缺答案、26.5% > 1/5 直接拒发）。
    - 实在认不出 → **清空**并标需要复核（宁可空着让人工填，也不要留一个假答案）。
    """
    original = str(raw or "").strip()
    allowed = "".join(sorted({str(o.get("key") or "").upper() for o in options if o.get("key")}))
    pool = allowed or MD_ANSWER_LETTERS
    letters = "".join(
        sorted({ch for ch in _ANSWER_SEP.sub("", original.translate(_FULLWIDTH)).upper() if ch in pool})
    )
    if letters:
        if letters != original:
            record.append(
                {"number": number, "field": "answerKey", "before": original[:20], "after": letters}
            )
        return letters, "", any(ch not in MD_ANSWER_LETTERS for ch in letters)

    # 没有可用字母：试试判断题的中文/符号写法
    text = original.upper()
    target = ""
    if original in _TRUE_WORDS or text in _TRUE_WORDS:
        target = "正确"
    elif original in _FALSE_WORDS or text in _FALSE_WORDS:
        target = "错误"
    if target:
        for option in options:
            if target in str(option.get("text") or ""):
                record.append(
                    {
                        "number": number,
                        "field": "answerKey",
                        "before": original[:20],
                        "after": option["key"],
                    }
                )
                return str(option["key"]).upper(), "", False
        # 没有"正确/错误"选项 → 答案以**文本**形式保留（S4 会按需补 A.正确/B.错误 选项）
        record.append(
            {
                "number": number,
                "field": "answerKey",
                "before": original[:20],
                "after": f"（转成答案文本）{target}",
            }
        )
        return "", target, False
    if original:
        record.append(
            {"number": number, "field": "answerKey", "before": original[:20], "after": "（已清空）"}
        )
        return "", "", True
    return "", "", False


def infer_question_type(options: list[dict], answer_key: str) -> str:
    """按内容推断题型（模型没给或给了认不出的值时用）。"""
    if len(options) < 2:
        return "fill"
    texts = {_squash(o.get("text")) for o in options}
    if len(texts & {"正确", "错误", "对", "错", "是", "否", "true", "false"}) >= 2:
        return "judgement"
    if len(answer_key) > 1:
        return "multi"
    return "single"


# 卷面上"大题标题"（"二、多项选择题"）比模型逐题猜的 questionType 可靠得多。
# 实测（Principles-of-Marxism）：第二大题明明写着「二、多项选择题」、每题 5 个选项，
# 模型却逐题给了 `single`，站上就变成"单选"，用户报"很多多选题的 questionType 不对"。
# 规则本体在 `_common.py`（S4 也要用同一条，避免两处漂移）。
def question_type_from_section(section: str) -> str:
    """从"题组名/大题标题"里读题型（读不出返回空串）。"""
    return c.question_type_from_section(section)


def normalize_question_type(
    raw, options: list[dict], answer_key: str, record: list[dict], number, section: str = ""
) -> str:
    """把 questionType 收敛到 `single | multi | judgement | fill` 四个合法值。

    `other` / `简答` / `论述` 这类**不是合法值**（`src/types/question.ts` 里没有），
    统一落到 `fill`（站上填空题就是开放输入框）。

    优先级：**卷面大题标题 > 模型逐题声明 > 内容推断**；最后用答案自洽性兜一层
    （答案里有 ≥2 个字母 ⇒ 一定是 multi —— 这是唯一能压过标题的硬证据）。
    """
    declared = _squash(raw)
    canonical = _TYPE_ALIASES.get(declared, "")
    inferred = infer_question_type(options, answer_key)
    from_section = question_type_from_section(section)
    chosen = from_section or canonical or inferred
    # 与答案自洽性检查（单向）：多个答案字母 ⇒ 必是多选
    if len(answer_key) > 1:
        chosen = "multi"
    if chosen not in QUIZ_TYPES:  # 兜底，保证永远落在合法集合里
        chosen = inferred
    if str(raw or "").strip() != chosen:
        record.append(
            {
                "number": number,
                "field": "questionType",
                "before": str(raw or "（未给）")[:20],
                "after": chosen,
            }
        )
    return chosen


def normalize_question(raw: dict, page: int, record: list[dict] | None = None) -> dict | None:
    """把模型给的一道题归一化。**只对"根本不是对象"的条目返回 None**。

    以前"题干为空"就整题丢掉，但截断的题（页底被切断、JSON 被 max_tokens 切掉）正是这种形态 ——
    用户要求**保留**：留在这里、标 needs_review，让 S4/S5 与人工能看到，而不是静默消失。

    `record` 收集"确定性纠正"（answerKey / questionType 被规范化成什么样），
    写进 merge.json 的 `normalized[]` 供 S4 的 report.md 汇总；**纯格式化不算不确定**，不因此标 needs_review。
    """
    record = record if record is not None else []
    if not isinstance(raw, dict):
        return None
    stem = str(raw.get("stem") or "").strip()
    options = []
    for option in raw.get("options") or []:
        if isinstance(option, dict):
            key = (
                str(option.get("key") or "")
                .strip()
                .translate(_FULLWIDTH)
                .upper()[:1]
            )
            text = str(option.get("text") or "").strip()
            if key:
                options.append({"key": key, "text": text})
    number_raw = raw.get("number")
    try:
        number = int(number_raw)
    except (TypeError, ValueError):
        number = None
    answer_key, judgement_text, key_needs_review = normalize_answer_key(
        raw.get("answerKey"), options, record, number
    )
    answer_text = str(raw.get("answerText") or "").strip() or judgement_text
    if len(answer_key) > 1 and not answer_text:
        # 多选：把各选项文本拼起来 —— md 的答案行要求"答案后面至少有一个字符"
        answer_text = "、".join(o["text"] for o in options if o["key"] in answer_key) or answer_key
    question_type = normalize_question_type(
        raw.get("questionType"),
        options,
        answer_key,
        record,
        number,
        section=f"{raw.get('group') or ''} {raw.get('groupTitle') or ''}",
    )
    confidence = str(raw.get("confidence") or "medium").strip().lower()
    needs_review = bool(raw.get("needs_review")) or confidence != "high" or key_needs_review
    # 答案里有字母不在选项里 → 一定是把握不足，交给人工复核
    if options and answer_key and not all(ch in {o["key"] for o in options} for ch in answer_key):
        needs_review = True
    # 题干为空 = 多半是截断；保留但必须复核
    if not stem:
        needs_review = True
    return {
        "number": number,
        "group": str(raw.get("group") or "").strip(),
        "groupTitle": str(raw.get("groupTitle") or "").strip(),
        "stem": stem,
        "options": options,
        "answerKey": answer_key,
        "answerText": answer_text,
        "explanation": str(raw.get("explanation") or "").strip(),
        "explanationSource": explanation_source(raw),
        "translation": str(raw.get("translation") or "").strip(),
        "questionType": question_type,
        "confidence": confidence,
        "needs_review": needs_review,
        "continued": bool(raw.get("continued")),
        "source": {"page": page},
    }


def _info_score(q: dict) -> int:
    """信息量打分：判重时保留更全的那份。"""
    return (
        len(q.get("options") or []) * 2
        + (2 if str(q.get("answerKey") or "").strip() else 0)
        + (1 if str(q.get("explanation") or "").strip() else 0)
        + (1 if str(q.get("answerText") or "").strip() else 0)
    )


# 页内判重（用户要求：遇到疑似相同的题**直接删去**）
DUP_STEM_MIN = 10  # 题干太短（匹配题的占位符 `(30) の選択肢：`）不参与判重
DUP_OPTION_MIN = 2  # 至少两个选项才判重（填空/判断不给选项，不能靠文本判）


def norm_for_dup(text) -> str:
    """判重用的归一化：去空白与标点、转小写。"""
    flat = " ".join(str(text or "").split()).lower()
    return re.sub(r"[\s\W_]+", "", flat, flags=re.UNICODE)


def dup_key(q: dict) -> str | None:
    """判重用的"题干指纹"：归一化题干；下面两种情况返回 None（**不参与判重**）：

    * 题干太短（匹配题占位符 `(30) の選択肢：`）—— 不同小题的题干本来就一样；
    * 题干是"这一页没有题干"的占位（参考答案页 `（本页未印题干，仅有答案）`）——
      那一页每一行都长这样，参与判重会把 23 条答案删到只剩 1 条（实测踩过）。
    """
    stem = norm_for_dup(q.get("stem"))
    if c.is_placeholder_stem(q.get("stem")):
        return None
    return stem if len(stem) >= DUP_STEM_MIN else None


def _options_set(q: dict) -> tuple:
    return tuple(sorted(norm_for_dup(o.get("text")) for o in q.get("options") or []))


def dedupe_questions(
    questions: list[dict], flagged: list[dict] | None = None
) -> tuple[list[dict], list[dict]]:
    """页内判重：**疑似相同的题直接删掉**（保留信息更全的那一份）。

    判据：**题干（归一化后）完全相同**，且选项"相同 or 有一方没给"。
    为什么要求题干够长（≥10 字）：匹配题的小题题干常常是 `(30) の選択肢：` 这类占位符，
    不同小题的题干会一模一样 —— 不设门槛会把真题删掉。
    为什么选项两边都有且不同就不算重复：那是"同题干不同小问"，是真题。
    为什么"没有题干"的占位行直接不参与：参考答案页每一行都是同一句占位（见 `dup_key`）。

    返回 (保留的题, 删除记录)。删除记录写进 merge.json 的 `deduped[]`，由 S4/report.md 汇总；
    **不**因此把整页标 needs_review（用户要求"直接删去"）。

    注意：这里**只删、不改题号**。"删掉后面题号整体前移"是跨页操作，只有 S4 看得到全卷。
    """
    kept: list[dict] = []
    by_stem: dict[str, dict] = {}
    removed: list[dict] = []
    for q in questions:
        stem = dup_key(q)
        if stem is None:
            kept.append(q)
            continue
        incumbent = by_stem.get(stem)
        if incumbent is None:
            by_stem[stem] = q
            kept.append(q)
            continue
        mine, theirs = _options_set(q), _options_set(incumbent)
        if mine and theirs and mine != theirs:
            kept.append(q)  # 同题干、不同选项 → 两道不同的题，都留
            continue
        # **题号不同就不许删**：卷面重号（同一题印两遍）时两条例的题号是**一样**的；
        # 题号不同却"题干完全相同"，多半是 OCR 把重号顺手重编了（实测：卷面把「7.」印了两遍，
        # 两路都读成 7、8 再跳到 9 —— 卷面真正的第 8 题因此消失）。这种情况两条都留 + 标待复核，
        # 让人看见，而不是静默删掉一道真题。
        if q.get("number") != incumbent.get("number"):
            kept.append(q)
            if flagged is not None:
                flagged.append(
                    {
                        "number": q.get("number"),
                        "keptNumber": incumbent.get("number"),
                        "stem": str(q.get("stem") or "")[:60],
                        "reason": "题号不同但题干完全相同 —— 疑似卷面重号 / OCR 重编号，两道都保留待核对",
                    }
                )
            continue
        winner, loser = (q, incumbent) if _info_score(q) > _info_score(incumbent) else (incumbent, q)
        removed.append(
            {
                "number": loser.get("number"),
                "keptNumber": winner.get("number"),
                "stem": str(loser.get("stem") or "")[:60],
                "reason": "题干与选项完全相同（判为重复，已删除）"
                if mine and theirs
                else "题干相同且选项有一方缺失（判为同一题的残缺副本，已删除）",
            }
        )
        if winner is q:
            kept[kept.index(incumbent)] = q
            by_stem[stem] = q
    return kept, removed


def normalize_merge(
    raw: dict,
    page: int,
    cfg: dict,
    elapsed_ms: int,
    usage,
    notes: list[str],
    call_meta: dict | None = None,
) -> dict:
    conflicts = []
    for item in raw.get("conflicts") or []:
        if not isinstance(item, dict):
            continue
        try:
            question = int(item.get("question")) if item.get("question") is not None else None
        except (TypeError, ValueError):
            question = None
        conflicts.append(
            {
                "question": question,
                "field": str(item.get("field") or "").strip(),
                "a": str(item.get("a") or "").strip(),
                "b": str(item.get("b") or "").strip(),
                "chosen": str(item.get("chosen") or "").strip(),
                "reason": str(item.get("reason") or "").strip(),
                "confidence": str(item.get("confidence") or "medium").strip().lower(),
            }
        )
    record: list[dict] = []
    flagged: list[dict] = []
    questions = [
        q
        for q in (normalize_question(item, page, record) for item in raw.get("questions") or [])
        if q
    ]
    questions, deduped = dedupe_questions(questions, flagged)
    identity = raw.get("paper_identity") if isinstance(raw.get("paper_identity"), dict) else {}
    return {
        "page": page,
        "paper_identity": {
            "title": str(identity.get("title") or ""),
            "date": str(identity.get("date") or ""),
            "variant": str(identity.get("variant") or ""),
        },
        "page_condition": str(raw.get("page_condition") or "").strip(),
        "conflicts": conflicts,
        "questions": questions,
        "deduped": deduped,
        "flagged": flagged,
        "normalized": record,
        "notes": notes,
        "needs_review": bool(notes) or bool(conflicts) or any(q["needs_review"] for q in questions),
        "call": {
            "model": cfg.get("model"),
            "endpoint": cfg.get("base_url"),
            "elapsed_ms": elapsed_ms,
            "usage": usage if isinstance(usage, dict) else {},
            **(call_meta or {}),
        },
    }


# ── 单页调用 ────────────────────────────────────────────────────────────
def merge_one_page(
    cfg: dict,
    page: int,
    reviews: dict[str, dict],
    index: int,
    total: int,
    timeout: int,
    max_retries: int,
    max_tokens: int,
) -> dict:
    stage = c.STAGES[3]
    payload = build_payload(cfg.get("model"), page, reviews, max_tokens)
    notes: list[str] = []
    if len(reviews) < 2:
        missing = "B" if "a" in reviews else "A"
        notes.append(f"缺少 OCR 路 {missing} 的结果，无法互校，整页标为待复核")
    last_error = ""

    for attempt in range(1, max_retries + 1):
        started = time.perf_counter()
        attempt_payload = (
            payload
            if attempt == 1
            else build_payload(cfg.get("model"), page, reviews, max_tokens, RETRY_NOTE)
        )
        try:
            response = c.post_json(
                str(cfg["base_url"]), attempt_payload, cfg.get("api_key"), timeout=timeout
            )
            text, text_field = c.response_text_ex(response)
            finish_reason = c.response_finish_reason(response)
            try:
                raw, repair = c.extract_json(text)
            except c.ApiError as exc:  # 补上"为什么取不到 JSON"，否则排查要绕好几圈
                raise c.ApiError(
                    f"{exc}{c.reasoning_hint(text_field, finish_reason, max_tokens, 'merge')}",
                    retryable=exc.retryable,
                ) from exc
            if finish_reason == "length":
                repair = {**repair, "truncated": True}
            # **返回值格式不对就重跑**（用户要求）：应答里连一个 schema 键都没有
            # → 这页等于白跑，抛可重试错误交给本函数的重试循环（默认 2 次重试）。
            if not any(key in raw for key in MERGE_SCHEMA_KEYS):
                raise c.ApiError(
                    "返回值格式不对：里面没有任何 schema 字段"
                    f"（{', '.join(MERGE_SCHEMA_KEYS)}），将重试；实际键={list(raw)[:6]}",
                    retryable=True,
                )
            if repair.get("truncated"):
                notes.append(f"模型回复疑似被截断（finish_reason={finish_reason or '?'}），已尽力补全")
            if len(reviews) == 2:
                extra = structural_diffs(reviews["a"], reviews["b"])
                # 模型自己可能已经报过同一个字段，别再补一条重复 conflict
                # （2026-09-22 实测：page 1 的 paper_identity.date 被报了两遍）
                reported = {
                    str(cf.get("field") or "")
                    for cf in (raw.get("conflicts") or [])
                    if isinstance(cf, dict)
                }
                extra = [cf for cf in extra if str(cf.get("field") or "") not in reported]
                if extra:
                    raw = dict(raw)
                    raw["conflicts"] = list(raw.get("conflicts") or []) + extra
                    notes.append(f"确定性比对另发现 {len(extra)} 处两路不一致")
            merged = normalize_merge(
                raw,
                page,
                cfg,
                c.human_ms(started),
                response.get("usage"),
                notes,
                {
                    "finish_reason": finish_reason,
                    "json_repaired": repair.get("repaired", False),
                    "json_truncated": repair.get("truncated", False),
                },
            )
            # 题号覆盖 / 题数匹配兜底：与"两路 OCR 自己声明的题号范围"对账
            coverage = coverage_diffs(reviews, merged.get("questions") or [])
            if coverage:
                merged["conflicts"] = list(merged.get("conflicts") or []) + coverage
                notes.append(f"题号覆盖核对发现 {len(coverage)} 处不一致")
                merged["notes"] = notes
                merged["needs_review"] = True
            return merged
        except c.ApiError as exc:
            last_error = str(exc)
            if not exc.retryable:
                raise
        if attempt < max_retries:
            c.retry_line(stage, index, total, attempt, max_retries, last_error, c.human_ms(started))
            if attempt == 1 and c.is_timeout(last_error):
                c.always(c.timeout_hint())
            time.sleep(min(2**attempt, 10))

    raise c.ApiError(f"重试 {max_retries} 次仍失败：{last_error}", retryable=False)


# ── 入口 ────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(
        description="S3：两路 OCR → 比对 + 题目提取 → page-00N.merge.json（docs §7.2）"
    )
    parser.add_argument("--category", required=True, help="分类名（= pdf-ocr/work/ 下的目录名）")
    parser.add_argument(
        "--pages",
        help="只处理这些页，如 1-3,7（页码从 1 开始；写 0-3 也接受，0 视为起点；默认全部）",
    )
    parser.add_argument("--timeout", type=int, default=180, help="单次请求超时秒数，默认 180")
    parser.add_argument("--max-retries", type=int, default=3, help="每页最大尝试次数，默认 3")
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=c.DEFAULT_MAX_TOKENS["merge"],
        help=(
            f"单次响应 token 上限，默认 {c.DEFAULT_MAX_TOKENS['merge']}"
            f"（= DeepSeek 端点合法上限 {c.MAX_TOKENS_CEILING['merge']}，出参是整份题目 JSON）"
        ),
    )
    parser.add_argument(
        "--budget-tokens",
        type=int,
        default=0,
        help="本次运行的 token 预算（0=不限）；每次调用前检查，超了就停在当前页（退出码 4）",
    )
    parser.add_argument(
        "--total-budget-tokens",
        type=int,
        default=0,
        help="跨运行累计 token 上限（0=不限，基于 manifest 里已记录的 usage）；已超则拒绝开工（退出码 4）",
    )
    parser.add_argument("--force", action="store_true", help="已存在的结果也重跑")
    parser.add_argument("--quiet", action="store_true", help="只打印每页完成行与最终摘要")
    args = parser.parse_args()

    c.setup_stdio()
    c.set_quiet(args.quiet)
    c.check_max_tokens("merge", args.max_tokens)

    category = c.safe_name(args.category)
    work_dir = c.WORK_ROOT / category
    manifest_path = work_dir / "source-manifest.json"
    if not manifest_path.exists():
        c.fail(f"找不到 {manifest_path.relative_to(c.REPO_ROOT)}；请先跑 S1", 1)

    cfg = c.merge_config()
    if not cfg.get("api_key"):
        c.fail(
            "缺少 DEEPSEEK_API_KEY：请在仓库根 .env 里填 DEEPSEEK_API_KEY（可选 DEEPSEEK_BASE_URL/DEEPSEEK_MODEL）",
            1,
        )

    manifest = c.read_json(manifest_path)
    document = (manifest.get("documents") or [{}])[0]
    rendered = [int(n) for n in document.get("rendered_pages", [])]
    if not rendered:
        c.fail(f"{manifest_path.name} 里没有 rendered_pages；请先跑 S1", 1)
    pages = c.parse_pages(args.pages, max(rendered)) if args.pages else rendered
    pages = [n for n in pages if n in set(rendered)]

    pages_dir = work_dir / "pages"
    c.info(
        f"[配置] 分类名={category}  页数={len(pages)}  模型={cfg.get('model')}  端点={cfg.get('base_url')}"
    )

    started_all = time.perf_counter()
    errors: list[str] = []
    done = 0
    total_questions = 0
    total_conflicts = 0
    total_generated = 0
    spent = 0
    calls_made = 0
    budget_hit = False

    prior = c.usage_block(manifest)
    if args.total_budget_tokens > 0 and int(prior.get("tokens", 0)) >= args.total_budget_tokens:
        c.fail(
            f"跨运行预算已用尽：{manifest_path.name} 里累计 {prior.get('tokens')} token ≥ "
            f"--total-budget-tokens {args.total_budget_tokens}；要重新开始请调大预算或删掉该 usage 记录",
            4,
        )

    for index, number in enumerate(pages, start=1):
        target = pages_dir / f"page-{number:03d}.merge.json"
        reviews: dict[str, dict] = {}
        for label in ("a", "b"):
            path = pages_dir / f"page-{number:03d}.{label}.review.json"
            if path.exists():
                reviews[label] = c.read_json(path)

        if not reviews:
            errors.append(f"page {number}: 两路 review.json 都不存在（先跑 S2）")
            c.progress(c.STAGES[3], index, len(pages), "✗", 0, "缺两路 OCR 结果")
            c.page_done(index, len(pages), ["比对提取 ✗"])
            continue

        if target.exists() and not args.force:
            existing = c.read_json(target)
            total_questions += len(existing.get("questions") or [])
            total_conflicts += len(existing.get("conflicts") or [])
            done += 1
            c.progress(
                c.STAGES[3], index, len(pages), "✓", 0, f"{target.name} 已存在，跳过"
            )
            c.page_done(index, len(pages), ["比对提取 ✓（已存在）"])
            continue

        # 预算检查放在**每页调用之前**
        if c.budget_stop(spent, args.budget_tokens):
            budget_hit = True
            c.warn(
                f"本次预算已用尽（{c.human_tokens(spent)} ≥ {c.human_tokens(args.budget_tokens)} token），"
                f"在第 {number} 页停下；已完成的结果都已落盘，可稍后续跑"
            )
            break

        page_started = time.perf_counter()
        try:
            merge = merge_one_page(
                cfg, number, reviews, index, len(pages), args.timeout, args.max_retries, args.max_tokens
            )
            calls_made += 1
            spent += c.usage_tokens(merge["call"].get("usage"))
            c.write_json_atomic(target, merge)
            question_count = len(merge["questions"])
            conflict_count = len(merge["conflicts"])
            generated_count = sum(
                1 for q in merge["questions"] if q.get("explanationSource") == "generated"
            )
            deduped_count = len(merge.get("deduped") or [])
            normalized_count = len(merge.get("normalized") or [])
            total_questions += question_count
            total_conflicts += conflict_count
            total_generated += generated_count
            done += 1
            status = "⚠" if merge["needs_review"] else "✓"
            c.progress(
                c.STAGES[3],
                index,
                len(pages),
                status,
                merge["call"]["elapsed_ms"],
                f"提取 {question_count} 题（冲突 {conflict_count}"
                + (f"，生成解析 {generated_count}" if generated_count else "")
                + (f"，判重删 {deduped_count}" if deduped_count else "")
                + (f"，格式化 {normalized_count}" if normalized_count else "")
                + "）",
            )
            c.page_done(
                index,
                len(pages),
                [f"比对提取 {status}"],
                total_questions,
                usage_note=f"本次累计 {c.human_tokens(spent)} tok",
            )
        except c.ApiError as exc:
            errors.append(f"page {number}: {exc}")
            c.progress(c.STAGES[3], index, len(pages), "✗", c.human_ms(page_started), str(exc)[:80])
            c.page_done(index, len(pages), ["比对提取 ✗"])

    merge_done = sorted(
        n for n in pages if (pages_dir / f"page-{n:03d}.merge.json").exists()
    )
    document["merge_pages"] = merge_done
    manifest["documents"] = [document] + list(manifest.get("documents", [])[1:])
    manifest["errors"] = manifest.get("errors", []) + errors
    manifest["updated_at"] = c.now_iso()
    usage = c.add_usage(manifest, calls=calls_made, tokens=spent)
    c.write_json_atomic(manifest_path, manifest)

    c.stage_done(c.STAGES[3], done, len(pages), c.human_ms(started_all))
    c.always(
        f"[完成] 比对提取 {len(merge_done)}/{len(pages)} 页 | 累计题数 {total_questions} | "
        f"冲突 {total_conflicts} | AI 生成解析 {total_generated} 题"
    )
    c.always(
        f"[用量] 本次调用 {calls_made} 次 / {c.human_tokens(spent)} tok；"
        f"该分类累计 {usage['calls']} 次 / {c.human_tokens(int(usage['tokens']))} tok"
    )
    c.always(f"[清单] {manifest_path.relative_to(c.REPO_ROOT)}")
    if budget_hit:
        return 4
    if errors:
        c.warn(f"有 {len(errors)} 页失败：{'; '.join(errors[:3])}")
        return 3
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(
            "\n[中断] 收到 Ctrl+C。已完成的产物都在 pdf-ocr/work/ 里，"
            "重跑同一条命令会自动续跑（已存在的页会跳过，不会重复计费）",
            flush=True,
        )
        sys.exit(130)
