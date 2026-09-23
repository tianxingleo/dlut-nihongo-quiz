"""S1：把 PDF 逐页渲染成 PNG，并写 source-manifest.json。

用法：
  python pdf-ocr/1_render.py <pdf> [--category 名字] [--dpi 200] [--pages 1-3] [--force] [--quiet]

流程（docs/pdf-ocr-pipeline.md §4.1 / §5）：
  1) 传了 --category：先做"最终产物目录已存在"护栏，再渲染到 pdf-ocr/work/<分类名>/pages/
  2) 没传：先把第 1 页渲染到 pdf-ocr/work/.tmp/<sha8>/，用它（有密钥时交给模型）提议分类名，
     在命令行等用户确认；确认后才建工作目录并把页图移入
  3) 页图落盘后写/更新 pdf-ocr/work/<分类名>/source-manifest.json
     （字段约定对齐 computer-organization/ocr，但文件不进 data/raw）

中间产物全部留在工具的 pdf-ocr/work/ 下；data/raw/<分类名>/ 只有最终 .md（S4 才写）。

退出码：0 成功；1 参数/环境错误（含缺 --category 的无人值守情形）；3 有页渲染失败。
"""

from __future__ import annotations

import argparse
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


# ── 分类名 ──────────────────────────────────────────────────────────────
def propose_category(pdf: Path, first_page_png: Path, quiet: bool) -> tuple[str, str]:
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
    return c.safe_name(pdf.stem), "PDF 文件名"


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


def confirm_category(pdf: Path, first_page_png: Path, quiet: bool) -> str:
    proposal, source = propose_category(pdf, first_page_png, quiet)
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


# ── 渲染 ────────────────────────────────────────────────────────────────
def render_one(doc, page_number: int, target: Path, dpi: int) -> tuple[int, int]:
    page = doc.load_page(page_number - 1)
    pixmap = page.get_pixmap(dpi=dpi)
    target.parent.mkdir(parents=True, exist_ok=True)
    # 用 tobytes() 而不是 pixmap.save(path)：save() 把路径按 C 字符串处理，
    # 遇到中文/不可编码字符会直接报 "argument 2 of type 'char const *'"。
    target.write_bytes(pixmap.tobytes("png"))
    return pixmap.width, pixmap.height


def main() -> int:
    parser = argparse.ArgumentParser(
        description="S1：PDF → 每页 PNG + source-manifest.json（docs/pdf-ocr-pipeline.md §5）"
    )
    parser.add_argument("pdf", help="输入的 PDF 路径")
    parser.add_argument("--category", help="分类名（= 输出目录名）；不传则交互确认")
    parser.add_argument("--dpi", type=int, default=200, help="渲染分辨率，默认 200")
    parser.add_argument(
        "--pages",
        help="只渲染这些页，如 1-3,7（页码从 1 开始；写 0-3 也接受，0 视为起点；默认全部）",
    )
    parser.add_argument("--force", action="store_true", help="目标目录已有文件时也继续")
    parser.add_argument("--quiet", action="store_true", help="只打印每页完成行与最终摘要")
    args = parser.parse_args()

    c.setup_stdio()
    c.set_quiet(args.quiet)

    pdf = Path(args.pdf).expanduser()
    if not pdf.exists():
        c.fail(f"找不到 PDF：{pdf}", 1)
    if pdf.suffix.lower() != ".pdf":
        c.warn(f"输入文件后缀不是 .pdf：{pdf.name}")

    started = time.perf_counter()
    sha = c.sha256_of_file(pdf)
    sha8 = sha[:8]

    with pymupdf.open(str(pdf)) as doc:
        page_count = doc.page_count
        pages = c.parse_pages(args.pages, page_count)

        c.info(f"[工具] 输入 {pdf.name}  sha256={sha8}  页数={page_count}")
        c.info(f"[工具] 本次渲染 {len(pages)} 页（dpi={args.dpi}）")

        # 1) 分类名：显式传入就直接用；否则先渲染第 1 页再交互确认
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
                render_one(doc, 1, first_png, args.dpi)
            category = confirm_category(pdf, first_png, args.quiet)
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
                if number not in pages:
                    continue
                target = pages_dir / png.name
                if target.exists():
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(png), str(target))
                moved_from_temp.append(number)

        # 3) 逐页渲染（已存在的页跳过，支持续跑）
        c.info(f"[配置] 分类名={category}  工作目录={work_dir.relative_to(c.REPO_ROOT)}")
        rendered: list[int] = []
        errors: list[str] = []
        for index, number in enumerate(pages, start=1):
            target = pages_dir / f"page-{number:03d}.png"
            page_started = time.perf_counter()
            if target.exists():
                rendered.append(number)
                c.progress(
                    c.STAGES[1], index, len(pages), "✓", c.human_ms(page_started), f"{target.name} 已存在，跳过"
                )
                c.page_done(index, len(pages), ["渲染 ✓"])
                continue
            try:
                width, height = render_one(doc, number, target, args.dpi)
                rendered.append(number)
                c.progress(
                    c.STAGES[1], index, len(pages), "✓", c.human_ms(page_started), f"{target.name} {width}×{height}"
                )
                c.page_done(index, len(pages), ["渲染 ✓"])
            except Exception as exc:
                errors.append(f"page {number}: {type(exc).__name__}: {exc}")
                c.progress(c.STAGES[1], index, len(pages), "✗", c.human_ms(page_started), f"page-{number:03d}.png {exc}")

        # 4) manifest（字段约定对齐 data/raw/computer-organization/ocr/source-manifest.json；
        #    文件本身放在 pdf-ocr/work/<分类名>/ 里，不进 data/raw）
        ocr_cfg = c.ocr_config()
        merge_cfg = c.merge_config()
        manifest_path = work_dir / "source-manifest.json"
        manifest = c.read_json(manifest_path) if manifest_path.exists() else {}
        documents = [d for d in manifest.get("documents", []) if d.get("source") != pdf.name]
        documents.append(
            {
                "source": pdf.name,
                "source_path": str(pdf),
                "bytes": pdf.stat().st_size,
                "pages": page_count,
                "sha256": sha,
                "dpi": args.dpi,
                "rendered_pages": rendered,
                "completed_pages": len(rendered),
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
                "created_at": manifest.get("created_at", c.now_iso()),
                "updated_at": c.now_iso(),
                "documents": documents,
                "errors": manifest.get("errors", []) + errors,
            }
        )
        c.write_json_atomic(manifest_path, manifest)

        c.stage_done(c.STAGES[1], len(rendered), len(pages), c.human_ms(started))
        c.always(
            f"[完成] 页图 {len(rendered)}/{len(pages)} → {pages_dir.relative_to(c.REPO_ROOT)}"
            + (f"（含临时目录移入 {len(moved_from_temp)} 页）" if moved_from_temp else "")
        )
        c.always(f"[清单] {manifest_path.relative_to(c.REPO_ROOT)}")
        if temp_dir.exists():
            leftover = list(temp_dir.glob("*"))
            if not leftover:
                temp_dir.rmdir()

    if errors:
        c.warn(f"有 {len(errors)} 页渲染失败：{'; '.join(errors)}")
        return 3
    return 0


def guard_existing(final_dir: Path, force: bool) -> None:
    """最终产物目录（data/raw/<分类名>/）已有文件就拒绝继续（docs §4.1 第 4 条：不动既有数据）。

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
