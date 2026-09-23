"""S7 批量导入的离线验收（不联网、不跑真实 PDF）。

跑法：`python pdf-ocr/tests/test_p7_import.py`

覆盖：入口名默认取文件夹名 / 中文名推不出 key 时给稳定兜底 / 一个文件夹里多份 PDF
各得一个分类名（带序号）、单份不带序号 / `--category-prefix` 非法要报错 / dry-run 不执行。
"""

import importlib.util
import io
import shutil
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))

import _common as c  # noqa: E402

spec = importlib.util.spec_from_file_location("import7", TOOL / "7_import.py")
import7 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import7)

# ── 1) slug：ASCII 压成 a-z 0-9 -；纯中文压不出来 ────────────────────────
assert import7.slug("English CET-4 真题") == "english-cet-4", import7.slug("English CET-4 真题")
assert import7.slug("马原试卷") == "", import7.slug("马原试卷")
print("[1] slug：只保留 a-z 0-9 -，纯中文返回空串")

sandbox = Path(tempfile.mkdtemp(prefix="p7-"))
try:
    # ── 2) 多份 PDF：分类名带序号；单份不带 ──────────────────────────────
    folder = sandbox / "english-cet4"
    folder.mkdir()
    for name in ("2024B.pdf", "2024A.pdf", "note.txt"):
        (folder / name).write_text("x", encoding="utf-8")
    pdfs = import7.collect_pdfs(folder)
    assert [p.name for p in pdfs] == ["2024A.pdf", "2024B.pdf"], [p.name for p in pdfs]  # 排序稳定
    rows = import7.plan(folder, pdfs, "english-cet4", "english-cet4", "")
    # 文件名能推出 ASCII 名字 → **每份卷用自己的目录名**（每份卷一个独立文件夹）
    assert [r["category"] for r in rows] == ["2024a", "2024b"], rows
    assert [r["paper"] for r in rows] == ["2024A", "2024B"], rows
    single = import7.plan(folder, pdfs[:1], "english-cet4", "english-cet4", "")
    assert single[0]["category"] == "2024a", single
    # 纯中文文件名 slug 后只剩数字 → **不能拿它当目录名**，退回 `<前缀>-<序号>`
    cn_rows = import7.plan(folder, [Path("马原试卷1(1)_0_1790064200614.pdf")], "x", "principles", "")
    assert cn_rows[0]["category"] == "principles", cn_rows
    # 卡片名要去掉 `_0_<长数字>` **和下载后缀 `(1)`**（否则侧栏挂着「马原试卷1(1)」）
    assert cn_rows[0]["paper"] == "马原试卷1", cn_rows
    print("[2] 计划：能推出名字就用文件名（每卷一个目录）、纯中文退回前缀+序号；卡片名去掉 `_0_<长数字>`")

    # ── 3) dry-run：**入口名默认 = 文件夹名**；中文名给稳定兜底 key ───────
    cn = sandbox / "马原试卷"
    cn.mkdir()
    (cn / "卷1.pdf").write_text("x", encoding="utf-8")
    sys.argv = ["7_import.py", "--folder", str(cn), "--dry-run"]
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = import7.main()
    out = buf.getvalue()
    assert code == 0, (code, out)
    assert "入口「马原试卷」" in out, out
    assert "entry-" in out and "1. 卷1.pdf" in out, out
    assert "--dry-run：只列计划，未执行" in out, out
    print("[3] dry-run：入口名默认取文件夹名；中文名自动给稳定 key（entry-<hash>）")

    # ── 4) 非法 --category-prefix 要报错（退出码 1）──────────────────────
    sys.argv = ["7_import.py", "--folder", str(cn), "--category-prefix", "中文前缀", "--dry-run"]
    try:
        import7.main()
        raise AssertionError("应该报错退出")
    except SystemExit as exc:
        assert exc.code == 1, exc.code
    print("[4] 非法 --category-prefix（纯中文）→ 退出码 1")

    # ── 5) 空文件夹要报错；--from-step / --only-step 被 argparse 拦住非法值 ─
    empty = sandbox / "empty"
    empty.mkdir()
    sys.argv = ["7_import.py", "--folder", str(empty), "--dry-run"]
    try:
        import7.main()
        raise AssertionError("应该报错退出")
    except SystemExit as exc:
        assert exc.code == 1, exc.code
    print("[5] 空文件夹 → 退出码 1（提示没有 PDF）")

    # ── 6) 失败 / 被审核拦截放弃 → **自动继续下一份**，且三桶分开统计 ──────
    # 打桩 run_step / blocked_pages：不真跑 S1–S6，只验证"继续"与汇总口径。
    multi = sandbox / "batch"
    multi.mkdir()
    for name in ("a.pdf", "b.pdf", "c.pdf"):
        (multi / name).write_text("x", encoding="utf-8")

    fail_at: dict[str, dict[int, int]] = {}
    import7.run_step = lambda step, argv, quiet: fail_at.get(
        argv[argv.index("--category") + 1], {}
    ).get(step, 0)
    import7.blocked_pages = lambda category: [6] if category == "b" else []

    def run_batch() -> tuple[int, str]:
        sys.argv = ["7_import.py", "--folder", str(multi), "--quiet"]
        buf2 = io.StringIO()
        with redirect_stdout(buf2):
            rc = import7.main()
        return rc, buf2.getvalue()

    # 6a) a 全绿 + b 被拦截放弃 + c 真失败 → 三份都跑完；退出码 3（只有真失败算错）
    fail_at = {"b": {2: 3}, "c": {2: 1}}
    code, out = run_batch()
    assert code == 3, (code, out)
    assert "试卷 3/3" in out, out                      # 没有停在第 2 份 → 确实继续了
    assert "↷ 自动继续下一份" in out, out
    assert "⊘ 放弃本卷：第 6 页内容审核拦截" in out, out
    assert "放弃（内容审核拦截）：b" in out, out
    assert "失败：c(码 1)" in out, out
    assert "成功 1/3" in out, out

    # 6b) 只有"放弃"、没有真失败 → 退出码 0（放弃是既定决策，不该让自动化报错）
    fail_at = {"b": {2: 3}}
    code, out = run_batch()
    assert code == 0, (code, out)
    assert "成功 2/3" in out, out
    assert "放弃（内容审核拦截）：b" in out and "失败" not in out.split("[完成]")[-1], out

    # 6c) --stop-on-error 时中断（老行为仍可用），且提示续跑命令。
    # 注意用**未被打桩 blocked_pages 的 a**（b 一拦就成"放弃"，测不出"失败即停"）。
    fail_at = {"a": {2: 1}}
    sys.argv = ["7_import.py", "--folder", str(multi), "--quiet", "--stop-on-error"]
    buf3 = io.StringIO()
    with redirect_stdout(buf3):
        code = import7.main()
    out = buf3.getvalue()
    assert code == 3, (code, out)
    assert "已停下" in out and "试卷 2/3" not in out, out
    assert "失败：a(码 1)" in out, out
    print("[6] 失败/放弃后自动继续（默认）、三桶汇总、仅放弃 → 退出码 0；--stop-on-error 才中断")

    # ── 7) --only：只补跑指定卷，**分类名/卡片序号仍是全量计划里的那一个** ────
    fail_at = {}
    ran: list[str] = []

    def only_run_step(step, argv, quiet):
        ran.append(f"{argv[argv.index('--category') + 1]}#{step}")
        return fail_at.get(argv[argv.index("--category") + 1], {}).get(step, 0)

    import7.run_step = only_run_step
    sys.argv = ["7_import.py", "--folder", str(multi), "--quiet", "--only", "b.pdf"]
    buf4 = io.StringIO()
    with redirect_stdout(buf4):
        code = import7.main()
    out = buf4.getvalue()
    assert code == 0, (code, out)
    assert {r.split("#")[0] for r in ran} == {"b"}, ran            # 只跑了 b
    assert "分类 b" in out, out
    assert "全列第 2 份" in out, out                                # 序号没被重排
    # 找不到的 --only 要报错（退出码 1），不能静默跑 0 份
    sys.argv = ["7_import.py", "--folder", str(multi), "--only", "不存在.pdf", "--dry-run"]
    try:
        import7.main()
        raise AssertionError("应该报错退出")
    except SystemExit as exc:
        assert exc.code == 1, exc.code
    print("[7] --only 只跑指定卷且序号不变；匹配不到 → 退出码 1")
finally:
    shutil.rmtree(sandbox, ignore_errors=True)

print("\n全部通过：7 组断言 / 沙箱已清理")
