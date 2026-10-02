"""S2b：**专用"下划线扫描"** —— 单独一趟极简任务，只问"哪些文字被下划线划住了"。

为什么要单独一趟：让模型"顺手标下划线"极不稳定 —— 同一个模型、同一份提示词，实测一轮标 53 处、
下一轮标 0 处（`qwen-vl-max` 也是：页 1-4 全 0）。任务单一、输出很短（1~2k token、单页 10~30s）
时模型的表现稳定得多；标出来的词再由 S3 贴回题干里第一次出现的位置。

产物：`pdf-ocr/work/<分类名>/pages/page-00N.underlines.json`
用法：
    python pdf-ocr/2b_underlines.py --category <分类名> [--pages 2] [--force] [--quiet]
    python pdf-ocr/2b_underlines.py --category <分类名> --model glm-5.3-prime   # 换模型对比
退出码：0 全成功；3 有页失败（其余页照常产出）。
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as c  # noqa: E402

STAGE = "S2b/下划线"
SYSTEM = "你是试卷版面助手。只输出一个 JSON 对象，不要解释、不要代码围栏。"
USER = """这一页是日语试卷的扫描图。请只做一件事：找出**被下划线划住的文字**（文字下方那条横线）。

规则：
1) 只抄被划住的那几个字/词，按页面上出现的先后顺序，逐条列出；
2) **填空用的空白横线**（线下面没有字）不算；表格边框、装饰线不算；
3) 同一条下划线只列一次，不要重复、不要解释、不要转写整页；
4) 没有下划线就返回空数组。

只输出：{"underlines": ["被划住的文字1", "被划住的文字2"]}"""


def build_payload(model: str | None, png: Path, max_tokens: int) -> dict:
    return {
        "model": model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": USER},
                    {"type": "image_url", "image_url": {"url": c.image_data_url(png)}},
                ],
            },
        ],
    }


def scan_one(cfg: dict, png: Path, number: int, index: int, total: int, args) -> dict:
    payload = build_payload(cfg.get("model"), png, args.max_tokens)
    started = time.perf_counter()
    response = c.call_with_retry(
        str(cfg["base_url"]),
        payload,
        cfg.get("api_key"),
        timeout=args.timeout,
        max_retries=args.max_retries,
        on_retry=lambda attempt, retries, why, ms: c.retry_line(
            STAGE, index, total, attempt, retries, why, ms
        ),
    )
    text, field = c.response_text_ex(response)
    try:
        raw, _repair = c.extract_json(text)
    except c.ApiError as exc:
        raise c.ApiError(
            f"下划线扫描取不到 JSON：{exc}"
            f"{c.reasoning_hint(field, c.response_finish_reason(response), args.max_tokens, 'ocr')}"
        ) from exc
    items = raw.get("underlines") if isinstance(raw, dict) else raw
    spans = [str(item).strip() for item in (items or []) if str(item).strip()]
    return {
        "page": number,
        "underlines": list(dict.fromkeys(spans)),
        "call": {
            "model": cfg.get("model"),
            "endpoint": cfg.get("base_url"),
            "elapsed_ms": c.human_ms(started),
            "usage": response.get("usage") if isinstance(response.get("usage"), dict) else {},
            "underline_marks": len(spans),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="S2b：专用下划线扫描（只输出被下划线划住的文字，不转写整页）"
    )
    parser.add_argument("--category", required=True, help="分类名（= pdf-ocr/work/ 下的目录名）")
    parser.add_argument("--pages", help="只扫这些页，如 2 或 1-3（默认全部已渲染页）")
    parser.add_argument("--force", action="store_true", help="已存在的结果也重扫")
    parser.add_argument("--model", help="临时换模型（覆盖 .env / OCR_*）")
    parser.add_argument("--base-url", help="临时换端点（覆盖 .env / OCR_*）")
    parser.add_argument("--timeout", type=int, default=180, help="单次请求超时秒数，默认 180")
    parser.add_argument("--max-retries", type=int, default=3, help="每页最大尝试次数，默认 3")
    parser.add_argument("--max-tokens", type=int, default=4000, help="单次响应上限，默认 4000（只列词）")
    parser.add_argument("--quiet", action="store_true", help="只打印每页完成行")
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

    cfg = c.ocr_config()
    if args.model:
        cfg["model"] = args.model
    if args.base_url:
        cfg["base_url"] = args.base_url
    cfg["api_key"] = c.ocr_key_for(str(cfg.get("base_url") or ""))
    if not cfg.get("api_key"):
        c.fail("缺少 OCR 密钥：填 STEPFUN_API_KEY，或 OCR_BASE_URL/OCR_MODEL/OCR_API_KEY", 1)

    c.always(
        f"[{STAGE}] 分类={category} 页数={len(pages)} 模型={cfg.get('model')} 端点={cfg.get('base_url')}"
    )

    started_all = time.perf_counter()
    errors: list[str] = []
    done = 0
    total_spans = 0
    for index, number in enumerate(pages, start=1):
        target = pages_dir / f"page-{number:03d}.underlines.json"
        if target.exists() and not args.force:
            cached = c.read_json(target) or {}
            total_spans += len(cached.get("underlines") or [])
            done += 1
            c.progress(STAGE, index, len(pages), "✓", 0, f"{target.name} 已存在，跳过")
            c.page_done(index, len(pages), ["下划线 ✓（已存在）"])
            continue
        png = c.page_source(document, work_dir, number)
        if not png.exists():
            errors.append(f"page {number}: 缺页图 {png.name}（先跑 S1）")
            c.progress(STAGE, index, len(pages), "✗", 0, "缺页图")
            continue
        page_started = time.perf_counter()
        try:
            result = scan_one(cfg, png, number, index, len(pages), args)
        except c.ApiError as exc:
            errors.append(f"page {number}: {str(exc)[:200]}")
            c.progress(STAGE, index, len(pages), "✗", c.human_ms(page_started), str(exc)[:70])
            c.page_done(index, len(pages), ["下划线 ✗"])
            continue
        c.write_json_atomic(target, result)
        count = len(result["underlines"])
        total_spans += count
        done += 1
        c.progress(
            STAGE,
            index,
            len(pages),
            "✓",
            result["call"]["elapsed_ms"],
            f"下划线 {count} 处" + (f"｜{'、'.join(result['underlines'][:4])}" if count else "（本页没有）"),
        )
        c.page_done(index, len(pages), [f"下划线 ✓（{count} 处）"])

    c.always(
        f"[{STAGE}] 完成 {done}/{len(pages)} 页，共标出 {total_spans} 处 → "
        f"{pages_dir.relative_to(c.REPO_ROOT)}"
    )
    c.always(f"[{STAGE}] 下一步：python pdf-ocr/3_merge.py --category {category} --force")
    if errors:
        for line in errors[:5]:
            c.warn(line)
        return 3
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n[中断] 已扫到的页都落盘了，重跑同一条命令会自动续跑", flush=True)
        sys.exit(130)
