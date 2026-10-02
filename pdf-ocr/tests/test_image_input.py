"""图片输入的离线验收（不联网、0 token）：文件头识别、自然序、S1 把图片当页、
**图片不重编码**（直接拿原图给 OCR）、`--max-side` 与需要转换的格式、PDF 与图片混合。

跑法：`python pdf-ocr/tests/test_image_input.py`
"""

import importlib.util
import io
import json
import shutil
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))

import _common as c  # noqa: E402

try:
    import pymupdf  # type: ignore
except ImportError:  # pragma: no cover
    import fitz as pymupdf  # type: ignore


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


render1 = load("1_render")

# ── 1) 按文件头识别输入（后缀不可靠，扫描 App 常导出没有后缀的文件）──────────
MAGIC = {
    "a.pdf": (b"%PDF-1.7\n", "pdf", "pdf"),
    "b.png": (b"\x89PNG\r\n\x1a\n" + b"0" * 8, "image", "png"),
    "c.jpg": (b"\xff\xd8\xff\xe0" + b"0" * 8, "image", "jpeg"),
    "d.webp": (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image", "webp"),
    "e.gif": (b"GIF89a" + b"0" * 8, "image", "gif"),
    "f.bmp": (b"BM" + b"0" * 8, "image", "bmp"),
    "g.tif": (b"II*\x00" + b"0" * 8, "image", "tiff"),
    "h.ppm": (b"P6\n2 2\n255\n" + b"\x00" * 12, "image", "pnm"),
}
sandbox = Path(tempfile.mkdtemp(prefix="p1img-"))
try:
    for name, (head, want_kind, want_format) in MAGIC.items():
        path = sandbox / name
        path.write_bytes(head)
        kind, fmt = c.sniff_source(path)
        assert (kind, fmt) == (want_kind, want_format), (name, kind, fmt)
    # 后缀兜底：没有 magic 但后缀是图片 → 仍当图片（老扫描件常见）
    fallback = sandbox / "noheader.jpeg"
    fallback.write_bytes(b"not really a jpeg")
    assert c.sniff_source(fallback) == ("image", "jpeg"), c.sniff_source(fallback)
    # 既不认识文件头、后缀也不是 → 明确判成"不是输入"，别硬塞给渲染器
    junk = sandbox / "note.txt"
    junk.write_text("hello", encoding="utf-8")
    assert c.sniff_source(junk)[0] == "", c.sniff_source(junk)
    assert c.is_source_file(sandbox / "a.pdf") and not c.is_source_file(junk)
    print("[1] 文件头识别：pdf / png / jpeg / webp / gif / bmp / tiff / pnm；没有头时退回后缀")

    # ── 2) 自然序 + 多文件摘要 ──────────────────────────────────────────
    names = ["IMG_10.png", "IMG_2.png", "IMG_1.png", "page-9.png", "page-10.png"]
    assert sorted(names, key=c.natural_key) == [
        "IMG_1.png",
        "IMG_2.png",
        "IMG_10.png",
        "page-9.png",
        "page-10.png",
    ], sorted(names, key=c.natural_key)
    first = sandbox / "one.png"
    second = sandbox / "two.png"
    first.write_bytes(b"\x89PNG\r\n\x1a\n" + b"aaa")
    second.write_bytes(b"\x89PNG\r\n\x1a\n" + b"bbb")
    digest_a, bytes_a = c.sha256_of_files([first, second])
    digest_b, _ = c.sha256_of_files([second, first])  # 顺序无关（按名字排序）
    assert digest_a == digest_b and bytes_a == first.stat().st_size + second.stat().st_size
    second.write_bytes(b"\x89PNG\r\n\x1a\n" + b"ccc")
    assert c.sha256_of_files([first, second])[0] != digest_a, "改了一张图，整卷摘要必须变"
    print("[2] 自然序（IMG_2 在 IMG_10 前）+ 多文件摘要（顺序无关、内容一变摘要就变）")

    # ── 3) data URL 的 MIME 按文件头选（图片输入会直接送原图，不能写死 png）────
    assert c.image_media_type(sandbox / "b.png") == "image/png"
    assert c.image_media_type(sandbox / "c.jpg") == "image/jpeg"
    assert c.image_media_type(sandbox / "d.webp") == "image/webp"
    assert c.image_data_url(sandbox / "c.jpg").startswith("data:image/jpeg;base64,")
    assert c.image_media_type(sandbox / "a.pdf") == "image/png"  # 不是图片时给个安全默认
    print("[3] data URL：MIME 按文件头给（png / jpeg / webp）")

    # ── 4) page_source：优先 manifest 的 page_files（相对工作目录），老 manifest 退回页图 ──
    work_root = sandbox / "work-probe"
    pages_dir = work_root / "pages"
    pages_dir.mkdir(parents=True)
    absolute = (sandbox / "c.jpg").resolve()
    assert c.page_source({"page_files": {"1": str(absolute)}}, work_root, 1) == absolute
    copied = work_root / "sources" / "page-002.jpg"
    copied.parent.mkdir(parents=True)
    copied.write_bytes(b"\xff\xd8\xff\xe0fake")
    assert c.page_source({"page_files": {"2": "sources/page-002.jpg"}}, work_root, 2) == copied
    rendered = pages_dir / "page-003.png"
    rendered.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    assert c.page_source({"page_files": {"3": "pages/page-003.png"}}, work_root, 3) == rendered
    # 早期把相对路径记成"相对 pages/"的 manifest 也能解析
    assert c.page_source({"page_files": {"3": "page-003.png"}}, work_root, 3) == rendered
    assert c.page_source({}, work_root, 3) == rendered  # 老 manifest：没有 page_files
    print("[4] page_source：绝对路径原图 / sources 副本 / pages 页图 / 老 manifest 都能解析")

    # ── 5) S1 真跑：PNG 图片目录 → **复制进工作目录**，不重编码 ──────────────
    FAKE_WORK = sandbox / "work"
    FAKE_RAW = sandbox / "raw"
    c.WORK_ROOT = FAKE_WORK
    c.RAW_ROOT = FAKE_RAW
    c.TEMP_ROOT = sandbox / "tmp"

    scans = sandbox / "scans"
    scans.mkdir()
    for index, name in enumerate(("IMG_1.png", "IMG_2.png", "IMG_10.png"), start=1):
        doc = pymupdf.open()
        page = doc.new_page(width=200, height=120)
        page.insert_text((20, 60), f"page {index}")
        page.get_pixmap(dpi=72).save(str(scans / name))
        doc.close()

    sys.argv = ["1_render.py", str(scans), "--category", "scan-test", "--quiet"]
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = render1.main()
    out = buffer.getvalue()
    assert code == 0, (code, out)
    work_dir = FAKE_WORK / "scan-test"
    assert list((work_dir / "pages").glob("*.png")) == [], "PNG 图片不该被重编码成中间页图"
    manifest = json.loads((work_dir / "source-manifest.json").read_text("utf-8"))
    document = manifest["documents"][0]
    assert document["kind"] == "image" and document["pages"] == 3, document
    assert document["page_files_copied"] == 3, document
    assert document["rendered_pages"] == [1, 2, 3], document["rendered_pages"]
    # 复制进 sources/，按页序编号；内容与源文件逐字节一致
    assert [document["page_files"][str(n)] for n in (1, 2, 3)] == [
        "sources/page-001.png",
        "sources/page-002.png",
        "sources/page-003.png",
    ], document["page_files"]
    for number, name in zip((1, 2, 3), ("IMG_1.png", "IMG_2.png", "IMG_10.png")):
        copied = work_dir / document["page_files"][str(number)]
        assert copied.exists() and copied.read_bytes() == (scans / name).read_bytes(), name
    assert "复制原图" in out, out[-300:]
    for number in (1, 2, 3):  # 这 3 页都能被 S2 找到
        assert c.page_source(document, work_dir, number).exists(), number
    # **关键**：源文件夹删掉之后，S2 依然能跑（工作目录里是副本）
    shutil.rmtree(scans)
    for number in (1, 2, 3):
        assert c.page_source(document, work_dir, number).exists(), number
    print("[5] S1 图片输入：原图**复制**进 sources/（逐字节一致），源文件夹删掉也不影响")

    # ── 6) 续跑：副本已存在就跳过复制，也不产生中间页图 ────────────────────
    scans.mkdir()
    for index, name in enumerate(("IMG_1.png", "IMG_2.png", "IMG_10.png"), start=1):
        (scans / name).write_bytes((work_dir / f"sources/page-00{index}.png").read_bytes())
    stamp = (work_dir / "sources/page-001.png").stat().st_mtime_ns
    sys.argv = ["1_render.py", str(scans), "--category", "scan-test", "--quiet"]
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = render1.main()
    assert code == 0, (code, buffer.getvalue()[-300:])
    assert (work_dir / "sources/page-001.png").stat().st_mtime_ns == stamp, "同尺寸副本不该重写"
    assert list((work_dir / "pages").glob("*.png")) == []
    print("[6] 续跑：副本已存在且大小一致 → 跳过复制（不重写、不产生中间页图）")

    # ── 7) 端点不认的格式（PPM）→ 转成 PNG，page_files 记相对名 ─────────────
    ppm_dir = sandbox / "ppm-scan"
    ppm_dir.mkdir()
    (ppm_dir / "scan-1.ppm").write_bytes(
        b"P6\n2 2\n255\n" + bytes([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0])
    )
    sys.argv = ["1_render.py", str(ppm_dir), "--category", "ppm-test", "--quiet"]
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = render1.main()
    assert code == 0, (code, buffer.getvalue()[-400:])
    ppm_doc = json.loads((FAKE_WORK / "ppm-test" / "source-manifest.json").read_text("utf-8"))[
        "documents"
    ][0]
    assert ppm_doc["page_files"]["1"] == "pages/page-001.png", ppm_doc["page_files"]
    assert (FAKE_WORK / "ppm-test" / "pages" / "page-001.png").exists()
    assert ppm_doc["page_files_copied"] == 0, ppm_doc
    print("[7] 端点不认的格式（pnm）→ 转成 PNG 再送")

    # ── 8) --max-side：超大图缩小并落 PNG；本来就小就不动它 ────────────────
    big = sandbox / "big.png"
    doc = pymupdf.open()
    page = doc.new_page(width=1000, height=700)
    page.get_pixmap(dpi=144).save(str(big))  # 2000×1400 px
    doc.close()
    sys.argv = ["1_render.py", str(big), "--category", "big-test", "--max-side", "600", "--quiet"]
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = render1.main()
    assert code == 0, (code, buffer.getvalue()[-400:])
    shrunk = pymupdf.Pixmap(str(FAKE_WORK / "big-test" / "pages" / "page-001.png"))
    assert max(shrunk.width, shrunk.height) <= 600, (shrunk.width, shrunk.height)
    big_doc = json.loads((FAKE_WORK / "big-test" / "source-manifest.json").read_text("utf-8"))[
        "documents"
    ][0]
    assert big_doc["max_side"] == 600 and big_doc["page_files"]["1"] == "pages/page-001.png", big_doc
    sys.argv = [
        "1_render.py",
        str(scans / "IMG_1.png"),
        "--category",
        "small-test",
        "--max-side",
        "600",
        "--quiet",
    ]
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = render1.main()
    assert code == 0, (code, buffer.getvalue()[-300:])
    # 本来就比 max-side 小 → 不缩、不转码，走**复制原图**那条路
    assert list((FAKE_WORK / "small-test" / "pages").glob("*.png")) == [], "小图不该被无谓重编码"
    small_doc = json.loads((FAKE_WORK / "small-test" / "source-manifest.json").read_text("utf-8"))[
        "documents"
    ][0]
    assert small_doc["page_files"]["1"] == "sources/page-001.png", small_doc["page_files"]
    print(f"[8] --max-side 600：2000×1400 → {shrunk.width}×{shrunk.height}；本来就小就只复制不转码")

    # ── 9) PDF + 图片混着传：PDF 出页图、图片复制原图 ──────────────────────
    pdf_path = sandbox / "two-pages.pdf"
    doc = pymupdf.open()
    for text in ("first", "second"):
        page = doc.new_page(width=200, height=120)
        page.insert_text((20, 60), text)
    doc.save(str(pdf_path))
    doc.close()
    sys.argv = [
        "1_render.py",
        str(pdf_path),
        str(scans / "IMG_1.png"),
        "--category",
        "mixed-test",
        "--quiet",
    ]
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = render1.main()
    assert code == 0, (code, buffer.getvalue()[-400:])
    mixed = json.loads((FAKE_WORK / "mixed-test" / "source-manifest.json").read_text("utf-8"))[
        "documents"
    ][0]
    assert mixed["pages"] == 3 and mixed["kind"] == "mixed", mixed
    assert mixed["page_files"]["1"] == "pages/page-001.png", mixed
    assert mixed["page_files"]["2"] == "pages/page-002.png", mixed
    assert mixed["page_files"]["3"] == "sources/page-003.png", mixed["page_files"]
    assert mixed["page_files_copied"] == 1, mixed
    written = sorted(p.name for p in (FAKE_WORK / "mixed-test" / "pages").glob("*.png"))
    assert written == ["page-001.png", "page-002.png"], written
    print("[9] 混合输入：2 页 PDF 渲染成页图 + 1 张图复制原图，kind 记 mixed")

    # ── 10) 目录里没有图片 → 明确报错，不要静默什么都不做 ──────────────────
    empty = sandbox / "empty"
    empty.mkdir()
    (empty / "readme.txt").write_text("no images here", encoding="utf-8")
    pages, problems = render1.collect_pages([empty])
    assert pages == [] and problems and "没有可识别的图片" in problems[0], problems
    print("[10] 空目录/非图片目录：给明确问题信息（不静默）")
finally:
    shutil.rmtree(sandbox, ignore_errors=True)

print("\n全部通过：10 组断言 / 沙箱已清理")
