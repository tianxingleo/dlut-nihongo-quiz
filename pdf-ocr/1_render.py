"""S1：把输入（PDF / 图片 / 装着图片的文件夹）逐页渲染成 PNG，并写 source-manifest.json。

用法：
  python pdf-ocr/1_render.py <输入> [更多输入…] [--category 名字] [--dpi 200] [--pages 1-3] [--force] [--quiet]

输入**按文件头自动识别**（后缀不可靠：扫描 App 常导出没有后缀的文件）：
  * `.pdf`          → 每一页算一页；
  * 图片            → 一张算一页（png / jpeg / webp / bmp / gif / tiff / pnm / jp2 … 由 MuPDF 解码）；
  * 文件夹          → 里面的图片按**自然序**（`IMG_2` 在 `IMG_10` 前）拼成一份连续文档；
  * 多个输入混着传  → 按命令行顺序拼页（PDF 展开成它的各页，图片各算一页）。

流程：
  1) 传了 --category：先做"最终产物目录已存在"护栏，再渲染到 pdf-ocr/work/<分类名>/pages/
  2) 没传：先把第 1 页渲染到 pdf-ocr/work/.tmp/<sha8>/，用它（有密钥时交给模型）提议分类名，
     在命令行等用户确认；确认后才建工作目录并把页图移入
  3) 页图落盘后写/更新 pdf-ocr/work/<分类名>/source-manifest.json
     （字段约定对齐 computer-organization/ocr，并多了 kind / format / sources，文件不进 data/raw）

关于分辨率：`--dpi` 只对 PDF 有意义（默认 200）；图片**按原始像素**转 PNG，
太大时用 `--max-side`（如 2600）按 2 的幂往下缩，省 OCR token。

中间产物全部留在工具的 pdf-ocr/work/ 下；data/raw/<分类名>/ 只有最终 .md（S4 才写）。

退出码：0 成功；1 参数/环境错误（含缺 --category 的无人值守情形）；3 有页渲染失败。
"""

from __future__ import annotations

import argparse
import contextlib
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as c  # noqa: E402

try:  # PyMuPDF 1.24+ 用 pymupdf，老版本/别名是 fitz
    import pymupdf  # type: ignore
except ImportError:  # pragma: no cover
    import fitz as pymupdf  # type: ignore


# ── 输入识别 ────────────────────────────────────────────────────────────
def collect_pages(sources: list[Path]) -> tuple[list[dict], list[str]]:
    """把输入摊平成"页"清单：`[{source, page, kind, format}, …]`，顺序 = 渲染顺序。

    * PDF → 它的每一页（`page` 是 PDF 内的页码，从 1 开始）；
    * 图片 → 1 页（`page` 为 None）；
    * 文件夹 → 里面的图片按自然序拼成一份连续文档。
    """
    pages: list[dict] = []
    problems: list[str] = []
    for source in sources:
        if source.is_dir():
            images = sorted(
                (
                    path
                    for path in source.iterdir()
                    if path.is_file() and c.sniff_source(path)[0] == "image"
                ),
                key=lambda path: c.natural_key(path.name),
            )
            if not images:
                skipped = [p.name for p in source.iterdir() if p.is_file()][:5]
                problems.append(
                    f"文件夹里没有可识别的图片：{source}"
                    + (f"（内容：{'、'.join(skipped)}）" if skipped else "")
                )
                continue
            c.info(f"[输入] {source.name}/ → {len(images)} 张图片，按自然序拼成一份文档")
            for path in images:
                pages.append(
                    {
                        "source": path,
                        "page": None,
                        "kind": "image",
                        "format": c.sniff_source(path)[1],
                    }
                )
            continue
        kind, fmt = c.sniff_source(source)
        if kind == "pdf":
            with pymupdf.open(str(source)) as doc:
                for number in range(1, doc.page_count + 1):
                    pages.append(
                        {"source": source, "page": number, "kind": "pdf", "format": "pdf"}
                    )
        elif kind == "image":
            pages.append({"source": source, "page": None, "kind": "image", "format": fmt})
        else:
            problems.append(f"不认识这个输入（既不像 PDF 也不像图片）：{source}")
    return pages, problems


def describe_inputs(pages: list[dict]) -> str:
    """给日志/ manifest 用的一句话描述：`2 个输入（pdf×1、image×1）共 3 页`。"""
    files = sorted({page["source"] for page in pages}, key=lambda path: c.natural_key(path.name))
    kinds = sorted({page["kind"] for page in pages})
    formats = sorted({page["format"] for page in pages})
    return (
        f"{len(files)} 个输入（{'、'.join(kinds)}：{'/'.join(formats)}）共 {len(pages)} 页"
    )


# ── 分类名 ──────────────────────────────────────────────────────────────
def propose_category(first_source: Path, first_page_png: Path, quiet: bool) -> tuple[str, str]:
    """返回 (建议名称, 建议来源说明)。有 API 密钥时用第 1 页问模型，否则退回文件名。"""
    cfg = c.ocr_config()
    if cfg.get("api_key"):
        try:
            title = ask_model_for_title(first_page_png, cfg)
            if title:
                return c.safe_name(title), "模型读图"
        except SystemExit:
            raise
        except Exception as exc:
            c.warn(f"模型识图失败，改用文件名提议：{type(exc).__name__}: {exc}")
    name = first_source.name if first_source.is_dir() else first_source.stem
    return c.safe_name(name), "输入文件名"


def ask_model_for_title(png: Path, cfg: dict) -> str | None:
    """用第 1 页图片问卷名。注意：StepFun 的 step_plan 端点请求体形态需用真实密钥冒烟确认。"""
    payload = {
        "model": cfg.get("model"),
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "这是试卷的第 1 页。只输出一个 JSON："
                            '{"title": "试卷名称（含年份，不含扩展名）", "date": "YYYY-MM-DD 或空", "variant": "卷别或空"}'
                        ),
                    },
                    {"type": "image_url", "image_url": {"url": c.image_data_url(png)}},
                ],
            }
        ],
        "temperature": 0,
    }
    result = c.call_with_retry(str(cfg["base_url"]), payload, cfg.get("api_key"), timeout=120, max_retries=2)
    text = c.response_text(result)
    try:
        return c.extract_json_object(text).get("title") or None
    except c.ApiError:
        return None


def confirm_category(first_source: Path, first_page_png: Path, quiet: bool) -> str:
    proposal, source = propose_category(first_source, first_page_png, quiet)
    c.always(f"[分类名] 建议分类名：{proposal}（来源：{source}）")
    c.always(f"[分类名] 建议目录：data/raw/{proposal}/")
    sys.stdout.write("[分类名] 回车采用 / 直接输入别的名字 / Ctrl+C 取消： ")
    sys.stdout.flush()
    try:
        answer = input().strip()
    except EOFError:
        c.fail(
            "未传 --category，且标准输入没有内容（无人值守场景）→ 请显式传 --category <分类名>",
            1,
        )
    except KeyboardInterrupt:
        c.fail("已取消", 1)
    chosen = c.safe_name(answer) if answer else proposal
    c.always(f"[分类名] 使用：{chosen}")
    return chosen


# ── 渲染 / 复制 ─────────────────────────────────────────────────────────
def copy_source_image(source: Path, target: Path, force: bool = False) -> tuple[int, int]:
    """把原图**复制**进工作目录（之后源文件夹随便挪/删，OCR 不受影响）。

    复制而不是"就地引用"：`work/<分类>/sources/` 是这份卷自己的副本，
    重跑/换机器都只看工作目录。已存在就跳过（续跑），`--force` 才重来。
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    if force or not target.exists() or target.stat().st_size != source.stat().st_size:
        shutil.copy2(source, target)
    return source.stat().st_size, 0


def shrink_to(pixmap, max_side: int):
    """比 `max_side` 还大就按 2 的幂往下缩（`Pixmap.shrink` 只能减半，够用且不引入依赖）。"""
    while max_side and max(pixmap.width, pixmap.height) > max_side:
        shrunk = pixmap.shrink(1)
        pixmap = shrunk if shrunk is not None else pixmap
        if max(pixmap.width, pixmap.height) > max_side and min(pixmap.width, pixmap.height) <= 1:
            break
    return pixmap


def needs_conversion(item: dict, max_side: int) -> bool:
    """这张图能不能**原样**送去 OCR？不能才需要先转 PNG。

    * 格式端点不认（bmp / gif / tiff / psd / jp2 / pnm…）→ 要转；
    * 给了 `--max-side` 且确实超了 → 要转（顺便缩小）。
    `png` / `jpeg` 且不需要缩小 → **直接用原图**，S1 一个中间文件都不写。
    """
    if item["format"] not in c.OCR_READY_FORMATS:
        return True
    if max_side:
        try:
            pixmap = pymupdf.Pixmap(str(item["source"]))
        except Exception:
            return True
        if max(pixmap.width, pixmap.height) > max_side:
            return True
    return False


def render_pdf_page(doc, page_number: int, dpi: int):
    return doc.load_page(page_number - 1).get_pixmap(dpi=dpi)


def render_image_page(path: Path, max_side: int):
    """图片输入：**按原始像素**转 PNG（`Pixmap` 直接解码，中文路径也没问题）。"""
    pixmap = pymupdf.Pixmap(str(path))
    return shrink_to(pixmap, max_side)


def write_pixmap(pixmap, target: Path) -> tuple[int, int]:
    target.parent.mkdir(parents=True, exist_ok=True)
    # 用 tobytes() 而不是 pixmap.save(path)：save() 把路径按 C 字符串处理，
    # 遇到中文/不可编码字符会直接报 "argument 2 of type 'char const *'"。
    target.write_bytes(pixmap.tobytes("png"))
    return pixmap.width, pixmap.height


def main() -> int:
    parser = argparse.ArgumentParser(
        description="S1：PDF / 图片 → 每页 PNG + source-manifest.json"
    )
    parser.add_argument(
        "sources",
        nargs="+",
        help="输入：PDF、图片，或装着图片的文件夹（可传多个，按顺序拼页）",
    )
    parser.add_argument("--category", help="分类名（= 输出目录名）；不传则交互确认")
    parser.add_argument("--dpi", type=int, default=200, help="PDF 渲染分辨率，默认 200（图片按原始像素）")
    parser.add_argument(
        "--max-side",
        type=int,
        default=0,
        help="图片最长边超过它就按 2 的幂缩小（默认 0 = 不缩；扫描件常用 2600 省 token）",
    )
    parser.add_argument(
        "--pages",
        help="只渲染这些页（按**拼好后的页序**，从 1 开始），如 1-3,7；默认全部",
    )
    parser.add_argument("--force", action="store_true", help="目标目录已有文件时也继续")
    parser.add_argument("--quiet", action="store_true", help="只打印每页完成行与最终摘要")
    args = parser.parse_args()

    c.setup_stdio()
    c.set_quiet(args.quiet)

    sources = [Path(item).expanduser() for item in args.sources]
    for source in sources:
        if not source.exists():
            c.fail(f"找不到输入：{source}", 1)

    started = time.perf_counter()
    all_pages, input_problems = collect_pages(sources)
    for problem in input_problems:
        c.warn(problem)
    if not all_pages:
        c.fail("没有任何可渲染的页（PDF 页 / 图片）。检查输入路径与格式", 1)

    sha, total_bytes = c.sha256_of_files([page["source"] for page in all_pages])
    sha8 = sha[:8]
    page_count = len(all_pages)
    wanted = c.parse_pages(args.pages, page_count)
    pages = [all_pages[number - 1] for number in wanted]

    c.info(f"[工具] {describe_inputs(all_pages)}  sha256={sha8}")
    c.info(
        f"[工具] 本次渲染 {len(pages)} 页"
        + (f"（PDF dpi={args.dpi}）" if any(p["kind"] == "pdf" for p in pages) else "")
        + (f"（图片最长边 ≤ {args.max_side}）" if args.max_side and any(p["kind"] == "image" for p in pages) else "")
    )

    with contextlib.ExitStack() as stack:
        docs: dict[Path, object] = {}

        def pdf_doc(path: Path):
            if path not in docs:
                docs[path] = stack.enter_context(pymupdf.open(str(path)))
            return docs[path]

        def render(index_page: dict, target: Path) -> tuple[int, int]:
            if index_page["kind"] == "pdf":
                pixmap = render_pdf_page(pdf_doc(index_page["source"]), index_page["page"], args.dpi)
            else:
                pixmap = render_image_page(index_page["source"], args.max_side)
            return write_pixmap(pixmap, target)

        temp_dir = c.TEMP_ROOT / sha8
        final_dir: Path | None = None
        moved_from_temp: list[int] = []

        if args.category:
            category = c.safe_name(args.category)
            final_dir = c.RAW_ROOT / category
            guard_existing(final_dir, args.force)
        else:
            first_png = temp_dir / "page-001.png"
            if not first_png.exists():
                render(all_pages[0], first_png)
            category = confirm_category(sources[0], first_png, args.quiet)
            final_dir = c.RAW_ROOT / category
            guard_existing(final_dir, args.force)

        assert final_dir is not None
        category = final_dir.name
        # 中间产物一律留在工具目录 pdf-ocr/work/<分类名>/，data/raw 只接收最终 .md（S4 才写）
        work_dir = c.WORK_ROOT / category
        pages_dir = work_dir / "pages"
        c.ensure_under(pages_dir, c.WORK_ROOT)

        # 2) 需要的话把临时目录里已渲染的页移入工作目录（第 1 页走的就是这条路）
        if temp_dir.exists():
            for png in sorted(temp_dir.glob("page-*.png")):
                number = int(png.stem.split("-")[1])
                if number not in wanted:
                    continue
                target = pages_dir / png.name
                if target.exists():
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(png), str(target))
                moved_from_temp.append(number)

        # 3) 逐页出图。**图片输入不"拆分"**：能用原图就一个文件都不写，
        #    只有格式端点不认、或 --max-side 要缩小时才转一张 PNG。
        c.info(f"[配置] 分类名={category}  工作目录={c.rel(work_dir)}")
        pages_dir.mkdir(parents=True, exist_ok=True)
        sources_dir = work_dir / "sources"
        rendered: list[int] = []
        page_files: dict[str, str] = {}
        errors: list[str] = list(input_problems)
        copied = 0
        for index, (number, item) in enumerate(zip(wanted, pages), start=1):
            target = pages_dir / f"page-{number:03d}.png"
            page_started = time.perf_counter()
            # 图片 + 端点认得的格式（png/jpeg）+ 不用缩小 → **复制原图**进工作目录，
            # 之后 OCR 只读这份副本（源文件夹可以随便挪走）
            if item["kind"] == "image" and not needs_conversion(item, args.max_side):
                suffix = item["source"].suffix.lower() or ".img"
                copy_target = sources_dir / f"page-{number:03d}{suffix}"
                try:
                    copy_source_image(item["source"], copy_target, force=args.force)
                except Exception as exc:
                    errors.append(f"page {number}: 复制原图失败 {type(exc).__name__}: {exc}")
                    c.progress(
                        c.STAGES[1], index, len(pages), "✗", c.human_ms(page_started), f"复制 {item['source'].name} 失败"
                    )
                    continue
                page_files[str(number)] = f"sources/{copy_target.name}"
                rendered.append(number)
                copied += 1
                c.progress(
                    c.STAGES[1],
                    index,
                    len(pages),
                    "✓",
                    c.human_ms(page_started),
                    f"复制原图 {item['source'].name} → sources/{copy_target.name}"
                    f"（{item['format']}，不转码）",
                )
                c.page_done(index, len(pages), ["原图 ✓"])
                continue
            if target.exists():
                page_files[str(number)] = f"pages/{target.name}"
                rendered.append(number)
                c.progress(
                    c.STAGES[1], index, len(pages), "✓", c.human_ms(page_started), f"{target.name} 已存在，跳过"
                )
                c.page_done(index, len(pages), ["渲染 ✓"])
                continue
            try:
                width, height = render(item, target)
                page_files[str(number)] = f"pages/{target.name}"
                rendered.append(number)
                origin = item["source"].name
                c.progress(
                    c.STAGES[1],
                    index,
                    len(pages),
                    "✓",
                    c.human_ms(page_started),
                    f"{target.name} {width}×{height}  ← {origin}"
                    + (f" 第 {item['page']} 页" if item["page"] else ""),
                )
                c.page_done(index, len(pages), ["渲染 ✓"])
            except Exception as exc:
                errors.append(f"page {number}: {type(exc).__name__}: {exc}")
                c.progress(
                    c.STAGES[1], index, len(pages), "✗", c.human_ms(page_started), f"page-{number:03d}.png {exc}"
                )

        # 4) manifest（字段约定对齐 data/raw/computer-organization/ocr/source-manifest.json；
        #    文件本身放在 pdf-ocr/work/<分类名>/ 里，不进 data/raw）
        ocr_cfg = c.ocr_config()
        merge_cfg = c.merge_config()
        manifest_path = work_dir / "source-manifest.json"
        manifest = c.read_json(manifest_path) if manifest_path.exists() else {}
        source_files = sorted(
            {page["source"] for page in all_pages}, key=lambda path: c.natural_key(path.name)
        )
        kinds = sorted({page["kind"] for page in all_pages})
        formats = sorted({page["format"] for page in all_pages})
        label = (
            source_files[0].name
            if len(source_files) == 1
            else f"{source_files[0].name} 等 {len(source_files)} 个文件"
        )
        documents = [d for d in manifest.get("documents", []) if d.get("sha256") != sha]
        documents.append(
            {
                "source": label,
                "source_path": str(sources[0]) if len(sources) == 1 else "、".join(str(s) for s in sources),
                "kind": kinds[0] if len(kinds) == 1 else "mixed",
                "format": formats[0] if len(formats) == 1 else "mixed",
                "sources": [str(path) for path in source_files],
                "bytes": total_bytes,
                "pages": page_count,
                "sha256": sha,
                "dpi": args.dpi if "pdf" in kinds else None,
                "max_side": args.max_side or None,
                "rendered_pages": rendered,
                "completed_pages": len(rendered),
                # 每页 OCR 该读哪个文件（相对工作目录）：图片输入是**复制进来的原图**
                # `sources/page-00N.jpg`，PDF / 转码的是渲染出来的 `pages/page-00N.png`；
                # S2 用 c.page_source() 取。
                "page_files": page_files,
                "page_files_copied": copied,
            }
        )
        manifest.update(
            {
                "model": ocr_cfg["model"],
                "endpoint": ocr_cfg["base_url"],
                "merge_model": merge_cfg["model"],
                "merge_endpoint": merge_cfg["base_url"],
                "ocr_passes": 2,
                "category": category,
                "dpi": args.dpi,
                "kind": kinds[0] if len(kinds) == 1 else "mixed",
                "created_at": manifest.get("created_at", c.now_iso()),
                "updated_at": c.now_iso(),
                "documents": documents,
                "errors": manifest.get("errors", []) + errors,
            }
        )
        c.write_json_atomic(manifest_path, manifest)

        c.stage_done(c.STAGES[1], len(rendered), len(pages), c.human_ms(started))
        c.always(
            f"[完成] 可用页 {len(rendered)}/{len(pages)}"
            + (f"（复制原图 {copied} 页 → {c.rel(sources_dir)}，之后源文件夹可挪走）" if copied else "")
            + (f"（含临时目录移入 {len(moved_from_temp)} 页）" if moved_from_temp else "")
            + (f" → {c.rel(pages_dir)}" if copied < len(rendered) else "")
        )
        c.always(f"[清单] {c.rel(manifest_path)}")
        if temp_dir.exists():
            leftover = list(temp_dir.glob("*"))
            if not leftover:
                temp_dir.rmdir()

    if errors:
        c.warn(f"有 {len(errors)} 处渲染/输入问题：{'; '.join(errors)}")
        return 3
    return 0


def guard_existing(final_dir: Path, force: bool) -> None:
    """最终产物目录（data/raw/<分类名>/）已有文件就拒绝继续（硬约束：不动既有数据）。

    中间产物目录 pdf-ocr/work/ 不受此限：那里是本工具的草稿区，按页续跑即可。
    """
    if not final_dir.exists():
        return
    existing = [p for p in final_dir.rglob("*") if p.is_file()]
    if existing and not force:
        preview = "、".join(str(p.relative_to(final_dir)) for p in existing[:5])
        more = f" 等 {len(existing)} 个文件" if len(existing) > 5 else ""
        c.fail(
            f"最终产物目录已存在且非空：{final_dir}\n        已有：{preview}{more}\n"
            f"        本工具不覆盖既有数据；换一个 --category，或确认要重做时加 --force",
            1,
        )


if __name__ == "__main__":
    sys.exit(main())
