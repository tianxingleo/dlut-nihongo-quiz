"""S4：把每页 merge.json 拼成一份可直接入库的 markdown（工作流第 4 步，**纯本地、不调 API**）。

用法：
  python pdf-ocr/4_build_md.py --category <分类名> [--pages 1-4] [--force] [--quiet]

输入：pdf-ocr/work/<分类名>/pages/page-00N.merge.json（S3 产物）
输出：
  * data/raw/<分类名>/<分类名>.md          ← 唯一最终产物（单文件，不分批）
  * pdf-ocr/work/<分类名>/transcription.md ← 每页转写汇总（人工复核用）
  * pdf-ocr/work/<分类名>/report.md        ← 待人工复核清单

做的事（docs/pdf-ocr-pipeline.md §8）：
  1. **题组归一化**：merge.json 的 group 字段实测很杂（'一、数值转换题' / '二' / '六、题组二' / ''），
     统一成"中文题组号 + 标题"；模型漏填的按"沿用上一题题组"补（跨页续题必然漏填）。
  2. **判断题补选项**：卷面自己写着「正确的选A，错误的选B」，但 OCR 抽出来 options=[]；
     不补的话解析端 :349 会把整题**静默丢弃**。补的内容直接来自卷面声明，不算编造。
  3. **公共题干复制到每道小题**（§8.4）：题组导言（含代码块/表格）会**复制**进该题组每一道小题的
     `#### 题目` 上方，让每个小问独立成题（单看任意一题都不缺上下文）。
  4. **跨页断题拼接**（§8.2 三步）。
  5. **全局按题号排序 + 去重**（§8.1）。
  6. **渲染 md**（§8.3）并复查字段完整性（题干非空 / 选项≥2 / 有答案），不满足只标 needs_review，**不丢题**。

退出码：0 成功；1 参数/环境错误；3 有页缺 S3 产物（已产出的部分照常写盘，可续跑）。
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as c  # noqa: E402

CN_NUMERALS = "一二三四五六七八九十"
CN_RE = re.compile(r"([一二三四五六七八九十])")
# 解析端 CHINESE_NUM_MAP 只认「一…十」单个字，超过 10 个题组无法表达
MAX_GROUPS = len(CN_NUMERALS)

STAGE = c.STAGES[4]


# ── 小工具 ──────────────────────────────────────────────────────────────
def flatten(text) -> str:
    """压成一行。

    解析端本来就会把多行题干用空格拼起来（`parse-japanese-2024-markdown.ts:296`），
    压成一行既等价、又能避免"题干里某行以 `A.` 开头被误判成选项"。
    """
    return " ".join(str(text or "").split())


def sanitize(text) -> str:
    """去掉可能把题块切碎的行内 heading 记号（`#### ` / `### 第N题`），并压成一行。"""
    flat = flatten(text)
    return re.sub(r"#{2,}", "", flat).strip()


OPTION_LIKE = re.compile(r"^[A-Da-d][\.\s、]")


def sanitize_block(text) -> str:
    """题干清洗（**保留换行**）：公共题干里常有代码块/表格，压成一行就没法渲染了。

    两个必须处理的坑：
      * 行首 `#` 会被解析端跳过（`:289`）→ 去掉行首的井号；
      * 行首 `A.` 这种会被解析端**当成选项**、还会把它后面的题干整段丢掉（`:277-297`）
        → 前面加个 HTML 注释挡一下（渲染时不可见）。
    """
    lines: list[str] = []
    for raw in str(text or "").split("\n"):
        line = raw.rstrip()
        stripped = line.strip()
        if stripped.startswith("#"):
            line = re.sub(r"^\s*#+\s*", "", line)
            stripped = line.strip()
        if OPTION_LIKE.match(stripped):
            line = f"<!-- -->{line}"
        lines.append(line)
    return "\n".join(lines).strip()


def norm_stem(text) -> str:
    """去重键用的归一化题干：去空白/标点/大小写（思路同 parse-history-markdown.ts）。"""
    flat = flatten(text).lower()
    return re.sub(r"[\s\W_]+", "", flat, flags=re.UNICODE)


def option_text(q: dict, key: str) -> str:
    for item in q.get("options") or []:
        if str(item.get("key") or "").strip().upper() == key:
            return flatten(item.get("text"))
    return ""


def info_score(q: dict) -> int:
    """判断"哪一份信息更全"，用于去重时保留更好的那份。"""
    return (
        len(q.get("options") or []) * 2
        + (2 if flatten(q.get("answerKey")) else 0)
        + (1 if flatten(q.get("answerText")) else 0)
        + (1 if flatten(q.get("explanation")) else 0)
        + (1 if flatten(q.get("translation")) else 0)
    )


# ── 1) 题组归一化 ───────────────────────────────────────────────────────
# groupTitle 里出现这些字样 / 长度超标 / 带代码围栏 → 它其实是"整段公共题干"而不是题组名
PASSAGE_TITLE_LIMIT = 40
PASSAGE_HINT = re.compile(r"以下|次の|空欄|答えよ|コード|配列|プログラム|文章|表を|問に|ソース")
CODE_FENCE = re.compile(r"```")
CN_PREFIX = re.compile(r"^\s*[一二三四五六七八九十]+\s*[、.．]\s*")
# `六、题组二` 这种"行首就是题组号"的写法（优先采信）
SECTION_PREFIX = re.compile(r"^\s*([一二三四五六七八九十]+)\s*[、.．]")
# `二` 这种光秃秃只有一个号码的写法
BARE_NUMERAL = re.compile(r"^\s*([一二三四五六七八九十]+)\s*$")
# 整页转写里的题组标题行：`六、题组二`
SECTION_LINE = re.compile(r"^\s*([一二三四五六七八九十]+)\s*[、.．]\s*(.+?)\s*$")


def looks_like_passage(text) -> bool:
    """这段文字像"公共题干"而不是"题组名"吗？"""
    raw = str(text or "")
    if len(flatten(raw)) > PASSAGE_TITLE_LIMIT:
        return True
    if CODE_FENCE.search(raw):
        return True
    return bool(PASSAGE_HINT.search(raw))


def title_from_group_field(raw) -> str:
    """从 `group` 字段里剥出真正的题组名：`'六、题组二'` → `'题组二'`、`'一、数值转换题'` → `'数值转换题'`。"""
    return CN_PREFIX.sub("", str(raw or "")).strip()


def transcription_section(pages_dir: Path, page: int, title: str) -> str:
    """在整页转写里找 `X、<title>` 形式的题组标题，返回它的中文题组号。

    为什么需要它：模型给 `group` 的写法不稳定 —— 实测同一页两次运行分别给出
    `'六、题组二'` 和 `'题组二'`。后者如果按"取第一个中文数字"就会被当成**题组二**，
    于是第 36/37 题会被并进前面真正的题组二里。转写里的 `六、题组二` 才是权威。
    """
    wanted = flatten(title)
    if not wanted:
        return ""
    for label in ("a", "b"):
        path = pages_dir / f"page-{page:03d}.{label}.review.json"
        if not path.exists():
            continue
        for line in str(c.read_json(path).get("transcription_md") or "").split("\n"):
            match = SECTION_LINE.match(line)
            if not match:
                continue
            head = flatten(match.group(2))
            if head == wanted or head.startswith(wanted) or wanted.startswith(head):
                return match.group(1)
    return ""


def resolve_numeral(
    raw: str, title: str, page: int, pages_dir: Path, report: dict
) -> str:
    """从 `group`/`groupTitle` 里定出题组号（按可靠性从高到低）。"""
    match = SECTION_PREFIX.match(raw)
    if match:
        return match.group(1)
    match = BARE_NUMERAL.match(raw)
    if match:
        return match.group(1)
    for candidate in (title, title_from_group_field(raw)):
        hit = transcription_section(pages_dir, page, candidate)
        if hit:
            return hit
    if raw or title:
        report["unresolved_groups"].append((page, raw[:20], title[:20]))
    return ""


def normalize_groups(entries: list[dict], pages_dir: Path, report: dict) -> list[str]:
    """给每题补 `numeral` / `group_title`，返回题组出现顺序。"""
    order: list[str] = []
    titles: dict[str, str] = {}
    current_num = ""
    current_title = ""

    for entry in entries:
        q = entry["q"]
        raw = str(q.get("group") or "").strip()
        title = str(q.get("groupTitle") or "").strip()
        numeral = resolve_numeral(raw, title, entry["page"], pages_dir, report)

        # 标题兜底：为空、或明显是"整段公共题干"时，改从 group 字段里取真正的题组名
        fallback = title_from_group_field(raw) or (f"题组{numeral}" if numeral else "")
        if looks_like_passage(title):
            entry["passage_candidate"] = title
            report["passage_in_title"].append((numeral or "?", len(flatten(title))))
            title = fallback
        elif not title:
            title = fallback

        if numeral:
            if numeral != current_num:
                current_num = numeral
                current_title = title or f"题组{numeral}"
                if numeral in titles and titles[numeral] != current_title:
                    report["group_title_conflicts"].append((numeral, titles[numeral], current_title))
                elif numeral not in titles:
                    titles[numeral] = current_title
                    order.append(numeral)
            elif title and title != current_title:
                # 同一个题组号出现了两个标题：以**第一次**看到的为准，记一笔
                report["group_title_conflicts"].append((numeral, current_title, title))
        elif not current_num:
            # 整份卷子一个题组号都没有 → 兜一个，别让题组标题缺失
            current_num, current_title = "一", title or "全部题目"
            order.append(current_num)
            titles[current_num] = current_title
            report["notes"].append("全卷没有中文题组号，已统一并入「题组一」")

        entry["numeral"] = current_num
        entry["group_title"] = titles.get(current_num, current_title)

    report["groups"] = [(n, titles.get(n, "")) for n in order]
    return order


# ── 2) 判断题补选项 ─────────────────────────────────────────────────────
JUDGE_HINT = re.compile(r"判断|正误|对错|辨析|○×|○|×|√")
JUDGE_OPTIONS = [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]
# 卷面把答案印在题干末尾时（`…である。 ( B )`），OCR 会把它一起抄进题干
TRAILING_ANSWER = re.compile(r"\s*[（(]\s*([A-Da-d])\s*[）)]\s*$")
# AI 生成解析的可见标记（P6 靠这一行判 `answerProvenance: 'generated'`）
GENERATED_NOTE = "> ⚙ 解析由 AI 生成（未经人工核对）"


def strip_trailing_answer_mark(entries: list[dict], report: dict) -> None:
    """题干末尾的 `（X）` 若与答案一致，就是卷面答案标记，不是题干内容 → 去掉。

    实测 39 题里有 3 题（第 22/23/24 判断题）带着它；只在**字母与答案完全一致**时才删，
    避免把题干里正常的括号（如填空的 `（　）`）误删。
    """
    for entry in entries:
        q = entry["q"]
        key = flatten(q.get("answerKey")).upper()
        stem = flatten(q.get("stem"))
        if not key or not stem:
            continue
        match = TRAILING_ANSWER.search(stem)
        if match and match.group(1).upper() == key:
            q["stem"] = stem[: match.start()].rstrip()
            report["answer_mark_stripped"].append((entry["page"], q.get("number")))


def fill_judgement_options(entries: list[dict], report: dict) -> None:
    """无选项 + 答案是 A/B（或答案文本就是 √/×/正确/错误）→ 补「A. 正确 / B. 错误」。

    只在**能看出是判断题**时才补：题组标题里出现「判断/辨析」等字样，或题目自带 judgement 类型。
    补不出来的一律原样保留（后面完整性复查会把它标成"会被 parser 丢弃"）。
    """
    for entry in entries:
        q = entry["q"]
        if q.get("options"):
            continue
        key = flatten(q.get("answerKey")).upper()
        if not key:
            # 答案写在 answerText 里的判断题（S3 把 `√`/`×` 转成了文本，见 normalize_answer_key）
            key = judgement_letter(flatten(q.get("answerText")))
        if key not in ("A", "B"):
            continue
        hint = " ".join(
            [
                str(entry.get("group_title") or ""),
                str(q.get("groupTitle") or ""),  # 题组标题按"首次出现"锁定，后来那句更具体的也要看
                str(q.get("questionType") or ""),
                flatten(q.get("stem")),
            ]
        )
        if not JUDGE_HINT.search(hint):
            continue
        q["options"] = [dict(o) for o in JUDGE_OPTIONS]
        q["questionType"] = "judgement"
        # 答案原先只写在 answerText 里（√/× → 正确/错误）→ 补上字母答案。
        # 解析端要求"判断题的答案必须指到一个存在的选项"，只有文本没有字母会被判字段不完整。
        q["answerKey"] = key
        # 选项刚被换成「正确/错误」，旧的 answerText（模型常直接填 A/B）已经没意义了 —— 必须重算，
        # 否则会渲染成 `**正确答案：A A**`（实测踩过）
        q["answerText"] = option_text(q, key)
        report["judgement_filled"].append((entry["page"], q.get("number")))


def normalize_answer_text(entries: list[dict], report: dict) -> None:
    """单选题：`answerText` 必须等于所选选项的原文。

    解析端存库时用的是 `answerText || 所选选项文本`（`:359`），所以一个**非空但不对**的
    answerText 会被原样带进题库；`parse-computer-banks.mjs:79` 也断言 `answerText === option.text`。
    """
    for entry in entries:
        q = entry["q"]
        key = flatten(q.get("answerKey")).upper()
        options = q.get("options") or []
        if len(key) != 1 or len(options) < 2:
            continue
        text = option_text(q, key)
        if text and flatten(q.get("answerText")) != text:
            report["answer_text_fixed"].append(
                (entry["page"], q.get("number"), flatten(q.get("answerText"))[:20], text[:20])
            )
            q["answerText"] = text


# ── 2.5) 参考答案 / 评分标准页 → 答案表 ────────────────────────────────
# 实测（Principles-of-Marxism）：答案单独印在最后一页「试卷评分标准」上，前面的题目页
# 一个答案都没有 —— 模型把那一页抄成了 23 条"题干为空、只有答案"的伪题目。
# 以前这些伪题目被当成真题输出（站上一堆空题干 + 裸答案），而**真正的题目反而 37 道缺答案**。
ANSWER_KEY_PAGE = re.compile(r"评分标准|参考答案|标准答案|答案及评分|评分细则|评分说明")


def is_answer_key_page(page_data: dict) -> bool:
    """这一页是不是"参考答案 / 评分标准"页？

    三个信号（满足其一即算）：
      1. `paper_identity.title` 里写着 评分标准 / 参考答案 之类；
      2. 该页提出的题**题干是空的或只是占位**（"（本页未印题干，仅有答案）"），
         且至少 3 道题带着 answerKey —— 模型把答案逐条抄了下来、题干留空；
      3. 由 `transcription_answer_pages()` 从**转写**里判出来（在 main 里合并判断）。
    """
    title = str((page_data.get("paper_identity") or {}).get("title") or "")
    if ANSWER_KEY_PAGE.search(title):
        return True
    questions = page_data.get("questions") or []
    if len(questions) < 3:
        return False
    empty_stem = sum(1 for q in questions if is_placeholder_stem(q.get("stem")))
    with_key = sum(1 for q in questions if str(q.get("answerKey") or "").strip())
    return empty_stem == len(questions) and with_key >= 3


def _bucket_name(text) -> str:
    """把**一个大题标题**压成"大题名"：去题组前缀、序号、分值说明，只留名字。

    必须是**逐段**压再合并：答案页那一行的 `group` 和 `groupTitle` 常常一模一样
    （都是「四、论述题」），拼起来压平就成了「论述题论述题」，与题目侧（`group='四'`、
    `groupTitle='论述题'`）压出来的「论述题」永远对不上 —— 实测 marxism-5/7 的评分标准
    「收下 13 条 → 贴回 0 道」，主观题全被判缺答案、卡在 S5 的 1/5 门限上拒发。
    """
    flat = c.squash_text(re.sub(r"题组\s*[一二三四五六七八九十\d]+", " ", str(text or "")))
    flat = re.sub(r"^第?[一二三四五六七八九十百\d]+(大题|部分|题)?", "", flat)
    flat = re.sub(r"^(本大题|该大题|本题|每题)", "", flat)
    # 分值/评分说明挂在标题后面的情况：「案例分析题共10分要求给三次小分」（squash 后括号已去掉）
    flat = re.sub(r"共\d+分.*$", "", flat)
    flat = re.sub(r"每题\d+分.*$", "", flat)
    flat = re.sub(r"要求给.*$", "", flat)
    return flat.strip()


def section_bucket(*parts) -> str:
    """把 `题组一 一、单项选择题` / `二、多项选择题` 归一到同一个"大题"键。

    * 客观题（单选/多选/判断）：直接用**题型**当键 —— 同一道大题在不同页可能写成
      「一、单项选择题」或「单项选择题」，按题型归并才配得上；
    * 主观题（论述/辨析/案例/思考/填空…）：**必须用大题名**。
      只按 `fill` 分桶会把「三、论述题」「四、辨析题」「五、案例分析题」混成一桶，
      答案就会贴到别的大题上（实测踩过：论述题拿到了案例分析第 3 题的标准）。
    """
    text = " ".join(str(part or "") for part in parts)
    quiz_type = c.question_type_from_section(text)
    if quiz_type and quiz_type != "fill":
        return quiz_type
    names = [name for name in (_bucket_name(part) for part in parts) if name]
    if not names:
        return ""
    # 先挑"看起来就是大题名"的那一份：`group='案例分析题'` / `groupTitle='引力波：广义相对论的最后一块“拼图”'`
    # 这种组合很常见（OCR 把文章标题填进了 groupTitle），取最长的那个就会串桶 → 答案/标准全贴不上。
    typed = [name for name in names if BUCKET_KEYWORD.search(name)]
    pool = typed or names
    # 同义重复（「案例分析题」/「案例分析题共10分…」）→ 取最短的那份，只要它是别人的子串
    shortest = min(pool, key=len)
    if all(shortest in name for name in pool):
        return shortest
    return max(pool, key=len)


def harvest_answer_table(page_data: dict) -> dict[tuple[str, int], str]:
    """从答案页的"伪题目"里抽出 {(大题键, 题号): 答案}。"""
    table: dict[tuple[str, int], str] = {}
    for raw in page_data.get("questions") or []:
        try:
            number = int(raw.get("number"))
        except (TypeError, ValueError):
            continue
        key = re.sub(r"[^A-E]", "", str(raw.get("answerKey") or "").upper())
        if not key:
            continue
        bucket = section_bucket(raw.get("group"), raw.get("groupTitle"))
        table.setdefault((bucket, number), key)
    return table


# 模型给"没有题干"的答案行写的占位文字：规则在 `_common.py`（S3 判重也要用同一条）
def is_placeholder_stem(text) -> bool:
    """题干是不是"模型自己写的空占位"（答案页的每一行都长这样）。"""
    return c.is_placeholder_stem(text)


# ── 答案表的**确定性**来源：直接读两路 OCR 的转写 ──────────────────────────
# 实测（Principles-of-Marxism page 7，真实 AI 重跑后）：模型这次只提出 5 条、把整页概括成
# "1-5 DDDB C / 6-10 ABDDB / 1-5 1.CE 2.AC 3.ABC…"，逐题答案全丢了（可靠性看运气）。
# 但两路 OCR 的**转写**里答案一直在，而且是这种格式：
#     一、单项选择题（每题1分，共15分）
#     1-5 DDDB C
#     6-10 ABDDB
#     二、多项选择题（每题1分，共5分）
#     1-5 1.CE 2.AC 3.ABC 4.ABC 5.DE
# 所以这里直接解析转写 —— **确定性、0 token，不受模型偷不偷懒影响**。
ANSWER_SECTION_LINE = re.compile(
    r"^\s*(?:[一二三四五六七八九十]+\s*[、.．]|第[一二三四五六七八九十]+部分)\s*(\S.*?)\s*$"
)
ANSWER_RANGE_LINE = re.compile(r"^\s*(\d+)\s*[-–—~]\s*(\d+)\s*[.．、:：]?\s*([A-Ea-e][A-Ea-e\s.．、,，]*)$")
ANSWER_ITEM = re.compile(r"(?<![0-9])(\d+)\s*[.．、:：]\s*([A-Ea-e]{1,5})(?![A-Za-z])")


def mine_answers_from_transcription(text, table: dict, page: int, report: dict) -> int:
    """把一段"参考答案页"的转写挖成 {(大题键, 题号): 答案}，返回挖到几条。

    只挖**客观题**大题（单选/多选/判断）里的答案；主观题那几段是评分标准，
    里面的"1. 对 2分""4分"之类不是答案，硬挖会造出假答案。
    """
    found = 0
    bucket = ""
    objective = False
    for raw_line in str(text or "").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        section = ANSWER_SECTION_LINE.match(line)
        if section:
            bucket = section_bucket(section.group(1))
            objective = bucket in ("single", "multi", "judgement")
            continue
        if not objective:
            continue
        items = ANSWER_ITEM.findall(line)
        if items:
            for number, key in items:
                place = (bucket, int(number))
                normalized = "".join(sorted(set(key.upper())))
                if place in table and table[place] != normalized:
                    report["answer_table_conflicts"].append(
                        (page, bucket, int(number), table[place], normalized)
                    )
                    continue
                if place not in table:
                    found += 1
                table[place] = normalized
            continue
        match = ANSWER_RANGE_LINE.match(line)
        if match:
            start, end = int(match.group(1)), int(match.group(2))
            letters = re.sub(r"[^A-Ea-e]", "", match.group(3)).upper()
            span = end - start + 1
            if len(letters) != span:
                report["answer_table_odd"].append((page, line[:40], len(letters), span))
                continue
            for offset, letter in enumerate(letters):
                place = (bucket, start + offset)
                if place not in table:
                    found += 1
                table[place] = letter
    return found


# 「这行长得像答案」：`1~5 ADAAD`（含全角波浪号）或 `1、ABCD` / `12．C` 这种逐题答案
ANSWER_LIKE_LINE = re.compile(
    r"^\s*(?:\d+\s*[~～\-–—至]\s*\d+\s*[A-Ea-e√×对错\s]{2,}"
    r"|\d+\s*[、.．:：]\s*[A-Ea-e]{1,5}\s*$)"
)


def looks_like_answer_key(text) -> bool:
    """按**内容**判断这页是不是答案页（≥3 行"长得像答案"）。

    为什么不能只看标题：实测这份 40 页卷的答案页**没有「参考答案」标题** —— 直接在卷尾从
    `绪论 / 一、单选题： / 1~5 ADAAD` 开始，靠关键词一个字都匹配不到，于是"答案页=空"，
    答案页原文根本没喂给 AI（答案 0 条）。
    """
    hits = sum(1 for line in str(text or "").split("\n") if ANSWER_LIKE_LINE.match(line.strip()))
    return hits >= 3


# 判断题答案的各种写法：卷面「请在括号内打√或×」、答案页 `×××√×`、模型写「正确/错误」。
# **必须认出来**：没有 A-E 可映射时，以前会把 `√`/`×` 当非法答案清空（见 S3 同名常量）。
JUDGE_TRUE = {"√", "✓", "对", "正确", "对的", "正确的", "是", "t", "true"}
JUDGE_FALSE = {"×", "✗", "x", "错", "错误", "错的", "错误的", "否", "f", "false"}


def judgement_letter(text) -> str:
    """判断题答案 → `A`（正确）/ `B`（错误）；不是**单独一个**判断题答案就返回空串。

    只在"整段就是这个符号/词"时才算 —— `对 2分\\n……` 这种评分标准不能被当成判断题答案。
    """
    flat = "".join(str(text or "").split()).lower()
    if not flat:
        return ""
    if flat in JUDGE_TRUE:
        return "A"
    if flat in JUDGE_FALSE:
        return "B"
    return ""


# 「整段都是答案表原文」——按**答案 token 密度**判，不看行数：
# 实测 marxism-5 把 72 字的答案块（`1-5 CBDBD 6-10 CDDDA … 1-5 BDE CD CDE ACE AC`）当成
# 题组公共题干，复制到了 15 道小题的题干上方；它挤在**同一行**里，而
# `looks_like_answer_key()` 要求 ≥3 行，判不出来 → 答案原文出现在题目里（用户报"答案拼接到题目"）。
ANSWER_TOKEN = re.compile(
    r"(?<![0-9])\d+\s*[-–—~～]\s*\d+\s*[A-Ea-e√×\s]{2,}"
    r"|(?<![0-9])\d+\s*[、.．:：]\s*[A-Ea-e]{1,5}(?![A-Za-z])"
)
# 不带题号的裸字母组（`CCBBB CDBDD CDACB CCDAC`）—— 文字里正常不会连续出现这种孤立 A–E 组
ANSWER_LETTER_GROUP = re.compile(r"(?<![A-Za-z0-9])[A-E]{1,5}(?![A-Za-z0-9])")


def looks_like_answer_dump(text) -> bool:
    """整段是不是"答案表原文"（答案行/答案块）→ 不能当题干、导言或材料。

    三个判据（满足其一即算），必须都留着 —— 实测三种都出现过：
      1. 带题号的答案行（`1-5 CBDBD`、`12.C`）；
      2. **不带题号的裸字母组**（`CCBBB CDBDD CDACB CCDAC` ＋ `ADE ACDE …`）：
         评分标准页常常不印题号，模型把 20 个单选答案直接排成 4 组字母；
      3. 判断题符号串（`×××√×`）。
    """
    flat = " ".join(str(text or "").split())
    if not flat:
        return False
    hits = ANSWER_TOKEN.findall(flat)
    if len(hits) >= 2:
        return True
    groups = ANSWER_LETTER_GROUP.findall(flat)
    letters = sum(len(g) for g in groups)
    cjk = len(re.findall(r"[\u4e00-\u9fff]", flat))
    if len(groups) >= 4 and letters >= 12 and letters / (letters + cjk + 1e-9) >= 0.35:
        return True
    if len(re.findall(r"[√×✓✗]", flat)) >= 3:
        return True
    return bool(hits) and len(re.findall(r"[A-E]", flat)) >= 8 and len(re.findall(r"[A-E]", flat)) / len(flat) > 0.35


def transcription_answer_pages(pages_dir: Path, pages: list[int]) -> list[int]:
    """哪些页的**转写**像"参考答案 / 评分标准"页（与模型抽没抽出题无关）。"""
    hits: list[int] = []
    for page in pages:
        for label in ("a", "b"):
            path = pages_dir / f"page-{page:03d}.{label}.review.json"
            if not path.exists():
                continue
            data = c.read_json(path) or {}
            text = str(data.get("transcription_md") or "")
            if ANSWER_KEY_PAGE.search(text) or "参考答案" in text or looks_like_answer_key(text):
                hits.append(page)
                break
    return hits


# ── 2.7) 评分标准行 → 主观题的答案 ──────────────────────────────────────
# 这份卷子的主观题答案就是**评分标准**（"1. 对 2分 劳动是创造价值的唯一源泉…"）。
# 实测：OCR 把它们抄下来了，但它们是**答案页上的独立行**（没有选项、没有字母答案），
# 从没贴到真正的题目上；而 md 里 `answerKey` 为空的题一律渲染成 `（待补）` ——
# **答案明明有，却没输出**（用户："优先修复答案不输出在 answerKey 的问题"）。
SECTION_HEADER_STEM = re.compile(r"^\s*[一二三四五六七八九十]+\s*[、.．]\s*\S")
GRADING_HINT = re.compile(r"共\s*\d+\s*分|小分|要求给|每题\s*\d+\s*分")
# 「材料型」大题名：它的评分标准常常要跨大题贴给「思考讨论」之类的小题（见 apply_criteria ③）
MATERIAL_BUCKET = re.compile(r"案例|材料|分析")
# 「说明句」措辞：`五、辨析题。……判断下列各题的对错，并说明理由。（每题5分，共10分）`
INSTRUCTION_HINT = re.compile(
    r"判断下列|下列各题|并说明理由|回答下列|每小题|请(?:简要)?(?:回答|说明|论述)|指出下列"
)
# 一眼就是"大题名"的关键词（用来在 group / groupTitle 里挑对那一个）
BUCKET_KEYWORD = re.compile(
    r"选择|判断|正误|对错|辨析|填空|简答|问答|论述|案例|材料|分析|思考|讨论|计算|名词解释|解答"
)


def is_grading_row(q: dict) -> bool:
    """这一行是"答案 / 评分标准"，不是一道题？

    签名：**没有选项** + **有答案（字母或文本）**，且
      * 题干为空 → 答案行（`#10 ans=B` 这种；实测答案表就印在第 1 页顶部，
        模型会把它当题一起抽出来）；
      * 或题干是纯大题标题 + "共N分/要求给…小分" → 评分标准行。

    这两条限制很关键：真实填空题（`4 バイト = ______ ビット。`＋答案文本、没有选项）
    不能被误判成答案行，那会把真题整道删掉。
    """
    if q.get("options"):
        return False
    if not (flatten(q.get("answerKey")) or flatten(q.get("answerText"))):
        return False
    stem = flatten(q.get("stem"))
    if not stem:
        return True
    return bool(SECTION_HEADER_STEM.match(stem)) and bool(GRADING_HINT.search(stem))


def answer_rows_to_table(rows: list[dict]) -> dict[tuple[str, int], str]:
    """把"没有选项、只有答案"的行转成 {(大题键, 题号): 答案}。

    答案可能是字母（`ADE`），也可能是判断题符号（`×`/`√`，模型把它写进了 answerText）
    → 后者按 `A=正确 / B=错误` 归一，和卷面判断题的选项顺序一致。
    """
    table: dict[tuple[str, int], str] = {}
    for raw in rows:
        try:
            number = int(raw.get("number"))
        except (TypeError, ValueError):
            continue
        key = re.sub(r"[^A-E]", "", str(raw.get("answerKey") or "").upper())
        if not key:
            key = judgement_letter(raw.get("answerText"))
        if not key:
            continue
        table.setdefault(
            (section_bucket(raw.get("group"), raw.get("groupTitle")), number), key
        )
    return table


def harvest_criteria(rows: list[dict], report: dict) -> dict[tuple[str, int | None], str]:
    """把评分标准行收成 {(大题键, 题号或 None): 正文}。

    题号可能是 None（模型没写）→ 用 `(大题键, None)` 记成"该大题的通用标准"。
    """
    table: dict[tuple[str, int | None], str] = {}
    for q in rows:
        if not is_grading_row(q):
            continue
        bucket = section_bucket(q.get("group"), q.get("groupTitle"))
        try:
            number: int | None = int(q.get("number"))
        except (TypeError, ValueError):
            number = None
        text = flatten(q.get("answerText"))
        if not text:
            continue
        table.setdefault((bucket, number), text)
        report["criteria_rows"].append((bucket, number, text[:60]))
    return table


def _bigrams(text) -> set[str]:
    """字符二元组集合（只留中文/字母/数字）—— 用来判断"题目和评分标准讲的是不是同一件事"。"""
    flat = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", str(text or ""))
    return {flat[i : i + 2] for i in range(len(flat) - 1)}


def apply_criteria(entries: list[dict], criteria: dict, report: dict) -> None:
    """把评分标准贴到真正的主观题上（三级匹配，逐级收紧）。

    1. `(大题键, 题号)` 完全一致（辨析题 1/2）；
    2. 题号缺失（模型没写）且该大题**只有一道**待答主观题 → 直接贴（论述题）；
    3. 还剩下的按顺序贴给"后面还没答案的主观题"，**数量必须相等**才敢贴
       （案例分析的标准 1/2/3 → 材料下面的思考题 1/2/3）。
    """
    if not criteria:
        return

    def bucket_of(entry: dict) -> str:
        q = entry["q"]
        return section_bucket(q.get("group"), q.get("groupTitle"))

    def attach(entry: dict, text: str) -> None:
        entry["q"]["answerText"] = text
        report["criteria_attached"].append(
            (entry["page"], entry["q"].get("number"), bucket_of(entry), len(text))
        )

    # 候选：没有选项、还没有答案文本、题干非空（= 真题，不是材料标题）
    targets = [
        e
        for e in entries
        if not (e["q"].get("options") or [])
        and not flatten(e["q"].get("answerText"))
        and flatten(e["q"].get("stem"))
    ]
    if not targets:
        return
    taken: set[int] = set()
    used: set[tuple] = set()

    # ① (大题键, 题号) 精确匹配
    for entry in targets:
        bucket = bucket_of(entry)
        number = entry["q"].get("number")
        place = (bucket, number)
        if place in criteria and place not in used:
            attach(entry, criteria[place])
            used.add(place)
            taken.add(id(entry))

    # ② 题号缺失的通用标准：该大题只剩一道候选时才贴
    for (bucket, number), text in criteria.items():
        if number is not None or (bucket, number) in used:
            continue
        left = [e for e in targets if id(e) not in taken and bucket_of(e) == bucket]
        if len(left) == 1:
            attach(left[0], text)
            used.add((bucket, number))
            taken.add(id(left[0]))

    # ③ **同一个大题里数量相等 → 按顺序贴**（不再要求题号一致）。
    # 实测 marxism-5/7 的评分标准页：`四、论述题` 只给 1 条、`五、案例分析题` 给 1/2/3 条，
    # 与题目侧的题号（4、5…）根本对不上，旧的"全局数量相等"又跨大题乱配 —— 于是
    # 「收下 13 条 → 贴回 0 道」，主观题全判缺答案。
    def leftover_of(bucket: str) -> list[dict]:
        return [e for e in targets if id(e) not in taken and bucket_of(e) == bucket]

    # 遍历顺序必须**确定**（按 criteria 的插入顺序 = 页序），不能用 set：
    # Python 的字符串哈希每次进程都不一样，用 set 会让同一份输入跑出不同结果。
    buckets_in_order: list[str] = []
    for place in criteria:
        if place[0] not in buckets_in_order:
            buckets_in_order.append(place[0])

    def attach_pairs(rows: list[tuple], rest: list[dict]) -> None:
        for entry, (place, text) in zip(rest, rows):
            attach(entry, text)
            used.add(place)
            taken.add(id(entry))
        report["criteria_by_order"] += len(rest)

    def split_subanswers(text: str) -> list[str]:
        """一段标准里塞了两个小问（`1. 共计10分。… 2. 共计10分。…`）→ 按小问切开。

        注意：`harvest_criteria` 存进来的是**压平过**的文本（换行没了），所以不能用
        `^\\d+\\.` 这种行首锚点（一个都匹配不到，实测 marxism-7 就是这样没拆开、
        整段被贴给了案例分析题的材料块）。这里按"数字 + 点/顿号 + 空白"切，
        并要求点号后有空白 —— 免得把 `3.5 倍` 这种小数切开。
        """
        flat = re.sub(r"\s+", " ", str(text or "")).strip()
        parts = [
            p.strip()
            for p in re.split(r"(?=\d{1,2}\s*[.．、]\s+\S)", flat)
            if p.strip()
        ]
        return parts if len(parts) >= 2 else []

    def expand(rows: list[tuple], rest: list[dict]) -> list[tuple]:
        """答案页把小问答案写成一段时，按 `1. 2.` 拆开正好对上就拆。

        实测 marxism-7：案例分析的两个小问答案挤在同一行（`1. 共计10分…2. 共计10分…`），
        而小问在另一页、另一个大题名下 —— 不拆就只能整段贴给一道题，另一道永远缺答案。
        """
        if len(rows) == 1 and len(rest) >= 2:
            parts = split_subanswers(rows[0][1])
            if len(parts) == len(rest):
                return [(rows[0][0], part) for part in parts]
        return rows

    # ③ 材料型大题的标准先往「思考/讨论/简答」的小题上贴（跨大题）。
    #    必须排在"同桶按顺序"之前：否则案例分析的标准会贴给案例分析题自己的**材料块**
    #    （那一块不是能作答的题），而真正的小问「思考讨论」永远拿不到答案。
    FOLLOW_HINT = re.compile(r"思考|讨论|问答|简答|解答|阅读")
    for bucket in buckets_in_order:
        if not MATERIAL_BUCKET.search(bucket):
            continue
        rows = [
            (place, text)
            for place, text in criteria.items()
            if place[0] == bucket and place not in used
        ]
        if not rows:
            continue
        follow_buckets: list[str] = []
        for entry in targets:
            if id(entry) in taken:
                continue
            name = bucket_of(entry)
            if name not in follow_buckets:
                follow_buckets.append(name)
        for follow in follow_buckets:
            if not FOLLOW_HINT.search(follow):
                continue
            rest = leftover_of(follow)
            if not rest:
                continue
            rows2 = expand(rows, rest)
            if len(rest) == len(rows2):
                attach_pairs(rows2, rest)
                break

    # ④ **同一个大题里数量相等 → 按顺序贴**（不再要求题号一致）。
    # 实测 marxism-5/7 的评分标准页：`四、论述题` 只给 1 条、`五、案例分析题` 给 1/2/3 条，
    # 与题目侧的题号（4、5…）根本对不上，旧的"全局数量相等"又跨大题乱配 —— 于是
    # 「收下 13 条 → 贴回 0 道」，主观题全判缺答案。
    for bucket in buckets_in_order:
        rows = [
            (place, text)
            for place, text in criteria.items()
            if place[0] == bucket and place not in used
        ]
        rest = leftover_of(bucket)
        if not rows or not rest:
            continue
        rows2 = expand(rows, rest)
        if len(rows2) == len(rest):
            attach_pairs(rows2, rest)

    # ⑤ 该大题只剩一道候选、标准却有两条以上 → 按**术语重合**挑最相关的一条。
    #    实测 marxism-5：辨析题的题干只抄回一道（另一道被 OCR 丢了），标准却有两段
    #    （"对 2分 这是由真理的本性和实践的特点决定的…" / "错 2分 资本主义基本矛盾…"），
    #    数量对不上就一条都不贴 —— 于是真题被判"缺答案"丢掉。这里只挑**严格领先**的那一条
    #    （重合 2 个词以上、且比第二名胜出），并列或证据不足一律不贴（宁可漏，不能贴错答案）。
    def shared_terms(a, b) -> int:
        return len(_bigrams(a) & _bigrams(b))

    for bucket in buckets_in_order:
        rest = leftover_of(bucket)
        if len(rest) != 1:
            continue
        rows = [
            (place, text)
            for place, text in criteria.items()
            if place[0] == bucket and place not in used
        ]
        if len(rows) < 2:
            continue
        scored = sorted(
            ((shared_terms(rest[0]["q"].get("stem"), text), place, text) for place, text in rows),
            key=lambda item: -item[0],
        )
        if scored[0][0] >= 2 and scored[0][0] > scored[1][0]:
            _score, place, text = scored[0]
            attach(rest[0], text)
            used.add(place)
            taken.add(id(rest[0]))
            report["criteria_by_content"].append((place[0], place[1], _score))
    for place, text in criteria.items():
        if place not in used:
            report["criteria_unmatched"].append((place[0], place[1], text[:60]))


def apply_answer_table(entries: list[dict], table: dict, report: dict) -> None:
    """把答案表按 (大题, 题号) 贴回真正的题目（§34.2）。

    匹配优先级：
      1. `(大题键, 题号)` 完全一致（大题名缺失时退回题型，见下）；
      2. **答案表只有一个大题**时，才敢用"只对题号"的回退；
      3. **同一个大题里"答案条数 == 还没答案的题数"→ 按出现顺序配对**（见函数末尾）。

    第 2 条必须卡死：很多卷子每个大题都从 1 重新编号（单选 1-15、多选 1-5、论述 1…），
    只按题号回退会把「一、单项选择题 第1题=C」贴到主观题第1题上（实测踩过）。

    **答案表是权威**：题目页上模型自己写的那份答案如果和评分标准不一致，以评分标准为准
    （实测第 9 题的选项被页边界切掉一半，模型就猜了个 B，官方答案是 D），
    改动记进 `answer_overrides[]` 让人看得见。
    """
    if not table:
        return
    buckets = {bucket for bucket, _number in table}
    by_number: dict[int, list[str]] = {}
    for (_bucket, number), key in table.items():
        by_number.setdefault(number, []).append(key)
    used: set[tuple[str, int]] = set()

    def bucket_of(q: dict) -> str:
        bucket = section_bucket(q.get("group"), q.get("groupTitle"))
        if not bucket:
            # 大题名两路都没抄到（实测 marxism-5 page 2：整页 `group` 为空）→ 退回**题型**。
            # 答案表里客观题本来就是按题型分桶的（single/multi/judgement），所以能对上；
            # 不这么退，那 6 道单选（第 10–15 题）的答案就贴不上，白白算进"会被丢弃"。
            quiz_type = str(q.get("questionType") or "")
            bucket = quiz_type if quiz_type in ("single", "multi", "judgement") else ""
        return bucket

    for entry in entries:
        q = entry["q"]
        if is_placeholder_stem(q.get("stem")):  # 题干是空的/占位 = 不是真题（答案页的伪题目）
            continue
        try:
            number = int(q.get("number"))
        except (TypeError, ValueError):
            continue
        bucket = bucket_of(q)
        key = table.get((bucket, number), "")
        if key:
            used.add((bucket, number))
        elif len(buckets) == 1:
            candidates = by_number.get(number) or []
            if len(candidates) == 1:
                key = candidates[0]
        if not key:
            continue
        before = str(q.get("answerKey") or "").strip()
        if before == key:
            continue
        q["answerKey"] = key
        text = "、".join(option_text(q, ch) for ch in key if option_text(q, ch))
        if text:
            q["answerText"] = text
        if before:
            report["answer_overrides"].append((entry["page"], number, before, key))
        else:
            report["answers_from_table"].append((entry["page"], number, key, bucket))

    # ③ 同一个大题里"答案条数 == 还没答案的题数"→ 按顺序配对。
    #    为什么必须要这一层：答案页常常**根本不印题号**（实测 marxism-7 第 8 页评分标准：
    #    20 个单选答案排成 4 组字母、多选 5 个、辨析 `×××√×`），模型只能顺延编号
    #    （单选 1-20、多选 21-25、辨析 26-30），而卷面每个大题都从 1 重新编号 ——
    #    (大题, 题号) 一个都对不上，答案抄到了却贴不回去，S5 就按"缺答案"判丢弃。
    #    顺序在两边都是"卷面顺序"，所以按序配对是安全的；数量不等就一律不贴（宁缺勿错）。
    bucket_order: list[str] = []
    for bucket, _number in table:
        if bucket not in bucket_order:
            bucket_order.append(bucket)
    for bucket in bucket_order:
        places = sorted(
            (number, key)
            for (b, number), key in table.items()
            if b == bucket and (b, number) not in used
        )
        if not places:
            continue
        rest = [
            e
            for e in entries
            if not is_placeholder_stem(e["q"].get("stem"))
            and not flatten(e["q"].get("answerKey"))
            and bucket_of(e["q"]) == bucket
        ]
        if len(places) != len(rest):
            continue
        for entry, (number, key) in zip(rest, places):
            q = entry["q"]
            q["answerKey"] = key
            text = "、".join(option_text(q, ch) for ch in key if option_text(q, ch))
            if text:
                q["answerText"] = text
            used.add((bucket, number))
            report["answers_by_order"].append((entry["page"], number, key, bucket))


def check_answer_coverage(entries: list[dict], table: dict, report: dict) -> None:
    """答案表里有、题目里却没有的题号 → **一定有题丢了**，必须报警（§34.13）。

    实测（马原卷第 1 页）：卷面把「7.」印了两遍，两路 OCR 都把它读成 7、8，
    然后跳到卷面的「9.」—— 卷面上真正的第 8 题（"一种认识是不是真理，要看它（ ）"）
    被**两路一起丢掉**。答案表却明明白白写着 `6-10 ABDDB`（第 8 题=D）。
    没有这道检查的话，丢题是**静默**的：题号看起来连续（7→9 被当成原卷跳号）。
    """
    if not table:
        return
    present: set[tuple[str, int]] = set()
    for entry in entries:
        q = entry["q"]
        if not flatten(q.get("stem")):
            continue
        try:
            present.add((section_bucket(q.get("group"), q.get("groupTitle")), int(q.get("number"))))
        except (TypeError, ValueError):
            continue
    for (bucket, number), key in sorted(table.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        if (bucket, number) in present:
            continue
        report["answer_without_question"].append((bucket, number, key))


def normalize_question_types(entries: list[dict], report: dict) -> None:
    """按"卷面大题标题"补正 questionType（S3 已做过一次，这里对老 merge.json 兜底）。

    实测用户手里那批 merge.json 是 S3 旧版产出的：第二大题「二、多项选择题」逐题都是
    `single`。改 S3 只对新跑的页生效，S4 再兜一次才能让**已有数据**（0 token）也修好。
    """
    for entry in entries:
        q = entry["q"]
        section = f"{q.get('group') or ''} {q.get('groupTitle') or ''}"
        chosen = c.question_type_from_section(section) or str(q.get("questionType") or "")
        if len(str(q.get("answerKey") or "")) > 1:
            chosen = "multi"
        if chosen not in c.QUIZ_TYPES:
            chosen = "fill"
        if chosen != str(q.get("questionType") or ""):
            report["type_from_section"].append(
                (entry["page"], q.get("number"), str(q.get("questionType") or ""), chosen)
            )
            q["questionType"] = chosen


# ── 3) 公共题干（题组导言）挂载 ─────────────────────────────────────────
# 小题自己的文字只是占位符的形态：`(30) の選択肢：` / `選択肢：` / 光秃秃一个 `（30）`
PLACEHOLDER_STEM = re.compile(r"の選択肢|選択肢[：:]")
BARE_MARKER = re.compile(r"^[（(]?\s*\d+\s*[）)]?\s*[：:．.]?$")

def is_thin_stem(q: dict) -> bool:
    """题干是不是"只是个占位符、必须靠公共题干才成立"。

    注意**不能只看长度**：题组七的 `swは何形式か。` 只有 8 个字，但它自足 ——
    按长度判会把它误当成公共题干题组（实测踩过）。
    """
    stem = flatten(q.get("stem"))
    return bool(PLACEHOLDER_STEM.search(stem)) or bool(BARE_MARKER.match(stem))


def clean_passage(text) -> str:
    """公共题干里不能出现 `## ` 开头行（会被解析端当成题组标题、并截断解析）和 `---`（会中止文章累积）。"""
    lines = []
    for line in str(text or "").split("\n"):
        stripped = line.strip()
        if stripped.startswith("## ") or stripped == "---":
            continue
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


def passage_from_transcription(pages_dir: Path, page: int, numeral: str, first_number: int) -> str:
    """从该页 OCR 转写里取"题组标题行 → 第一个小题行"之间的文本（公共题干）。

    实测题组五的导言（含 MIPS 代码块）只存在于整页转写里：merge.json 的 groupTitle 是 `题组一`，
    小题 stem 全是 `(30) の選択肢：`，导言本身没被任何字段接住 —— 只能回落到转写。
    """
    if not numeral or not first_number:
        return ""
    head_re = re.compile(rf"^\s*{re.escape(numeral)}\s*[、.．]")
    stop_re = re.compile(rf"^\s*{first_number}\s*[.．、]")
    for label in ("a", "b"):
        path = pages_dir / f"page-{page:03d}.{label}.review.json"
        if not path.exists():
            continue
        lines = str(c.read_json(path).get("transcription_md") or "").split("\n")
        start = None
        for index, line in enumerate(lines):
            if head_re.match(line.strip()):
                start = index
        if start is None:
            continue
        body: list[str] = []
        for line in lines[start + 1 :]:
            if stop_re.match(line.strip()):
                break
            body.append(line)
        fragment = clean_passage("\n".join(body))
        if fragment:
            return fragment
    return ""


def _common_prefix_len(a: str, b: str) -> int:
    limit = min(len(a), len(b))
    index = 0
    while index < limit and a[index] == b[index]:
        index += 1
    return index


def strip_leading_passage(stem: str, passage: str) -> tuple[str, bool]:
    """题干开头若已经把公共题干抄了一遍，就切掉它（避免"文章 + 题干"里重复一遍）。

    两份文本来自不同的 OCR 路，标点/顿号会有差异，所以按**归一化后**的最长公共前缀判断：
    公共前缀 ≥30 字且覆盖导言归一化长度的 80% 以上，就认定"这一题的题干开头就是导言"。
    """
    target = norm_stem(passage)
    if len(target) < 30:
        return stem, False
    prefix = _common_prefix_len(norm_stem(stem), target)
    if prefix < 30 or prefix < 0.8 * len(target):
        return stem, False

    count = 0
    for index, char in enumerate(stem):
        if re.sub(r"[\s\W_]+", "", char.lower()):
            count += 1
        if count >= prefix:
            # 归一化会把反引号当非单词字符丢掉，所以切点可能停在代码块围栏**之前**，
            # 残余的 ``` 要一并剥掉（实测题组六第 36 题就是这里剩了个裸围栏）
            rest = stem[index + 1 :].lstrip(" \n\t:：。、.`")
            return (rest, True) if rest else (stem, False)
    return stem, False


def passage_from_stem(stem: str) -> tuple[str, str]:
    """从"模型已经把导言抄进第一道小题题干"的那种文本里，切出 (导言, 该小题自己的题干)。

    新提示词（§8.4 / 规则 6a）要求模型把题组导言抄进第一道小题的 stem 开头，
    所以导言**本来就在 JSON 里**，不用去转写里找（转写那份还缺代码围栏、行号也对不上）。
    切法按可靠性：
      1. 以**最后一个代码围栏**收尾（导言里的代码块到这里结束）→ 导言 = 到围栏为止；
      2. 以**小题占位符**（`(30) の選択肢：`）开头 → 导言 = 占位符之前；
      3. 都不成立 → 交回调用方（改用 groupTitle / 转写）。
    """
    text = str(stem or "")
    fence_count = text.count("```")
    if fence_count >= 2:
        last_fence = text.rfind("```")
        line_end = text.find("\n", last_fence)
        line_end = len(text) if line_end == -1 else line_end
        head, tail = text[: last_fence + 3].strip(), text[line_end:].strip()
        if len(flatten(head)) >= 30:
            return head, tail
    match = PLACEHOLDER_STEM.search(text)
    if match and match.start() > 0 and len(flatten(text[: match.start()])) >= 30:
        return text[: match.start()].strip(), text[match.start() :].strip()
    return "", text.strip()


def drop_empty_rows(entries: list[dict], report: dict) -> list[dict]:
    """丢掉"零信息"条目：题干空/占位 + 没有答案 + 没有选项。

    实测（marxism-5 page 4）：模型给了 3 条空洞条目，S3 按"截断也要保留"的约定留了下来；
    S4 又把案例材料复制到它们头上，于是站上多出 3 道"只有材料、没有题目、没有答案"的假题，
    还把 S5 的"会被解析端丢弃"计数推高到 1/5 门限之上。
    截断的真题题干**非空**（只是被切断），所以这里不会误删。
    """
    keep: list[dict] = []
    for entry in entries:
        q = entry["q"]
        if (
            is_placeholder_stem(q.get("stem"))
            and not (q.get("options") or [])
            and not flatten(q.get("answerKey"))
            and not flatten(q.get("answerText"))
        ):
            report["dropped_empty_rows"].append((entry["page"], q.get("number")))
            continue
        keep.append(entry)
    return keep


def drop_instruction_rows(entries: list[dict], report: dict) -> list[dict]:
    """丢掉"大题说明"条目：`五、辨析题。运用马克思主义的基本原理，判断下列各题的对错，
    并说明理由。（每题5分，共10分）` 这种**说明句**不是一道能作答的题。

    留着有两个坏处（实测 marxism-5）：
      1. 它会作为一道"题"上站（题干是说明、答案是某条评分标准）；
      2. 它还会把评分标准**按顺序配错位** —— 真正那道辨析题拿到了另一题的答案。
    要求同时满足"以大题序号开头"+"写了分值/评分说明"+**说明句措辞**+不长，才敢丢 ——
    案例材料（`五、案例分析题。（共10分）＋大段材料`）也是这个开头，但它又长又没有说明句措辞，
    绝不能当说明丢掉（丢了材料就贴不到小问上了）。
    """
    keep: list[dict] = []
    dropped: dict[str, list[int]] = {}
    for entry in entries:
        q = entry["q"]
        stem = str(q.get("stem") or "")
        flat = flatten(stem)
        if (
            not (q.get("options") or [])
            and len(flat) <= 120
            and INSTRUCTION_HINT.search(flat)
            and (SECTION_HEADER_STEM.match(stem) or GRADING_HINT.search(flat))
        ):
            report["dropped_instruction_rows"].append((entry["page"], q.get("number")))
            try:
                number = int(q.get("number"))
            except (TypeError, ValueError):
                number = None
            if number is not None:
                dropped.setdefault(section_bucket(q.get("group"), q.get("groupTitle")), []).append(
                    number
                )
            continue
        keep.append(entry)

    # 说明句常常**占了题号**（模型把它编成第 1 题），于是同大题里真正的第 1 题变成 2、
    # 答案/评分标准就按题号贴到了下一条上（实测 marxism-5：辨析题拿到了"错 2分 资本主义…"）。
    # 这里把同大题里排在说明句后面的题号整体前移，恢复卷面真实编号。
    for entry in keep:
        bucket = section_bucket(entry["q"].get("group"), entry["q"].get("groupTitle"))
        gone = dropped.get(bucket) or []
        if not gone:
            continue
        try:
            number = int(entry["q"].get("number"))
        except (TypeError, ValueError):
            continue
        shift = sum(1 for n in gone if n < number)
        if shift:
            entry["q"]["number"] = number - shift
            report["instruction_renumbered"].append((entry["page"], number, number - shift))
    return keep


def attach_shared_stems(entries: list[dict], pages_dir: Path, report: dict) -> None:
    """把"题组公共题干"**复制**到该题组每一道小题的题干上方，让每个小问独立成题（§8.4）。

    **为什么是复制、不是解析端的"文章"机制**：用户明确要求"公共题干复制到每个小问的上方，
    独立成题"。所以 md 里每道小题的 `#### 题目` 都自带完整导言 ——
    单看任意一题（错题本、单题分享、搜索命中）都不缺上下文，不依赖题组上下文。

    导言来源（按可靠性）：
      1. `merge.json` 的 `groupTitle` 其实是整段导言（`passage_candidate`，实测出现过）
      2. **整页 OCR 转写里"题组标题行 → 第一个小题行"之间的文本**（实测题组五、六都靠它）
    触发条件：上面任一条取到导言，且导言像公共题干（含代码块 / 较长），或该题组有 ≥2 道小题题干是占位符。

    防重复：某一题的题干开头已经抄了一遍导言时（实测题组六第 36 题），先按**归一化后的最长公共前缀**
    切掉原有那份，再补上标准的一份 —— 保证每道小题的题干里导言**恰好出现一次**。
    """
    by_group: dict[str, list[dict]] = {}
    for entry in entries:
        by_group.setdefault(entry["numeral"], []).append(entry)

    for numeral, group in by_group.items():
        if len(group) < 2:
            continue
        thin = sum(1 for e in group if is_thin_stem(e["q"]))
        candidate = next((e["passage_candidate"] for e in group if e.get("passage_candidate")), "")
        first = group[0]

        # ① 模型按新提示词把导言抄进了第一道小题的题干 → 直接从那里切（那份带代码围栏，最完整）
        from_stem, first_body = passage_from_stem(str(first["q"].get("stem") or ""))
        if from_stem:
            passage, source = from_stem, "第一道小题题干里的导言（提示词规则 6a 要求的位置）"
        elif candidate:
            passage, source = candidate, "merge.json 的 groupTitle（模型把整段导言塞进了标题）"
        else:
            from_transcription = passage_from_transcription(
                pages_dir, first["page"], numeral, int(first["q"].get("number") or 0)
            )
            if from_transcription:
                passage, source = from_transcription, f"page {first['page']} 的 OCR 转写"
            else:
                if thin >= 2:
                    report["shared_stem_missing"].append((numeral, len(group), thin))
                continue

        passage = clean_passage(passage)
        if not passage:
            report["shared_stem_missing"].append((numeral, len(group), thin))
            continue
        # **答案区不能当导言**：整段"长得像答案"就拒绝（否则答案会被复制进每个小题）。
        # 两个判据都要：按行（≥3 行答案行）和按 token 密度（答案块挤在同一行里，实测踩过）。
        if looks_like_answer_key(passage) or looks_like_answer_dump(passage):
            report["answer_region_rejected"].append(
                (numeral, "公共题干", len(flatten(passage)))
            )
            continue
        # 别把"题组标题下面恰好接着的普通一行"误当导言：要求它确实像公共题干
        if not (
            from_stem
            or candidate
            or thin >= 2
            or CODE_FENCE.search(passage)
            or len(flatten(passage)) > 60
        ):
            continue

        for entry in group:
            original = str(entry["q"].get("stem") or "").strip()
            if entry is first and from_stem:
                body = first_body
            else:
                rest, changed = strip_leading_passage(flatten(original), passage)
                if changed:
                    report["shared_stem_stripped"].append(entry["q"].get("number"))
                body = (rest if changed else original).strip()
            # 公共题干**复制**到每一道小题的题干上方 → 每个小问都是独立可读的题
            entry["q"]["stem"] = f"{passage}\n\n{body}".strip() if body else passage
            report["shared_stem_inlined"].append(entry["q"].get("number"))
        report["shared_stems"].append((numeral, len(group), source, len(flatten(passage))))


# ── 3.5) 材料题 / 案例题：把"大段材料"贴到后续小题上 ────────────────────
# 实测（Principles-of-Marxism page 5→6）：「五、案例分析题」的整段材料在第 5 页最后一道题
# （`continued`），三个小问在第 6 页。`attach_shared_stems()` 按"题组"找导言，而这两页的
# 题组名不同（`五、案例分析题` vs `思考题`）→ 贴不上去，站上三个小问成了没头没尾的孤儿题
# （用户报"拼接功能消失"）。
MATERIAL_HINT = re.compile(r"案例|材料|阅读|分析|论述|思考题|结合|根据上述|下列")
MATERIAL_MIN = 120  # 材料至少这么长（压平后），免得把普通长题干误当材料


def attach_material_passages(entries: list[dict], report: dict) -> list[dict]:
    """把材料题的整段材料**复制**到紧随其后的小题上，并把材料本身从题单里撤掉。

    判据（全满足才动手，宁可漏也不乱贴）：
      1. 该题没有选项，题干压平后 ≥ `MATERIAL_MIN` 字，且带材料味关键词；
      2. 它是**所在页的最后一道题**；
      3. 下一页至少 2 道题，且这些题自己都还没有材料（题干短、无代码围栏）。

    材料题本身（`五、案例分析题。（共10分）` ＋ 材料）不是一道能作答的题，材料既然已经
    复制到每个小问，它就从题单里撤掉 —— 否则站上会多出一道"只有材料、没有答案"的空题。
    """
    if not entries:
        return entries
    by_page: dict[int, list[dict]] = {}
    for entry in entries:
        by_page.setdefault(entry["page"], []).append(entry)

    drop: set[int] = set()
    for page, group in sorted(by_page.items()):
        head = group[-1]
        q = head["q"]
        stem = str(q.get("stem") or "")
        flat = flatten(stem)
        if q.get("options") or len(flat) < MATERIAL_MIN or not MATERIAL_HINT.search(stem):
            continue
        followers = by_page.get(page + 1) or []
        if len(followers) < 2:
            continue
        if any(len(flatten(e["q"].get("stem"))) >= MATERIAL_MIN for e in followers):
            continue  # 小题自己已经带着材料，不重复贴
        passage = clean_passage(stem)
        if len(flatten(passage)) < MATERIAL_MIN:
            continue
        # **答案区不能当材料**：同样的道理，答案不该出现在任何题干里
        if looks_like_answer_key(passage) or looks_like_answer_dump(passage):
            report["answer_region_rejected"].append(
                (head["page"], "材料", len(flatten(passage)))
            )
            continue

        flat_passage = flatten(passage)
        attached = 0
        for entry in followers:
            body = str(entry["q"].get("stem") or "").strip()
            flat_body = flatten(body)
            head_40 = flat_passage[:40]
            if head_40 and head_40 in flat_body:
                continue  # 已经贴过
            entry["q"]["stem"] = f"{passage}\n\n{body}".strip() if body else passage
            report["material_inlined"].append(entry["q"].get("number"))
            attached += 1
        if attached:
            drop.add(id(head))
            report["material_stems"].append(
                (head["page"], q.get("number"), attached, len(flat_passage))
            )
            report["material_headers_dropped"].append((head["page"], q.get("number")))
    if drop:
        entries = [e for e in entries if id(e) not in drop]
        # 材料题本身撤掉了，它先前那条"跨页拼接失败"的记录也就没意义了（否则报告里留着噪音）
        dropped = set(report["material_headers_dropped"])
        report["splice_failed"] = [
            item for item in report["splice_failed"] if (item[0], item[1]) not in dropped
        ]
    return entries


# ── 4) 跨页断题拼接（§8.2）───────────────────────────────────────────────
def merge_pair(target: dict, follower: dict) -> None:
    """把 follower 并进 target（同题号的跨页两半）。"""
    a, b = flatten(target.get("stem")), flatten(follower.get("stem"))
    if b and b not in a:
        target["stem"] = f"{a} {b}".strip()
    if not flatten(target.get("answerKey")) and flatten(follower.get("answerKey")):
        target["answerKey"] = follower["answerKey"]
    if not flatten(target.get("answerText")) and flatten(follower.get("answerText")):
        target["answerText"] = follower["answerText"]
    if not flatten(target.get("translation")) and flatten(follower.get("translation")):
        target["translation"] = follower["translation"]
    a_exp, b_exp = flatten(target.get("explanation")), flatten(follower.get("explanation"))
    if b_exp and b_exp not in a_exp:
        target["explanation"] = f"{a_exp}\n\n{b_exp}".strip()
    # 选项按 key 合并，先到先得；key 相同但文本不同的记一笔
    options = {str(o.get("key") or "").upper(): dict(o) for o in target.get("options") or []}
    for item in follower.get("options") or []:
        k = str(item.get("key") or "").upper()
        if not k:
            continue
        if k in options:
            if flatten(options[k].get("text")) != flatten(item.get("text")):
                target.setdefault("_splice_option_conflicts", []).append(k)
        else:
            options[k] = dict(item)
    target["options"] = [options[k] for k in sorted(options)]
    target["continued"] = bool(follower.get("continued"))
    target["needs_review"] = bool(target.get("needs_review")) or bool(follower.get("needs_review"))
    target["confidence"] = "low" if target.get("continued") else target.get("confidence")


def page_head_fragment(pages_dir: Path, page: int, limit: int = 1200) -> str:
    """下一页"第一个题号之前"的文本片段（用于 §8.2 第 2 步）。

    merge.json 里没有"页首未归属文本"字段，只能回落到该页的整页转写里取开头。
    取不到 / 太长就返回空串 —— 宁可交给人工，也不猜。
    """
    for label in ("a", "b"):
        path = pages_dir / f"page-{page:03d}.{label}.review.json"
        if not path.exists():
            continue
        text = str(c.read_json(path).get("transcription_md") or "").strip()
        if not text:
            continue
        head: list[str] = []
        for line in text.split("\n"):
            if re.match(r"^\s*#{0,4}\s*第\s*\d+\s*[題题]", line) or re.match(
                r"^\s*[（(]?\d+[)）.、]\s*\S", line
            ):
                break
            head.append(line)
        fragment = flatten(" ".join(head))
        if fragment and len(fragment) <= limit:
            return fragment
    return ""


def splice_continued(entries: list[dict], pages_dir: Path, report: dict) -> list[dict]:
    """§8.2 三步：按题号配对 → 按"题号缺失"配对 → 兜底标待复核（不丢题）。"""
    by_page: dict[int, list[dict]] = {}
    for entry in entries:
        by_page.setdefault(entry["page"], []).append(entry)

    # 第 1 步：同题号跨页配对
    dropped: set[int] = set()
    for entry in entries:
        q = entry["q"]
        if not q.get("continued") or id(entry) in dropped:
            continue
        number = q.get("number")
        followers = [
            e
            for e in by_page.get(entry["page"] + 1, [])
            if e["q"].get("number") == number and id(e) not in dropped
        ]
        if not followers:
            continue
        follower = followers[0]
        merge_pair(q, follower["q"])
        dropped.add(id(follower))
        report["splices"].append((entry["page"], entry["page"] + 1, number, "按题号配对"))

    kept = [e for e in entries if id(e) not in dropped]

    # 第 2 步 / 第 3 步
    for entry in kept:
        q = entry["q"]
        if not q.get("continued"):
            continue
        number = q.get("number")
        heads = by_page.get(entry["page"] + 1, [])
        first_next = heads[0]["q"].get("number") if heads else None
        if first_next is not None and first_next != (number or 0) + 1:
            fragment = page_head_fragment(pages_dir, entry["page"] + 1)
            if fragment:
                q["stem"] = f"{flatten(q.get('stem'))} {fragment}".strip()
                q["needs_review"] = True
                q["_splice_note"] = f"页首片段已并入（{len(fragment)} 字），请与页图核对"
                report["splices"].append(
                    (entry["page"], entry["page"] + 1, number, "页首片段并入（需人工确认）")
                )
                continue
        # 第 3 步前的现实检查：模型把完整的题也标成 continued（实测第 34/35 题：选项 4 个、答案齐全）。
        # 选项 ≥2 且有答案 → 这题不缺东西，不该按"拼接失败"惊动人工。
        if len(q.get("options") or []) >= 2 and flatten(q.get("answerKey")):
            report["splice_false_alarms"].append((entry["page"], number))
            continue
        q["needs_review"] = True
        q["_splice_note"] = "疑似跨页断题，未能自动拼接"
        report["splice_failed"].append((entry["page"], number, flatten(q.get("stem"))[:60]))

    if dropped:
        report["splices_dropped"] = len(dropped)
    return kept


# ── 5) 排序 + 去重（§8.1）────────────────────────────────────────────────
def sort_and_dedupe(entries: list[dict], report: dict) -> list[dict]:
    ordered = sorted(entries, key=lambda e: (int(e["q"].get("number") or 0), e["page"], e["index"]))
    seen: dict[tuple, dict] = {}
    result: list[dict] = []
    for entry in ordered:
        q = entry["q"]
        key = (int(q.get("number") or 0), norm_stem(q.get("stem")))
        if key in seen:
            kept = seen[key]
            winner, loser = (entry, kept) if info_score(q) > info_score(kept["q"]) else (kept, entry)
            report["duplicates"].append(
                (q.get("number"), int(winner["page"]), int(loser["page"]), flatten(q.get("stem"))[:50])
            )
            if winner is entry:
                result[result.index(kept)] = entry
                seen[key] = entry
            continue
        seen[key] = entry
        result.append(entry)
    return result


# ── 6.5) 全卷 AI 终审：判重删除 + 题号顺延 + 答案重新对位 ────────────────
AI_REVIEW_SYSTEM = (
    "你是试卷终审助手。你会看到一份试卷**全部**题目（含题号、大题名、题组、题干、选项、答案），"
    "以及从卷面 OCR 里挑出来的答案表/评分标准片段。"
    "请做三件事："
    "① 找出**疑似重复的题**，并在删除后把后面题号整体前移（顺延）、把答案重新对位；"
    "② 逐题判定**题型**（单选/多选/判断）—— 答案表本身不会写「这题是多选」，"
    "每道题又都挂着好几个选项，只能靠大题标题和题目内容判；"
    "③ 对多选题给出**你认为的全部正确选项**，用来交叉验证卷面答案表有没有漏读。"
    "只输出一个 JSON 对象，不要解释、不要代码围栏。"
)

AI_REVIEW_SCHEMA = """请输出如下 JSON（键名固定）：

{
  "duplicates": [
    {"number": 8, "keepNumber": 7, "reason": "题干与选项完全相同，仅答案不同，判为重复", "confidence": "high"}
  ],
  "answerKeySource": "卷首答案表 1-5 DDDBC / 6-10 ABDDB / 11-15 ABCAC（没有就写空）",
  "answers": [{"index": 12, "answerKey": "D", "reason": "答案表 第一章 一、单选题 1~5 DCBAC 的第 2 个"}],
  "questionTypes": [
    {"index": 12, "questionType": "multi", "answerKey": "CE", "reason": "卷面大题写「多选题」"}
  ],
  "notes": []
}

规则：
1) **duplicates 只报真正的重复**：题干与选项实质相同（同一道题被 OCR/模型输出两遍）。
   只是"长得像"或题型相同**不算**；拿不准就不要报（宁缺勿滥）。keepNumber 填保留哪一条。
2) 删除后**题号整体前移**（顺延）：被删题之后的所有题号减 1，依次类推 —— 这一层 S4 会自己算，
   你只要报 duplicates。
3) `answers` 里每条**必须带 `index`**（题目行首的 `#序号`，原样抄回）—— 这是唯一无歧义的引用：
   很多卷子按「绪论/第一章/第二章」分节、**每章题号都从 1 重新开始**，而且 OCR 抽题时
   常常整段没写大题名，用"题号/大题名"根本对不上（实测 421 题里 277 题完全没有大题名）。
   `answerKey` 用 A/B/C/D/E。请自己读懂【参考答案页原文】的版式（可能是 `1～5 ADAAD`（全角波浪号）、
   `1、ABCD 2、ABD`（多选）、`1~4 × √ × ×`（判断题符号），还常带"绪论/第一章"小标题、
   每章重新编号）——**按"章的顺序 + 大题 + 题号"落到对应的 #序号 上**。
   判断题符号 `√` 记作 `A`、`×` 记作 `B`（卷面判断题的选项是 A.正确 / B.错误）。
   卷面没给答案的题就**不要放进 answers**。
4) 卷面答案表按"位置"给（如 `1-5 DDDBC` 表示第 1~5 题依次是 D D D B C）；
   多选题可能写作 `1.CE 2.AC` 这种，answerKey 直接拼成 "CE"。
   **⚠ 很多卷子每个大题都从 1 重新编号**（一、单项 1-15；二、多项 1-5；三、论述 1…）——
   `answers[].number` 配的是**上面给你的那道题**，别把「单项选择 第4题=B」贴到
   「多项选择 第4题」上（S4 实测踩过：卷面答案是 ABC，被改成了 B）。
   `answers[]` **只用来补卷面没给出答案的题**；已经有答案的题不要放进 answers。
5) **questionTypes：题型判定（次要任务，答案做完再判）**。
   只对**大题名看不出题型**的题给（大题名写着"单选题/多选题/判断题"的题**不用给**，S4 有确定性规则）。
   判据优先级：卷面大题标题 > 答案的字母个数（≥2 → multi）> 题干与选项内容。
   `answerKey` 填你认为的全部正确项（多选拼起来，如 "CE"），用来交叉验证答案表有没有漏读。
6) 不确定的一律写进 notes，不要编造。"""


def answer_table_snippets(pages_dir: Path, pages: list[int], limit: int = 40) -> list[str]:
    """把**答案页的整页转写**喂给 AI 终审（用户要求：答案匹配交给 AI 分析，不用正则）。

    以前这里用一条窄正则去"挑片段"（只认 `1-5 DDDBC` 这种），实测在真实卷子上**一条都挑不到**：
    马原 40 页卷的答案是 `1～5 ADAAD`（全角波浪号）、按「绪论/第一章/第二章」分节且**每章题号
    都从 1 重新开始**、判断题答案是 `× √ × ×` 符号 —— 窄正则全军覆没，于是"答案页找到了、
    却挖到 0 条"，而这一步是**静默**的。

    现在改成：**把答案页的原文整段交给 AI**，由它读懂版式、按"章 + 大题 + 题号"把答案对到题上。
    只有 `--no-ai-review`（纯离线）时才回落到确定性的 `mine_answers_from_transcription()`。
    """
    texts: list[str] = []
    seen: set[str] = set()
    budget = 24000  # 字符预算：推理模型读长文会把思维链撑爆（实测 16384 输出被吃光）
    for page in pages:
        for label in ("a", "b"):
            path = pages_dir / f"page-{page:03d}.{label}.review.json"
            if not path.exists():
                continue
            text = str((c.read_json(path) or {}).get("transcription_md") or "").strip()
            if not text:
                continue
            # a/b 两路的答案页原文常常几乎一样 → 按内容去重，省一半输入
            fingerprint = re.sub(r"\s+", "", text)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            if len(text) > budget:
                text = text[:budget] + "\n…（本页过长已截断）"
            budget -= len(text)
            texts.append(f"（page {page} / {label} 路）\n{text}")
            if budget <= 0:
                return texts
    return texts


def snippet(text, head: int = 80, tail: int = 80) -> str:
    """给 AI 看的题干摘要：**头 + 尾**。

    只给前 N 字会出事（实测）：材料题的小问都被拼上了同一段材料，前 160 字完全相同，
    AI 就把第 2、3 问当成第 1 问的重复删掉 —— 真正的区分信息在**末尾**。
    """
    flat = flatten(text)
    if len(flat) <= head + tail + 5:
        return flat
    return f"{flat[:head]} …… {flat[-tail:]}"


def build_review_payload(model: str | None, entries: list[dict], snippets: list[str], max_tokens: int) -> dict:
    lines = ["【全卷题目】（**引用题目一律用行首的 #序号** —— 很多卷子按章重新编号，题号会重）"]
    for index, entry in enumerate(entries, start=1):
        q = entry["q"]
        options = " / ".join(f"{o['key']}.{o['text']}" for o in q.get("options") or [])
        lines.append(
            f"#{index} 第{q.get('number')}题（page {entry['page']} / 大题={q.get('group') or '未写'}"
            f" / 题组={entry.get('group_title') or '未分组'} / 现有题型={q.get('questionType') or '未定'}）"
            f"{snippet(q.get('stem'))}"
            + (f"  [{options[:200]}]" if options else "")
            + f"  答案={q.get('answerKey') or '（无）'}"
        )
    if snippets:
        lines += ["", "【参考答案页原文（整页 OCR 转写，答案一律以它为准）】", *snippets]
    lines += ["", AI_REVIEW_SCHEMA]
    return {
        "model": model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": AI_REVIEW_SYSTEM},
            {"role": "user", "content": "\n".join(lines)},
        ],
    }


AI_ITEM_KEYS = ("duplicates", "answers", "questionTypes", "explanations")
AI_ITEM_MARKERS = {
    "duplicates": ("stem", "keepNumber"),
    "answers": ("answerKey",),
    "questionTypes": ("questionType",),
    "explanations": ("explanation",),
}


def normalize_ai_review(raw, report: dict) -> dict:
    """把 AI 返回的 JSON **形状**收拾成"每个键都是数组"，收不了就大声报出来。

    实测（马原 40 页卷）：模型没按 schema 回 `{"explanations":[…]}`，而是直接回了一个**裸对象**
    （只有 1 条解析）。旧代码 `raw.get("explanations")` 得到 None → **整段结果被静默丢掉**，
    报告里只剩一句"AI 判型 0 题"，根本看不出是解析形状不对。
    这里兼容三种常见形状：① 正常对象；② 键的值是单个对象；③ 整个回复就是一个裸对象/裸数组。
    """
    fixed: dict = dict(raw) if isinstance(raw, dict) else {}
    notes: list[str] = []

    if isinstance(raw, list):  # ③ 裸数组：按字段归位
        fixed = {}
        for key in AI_ITEM_KEYS:
            picked = [
                item
                for item in raw
                if isinstance(item, dict) and any(m in item for m in AI_ITEM_MARKERS[key])
            ]
            if picked:
                fixed[key] = picked
        if fixed:
            notes.append("裸数组 → 按字段归位")

    for key in AI_ITEM_KEYS:  # ② 键的值是单个对象
        if isinstance(fixed.get(key), dict):
            fixed[key] = [fixed[key]]
            notes.append(f"{key}: 单对象 → 数组")

    if not any(isinstance(fixed.get(k), list) for k in AI_ITEM_KEYS):  # ③ 整个回复是裸对象
        item = {k: v for k, v in fixed.items() if not str(k).startswith("_")}
        for key in AI_ITEM_KEYS:
            if any(m in item for m in AI_ITEM_MARKERS[key]):
                fixed[key] = [item]
                notes.append(f"裸对象 → 归入 {key}")
                break

    if notes:
        report["ai_shape_fixed"].extend(notes)
    if not any(isinstance(fixed.get(k), list) for k in AI_ITEM_KEYS):
        preview = str(raw)[:200]
        c.warn(f"AI 终审返回的形状无法识别，本次结果整段忽略；原文前 200 字：{preview}")
        report["ai_shape_broken"].append(preview)
    return fixed


def ai_review(
    entries: list[dict],
    pages_dir: Path,
    pages: list[int],
    work_dir: Path,
    category: str,
    cfg: dict,
    args,
    report: dict,
) -> dict | None:
    """调一次 DeepSeek 做全卷终审（判重/答案对位）。结果缓存，重跑不重复花钱。"""
    cache_path = work_dir / "paper-review.json"
    if cache_path.exists() and not args.refresh_review:
        cached = c.read_json(cache_path)
        c.always(
            f"[{STAGE}] AI 终审：复用 {cache_path.name}"
            f"（判重 {len(cached.get('duplicates') or [])}、答案 {len(cached.get('answers') or [])}；"
            f"要重跑加 --refresh-review）"
        )
        return cached
    if not cfg.get("api_key"):
        c.warn("没配 DEEPSEEK_API_KEY，跳过 AI 终审（判重/答案对位都不会做）")
        return None

    # **只喂答案页的原文**。以前这里传的是全部页，24k 字符预算从第 1 页开始截 →
    # 答案页（卷尾）被整段截掉，AI 根本没见过答案表（实测：答案 0 条）。
    answer_pages = transcription_answer_pages(pages_dir, pages)
    snippets = answer_table_snippets(pages_dir, answer_pages or pages)
    payload = build_review_payload(cfg.get("model"), entries, snippets, args.ai_max_tokens)
    c.info(f"    AI 终审：{len(entries)} 题 + {len(snippets)} 段答案表 → {cfg.get('model')}")
    started = time.perf_counter()
    response = c.post_json(str(cfg["base_url"]), payload, cfg.get("api_key"), timeout=args.ai_timeout)
    text, field = c.response_text_ex(response)
    finish = c.response_finish_reason(response)
    tokens = c.usage_tokens(response.get("usage"))
    report["ai_usage"] = tokens
    try:
        raw, repair = c.extract_json(text)
    except c.ApiError as exc:
        raise c.ApiError(f"AI 终审失败：{exc}{c.reasoning_hint(field, finish, args.ai_max_tokens, 'merge')}") from exc
    raw["_meta"] = {
        "model": cfg.get("model"),
        "elapsed_ms": c.human_ms(started),
        "usage": response.get("usage") if isinstance(response.get("usage"), dict) else {},
        "finish_reason": finish,
        "json_truncated": bool(repair.get("truncated")),
        "answer_table_snippets": len(snippets),
    }
    raw = normalize_ai_review(raw, report)
    # **不许"质量骤降"的结果静默覆盖缓存**：实测 403 题的卷子，输出预算不够时模型只回
    # 1 条答案（上一次同一份卷子给了 298 条）—— 覆盖后 md 从"有答案 346"退回"101"，
    # 而 S5 只会告诉你"302 道会被丢弃"，完全看不出是 AI 那次偷懒。
    if cache_path.exists():
        old = c.read_json(cache_path) or {}
        old_n = len(old.get("answers") or []) + len(old.get("questionTypes") or [])
        new_n = len(raw.get("answers") or []) + len(raw.get("questionTypes") or [])
        if old_n >= 20 and new_n < old_n // 3:
            c.warn(
                f"AI 终审这次只给了 {new_n} 条结果（缓存里上一次是 {old_n} 条）——"
                f"疑似输出被截断/形状异常，**保留旧缓存不覆盖**。"
                f"确认要覆盖：删掉 {cache_path.name} 后重跑（或加大 --ai-max-tokens）"
            )
            report["ai_review_regressed"].append((old_n, new_n))
            return old
    c.write_json_atomic(cache_path, raw)
    c.always(
        f"[{STAGE}] AI 终审：{c.human_ms(started)}ms / {c.human_tokens(tokens)} tok → "
        f"判重 {len(raw.get('duplicates') or [])}、答案 {len(raw.get('answers') or [])}"
        f"、题型 {len(raw.get('questionTypes') or [])}（{cache_path.name}）"
    )
    return raw


def apply_ai_review(entries: list[dict], review: dict, report: dict) -> list[dict]:
    """按 AI 终审结论改题：**删重复 → 题号顺延 → 答案重新对位**。

    - 删重复：按 `duplicates[].number` 匹配（keepNumber 优先保留），**直接删**、不改 needs_review。
    - 题号顺延：**只在真的删过题时**做，且**按题组**重新连续编号（从该组第一题的原题号开始）——
      这样"删掉的那题之后所有题号减 1"自然成立，也不会动到没有重复的题组。
    - 答案对位：`answers[]` 给的是**顺延后**的题号 → 答案，逐条覆盖（answerText 跟着选项重算）。
    """
    if not review:
        return entries
    # AI 用**清单序号**引用题目。序号按 AI 看到的顺序编，**必须在删重复之前**记下来
    # （删完 entries 就整体前移了；而且对象引用稳定，删掉的题自然查不到）。
    by_index: dict[int, dict] = {index: entry for index, entry in enumerate(entries, start=1)}
    duplicates = review.get("duplicates") or []
    drop_positions: set[int] = set()
    by_number: dict[int, list[int]] = {}
    for index, entry in enumerate(entries):
        number = entry["q"].get("number")
        if isinstance(number, int):
            by_number.setdefault(number, []).append(index)

    for dup in duplicates:
        if not isinstance(dup, dict):
            continue
        number = dup.get("number")
        keep = dup.get("keepNumber")
        candidates = by_number.get(number) if isinstance(number, int) else None
        if not candidates:
            report["ai_review_skipped"].append(f"判重要删的第 {number} 题没找到，已忽略")
            continue
        target = next((i for i in candidates if entries[i]["q"].get("number") != keep), candidates[-1])
        # **删之前用全文题干校验**：AI 只看到摘要（头+尾），材料题的小问可能"看起来一样"。
        # 只有"保留项里确实有一条与它全文题干相同"才敢删（实测踩过：AI 把材料下的
        # 第 2、3 个小问当成第 1 问的重复，删掉后小问就丢了）。
        keepers = by_number.get(keep) if isinstance(keep, int) else None
        target_stem = norm_stem(entries[target]["q"].get("stem"))
        if not keepers or not any(
            norm_stem(entries[i]["q"].get("stem")) == target_stem for i in keepers
        ):
            report["ai_review_skipped"].append(
                f"判重要删的第 {number} 题与保留的第 {keep} 题**全文题干并不相同**"
                "（多半是公共题干前缀相同造成的误判），已拒绝删除"
            )
            continue
        drop_positions.add(target)
        q = entries[target]["q"]
        report["ai_duplicates"].append(
            (q.get("number"), keep, str(dup.get("reason") or "")[:80])
        )

    if drop_positions:
        entries = [entry for index, entry in enumerate(entries) if index not in drop_positions]
        # 题号顺延：按题组连续重编（从该组第一题的原题号起）
        groups: dict[str, list[dict]] = {}
        for entry in entries:
            groups.setdefault(entry["numeral"], []).append(entry)
        for group_entries in groups.values():
            numbers = [e["q"].get("number") for e in group_entries if isinstance(e["q"].get("number"), int)]
            if not numbers:
                continue
            start = min(numbers)
            for offset, entry in enumerate(group_entries):
                entry["q"]["number"] = start + offset

    answers = review.get("answers") or []
    # **按 (大题, 题号) 找题**：很多卷子（含马原 40 页卷）按"绪论/第一章/第二章"分节，
    # **每章题号都从 1 重新开始** —— 只按题号查会全部落到同一道题上（旧代码的 dict 推导
    # 还会静默保留最后一个 entry）。AI 被要求在 answers[].group 里原样抄回大题名。
    by_place: dict[tuple[str, int], dict] = {}
    by_number: dict[int, list[dict]] = {}
    for entry in entries:
        number = entry["q"].get("number")
        if not isinstance(number, int):
            continue
        bucket = section_bucket(entry["q"].get("group"), entry["q"].get("groupTitle"))
        by_place[(bucket, number)] = entry
        by_number.setdefault(number, []).append(entry)

    for item in answers:
        if not isinstance(item, dict):
            continue
        key = flatten(item.get("answerKey")).upper()
        # **优先按 AI 抄回的 #序号 找题**（题号/大题名不可靠时唯一无歧义的引用）
        raw_index = item.get("index")
        entry = by_index.get(raw_index) if isinstance(raw_index, int) else None
        if entry is None:
            number = item.get("number")
            if not isinstance(number, int):
                continue
            bucket = section_bucket(item.get("group"), item.get("groupTitle"))
            entry = by_place.get((bucket, number))
            if entry is None:
                # 大题名对不上时，只有"全卷只有这一道该题号"才敢用题号兜底
                candidates = by_number.get(number) or []
                entry = candidates[0] if len(candidates) == 1 else None
        if not entry or not key:
            continue
        text = option_text(entry["q"], key)
        before = flatten(entry["q"].get("answerKey"))
        if before == key:
            continue
        if before:
            # **已经有答案就不覆盖**。实测：这份卷子每个大题都从 1 重新编号，AI 把
            # 「一、单项选择题 第4题=B」贴到了「二、多项选择题 第4题」上，把卷面答案表里的
            # ABC 改成了 B —— 卷面答案表（S4 已按大题贴好）比 AI 的按位置猜更可靠。
            report["ai_answer_conflicts"].append((entry["page"], number, before, key))
            continue
        # 字母答案只对**有这些选项的题**成立。实测：主观题（没有选项、只有评分标准）
        # 也被 AI 按题号塞了个 `D`，站上就成了假答案。
        option_keys = {str(o.get("key") or "").upper() for o in entry["q"].get("options") or []}
        if not option_keys or not all(ch in option_keys for ch in key):
            report["ai_answer_ignored"].append((entry["page"], number, key, len(option_keys)))
            continue
        report["ai_answers"].append((number, before or "（无）", key, text[:20], str(item.get("reason") or "")[:40]))
        entry["q"]["answerKey"] = key
        entry["q"]["answerText"] = text or entry["q"].get("answerText") or ""
    apply_ai_types(entries, review, report, by_index)
    return entries


def apply_ai_types(
    entries: list[dict], review: dict, report: dict, by_index: dict | None = None
) -> None:
    """按 AI 的判型结果补正题型，并交叉验证多选答案有没有漏读（用户："用 ai 判断"）。

    为什么必须靠 AI：**答案表本身不写"这题是多选"**，而每道题都挂着好几个选项 ——
    只有大题标题（"二、多项选择题"）或"答案有几个字母"能区分；两者都缺时就只能读题判。

    判据优先级（卷面 > 答案 > AI）：
      1. 卷面大题标题认得出来 → **以卷面为准**；AI 不同意就记进 `ai_type_conflicts[]` 给人看；
      2. 标题认不出（模型没写大题名）→ 采用 AI 的判定，记进 `type_from_ai[]`；
      3. **交叉验证**：判定为 `multi` 但答案只有一个字母 → 答案表很可能漏读了，
         记进 `multi_answer_suspect[]` 并标 `needs_review`（这正是"多选只抄到一个字母"的形态）。
    答案本身仍以卷面答案表为权威：卷面没有、AI 才给的才采用（`answers_from_ai[]`）；
    两者不一致只记 `ai_answer_conflicts[]`，不偷偷改。
    """
    items = review.get("questionTypes") or []
    if not items:
        return
    index: dict[tuple[str, int], dict] = {}
    for entry in entries:
        q = entry["q"]
        try:
            number = int(q.get("number"))
        except (TypeError, ValueError):
            continue
        index[(section_bucket(q.get("group"), q.get("groupTitle")), number)] = entry

    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            number = int(item.get("number"))
        except (TypeError, ValueError):
            number = None
        raw_index = item.get("index")
        # schema 现在要求 AI 用 `#序号` 引用题目（题号/大题名不可靠）→ **不能强求 number**
        if not isinstance(raw_index, int) and number is None:
            continue
        bucket = section_bucket(item.get("group"), item.get("groupTitle"))
        # 优先按 AI 抄回的 #序号（题号/大题名不可靠时唯一无歧义的引用）
        raw_index = item.get("index")
        entry = (by_index or {}).get(raw_index) if isinstance(raw_index, int) else None
        if entry is None:
            entry = index.get((bucket, number))
        if entry is None:  # 大题名对不上时，只有"全卷只有这一道该题号"才敢用题号兜底
            candidates = [e for (_b, n), e in index.items() if n == number]
            entry = candidates[0] if len(candidates) == 1 else None
        if entry is None:
            continue
        q = entry["q"]
        declared = str(item.get("questionType") or "").strip().lower()
        if declared not in c.QUIZ_TYPES:
            continue
        current = str(q.get("questionType") or "")
        reason = str(item.get("reason") or "")[:60]
        if declared != current:
            from_section = c.question_type_from_section(
                f"{q.get('group') or ''} {q.get('groupTitle') or ''}"
            )
            if from_section:
                report["ai_type_conflicts"].append(
                    (entry["page"], number, current, declared, from_section, reason)
                )
            else:
                report["type_from_ai"].append((entry["page"], number, current or "未定", declared, reason))
                q["questionType"] = declared
                current = declared
        report["ai_types"].append(
            (entry["page"], number, str(q.get("group") or "")[:20], current, str(item.get("answerKey") or ""))
        )
        key = flatten(q.get("answerKey")).upper()
        ai_key = re.sub(r"[^A-E]", "", str(item.get("answerKey") or "").upper())
        if current == "multi" and len(key) == 1:
            # 多选却只有一个答案字母 —— 答案表大概率漏读了（实测 `1.C` vs 真值 `1.CE`）
            report["multi_answer_suspect"].append((entry["page"], number, key, ai_key or "（AI 没给）"))
            q["needs_review"] = True
        elif key and ai_key and key != ai_key:
            report["ai_answer_conflicts"].append((entry["page"], number, key, ai_key))
        elif not key and ai_key:
            # 同样要卡"字母答案只对有这些选项的题成立"：实测 marxism-5 的**案例分析题**
            # （没有选项、答案是评分标准）被 AI 按"答案项数"塞了 `CD`/`CDE`，
            # md 里就成了 `**正确答案：CD 想问题做事情要一切从实际出发…**` —— 半截假答案。
            option_keys = {str(o.get("key") or "").upper() for o in q.get("options") or []}
            if not option_keys or not all(ch in option_keys for ch in ai_key):
                report["ai_answer_ignored"].append((entry["page"], number, ai_key, len(option_keys)))
                continue
            q["answerKey"] = ai_key
            text = "、".join(option_text(q, ch) for ch in ai_key if option_text(q, ch))
            if text:
                q["answerText"] = text
            report["answers_from_ai"].append((entry["page"], number, ai_key))


# ── 6.6) 补解析：给**没有解析**的题补一句 AI 解析 ─────────────────────────
# 用户要求「尽量所有题目都生成解析」。S3 每页只给"卷面没印解析"的题写一句（还常因
# 模型偷懒/被 max_tokens 截断而留空），所以这里在 S4 全卷兜一次：**只补空的**，
# 卷面印的解析（explanationSource=printed）绝不动。
AI_EXPLAIN_SYSTEM = (
    "你是解题老师。请给每道题写一句**简短**解析（中文 ≤80 字）：直接说为什么选它、"
    "其他选项错在哪；有公式/推导就给关键一步。不要写「根据题意可知」这类废话。"
    "只输出一个 JSON 对象，不要解释、不要代码围栏。"
)

AI_EXPLAIN_SCHEMA = """请输出如下 JSON（键名固定）：

{"explanations": [{"number": 3, "group": "一、单项选择题", "explanation": "……"}]}

规则：
1) 上面每道题都要给一条；`group` 原样抄回（很多卷子每个大题都从 1 重新编号，只写题号对不上）。
2) 答案以卷面为准（已给你），解析要能**支持这个答案**；如果你认为答案本身有问题，
   解析里用一句话说明理由即可，不要改答案。
3) 主观题（没有选项）按参考答案/评分标准写一句"得分点"提示。
4) 实在写不出（题干残缺到读不懂）就把 explanation 留空字符串。"""


def build_explain_payload(model: str | None, entries: list[dict], max_tokens: int) -> dict:
    lines = ["【需要写解析的题目】"]
    for entry in entries:
        q = entry["q"]
        options = " / ".join(f"{o['key']}.{o['text']}" for o in q.get("options") or [])
        answer = (
            f"{q.get('answerKey')} {flatten(q.get('answerText'))[:60]}"
            if flatten(q.get("answerKey"))
            else (flatten(q.get("answerText"))[:120] or "（卷面未给）")
        )
        lines.append(
            f"- 第{q.get('number')}题（大题={q.get('group') or '未写'}）{snippet(q.get('stem'))}"
            + (f"  [{options[:200]}]" if options else "")
            + f"  正确答案={answer}"
        )
    lines += ["", AI_EXPLAIN_SCHEMA]
    return {
        "model": model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": AI_EXPLAIN_SYSTEM},
            {"role": "user", "content": "\n".join(lines)},
        ],
    }


def ai_fill_explanations(
    entries: list[dict], work_dir: Path, cfg: dict, args, report: dict
) -> None:
    """给没有解析的题补解析（一次调用；结果缓存，重跑不重复花钱）。"""
    targets = [
        e for e in entries if not flatten(e["q"].get("explanation")) and flatten(e["q"].get("stem"))
    ]
    if not targets:
        c.info("    补解析：所有题都已有解析，跳过")
        return
    cache_path = work_dir / "explanations.json"
    raw: dict | None = None
    if cache_path.exists() and not args.refresh_review:
        raw = c.read_json(cache_path)
        c.always(f"[{STAGE}] 补解析：复用 {cache_path.name}（要重跑加 --refresh-review）")
    elif cfg.get("api_key"):
        payload = build_explain_payload(cfg.get("model"), targets, args.ai_max_tokens)
        c.info(f"    补解析：{len(targets)} 题 → {cfg.get('model')}")
        started = time.perf_counter()
        # **返回值格式不对就重跑**（用户要求）：解析失败、或没拿到 explanations 键，
        # 都算"格式不对"→ 最多重试 2 次（共 3 次尝试）。以前一次不成/形状不对就静默接受，
        # 实测出现过"18 题只回 1 条"的情况。
        raw = None
        for attempt in range(1, 4):
            response = c.post_json(
                str(cfg["base_url"]), payload, cfg.get("api_key"), timeout=args.ai_timeout
            )
            text, field = c.response_text_ex(response)
            tokens = c.usage_tokens(response.get("usage"))
            report["ai_usage"] = (report.get("ai_usage") or 0) + tokens
            try:
                candidate, _repair = c.extract_json(text)
            except c.ApiError as exc:
                if attempt < 3:
                    c.warn(f"补解析第 {attempt} 次返回不是合法 JSON，重跑：{str(exc)[:80]}")
                    continue
                c.warn(
                    f"补解析失败（跳过）：{exc}"
                    f"{c.reasoning_hint(field, c.response_finish_reason(response), args.ai_max_tokens, 'merge')}"
                )
                return
            if not isinstance(candidate.get("explanations"), list) and not isinstance(
                candidate, dict
            ):
                pass
            if not (candidate.get("explanations") or candidate.get("解释")):
                if attempt < 3:
                    c.warn(
                        f"补解析第 {attempt} 次返回值里没有 `explanations`（形状不对），重跑"
                    )
                    continue
                report["ai_shape_broken"].append(f"补解析：缺 explanations 键（{str(candidate)[:120]}）")
                c.warn("补解析连续 3 次都没按格式返回，已放弃（记进 report.md）")
                return
            raw = candidate
            break
        if raw is None:
            return
        c.write_json_atomic(cache_path, raw)
        c.always(
            f"[{STAGE}] 补解析：{c.human_ms(started)}ms / {c.human_tokens(tokens)} tok → "
            f"{len(raw.get('explanations') or [])} 条（{cache_path.name}）"
        )
    else:
        c.warn("没配 DEEPSEEK_API_KEY，跳过补解析")
        return
    if not raw:
        return

    index: dict[tuple[str, int], dict] = {}
    for entry in entries:
        q = entry["q"]
        try:
            number = int(q.get("number"))
        except (TypeError, ValueError):
            continue
        index[(section_bucket(q.get("group"), q.get("groupTitle")), number)] = entry
    for item in raw.get("explanations") or []:
        if not isinstance(item, dict):
            continue
        try:
            number = int(item.get("number"))
        except (TypeError, ValueError):
            continue
        bucket = section_bucket(item.get("group"), item.get("groupTitle"))
        entry = index.get((bucket, number))
        if entry is None:
            candidates = [e for (_b, n), e in index.items() if n == number]
            entry = candidates[0] if len(candidates) == 1 else None
        text = flatten(item.get("explanation"))
        if entry is None or not text or flatten(entry["q"].get("explanation")):
            continue
        entry["q"]["explanation"] = text
        entry["q"]["explanationSource"] = "generated"
        report["explanations_from_ai"].append(
            (entry["page"], number, str(entry["q"].get("group") or "")[:16], len(text))
        )

    # 主观题（没有选项）的"答案"就是**评分标准** —— 它本身就是最贴切的解析，
    # 不必再让 AI 编一段（用户要求"尽量所有题目都生成解析"）。
    for entry in entries:
        q = entry["q"]
        if flatten(q.get("explanation")) or q.get("options"):
            continue
        criteria_text = flatten(q.get("answerText"))
        if not criteria_text:
            continue
        q["explanation"] = f"评分标准：{criteria_text}"
        q["explanationSource"] = "printed"
        report["explanations_from_criteria"].append((entry["page"], q.get("number")))


# ── 6) 完整性复查 + 渲染 ────────────────────────────────────────────────
GROUP_COUNT_RE = re.compile(r"共\s*(\d+)\s*[题問问]")


def paper_title(document: dict, category: str) -> str:
    """题单名（= 卷名）：`{title}（{variant}）{date}`，拼不出东西就用分类名。"""
    identity = document.get("paper_identity") or {}
    title = flatten(identity.get("title"))
    variant = flatten(identity.get("variant"))
    date = flatten(identity.get("date"))
    parts = title or category
    if variant and variant not in parts:
        parts += f"（{variant}）"
    if date and date not in parts:
        parts += date
    return parts.strip() or category


def collapse_groups(entries: list[dict], document: dict, category: str, report: dict) -> None:
    """把题组划分收成 **1 个**：全卷作为一张题单（用户 2026-09-22 要求取消「选择题/判断题」这种划分）。

    注意：**必须在 attach_shared_stems / check_group_counts 之后调用** ——
    那两个步骤依赖"按题型分的题组"来定位公共题干和核对题数，收拢后就找不到题组边界了。

    为什么还保留一个 `## 题组一：…` 标题：解析端没有 `## 题组X：` 时会把所有题挂到 `g00`
    且 `groupTitle` 为空 —— 站上的题单名会变成空白。所以留一个标题装卷名。
    """
    title = paper_title(document, category)
    for entry in entries:
        entry["numeral"] = "一"
        entry["group_title"] = title
    report["groups"] = [("一", title)]
    report["notes"].append(f"已取消题型分题组：全卷 1 张题单「{title}」")


def check_group_counts(entries: list[dict], report: dict) -> None:
    """题组标题里写了「共 N 题」的，按最终题数核对一遍。

    这是**跨页才做得成**的检查（一个题组可能横跨两页），所以放在 S4 而不是 S3。
    实测这份卷子：题组一 共10题→10、题组二 共9题→9、题组三 共5题→5、题组四 共 5 题→5，全对。
    """
    declared: dict[str, tuple[int, str]] = {}
    for entry in entries:
        for title in (entry.get("group_title"), entry["q"].get("groupTitle")):
            match = GROUP_COUNT_RE.search(str(title or ""))
            if match:
                declared.setdefault(entry["numeral"], (int(match.group(1)), str(title)))
    for numeral, (expected, title) in declared.items():
        actual = sum(1 for e in entries if e["numeral"] == numeral)
        if actual != expected:
            report["count_mismatch"].append((numeral, expected, actual, title))
    # 题组标题太长通常是模型把"整段公共题干"塞进了 groupTitle（实测重跑 S3 后题组六变成这样）。
    # 不替它编名字（那属于编造），只提醒人工在 report 里改短。
    for numeral, title in report.get("groups") or []:
        if len(title) > 40:
            report["long_group_titles"].append((numeral, len(title), title[:60]))


def strip_answer_lines(entries: list[dict], report: dict) -> None:
    """把**混进题干里的答案区**剥掉（用户要求："确保答案不会出现在问题中"）。

    为什么会有：不少卷子把答案表印在**第 1 页顶部**，S3 抽取时整段抄进了题干 / 当成了公共题干，
    于是答案被复制到十几道题的题干上方（实测 试卷1：15 道小题带着答案表）。

    答案行的长相很固定（见 `ANSWER_LIKE_LINE`）：`1~5 ADAAD`、`1、ABCD 2、ABD`、
    `四、判断题 1~4 × √ × ×`。它们**永远不属于题干**，逐行删掉并记进 report。
    """
    for entry in entries:
        q = entry["q"]
        stem = str(q.get("stem") or "")
        if not stem:
            continue
        kept: list[str] = []
        dropped = 0
        for line in stem.split("\n"):
            if ANSWER_LIKE_LINE.match(line.strip()):
                dropped += 1
                continue
            kept.append(line)
        if dropped:
            q["stem"] = "\n".join(kept).strip()
            report["answer_lines_stripped"].append(
                (entry["page"], q.get("number"), dropped)
            )


def renumber_if_duplicated(entries: list[dict], report: dict) -> list[dict]:
    """题号重复时**按大题顺序重排 + 全卷重新连续编号**（1..N），返回新列表。

    很多卷子每个大题都从 1 重新编号（一、单项 1-15；二、多项 1-5；三、辨析 1-2…）。
    md 契约要求 `### 第N题` 唯一 —— 直接输出会让 S5 报"重复题号"硬错误，
    解析端的 `id` 也会撞车（`-2` 后缀）。

    排序不能只按原题号（那样单选 1/多选 1/辨析 1 会交错），要**按大题首次出现的顺序**
    再按原题号 —— 得到的就是卷面上的阅读顺序。原题号与去向记进 report，方便人工回查。
    """
    numbers = [e["q"].get("number") for e in entries]
    duplicates = {n for n in numbers if numbers.count(n) > 1}
    if not duplicates:
        return entries

    def bucket_of(entry: dict) -> str:
        q = entry["q"]
        return section_bucket(q.get("group"), q.get("groupTitle"))

    order: dict[str, int] = {}
    for entry in entries:
        order.setdefault(bucket_of(entry), len(order))
    ordered = sorted(
        entries, key=lambda e: (order[bucket_of(e)], int(e["q"].get("number") or 0))
    )
    for index, entry in enumerate(ordered, start=1):
        before = entry["q"].get("number")
        if before != index:
            report["renumbered"].append(
                (before, index, str(entry["q"].get("group") or "")[:18])
            )
        entry["q"]["number"] = index
    report["renumber_note"] = (
        f"原卷每个大题都从 1 重新编号（重复题号 {sorted(n for n in duplicates if n is not None)}），"
        f"已按大题顺序重排并编号 1..{len(ordered)}"
    )
    return ordered


def review_completeness(entries: list[dict], report: dict) -> None:
    """字段完整性检查 —— **按题型区分**，别把填空题当成坏题。

    实测（Principles-of-Marxism）：主观题/填空题本来就不给选项，旧逻辑对它们同时报
    "选项不足 2 个"和"答案不在选项里"，一口气把 13 道正常的题标成待复核。
    """
    for entry in entries:
        q = entry["q"]
        problems: list[str] = []
        quiz_type = str(q.get("questionType") or "")
        options = q.get("options") or []
        keys = {str(o.get("key") or "").upper() for o in options}
        if not flatten(q.get("stem")):
            problems.append("题干为空")
        if len(options) < 2 and quiz_type != "fill":
            problems.append(f"选项不足 2 个（{len(options)}）")
        key = flatten(q.get("answerKey")).upper()
        if not key and not flatten(q.get("answerText")):
            # 主观题/填空题的答案是**文本**（评分标准），只在两个字段都空时才算缺答案
            problems.append("缺答案")
        elif key and options and not all(ch in keys for ch in key):
            problems.append(f"答案 {key} 不在选项里")
        entry["problems"] = problems
        if problems:
            q["needs_review"] = True
            report["incomplete"].append((entry["page"], q.get("number"), "；".join(problems)))


def render_question(entry: dict) -> str:
    q = entry["q"]
    number = int(q.get("number") or 0)
    key = flatten(q.get("answerKey")).upper()
    answer_text = flatten(q.get("answerText")) or option_text(q, key)
    lines = [f"### 第{number}题", "", "#### 题目", "", sanitize_block(q.get("stem"))]
    translation = sanitize(q.get("translation"))
    if translation:
        lines += ["", f"题目翻译：{translation}"]
    lines.append("")
    for item in q.get("options") or []:
        lines.append(f"{str(item.get('key') or '').upper()}. {sanitize(item.get('text'))}")
    # 待复核标记放在题目区（解析端 `:289-290` 会跳过 `>` 开头行，不污染题干）
    marks: list[str] = []
    for conflict in entry.get("conflicts") or []:
        marks.append(f"OCR 冲突：{conflict.get('field')}（A 路「{conflict.get('a')}」/ B 路「{conflict.get('b')}」）")
    if q.get("_splice_note"):
        marks.append(str(q["_splice_note"]))
    for problem in entry.get("problems") or []:
        marks.append(problem)
    # 模型自己标的 needs_review / 低置信度也要落到 md 里 —— 否则解析端（P6）根本不知道哪些题要复核，
    # 这批信息就断在 P4 了（md 是流水线与网站之间唯一的接口）。
    if q.get("needs_review") and not marks:
        marks.append(f"模型标记待复核（置信度 {q.get('confidence') or '未知'}）")
    for mark in dict.fromkeys(marks):
        lines.append(f"> ⚠ 待核对：{mark}")
    lines += ["", "#### 答案与解析", ""]
    if key:
        # 解析端的正则要求答案后面**至少还有一个字符**（`.+?`），所以不能只写 `**正确答案：B**`
        lines.append(f"**正确答案：{key} {answer_text or key}**")
    elif answer_text:
        # **没有选项字母、但有答案文本**（主观题/填空题的参考答案、评分标准）——
        # 以前这里一律写 `（待补）`，把已经 OCR 到的答案**整段丢掉**（用户："答案不输出"）。
        # 解析端已同步支持"纯文本答案行"（`**正确答案：<正文>**`）。
        lines.append(f"**正确答案：{answer_text}**")
    else:
        lines.append("**正确答案：（待补）**")
    explanation = sanitize(q.get("explanation"))
    if explanation:
        lines += ["", explanation]
    # AI 生成的解析要标出来：站上 `answerProvenance` 是个纯数据字段（UI 不显示），
    # 所以这里在解析末尾留一行可见的引用 —— 解析端会把它一起存进 explanation，读者看得到。
    if explanation and str(q.get("explanationSource") or "").strip().lower() == "generated":
        lines += ["", GENERATED_NOTE]
    lines.append("")
    return "\n".join(lines)


def render_md(
    category: str, document: dict, group_order: list[str], group_titles: dict, entries: list[dict]
) -> str:
    source = document.get("source") or ""
    sha8 = str(document.get("sha256") or "")[:8]
    pages = len(document.get("rendered_pages") or [])
    head = [
        f"# {category}",
        "",
        f"> 来源：`{source}`（sha256 前 8 位：`{sha8}`，共 {pages} 页）",
        f"> 生成：双路 step-3.7-flash OCR + deepseek-flash 比对提取；待复核项见 `report.md`",
        "",
    ]
    body: list[str] = []
    for numeral in group_order:
        group_entries = [e for e in entries if e["numeral"] == numeral]
        if not group_entries:
            continue
        body += [f"## 题组{numeral}：{flatten(group_titles.get(numeral, ''))}", ""]
        for entry in group_entries:
            body.append(render_question(entry))
    return "\n".join(head + body).rstrip() + "\n"


def render_transcription(document: dict, pages, pages_dir: Path) -> str:
    source = document.get("source") or ""
    lines = [
        f"# {source} — 双路 OCR 转写汇总",
        "",
        "模型：step-3.7-flash（两路）。按 PDF 物理页排列；A 路逐字保版面、B 路按题结构化，"
        "两路不一致处见 `report.md`。此稿仅供人工核对，未解题、未生成标准答案。",
        "",
    ]
    for page in pages:
        lines += [f"## PDF 第 {page} 页", ""]
        for label, name in (("a", "A 路（逐字转写）"), ("b", "B 路（按题结构化）")):
            path = pages_dir / f"page-{page:03d}.{label}.review.json"
            if not path.exists():
                lines += [f"### {name}", "", "（缺该路结果）", ""]
                continue
            review = c.read_json(path)
            lines += [f"### {name}", "", str(review.get("transcription_md") or "").strip(), ""]
    return "\n".join(lines).rstrip() + "\n"


def render_report(
    category: str, entries: list[dict], report: dict, all_conflicts: list[dict], failures: list[str]
) -> str:
    review = [e for e in entries if e["q"].get("needs_review")]
    generated = sum(
        1 for e in entries if str(e["q"].get("explanationSource") or "").lower() == "generated"
    )
    printed = sum(
        1 for e in entries if str(e["q"].get("explanationSource") or "").lower() == "printed"
    )
    lines = [
        f"# {category} — 待人工复核清单",
        "",
        f"- 题数：**{len(entries)}**（其中待复核 **{len(review)}**）",
        f"- 解析来源：卷面原文 {printed} 题 / **AI 生成 {generated} 题** / 其余无解析",
        f"- 题组：{len(report['groups'])} → " + "、".join(f"题组{n}" for n, _ in report["groups"]),
        f"- 跨页拼接：{len(report['splices'])} 处成功 / {len(report['splice_failed'])} 处失败",
        f"- OCR 冲突：{len(all_conflicts)} 条；判断题自动补选项：{len(report['judgement_filled'])} 题；"
        f"题干末尾答案标记已清理：{len(report['answer_mark_stripped'])} 题；"
        f"答案文本已按选项校正：{len(report['answer_text_fixed'])} 题；"
        f"字段格式化：{len(report['s3_normalized'])} 次",
        f"- 去重：{len(report['duplicates'])} 题；S3 页内判重删除：{len(report['s3_deduped'])} 题；"
        f"缺页/缺产物：{len(failures)}",
        f"- 公共题干：{len(report['shared_stems'])} 个题组已复制到 "
        f"{len(report['shared_stem_inlined'])} 道小题的题干上方"
        + (f"；{len(report['shared_stem_missing'])} 个题组取不到导言（需人工补）" if report["shared_stem_missing"] else ""),
        f"- 材料题：{len(report['material_stems'])} 段材料已复制到 "
        f"{len(report['material_inlined'])} 道小题的题干上方",
        f"- 答案来源：参考答案页 {len(report['answer_key_pages'])} 张（转写挖到 "
        f"{sum(mined for _p, _rows, _k, mined in report['answer_key_pages'])} 条 / 模型给了 "
        f"{sum(keys for _p, _rows, keys, _m in report['answer_key_pages'])} 条）→ 贴回 "
        f"{len(report['answers_from_table'])} 道题（另改正 {len(report['answer_overrides'])} 道与评分标准不符的）；"
        f"不再输出 "
        f"{sum(rows for _p, rows, _k, _m in report['answer_key_pages'])} 条空题干伪题目；"
        f"题型补正 {len(report['type_from_section'])} 处 / 答案表有、题目里缺 {len(report['answer_without_question'])} 题",
        f"- AI 判型：{len(report['ai_types'])} 题（改 {len(report['type_from_ai'])} 处 / "
        f"与卷面大题标题冲突 {len(report['ai_type_conflicts'])} 处 / "
        f"多选却只有一个答案字母 {len(report['multi_answer_suspect'])} 处 / "
        f"卷面与 AI 答案不一致 {len(report['ai_answer_conflicts'])} 处）",
        "",
    ]
    if failures:
        lines += ["## 缺产物（先补跑 S2/S3）", ""] + [f"- {f}" for f in failures] + [""]
    if report["answer_key_pages"] or report["answers_from_table"]:
        answer_rows = sum(rows for _page, rows, _keys, _mined in report["answer_key_pages"])
        lines += [
            "## 参考答案 / 评分标准页（只贡献答案，不产出题目）",
            "",
            "这类页面上**没有题目，只有答案**（题干是空的）。以前它会被当成一堆"
            "「题干为空、只有答案」的题目输出 —— 站上多出一批空题 + 裸答案，"
            "而真正的题目反而大面积缺答案。现在这一页被识别成**答案表**：",
            "",
            "| 答案页 | 页上条目 | 转写挖到 | 模型给了 |",
            "|---|---|---|---|",
        ]
        lines += [
            f"| page {page} | {rows} 条 | {mined} 条 | {keys} 条 |"
            for page, rows, keys, mined in report["answer_key_pages"]
        ]
        lines += [
            "",
            f"共从答案表贴回 **{len(report['answers_from_table'])}** 道题，"
            f"答案页的 **{answer_rows}** 条空题干伪题目不再输出。",
            "",
        ]
        if report["answers_from_table"]:
            lines += ["| 页码 | 题号 | 答案 | 大题 |", "|---|---|---|---|"]
            lines += [
                f"| page {page} | {number} | {key} | {bucket} |"
                for page, number, key, bucket in report["answers_from_table"]
            ]
            lines.append("")
        if report["answers_by_order"]:
            lines += [
                f"- 其中 **{len(report['answers_by_order'])}** 道是"
                "**按顺序配对**的（答案页没印题号，题号体系对不上、但同大题两边条数相等）：",
                "",
                "| 页码 | 答案页题号 | 答案 | 大题 |",
                "|---|---|---|---|",
            ]
            lines += [
                f"| page {page} | {number} | {key} | {bucket} |"
                for page, number, key, bucket in report["answers_by_order"]
            ]
            lines.append("")
        if report["dropped_answer_rows"]:
            preview = "、".join(
                f"page {page} 第{n}题={k}" for page, n, k in report["dropped_answer_rows"][:20]
            )
            more = (
                f" 等 {len(report['dropped_answer_rows'])} 条"
                if len(report["dropped_answer_rows"]) > 20
                else ""
            )
            lines += [f"- 已丢弃（题干为空，不是真题）：{preview}{more}", ""]
        if report["answer_overrides"]:
            lines += [
                "",
                "**题目页上模型自己写的答案与评分标准不一致 → 已按评分标准改正**"
                "（多半是题目页被页边界切开、选项不全）：",
                "",
                "| 页码 | 题号 | 模型写的 | 评分标准 |",
                "|---|---|---|---|",
            ]
            lines += [
                f"| page {page} | {number} | {before} | {after} |"
                for page, number, before, after in report["answer_overrides"]
            ]
            lines.append("")
        if report["answer_table_odd"]:
            lines += ["- ⚠ 下面这些答案行**字母个数和题号区间对不上**，没敢采信（需人工核对）：", ""]
            lines += [
                f"  - page {page}：`{text}`（{count} 个字母 / 区间 {span} 题）"
                for page, text, count, span in report["answer_table_odd"]
            ]
            lines.append("")
        if report["answer_table_conflicts"]:
            lines += ["- ⚠ 两路转写的答案不一致（保留先读到的那条，需人工核对）：", ""]
            lines += [
                f"  - page {page} 大题 `{bucket}` 第 {number} 题：`{first}` vs `{second}`"
                for page, bucket, number, first, second in report["answer_table_conflicts"]
            ]
            lines.append("")
    if report["type_from_section"]:
        lines += [
            "## 题型按「卷面大题标题」补正（S3 旧数据兜底）",
            "",
            "| 页码 | 题号 | 原题型 | 补正为 |",
            "|---|---|---|---|",
        ]
        lines += [
            f"| page {page} | {number} | {before or '（未给）'} | {after} |"
            for page, number, before, after in report["type_from_section"]
        ]
        lines.append("")
    if report["material_stems"]:
        lines += [
            "## 材料题：整段材料已复制到后续小题的题干上方",
            "",
            "| 材料所在页 | 题号 | 覆盖小题 | 材料字数 |",
            "|---|---|---|---|",
        ]
        lines += [
            f"| page {page} | {number} | {count} 道 | {length} |"
            for page, number, count, length in report["material_stems"]
        ]
        lines += [
            "",
            "- 材料本身（只有材料、没有答案）已从题单里撤掉；材料内容完整保留在每道小题的题干里。",
            "",
        ]
    if report["shared_stems"]:
        lines += [
            "## 公共题干（题组导言）已复制到每道小题的题干上方",
            "",
            "每道小题的 `#### 题目` 都自带完整导言，**单看任意一题都不缺上下文**（独立成题）。",
            "",
            "| 题组 | 覆盖小题 | 导言来源 | 导言字数 |",
            "|---|---|---|---|",
        ]
        lines += [
            f"| {n} | {count} 道 | {source} | {length} |"
            for n, count, source, length in report["shared_stems"]
        ]
        lines.append("")
        if report["shared_stem_stripped"]:
            lines += [
                "- 以下小题的题干开头原本就抄了一份导言，已切掉再补标准的一份（保证只出现一次）："
                + "、".join(f"第{n}题" for n in report["shared_stem_stripped"]),
                "",
            ]
    if report["shared_stem_missing"]:
        lines += ["## ⚠ 疑似有公共题干、但取不到导言（需要人工补）", ""]
        lines += [
            f"- 题组{n}：{count} 道小题，其中 {thin} 道题干是占位符 —— merge.json 没接住导言，"
            f"OCR 转写里也没找到，请人工把导言补进该题组**每道小题**的题干开头"
            for n, count, thin in report["shared_stem_missing"]
        ]
        lines.append("")
    if report["passage_in_title"]:
        lines += ["## 题组标题其实是公共题干（已改短 + 转成 文章）", ""]
        lines += [f"- 题组{n}：原 groupTitle 长达 {length} 字" for n, length in report["passage_in_title"]]
        lines.append("")
    if report["unresolved_groups"]:
        lines += ["## ⚠ 定不出题组号的题（已沿用上一题题组）", ""]
        lines += [f"- page {page}：group=`{raw}` title=`{title}`" for page, raw, title in report["unresolved_groups"]]
        lines.append("")
    if report["incomplete"]:
        lines += ["## 字段不完整（会被解析端丢弃，必须手工补）", ""]
        lines += [f"- 第 {n} 题（page {p}）：{why}" for p, n, why in report["incomplete"]]
        lines.append("")
    if report["count_mismatch"]:
        lines += ["## 题组题数与标题声明不符", ""]
        lines += [
            f"- 题组{num}：标题写「{title}」＝共 {expected} 题，实际 {actual} 题"
            for num, expected, actual, title in report["count_mismatch"]
        ]
        lines.append("")
    if review:
        lines += ["## 待复核题目", "", "| 页 | 题号 | 题组 | 置信度 | 原因 |", "|---|---|---|---|---|"]
        for entry in review:
            q = entry["q"]
            why = entry.get("problems") or []
            if q.get("_splice_note"):
                why.insert(0, q["_splice_note"])
            if q.get("confidence") != "high":
                why.append(f"置信度 {q.get('confidence')}")
            lines.append(
                f"| {entry['page']} | {q.get('number')} | {entry['numeral']} | "
                f"{q.get('confidence')} | {'；'.join(why) or '模型标记 needs_review'} |"
            )
        lines.append("")
    if all_conflicts:
        lines += ["## OCR 两路冲突", "", "| 页 | 题号 | 字段 | A 路 | B 路 | 采信 | 依据 |", "|---|---|---|---|---|---|---|"]
        for item in all_conflicts:
            lines.append(
                f"| {item.get('page')} | {item.get('question') or '（整页）'} | {item.get('field')} | "
                f"{str(item.get('a'))[:40]} | {str(item.get('b'))[:40]} | "
                f"{str(item.get('chosen'))[:30]} | {str(item.get('reason'))[:60]} |"
            )
        lines.append("")
    if report["splice_failed"]:
        lines += ["## 跨页拼接失败", ""]
        lines += [f"- page {p} 第 {n} 题：`{s}`…" for p, n, s in report["splice_failed"]]
        lines.append("")
    if report["splice_false_alarms"]:
        lines += ["## 模型误标 continued 的题（字段完整，按完整题处理）", ""]
        lines += [f"- page {p} 第 {n} 题：选项 ≥2 且有答案" for p, n in report["splice_false_alarms"]]
        lines.append("")
    if report["s3_deduped"]:
        lines += ["## S3 页内判重删除（题干+选项完全相同 → 直接删）", ""]
        lines += [
            f"- page {item['page']} 第 {item.get('number')} 题（保留第 {item.get('keptNumber')} 题）："
            f"{item.get('reason')}"
            for item in report["s3_deduped"]
        ]
        lines.append("")
    if report["s3_normalized"]:
        agg: dict[tuple, int] = {}
        for item in report["s3_normalized"]:
            key = (
                str(item.get("field") or "?"),
                str(item.get("before") or "（空）"),
                str(item.get("after") or "（空）"),
            )
            agg[key] = agg.get(key, 0) + 1
        lines += ["## S3 字段格式化（answerKey / questionType 被规范化的地方）", ""]
        lines += [
            f"共 {len(report['s3_normalized'])} 次。原值已保留在 merge.json 的 `normalized[]` 里，"
            "md 与题库用的是右列的规范值。",
            "",
            "| 字段 | 原值 | 规范为 | 次数 |",
            "|---|---|---|---|",
        ]
        for (field, before, after), count in sorted(agg.items(), key=lambda kv: (-kv[1], kv[0])):
            lines.append(f"| {field} | `{before}` | `{after}` | {count} |")
        bad = [k for k in agg if k[2] == "（空）"]
        if bad:
            lines += [
                "",
                f"⚠ 有 {sum(agg[k] for k in bad)} 次被清空（原值不是合法答案），"
                "这些题已标 `needs_review`，需要人工补答案。",
            ]
        lines.append("")
    if report["criteria_rows"]:
        lines += [
            "## 主观题的评分标准（从答案页贴回题目上）",
            "",
            "主观题（论述/辨析/案例）的答案就是**评分标准**（\"1. 对 2分 …\"）。"
            "它们以前是答案页上的**独立行**（没有选项、没有字母答案），既没贴回题目，"
            "又被 md 渲染成 `（待补）` —— **答案抄到了却没输出**。现在：",
            "",
            f"- 收下评分标准行 **{len(report['criteria_rows'])}** 条 → "
            f"贴回题目 **{len(report['criteria_attached'])}** 道"
            + (f"（其中 {report['criteria_by_order']} 道是按顺序配对："
               f"大题名对不上、但两边数量相等）" if report["criteria_by_order"] else ""),
            "",
            "| 题号 | 大题 | 标准字数 |",
            "|---|---|---|",
        ]
        lines += [
            f"| 第 {number} 题 | {bucket} | {length} |"
            for _page, number, bucket, length in report["criteria_attached"]
        ]
        lines.append("")
        if report["criteria_unmatched"]:
            lines += [
                f"- ⚠ 还有 **{len(report['criteria_unmatched'])}** 条标准贴不出去"
                "（对不上任何主观题，**会漏答案**，见下表）：",
                "",
                "| 大题 | 题号 | 标准开头 |",
                "|---|---|---|",
            ]
            lines += [
                f"| {bucket} | {number if number is not None else '（未给）'} | {text} |"
                for bucket, number, text in report["criteria_unmatched"]
            ]
            lines.append("")
    if report["dropped_empty_rows"]:
        lines += [
            "## 空条目（题干空 + 无答案 + 无选项 → 直接丢掉，不是题）",
            "",
            f"- 丢掉 **{len(report['dropped_empty_rows'])}** 条："
            + "、".join(f"page {page} #{number}" for page, number in report["dropped_empty_rows"]),
            "",
        ]
    if report["dropped_instruction_rows"]:
        lines += [
            "## 大题说明（不是题，已丢掉）",
            "",
            "`五、辨析题。……判断下列各题的对错，并说明理由。（每题5分，共10分）` 这类**说明句**"
            "以前会变成一道「题」（题干是说明、答案是某条评分标准），还会把评分标准按顺序配错位。"
            "现在按「以大题序号开头 + 带分值说明 + 没有选项」丢掉：",
            "",
            f"- 丢掉 **{len(report['dropped_instruction_rows'])}** 条："
            + "、".join(
                f"page {page} #{number}" for page, number in report["dropped_instruction_rows"]
            ),
            "",
        ]
    if report["answer_without_question"]:
        lines += [
            "## ⚠ 答案表里有、题目里没有的题号（**OCR 很可能漏了一道题**）",
            "",
            "这种丢题是**静默**的：题号看起来连续（实测卷面把「7.」印了两遍，两路 OCR 都把它读成",
            "7、8，然后跳到卷面的「9.」—— 卷面真正的第 8 题就没了）。请对着页图人工补回：",
            "",
            "| 大题 | 题号 | 答案表给的答案 |",
            "|---|---|---|",
        ]
        lines += [
            f"| {bucket} | 第 {number} 题 | {key} |"
            for bucket, number, key in report["answer_without_question"]
        ]
        lines.append("")
    if report["ai_types"] or report["multi_answer_suspect"]:
        lines += [
            "## AI 题型判定（答案表不写「这题是多选」，只能读题判）",
            "",
            "答案表按题号给字母，**它不会标哪道是多选**；每道题又都挂着好几个选项，"
            "所以「单选还是多选」交给 AI 逐题判（判据：卷面大题标题 > 答案字母个数 > 题目内容）。",
            "",
        ]
        if report["type_from_ai"]:
            lines += ["**已按 AI 判定改掉的题型**（大题标题认不出题型时才改）：", ""]
            lines += ["| 页码 | 题号 | 原题型 | 改为 | 依据 |", "|---|---|---|---|---|"]
            lines += [
                f"| page {page} | {number} | {before} | {after} | {reason} |"
                for page, number, before, after, reason in report["type_from_ai"]
            ]
            lines.append("")
        if report["ai_type_conflicts"]:
            lines += [
                "**⚠ AI 与卷面大题标题不一致 → 保留卷面标题**（标题是卷面印的硬证据，请人工确认）：",
                "",
                "| 页码 | 题号 | 卷面推出 | AI 判定 | 依据 |",
                "|---|---|---|---|---|",
            ]
            lines += [
                f"| page {page} | {number} | {current} | {declared} | {reason} |"
                for page, number, current, declared, _from_section, reason in report["ai_type_conflicts"]
            ]
            lines.append("")
        if report["multi_answer_suspect"]:
            lines += [
                "**⚠ 判定为多选、但答案只有一个字母 → 答案表很可能漏读**（已标 needs_review）：",
                "",
                "| 页码 | 题号 | 卷面答案 | AI 认为的答案 |",
                "|---|---|---|---|",
            ]
            lines += [
                f"| page {page} | {number} | {key} | {ai_key} |"
                for page, number, key, ai_key in report["multi_answer_suspect"]
            ]
            lines.append("")
        if report["ai_answer_conflicts"]:
            lines += [
                "**⚠ 卷面答案与 AI 判断不一致 → 保留卷面答案**（卷面是权威，这里只提示）。"
                "注意 AI 容易把「一、单项选择题 第4题」的答案贴到「二、多项选择题 第4题」上"
                "（很多卷子每个大题都从 1 重新编号）：",
                "",
                "| 页码 | 题号 | 卷面 | AI |",
                "|---|---|---|---|",
            ]
            lines += [
                f"| page {page} | {number} | {key} | {ai_key} |"
                for page, number, key, ai_key in report["ai_answer_conflicts"]
            ]
            lines.append("")
        if report["ai_answer_ignored"]:
            lines += [
                "- 已忽略的 AI 答案（那些题没有对应选项 —— 主观题只有评分标准，不该有字母答案）："
                + "、".join(
                    f"page {p} 第{n}题={k}（选项 {c} 个）" for p, n, k, c in report["ai_answer_ignored"]
                ),
                "",
            ]
        if report["answers_from_ai"]:
            lines += [
                "- 卷面没给答案、由 AI 补上的题："
                + "、".join(f"page {p} 第{n}题={k}" for p, n, k in report["answers_from_ai"]),
                "",
            ]
        lines += ["<details><summary>AI 逐题判定明细</summary>", "", "| 页码 | 题号 | 大题 | AI 判定 | AI 答案 |", "|---|---|---|---|---|"]
        lines += [
            f"| page {page} | {number} | {group} | {quiz_type} | {key or '—'} |"
            for page, number, group, quiz_type, key in report["ai_types"]
        ]
        lines += ["", "</details>", ""]
    if report["ai_duplicates"] or report["ai_answers"] or report["ai_review_skipped"]:
        lines += [
            "## 全卷 AI 终审（判重 → 题号顺延 → 答案重新对位）",
            "",
            f"单次调用 {report['ai_usage']} token。删除重复题后，其后所有题号整体前移，答案按卷面答案表重新对位。",
            "",
        ]
        if report["ai_duplicates"]:
            lines += ["| 删除题号 | 保留 | 理由 |", "|---|---|---|"]
            lines += [f"| {n} | {keep} | {why} |" for n, keep, why in report["ai_duplicates"]]
            lines.append("")
        if report["ai_answers"]:
            lines += ["| 题号 | 原答案 | 新答案 | 选项文本 | 依据 |", "|---|---|---|---|---|"]
            lines += [
                f"| {n} | {before} | **{after}** | {text} | {why} |"
                for n, before, after, text, why in report["ai_answers"]
            ]
            lines.append("")
        for skipped in report["ai_review_skipped"]:
            lines += [f"- 已忽略：{skipped}", ""]
    if report["duplicates"]:
        lines += ["## 去重记录", ""]
        lines += [f"- 第 {n} 题：page {keep} 胜出（丢弃 page {drop} 的重复）" for n, keep, drop, _ in report["duplicates"]]
        lines.append("")
    if report["notes"] or report["group_title_conflicts"] or report["long_group_titles"]:
        lines += ["## 其它", ""]
        lines += [f"- {n}" for n in report["notes"]]
        lines += [f"- 题组{num} 标题不一致：以「{first}」为准，另有「{other}」" for num, first, other in report["group_title_conflicts"]]
        lines += [
            f"- 题组{num} 的标题长达 {length} 字（疑似模型把公共题干塞进了 groupTitle），建议在 md 里改短：`{preview}…`"
            for num, length, preview in report["long_group_titles"]
        ]
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_final(path: Path, text: str, force: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not force:
        c.fail(f"{path.relative_to(c.REPO_ROOT)} 已存在；确认覆盖请加 --force（硬约束 5：不动既有数据）", 1)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


# ── 入口 ────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(
        description="S4：全部 merge.json → 单个 <分类名>.md + transcription.md + report.md（docs §8）"
    )
    parser.add_argument("--category", required=True, help="分类名（= pdf-ocr/work/ 下的目录名）")
    parser.add_argument(
        "--pages",
        help="只汇总这些页，如 1-4（页码从 1 开始；写 0-3 也接受，0 视为起点；默认全部已渲染页）",
    )
    parser.add_argument(
        "--group-by",
        choices=("paper", "type"),
        default="paper",
        help="题组怎么分：paper=全卷 1 张题单（默认，取消「选择题/判断题」这类划分）；"
        "type=按原卷题型分题组",
    )
    parser.add_argument("--force", action="store_true", help="已存在的最终 .md 也覆盖")
    parser.add_argument(
        "--no-ai-review",
        action="store_true",
        help="跳过全卷 AI 终审（判重/题号顺延/答案对位）—— 跳过就完全离线、0 token",
    )
    parser.add_argument(
        "--refresh-review",
        action="store_true",
        help="重跑 AI 终审（默认复用 work/<分类名>/paper-review.json，不重复花钱）",
    )
    parser.add_argument(
        "--ai-max-tokens",
        type=int,
        default=393216,
        help="AI 终审单次响应上限，默认 393216（= **DeepSeek 端点允许的最大值**）。"
        "**推理模型**会把思维链也算进这里：实测 40 页卷 403 题 + 答案页，16384/65536 都不够它"
        "把 ~300 条答案写完（会只回几条甚至空正文），131072 才跑通。"
        "再往上（如 13000000）会被端点直接 HTTP 400 打回，所以这里顶到上限即可 —— "
        "max_tokens 只是截止线，没生成的 token 不计费，顶满不额外花钱",
    )
    parser.add_argument("--ai-timeout", type=int, default=180, help="AI 终审单次超时秒数，默认 180")
    parser.add_argument("--quiet", action="store_true", help="只打印每页完成行与最终摘要")
    args = parser.parse_args()

    c.setup_stdio()
    c.set_quiet(args.quiet)

    category = c.safe_name(args.category)
    work_dir = c.WORK_ROOT / category
    pages_dir = work_dir / "pages"
    manifest_path = work_dir / "source-manifest.json"
    if not manifest_path.exists():
        c.fail(f"找不到 {manifest_path.relative_to(c.REPO_ROOT)}；请先跑 S1", 1)

    manifest = c.read_json(manifest_path)
    document = (manifest.get("documents") or [{}])[0]
    rendered = [int(n) for n in document.get("rendered_pages") or []]
    if not rendered:
        c.fail(f"{manifest_path.name} 里没有 rendered_pages；请先跑 S1", 1)
    pages = c.parse_pages(args.pages, max(rendered)) if args.pages else rendered
    pages = [n for n in pages if n in set(rendered)]

    c.info(f"[配置] 分类名={category}  页数={len(pages)}  工作目录={work_dir.relative_to(c.REPO_ROOT)}")

    started_all = time.perf_counter()
    entries: list[dict] = []
    failures: list[str] = []
    all_conflicts: list[dict] = []
    answer_table: dict[tuple[str, int], str] = {}
    criteria: dict[tuple[str, int | None], str] = {}
    report: dict = {
        "groups": [],
        "group_title_conflicts": [],
        "judgement_filled": [],
        "answer_text_fixed": [],
        "answer_mark_stripped": [],
        "answer_key_pages": [],
        "dropped_answer_rows": [],
        "answers_from_table": [],
        "answers_by_order": [],
        "answer_without_question": [],
        "answer_rows_any_page": [],
        "ai_shape_fixed": [],
        "ai_shape_broken": [],
        "ai_review_failed": [],
        "ai_review_regressed": [],
        "answer_lines_stripped": [],
        "answer_region_rejected": [],
        "criteria_rows": [],
        "criteria_attached": [],
        "criteria_by_order": 0,
        "criteria_by_content": [],
        "criteria_unmatched": [],
        "dropped_empty_rows": [],
        "dropped_instruction_rows": [],
        "instruction_renumbered": [],
        "renumbered": [],
        "renumber_note": "",
        "answer_overrides": [],
        "answer_table_conflicts": [],
        "answer_table_odd": [],
        "ai_types": [],
        "type_from_ai": [],
        "ai_type_conflicts": [],
        "ai_answer_conflicts": [],
        "ai_answer_ignored": [],
        "answers_from_ai": [],
        "explanations_from_ai": [],
        "explanations_from_criteria": [],
        "multi_answer_suspect": [],
        "type_from_section": [],
        "material_stems": [],
        "material_inlined": [],
        "material_headers_dropped": [],
        "splices": [],
        "splice_failed": [],
        "splice_false_alarms": [],
        "duplicates": [],
        "incomplete": [],
        "count_mismatch": [],
        "long_group_titles": [],
        "passage_in_title": [],
        "shared_stems": [],
        "shared_stem_missing": [],
        "shared_stem_stripped": [],
        "shared_stem_inlined": [],
        "s3_deduped": [],
        "s3_flagged": [],
        "s3_normalized": [],
        "ai_duplicates": [],
        "ai_answers": [],
        "ai_review_skipped": [],
        "ai_usage": 0,
        "unresolved_groups": [],
        "notes": [],
    }

    # 答案页的判定与答案挖掘：**先看转写**（不依赖模型抽没抽出题）
    transcription_answer_pages_set = set(transcription_answer_pages(pages_dir, pages))
    if transcription_answer_pages_set:
        c.info(
            f"    答案页（按转写判定）：page "
            + "、".join(str(n) for n in sorted(transcription_answer_pages_set))
        )

    # ① 读入
    for index, number in enumerate(pages, start=1):
        page_started = time.perf_counter()
        merge_path = pages_dir / f"page-{number:03d}.merge.json"
        if not merge_path.exists():
            failures.append(f"page {number}: 缺 page-{number:03d}.merge.json（先跑 S3）")
            c.progress(STAGE, index, len(pages), "✗", c.human_ms(page_started), "缺 merge.json")
            c.page_done(index, len(pages), ["汇总 ✗"], total_questions=len(entries))
            continue
        page_data = c.read_json(merge_path)
        page_questions = page_data.get("questions") or []
        page_conflicts = page_data.get("conflicts") or []
        # 答案行 / 评分标准行：**没有选项、只有答案**的行不是题目。
        # 带字母答案的 → 直接进答案表（答案表可能印在**任意一页**，实测就印在第 1 页顶部）；
        # 只有文本的 → 进评分标准表（贴给主观题）。
        grading_rows = [q for q in page_questions if is_grading_row(q)]
        if grading_rows:
            # 答案行分两类：**字母答案**（含判断题的 √/×，模型常写进 answerText）→ 答案表；
            # **纯文本**（评分标准）→ 评分标准表。判据要一致，否则 √/× 会跑进评分标准里，
            # 回头被当成"主观题评分标准"贴到别的题上。
            def _letter_row(raw: dict) -> bool:
                return bool(
                    flatten(raw.get("answerKey")) or judgement_letter(raw.get("answerText"))
                )

            letter_rows = [q for q in grading_rows if _letter_row(q)]
            text_rows = [q for q in grading_rows if not _letter_row(q)]
            for place, key in answer_rows_to_table(letter_rows).items():
                answer_table.setdefault(place, key)
            if text_rows:
                criteria.update(harvest_criteria(text_rows, report))
            if len(grading_rows) != len(text_rows):
                report["answer_rows_any_page"].append((number, len(letter_rows)))
            page_questions = [q for q in page_questions if not is_grading_row(q)]
        # 卷名信息（用于"全卷 1 张题单"的题单名）——取第一份有内容的
        if not (document.get("paper_identity") or {}).get("title"):
            identity = page_data.get("paper_identity") or {}
            if any(flatten(value) for value in identity.values()):
                document["paper_identity"] = identity
        # 「参考答案 / 评分标准」页：它贡献**答案**，不贡献题目（题干本来就是空的）
        # 答案有两个来源，都收：① 两路 OCR **转写**里的答案原文（`1-5 DDDB C` / `1-5 1.CE …`）
        # —— 确定性、0 token，模型偷懒也不怕；② 模型逐题抄下来的伪题目。
        mined = 0
        if number in transcription_answer_pages_set:
            for label in ("a", "b"):
                review_path = pages_dir / f"page-{number:03d}.{label}.review.json"
                if not review_path.exists():
                    continue
                transcription = str(
                    (c.read_json(review_path) or {}).get("transcription_md") or ""
                )
                mined += mine_answers_from_transcription(
                    transcription, answer_table, number, report
                )
        # 注意：**只有"该页的题全是答案行（没有题干）"才整页不产题**。
        # 不能因为"转写里像答案页"就跳过这一页 —— 很多卷子把答案表印在**第 1 页顶部**，
        # 那一页同时还有真题；按转写判定会连真题一起丢掉（实测：试卷1 的 page 1 整页没了）。
        # 转写层面的识别只用于"把哪几页喂给 AI 对答案"。
        # 带字母答案的答案行由 is_grading_row() 逐行拦下、进答案表，不受此影响。
        if is_answer_key_page(page_data):
            harvested = harvest_answer_table(page_data)
            for place, key in harvested.items():
                answer_table.setdefault(place, key)
            report["answer_key_pages"].append(
                (number, len(page_questions), len(harvested), mined)
            )
            report["dropped_answer_rows"].extend(
                (number, q.get("number"), str(q.get("answerKey") or ""))
                for q in page_questions
                if str(q.get("answerKey") or "").strip()
            )
            for conflict in page_conflicts:
                all_conflicts.append({**conflict, "page": number})
            c.progress(
                STAGE,
                index,
                len(pages),
                "✓",
                c.human_ms(page_started),
                f"答案页：转写挖到 {mined} 条 / 模型给了 {len(harvested)} 条（不产出题目）",
            )
            c.page_done(index, len(pages), ["答案页 ✓"], total_questions=len(entries))
            continue
        for order, q in enumerate(page_questions):
            q.setdefault("source", {}).setdefault("page", number)
            # 把"点题号"的冲突挂到对应题上，md 里才能在那一题下面写出待核对原因
            mine = [
                cf
                for cf in page_conflicts
                if isinstance(cf, dict) and cf.get("question") == q.get("number")
            ]
            entries.append({"page": number, "index": order, "q": q, "conflicts": mine})
        for conflict in page_conflicts:
            all_conflicts.append({**conflict, "page": number})
        for item in page_data.get("deduped") or []:
            report["s3_deduped"].append({**item, "page": number})
        for item in page_data.get("flagged") or []:
            report["s3_flagged"].append({**item, "page": number})
        for item in page_data.get("normalized") or []:
            report["s3_normalized"].append({**item, "page": number})
        status = "⚠" if any(q.get("needs_review") for q in page_questions) else "✓"
        c.progress(
            STAGE, index, len(pages), status, c.human_ms(page_started), f"读出 {len(page_questions)} 题"
        )
        c.page_done(index, len(pages), [f"汇总 {status}"], total_questions=len(entries))

    if not entries:
        c.fail("所有页都没有题目（merge.json 里 questions 为空）；请检查 S3 结果", 1)

    # ② 加工
    # 答案表 / 大题标题 → 先落到题目上，后面几步（去重、完整性检查）才看得到正确答案
    apply_answer_table(entries, answer_table, report)
    check_answer_coverage(entries, answer_table, report)
    # **先把混进题干的答案区剥掉**，再做公共题干/材料题挂载 ——
    # 否则答案表会被当"导言"复制到一大片小题上（实测踩过）。
    strip_answer_lines(entries, report)
    normalize_question_types(entries, report)
    group_order = normalize_groups(entries, pages_dir, report)
    if len(group_order) > MAX_GROUPS:
        c.warn(
            f"题组数 {len(group_order)} 超过 {MAX_GROUPS} 个；解析端只认「一…十」单个汉字，"
            f"多出来的题组会串到「题组十」下面，请合并题组"
        )
    fill_judgement_options(entries, report)
    strip_trailing_answer_mark(entries, report)
    normalize_answer_text(entries, report)
    entries = splice_continued(entries, pages_dir, report)
    entries = sort_and_dedupe(entries, report)
    # 零信息条目（空题干+无答案+无选项）在挂导言/材料**之前**丢掉：
    # 留着它们只会让材料被复制到一道"不存在的题"上（实测 marxism-5 多出 3 道假题）。
    entries = drop_instruction_rows(entries, report)
    entries = drop_empty_rows(entries, report)
    attach_shared_stems(entries, pages_dir, report)
    entries = attach_material_passages(entries, report)
    # 贴评分标准放在材料题处理**之后**：材料标题本身也是"没有选项、没有答案的题"，
    # 它还没被撤掉时会混进候选，把"数量相等"的判断搞乱（实测）。
    apply_criteria(entries, criteria, report)
    # 全卷 AI 终审放在公共题干挂载**之后**：它用"卷面原题号"回查转写定位导言，重编号后就不准了
    if args.no_ai_review:
        c.info("    AI 终审：已按 --no-ai-review 跳过（纯离线）")
    else:
        c.check_max_tokens("merge", args.ai_max_tokens)
        try:
            review = ai_review(
                entries, pages_dir, pages, work_dir, category, c.merge_config(), args, report
            )
            entries = apply_ai_review(entries, review, report)
            ai_fill_explanations(entries, work_dir, c.merge_config(), args, report)
        except c.ApiError as exc:
            # **AI 终审失败不能拖垮整条流水线**：确定性那一层（答案行 / 答案页 / 交叉核对）
            # 已经把能贴的答案贴上了，剩下的是"少一些 AI 纠正、多一些待复核"。
            # 之前这里是直接抛异常 → S4 退出码 1 → S7 批量导入整份停下来（实测踩过：
            # 40 页卷的 AI 终审被 max_tokens 截断，8 份里就它一个失败）。
            c.warn(f"AI 终审失败，已降级继续（本卷少一层 AI 纠正，待复核会更多）：{exc}")
            report["ai_review_failed"].append(str(exc)[:300])
    entries = renumber_if_duplicated(entries, report)
    review_completeness(entries, report)
    check_group_counts(entries, report)
    for numeral, length, _preview in report["long_group_titles"]:
        c.warn(
            f"题组{numeral} 的标题长达 {length} 字（疑似模型把公共题干塞进了 groupTitle），"
            f"网站上的题单名会很难看 —— 建议在 md 里改短（见 report.md）"
        )

    # ③ 写盘
    if args.group_by == "paper":
        # 取消题型分题组：全卷 1 张题单（必须在上面那几步之后，否则公共题干/题数核对就找不到题组边界）
        collapse_groups(entries, document, category, report)
        group_order = ["一"]
    group_titles = dict(report["groups"])
    md_text = render_md(category, document, group_order, group_titles, entries)
    out_path = c.RAW_ROOT / category / f"{category}.md"
    c.ensure_under(out_path, c.RAW_ROOT)
    write_final(out_path, md_text, args.force)

    trans_path = work_dir / "transcription.md"
    trans_path.write_text(render_transcription(document, pages, pages_dir), encoding="utf-8")
    report_path = work_dir / "report.md"
    report_path.write_text(render_report(category, entries, report, all_conflicts, failures), encoding="utf-8")

    # ④ 收尾
    errors = list(manifest.get("errors") or []) + failures
    document["build_pages"] = sorted({int(e["page"]) for e in entries})
    document["build_questions"] = len(entries)
    manifest["documents"] = [document] + list(manifest.get("documents") or [])[1:]
    manifest["errors"] = errors
    manifest["updated_at"] = c.now_iso()
    c.write_json_atomic(manifest_path, manifest)

    review_count = sum(1 for e in entries if e["q"].get("needs_review"))
    generated_count = sum(
        1 for e in entries if str(e["q"].get("explanationSource") or "").lower() == "generated"
    )
    c.always(
        f"[{STAGE}] 跨页拼接 {len(report['splices'])} 题 / 去重 {len(report['duplicates'])} 题 → 单文件"
    )
    c.always(f"[{STAGE}] {out_path.relative_to(c.REPO_ROOT)} ✓ {len(entries)} 题")
    c.always(
        f"[{STAGE}] 题组 {len(group_order)} / 字段不完整 {len(report['incomplete'])} / "
        f"题数不符 {len(report['count_mismatch'])} / 公共题干 {len(report['shared_stems'])} / "
        f"材料题 {len(report['material_stems'])} / 答案表贴回 {len(report['answers_from_table'])} / "
        f"题型补正 {len(report['type_from_section'])} / 字段格式化 {len(report['s3_normalized'])} / "
        f"AI 生成解析 {generated_count} / AI 判重 {len(report['ai_duplicates'])} / "
        f"AI 改答案 {len(report['ai_answers'])} / AI 判型 {len(report['ai_types'])}"
        f"（改 {len(report['type_from_ai'])}、与卷面冲突 {len(report['ai_type_conflicts'])}）"
        f" / 多选答案可疑 {len(report['multi_answer_suspect'])}"
        f" / 待复核 {review_count} / 缺产物 {len(failures)}"
    )
    c.always(
        f"[完成] 共 {len(entries)} 题 | 待复核 {review_count} | 失败 {len(failures)} | "
        f"总耗时 {c.human_ms(started_all) / 1000:.1f}s"
    )
    c.info(f"[清单] {report_path.relative_to(c.REPO_ROOT)}")
    c.info(f"[清单] {trans_path.relative_to(c.REPO_ROOT)}")
    return 3 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n[中断] 已写盘的产物保留，重跑会自动跳过", file=sys.stderr)
        sys.exit(130)
