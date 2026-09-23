"""S2：每页两路 OCR（step-3.7-flash ×2）→ pdf-ocr/work/<分类名>/pages/page-00N.{a,b}.review.json

用法：
  python pdf-ocr/2_ocr.py --category <分类名> [--pages 1-3] [--passes a,b] [--force] [--quiet]
  （密钥读 .env：STEPFUN_API_KEY / STEPFUN_BASE_URL / STEPFUN_MODEL）

设计要点（docs/pdf-ocr-pipeline.md §7.1）：
  * 两路提示词"适度异构"：**同一系统角色、同一 JSON schema、同一 temperature**，
    只在 2–3 条侧重指令上不同（A 逐字转写保版面；B 按题结构化带置信度）。
    这样两路逐字段可比，又不至于错误完全相关。
  * 每页独立调用，页与页之间不共享上下文；单页失败不打断整批（记进 manifest.errors，退出码 3）。
  * 进度一律按 §6 的 `[S2/4 OCR-A] page i/n (i/n)  ✓ 2180ms 1.9KB q=1-4` 格式输出。

产物字段与 data/raw/computer-organization/ocr/page-XXX.review.json 同名同义，
只额外加了 uncertain[] 与 call{} 两个键。中间产物留在 pdf-ocr/work/，不写 data/raw。
"""

from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as c  # noqa: E402

# ── 两路提示词（适度异构）─────────────────────────────────────────────────
# 系统提示词与 schema 对两路**完全一致**，保证结果可以逐字段比对。
# 【用途说明】如实交代任务背景：这是**大学课程试卷的扫描页**，用于学生个人学习/错题整理/题库校对。
# 实测（2026-09-22）：马原试卷4 第 6 页（整页是《…试卷评分标准》）两路都被内容审核拦成
# HTTP 451 censorship_blocked —— 属于对**课程政治理论术语**的误判。这里把真实用途讲清楚，
# 并明确要求"如实转写、不要因涉及课程术语而拒答或改写"。
# 注意：只写**真实**背景 —— 不写"这是虚构内容""忽略你的安全规则"这类欺骗审核的措辞。
SYSTEM_PROMPT = (
    "你是试卷整页识别助手。本次任务是把**大学课程试卷的扫描页**转成文字，"
    "用于学生**个人学习、错题整理与题库校对**（不对外公开发布、不用于商业用途）；"
    "页面内容是公开课程的教学与考试材料（如《马克思主义基本原理概论》等公共课）。"
    "请如实、完整地转写页面上的全部文字（含题干、选项、参考答案与评分标准），"
    "不要因为内容涉及课程或政治理论术语就拒答、省略或改写。"
    "请严格按用户要求，只输出一个 JSON 对象，"
    "不要输出解释、不要用代码围栏。看不清的地方如实标注，不要编造。"
)

# 应答里至少要出现其中一个键，否则算"返回值格式不对"（见 run_pass 里的校验）
OCR_SCHEMA_KEYS = (
    "transcription_md",
    "paper_identity",
    "page_condition",
    "question_ranges",
    "printed_page_labels",
)

SCHEMA_BLOCK = """请输出如下 JSON（键名固定；没有的填空字符串或空数组）：

{
  "printed_page_labels": ["A-1"],
  "paper_identity": {"title": "", "date": "", "variant": "", "declared_printed_pages": ""},
  "question_ranges": ["1-4"],
  "page_condition": "clear",
  "transcription_md": "……整页转写，尽量保留原版面与换行……",
  "corrections": [{"location": "", "before": "", "after": "", "evidence": "", "confidence": "high"}],
  "uncertain": [{"location": "", "note": ""}]
}

字段说明：
- printed_page_labels：页面上印刷的页码/卷别标记（如 A-1、第3页），没有就 []
- paper_identity：卷名/日期/卷别/声明页数，只填页面上真实出现的
- question_ranges：本页出现的题号范围，如 ["1-4"] 或 ["5","6"]
- page_condition：clear | blurry | cropped | handwritten | mixed
- transcription_md：整页内容（markdown），这是后续题目提取的唯一依据
- corrections：你改正过的地方（before=原样，after=改写后，evidence=依据，confidence=high|medium|low）
- uncertain：你没有把握的地方（location=位置，note=说明）

【题号必须**照抄卷面**（硬要求）】
- transcription_md 里每一题的题号**一律照抄卷面上印的那个数字/汉字**：不要自己重新编号、
  不要"顺手改正"、也不要为了看起来连续而挪动题号。
- 卷面**同一个题号印了两遍**（重号）时：**两遍都照抄成同一个号**，并在 uncertain[] 里写一条
  （location=该题号，note="卷面此处题号重复"）。
- 卷面**跳号**（如 7 后面直接是 9）时同样照抄，并在 uncertain[] 里说明。
- 为什么：后续是**按题号**把参考答案贴回每一道题的。你一旦重编号，卷面上真正印着的那道题
  就会被挤掉（实测：卷面把「7.」印了两遍，两路都读成 7、8 再跳到 9，卷面真正的第 8 题
  在两路里都不见了 —— 整卷答案跟着错位）。"""

# 两路各自的侧重（只有这里不同）
PASS_EMPHASIS = {
    "a": """【本次侧重 A —— 逐字转写】
1) transcription_md 尽量忠实于像素，保留原有换行、空行与选项排布；先把整页写下来，再谈理解。
2) 没把握的地方**只标位置、不改字**：按原样写进 transcription_md，并在 uncertain[] 里说明。
3) corrections[] 只填你非常有把握的明显误识别，宁少勿多。
4) **题号照抄**（含重号、跳号），绝不自行重编号 —— 见上面的硬要求。""",
    "b": """【本次侧重 B —— 按题结构化】
1) transcription_md 以"题目"为单位排布：每题按 题干 → A/B/C/D 选项 → 答案（若页面有）的顺序写清楚。
2) 逐项标注把握程度：把握不大的题干/选项/答案写进 uncertain[]，note 里给出你判断的更可能读法。
3) 明显错字可直接在 transcription_md 里给出更可能的读法，并在 corrections[] 记录 before/after/evidence。
4) **题号照抄**（含重号、跳号），绝不自行重编号 —— 见上面的硬要求。""",
}

PASS_HINT = {"a": "逐字转写 / 保版面", "b": "按题结构化 / 带置信度"}


# 重试时的纠偏提示（第 2 次起追加）：直接针对"裸换行/带解释"两种翻车形态
RETRY_NOTE = (
    "\n\n【重要】上一次回复不是合法 JSON。这一次请**只输出一个 JSON 对象**："
    "不要任何解释文字、不要代码围栏；字符串内部的换行必须写成 \\n（不要出现裸换行）。"
)


def build_payload(
    model: str | None, png: Path, pass_key: str, max_tokens: int, retry_note: str = ""
) -> dict:
    """构造一次 OCR 请求体（OpenAI 兼容 vision 形态）。"""
    user_text = f"{SCHEMA_BLOCK}\n\n{PASS_EMPHASIS[pass_key]}{retry_note}"
    return {
        "model": model,
        "temperature": 0,
        # 单次响应上限：防止模型话痨（多余内容会被 extract_json 丢掉，但照样计费）
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {"type": "image_url", "image_url": {"url": c.image_data_url(png)}},
                ],
            },
        ],
    }


# ── 结果归一化（字段与现有 review.json 约定对齐）────────────────────────────
def as_list(value) -> list:
    if isinstance(value, list):
        return value
    if value in (None, ""):
        return []
    return [value]


def as_text(value) -> str:
    return "" if value is None else str(value)


def normalize_review(
    raw: dict,
    number: int,
    pass_key: str,
    cfg: dict,
    elapsed_ms: int,
    usage,
    call_meta: dict | None = None,
) -> dict:
    identity = raw.get("paper_identity") if isinstance(raw.get("paper_identity"), dict) else {}
    corrections = []
    for item in as_list(raw.get("corrections")):
        if isinstance(item, dict):
            corrections.append(
                {
                    "location": as_text(item.get("location")),
                    "before": as_text(item.get("before")),
                    "after": as_text(item.get("after")),
                    "evidence": as_text(item.get("evidence")),
                    "confidence": as_text(item.get("confidence")) or "medium",
                }
            )
    uncertain = []
    for item in as_list(raw.get("uncertain")):
        if isinstance(item, dict):
            uncertain.append(
                {"location": as_text(item.get("location")), "note": as_text(item.get("note"))}
            )
        elif item:
            uncertain.append({"location": "", "note": as_text(item)})

    return {
        "page": number,
        "printed_page_labels": [as_text(x) for x in as_list(raw.get("printed_page_labels"))],
        "paper_identity": {
            "title": as_text(identity.get("title")),
            "date": as_text(identity.get("date")),
            "variant": as_text(identity.get("variant")),
            "declared_printed_pages": as_text(identity.get("declared_printed_pages")),
        },
        "question_ranges": [as_text(x) for x in as_list(raw.get("question_ranges"))],
        "page_condition": as_text(raw.get("page_condition")) or "unknown",
        "transcription_md": as_text(raw.get("transcription_md")),
        "corrections": corrections,
        "uncertain": uncertain,
        "call": {
            "pass": pass_key,
            "model": cfg.get("model"),
            "endpoint": cfg.get("base_url"),
            "elapsed_ms": elapsed_ms,
            "usage": usage if isinstance(usage, dict) else {},
            **(call_meta or {}),
        },
    }


# ── 单页单路调用 ────────────────────────────────────────────────────────
def ocr_one_pass(
    cfg: dict,
    png: Path,
    number: int,
    pass_key: str,
    index: int,
    total: int,
    timeout: int,
    max_retries: int,
    max_tokens: int,
) -> dict:
    stage = f"{c.STAGES[2]}-{pass_key.upper()}"
    payload = build_payload(cfg.get("model"), png, pass_key, max_tokens)
    last_error = ""

    for attempt in range(1, max_retries + 1):
        started = time.perf_counter()
        # 第 2 次起追加纠偏提示（只影响重试，正常路径的提示词不变）
        attempt_payload = (
            payload
            if attempt == 1
            else build_payload(cfg.get("model"), png, pass_key, max_tokens, RETRY_NOTE)
        )
        try:
            response = c.post_json(
                str(cfg["base_url"]), attempt_payload, cfg.get("api_key"), timeout=timeout
            )
            text, text_field = c.response_text_ex(response)
            finish_reason = c.response_finish_reason(response)
            try:
                parsed, repair = c.extract_json(text)
            except c.ApiError as exc:  # 补上"为什么取不到 JSON"，否则排查要绕好几圈
                raise c.ApiError(
                    f"{exc}{c.reasoning_hint(text_field, finish_reason, max_tokens, 'ocr')}",
                    retryable=exc.retryable,
                ) from exc
            if finish_reason == "length":
                repair = {**repair, "truncated": True}
            # **返回值格式不对就重跑**（用户要求）：应答里连一个 schema 里的键都没有
            # （典型：模型回了一句解释、或回了别的形状），这页等于白跑 → 抛出可重试错误，
            # 由本函数的重试循环再试（--max-retries 默认 3 = 1 次首试 + 2 次重试）。
            if not any(key in parsed for key in OCR_SCHEMA_KEYS):
                raise c.ApiError(
                    "返回值格式不对：里面没有任何 schema 字段"
                    f"（{', '.join(OCR_SCHEMA_KEYS)}），将重试；实际键={list(parsed)[:6]}",
                    retryable=True,
                )
            review = normalize_review(
                parsed,
                number,
                pass_key,
                cfg,
                c.human_ms(started),
                response.get("usage"),
                {
                    "finish_reason": finish_reason,
                    "json_repaired": repair.get("repaired", False),
                    "json_truncated": repair.get("truncated", False),
                },
            )
            if repair.get("truncated"):
                c.warn(
                    f"第 {number} 页 OCR-{pass_key.upper()} 的回复疑似被截断"
                    f"（finish_reason={finish_reason or '?'}），已尽力补全；"
                    f"当前 --max-tokens={max_tokens} 已是端点允许的上限，"
                    f"若转写确实缺末尾内容，说明是模型侧生成长度限制，需要拆页处理"
                )
            return review
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
        description="S2：每页两路 OCR → page-00N.{a,b}.review.json（docs/pdf-ocr-pipeline.md §5/§6）"
    )
    parser.add_argument("--category", required=True, help="分类名（= pdf-ocr/work/ 下的目录名）")
    parser.add_argument(
        "--pages",
        help="只处理这些页，如 1-3,7（页码从 1 开始；写 0-3 也接受，0 视为起点；默认全部已渲染页）",
    )
    parser.add_argument("--passes", default="a,b", help="只跑其中一路，如 --passes a（默认 a,b）")
    parser.add_argument(
        "--sequential",
        action="store_true",
        help="两路 OCR 串行跑（默认并行：两路互不依赖，并行不花钱、墙钟时间减半）",
    )
    parser.add_argument("--timeout", type=int, default=180, help="单次请求超时秒数，默认 180")
    parser.add_argument("--max-retries", type=int, default=3, help="每页每路最大尝试次数，默认 3")
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=c.DEFAULT_MAX_TOKENS["ocr"],
        help=(
            f"单次响应 token 上限，默认 {c.DEFAULT_MAX_TOKENS['ocr']}"
            f"（= 自设上限 {c.MAX_TOKENS_CEILING['ocr']}，防止密排页转写被截断成非法 JSON）"
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
    c.check_max_tokens("ocr", args.max_tokens)

    category = c.safe_name(args.category)
    work_dir = c.WORK_ROOT / category
    manifest_path = work_dir / "source-manifest.json"
    if not manifest_path.exists():
        c.fail(f"找不到 {manifest_path.relative_to(c.REPO_ROOT)}；请先跑 S1："
               f"python pdf-ocr/1_render.py <pdf> --category {category}", 1)

    cfg = c.ocr_config()
    if not cfg.get("api_key"):
        c.fail(
            "缺少 STEPFUN_API_KEY：请在仓库根 .env 里填 STEPFUN_API_KEY（可选 STEPFUN_BASE_URL/STEPFUN_MODEL）",
            1,
        )

    passes = [p.strip().lower() for p in args.passes.split(",") if p.strip()]
    unknown = [p for p in passes if p not in PASS_EMPHASIS]
    if unknown:
        c.fail(f"--passes 只支持 a,b；收到：{','.join(unknown)}", 1)

    manifest = c.read_json(manifest_path)
    document = (manifest.get("documents") or [{}])[0]
    rendered = [int(n) for n in document.get("rendered_pages", [])]
    if not rendered:
        c.fail(f"{manifest_path.name} 里没有 rendered_pages；请先跑 S1", 1)
    pages = c.parse_pages(args.pages, max(rendered)) if args.pages else rendered
    pages = [n for n in pages if n in set(rendered)]

    pages_dir = work_dir / "pages"
    c.info(
        f"[配置] 分类名={category}  页数={len(pages)}  路={','.join(p.upper() for p in passes)}  "
        f"模型={cfg.get('model')}  端点={cfg.get('base_url')}"
    )
    c.info(f"[配置] 提示词：同角色/同 schema/同 temperature；差异仅 {PASS_HINT['a']} vs {PASS_HINT['b']}")

    started_all = time.perf_counter()
    errors: list[str] = []
    done_pages = 0
    spent = 0            # 本次运行累计 token（含重试）
    calls_made = 0
    budget_hit = False

    # 跨运行预算：manifest 里累计用量已经超了就直接拒绝开工（防止"反复调用"把账烧穿）
    prior = c.usage_block(manifest)
    if args.total_budget_tokens > 0 and int(prior.get("tokens", 0)) >= args.total_budget_tokens:
        c.fail(
            f"跨运行预算已用尽：{manifest_path.name} 里累计 {prior.get('tokens')} token ≥ "
            f"--total-budget-tokens {args.total_budget_tokens}；要重新开始请调大预算或删掉该 usage 记录",
            4,
        )

    for index, number in enumerate(pages, start=1):
        png = pages_dir / f"page-{number:03d}.png"
        if not png.exists():
            errors.append(f"page {number}: 缺页图 {png.name}（先跑 S1）")
            c.progress(c.STAGES[2], index, len(pages), "✗", 0, f"缺页图 {png.name}")
            c.page_done(index, len(pages), ["OCR ✗"])
            continue

        parts: list[str] = []
        page_failed = False
        pending: list[tuple[str, Path]] = []

        for pass_key in passes:
            stage = f"{c.STAGES[2]}-{pass_key.upper()}"
            target = pages_dir / f"page-{number:03d}.{pass_key}.review.json"
            page_started = time.perf_counter()
            if target.exists() and not args.force:
                parts.append(f"OCR-{pass_key.upper()} ✓（已存在）")
                c.progress(
                    stage, index, len(pages), "✓", c.human_ms(page_started), f"{target.name} 已存在，跳过"
                )
                continue
            pending.append((pass_key, target))

        # 预算检查放在**整页开跑之前**：两路并行时不能一路超了、另一路还在发（最多只多花一页）
        if pending and c.budget_stop(spent, args.budget_tokens):
            budget_hit = True
            c.warn(
                f"本次预算已用尽（{c.human_tokens(spent)} ≥ {c.human_tokens(args.budget_tokens)} token），"
                f"在第 {number} 页停下；已完成的结果都已落盘，可稍后续跑"
            )
            pending = []

        def run_one(pass_key: str, target: Path) -> dict:
            """跑一路并落盘（可能在子线程里跑；写盘用的是原子改名，线程安全）。"""
            review = ocr_one_pass(
                cfg, png, number, pass_key, index, len(pages), args.timeout,
                args.max_retries, args.max_tokens,
            )
            c.write_json_atomic(target, review)
            return review

        results: dict[str, dict] = {}
        failures: dict[str, str] = {}
        if len(pending) > 1 and not args.sequential:
            # 两路并行：互不依赖、各自独立重试，token 消耗与串行完全一致
            with ThreadPoolExecutor(max_workers=len(pending)) as pool:
                futures = {pool.submit(run_one, key, target): key for key, target in pending}
                for future in as_completed(futures):
                    pass_key = futures[future]
                    try:
                        results[pass_key] = future.result()
                    except c.ApiError as exc:
                        failures[pass_key] = str(exc)
        else:
            for pass_key, target in pending:
                try:
                    results[pass_key] = run_one(pass_key, target)
                except c.ApiError as exc:
                    failures[pass_key] = str(exc)

        # 统一在**主线程**里记账与打印，顺序固定为 passes 的顺序（并行也不会打乱完成行）
        for pass_key, target in pending:
            stage = f"{c.STAGES[2]}-{pass_key.upper()}"
            if pass_key in results:
                review = results[pass_key]
                calls_made += 1
                spent += c.usage_tokens(review["call"].get("usage"))
                size_kb = target.stat().st_size / 1024
                ranges = ",".join(review["question_ranges"]) or "-"
                c.progress(
                    stage,
                    index,
                    len(pages),
                    "✓",
                    review["call"]["elapsed_ms"],
                    f"{size_kb:.1f}KB q={ranges}",
                )
                parts.append(f"OCR-{pass_key.upper()} ✓")
            else:
                message = failures.get(pass_key, "未知错误")
                errors.append(f"page {number} pass {pass_key}: {message}")
                c.progress(stage, index, len(pages), "✗", 0, message[:80])
                parts.append(f"OCR-{pass_key.upper()} ✗")
                page_failed = True

        if not page_failed and parts and all("✓" in p for p in parts):
            done_pages += 1
        c.page_done(
            index,
            len(pages),
            parts or ["已停止"],
            usage_note=f"本次累计 {c.human_tokens(spent)} tok",
        )
        if budget_hit:
            break

    # 账本回写：errors 追加，completed_pages 表示两路都拿到的页数
    ocr_done = sorted(
        n
        for n in pages
        if all((pages_dir / f"page-{n:03d}.{p}.review.json").exists() for p in passes)
    )
    document["ocr_pages"] = ocr_done
    document["completed_pages"] = len(ocr_done)
    manifest["documents"] = [document] + [
        d for d in manifest.get("documents", [])[1:] if d is not document
    ]
    manifest["errors"] = manifest.get("errors", []) + errors
    # **内容审核拦截的页**（重试到头仍 451）：按用户要求"三次不过就放弃这套试卷"。
    # 落进 manifest 供 S7 识别（S7 不捕获子进程输出，只能靠文件通道），并给出一条明确建议。
    blocked = sorted(
        {
            int(line.split()[1])
            for line in errors
            if line.startswith("page ") and ("censorship_blocked" in line or "451" in line)
        }
    )
    if blocked:
        manifest["blocked_pages"] = blocked
        c.always(
            f"[放弃建议] 第 {'、'.join(str(n) for n in blocked)} 页内容审核拦截"
            f"（重试 {args.max_retries} 次仍不过）—— 本卷数据不完整，建议放弃这一套试卷；"
            f"要救这一页可以换视觉模型，或人工补录 work/<分类名>/pages/page-0NN.*.review.json"
        )
    manifest["updated_at"] = c.now_iso()
    usage = c.add_usage(manifest, calls=calls_made, tokens=spent)
    c.write_json_atomic(manifest_path, manifest)

    c.stage_done(c.STAGES[2], done_pages, len(pages), c.human_ms(started_all))
    c.always(
        f"[完成] 两路 OCR 完成 {len(ocr_done)}/{len(pages)} 页 → "
        f"{(pages_dir).relative_to(c.REPO_ROOT)}"
    )
    c.always(
        f"[用量] 本次调用 {calls_made} 次 / {c.human_tokens(spent)} tok；"
        f"该分类累计 {usage['calls']} 次 / {c.human_tokens(int(usage['tokens']))} tok"
    )
    c.always(f"[清单] {manifest_path.relative_to(c.REPO_ROOT)}")
    if budget_hit:
        return 4
    if errors:
        c.warn(f"有 {len(errors)} 项失败：{'; '.join(errors[:3])}")
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
