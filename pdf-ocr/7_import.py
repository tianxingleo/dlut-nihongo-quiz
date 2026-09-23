"""S7：**文件夹批量导入** —— 一个文件夹 = 一个入口，文件夹里的每个 PDF = 一张试卷卡。

把 S1→S6 串起来全自动跑：

    S1 渲染页图 → S2 双路 OCR → S3 比对提取 → S4 汇总成文 → S5 契约门禁 → S6 发布上站

用法：

    # 入口名默认取**文件夹名**（例：`.../马克思主义原理/` → 入口「马克思主义原理」）
    python pdf-ocr/7_import.py --folder "C:\\Users\\me\\Desktop\\马原试卷"

    # 用一个文件夹批量导入到**指定入口**（文件夹里多份 PDF 都挂到同一入口下）
    python pdf-ocr/7_import.py --folder .\\inbox --entry "英语四级" --entry-key english-cet4 --entry-icon 英

    # 先看计划不跑（打印每个 PDF 的分类名与要执行的步骤）
    python pdf-ocr/7_import.py --folder .\\inbox --dry-run

    # 断点续跑：从第 3 步开始（前面几步的产物已存在会被各自跳过）
    python pdf-ocr/7_import.py --folder .\\inbox --from-step 3

    # 只补跑某几份（文件名含这个子串；分类名与卡片顺序仍按全量计划，不会错位）
    python pdf-ocr/7_import.py --folder .\\inbox --only 试卷5,试卷7

规则：
  * 入口名默认 = **文件夹名**；`--entry` 可覆盖。
  * `--entry-key` 不填时由入口名推（只用 a-z 0-9 -；中文名推不出来时必须显式给）。
  * 每个 PDF 一张试卷：卡片标题默认 = **PDF 文件名**（去扩展名）；`--paper-prefix` 可加前缀。
  * 分类名（= `data/raw/<分类名>/` + `public/<分类名>-question-bank.json` 的 key）默认
    `<entry-key>-<序号>`，可用 `--category-prefix` 换前缀。
  * 某一份 PDF 失败或"被内容审核拦截而放弃"时**默认继续**跑下一份（`--stop-on-error` 才停下）。

退出码：0 全部成功（含"仅放弃"）；1 参数/环境错误；3 有试卷失败；4 token 预算耗尽（透传子步骤）。
"""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as c  # noqa: E402

STAGE = "S7/7 批量导入"

STEPS: tuple[tuple[int, str, str], ...] = (
    (1, "1_render.py", "渲染页图"),
    (2, "2_ocr.py", "双路 OCR"),
    (3, "3_merge.py", "比对提取"),
    (4, "4_build_md.py", "汇总成文"),
    (5, "5_check.py", "契约门禁"),
    (6, "6_publish.py", "发布上站"),
)


def slug(text: str) -> str:
    """把任意名字压成 `a-z 0-9 -`（入口 key / 分类名前缀用）。中文会被丢掉，可能返回空串。"""
    flat = re.sub(r"[^a-zA-Z0-9]+", "-", str(text or "").strip()).strip("-").lower()
    return re.sub(r"-{2,}", "-", flat)


def clean_paper_title(stem: str) -> str:
    """把 PDF 文件名收拾成**卡片标题**：去掉平台导出的噪声尾巴。

    实测这些卷的名字长这样：`马原试卷1(1)_0_1790064200614.pdf`、`马原机考题库_202412081720_15114_0_1790063990489.pdf`
    —— 直接当卡片名很难看。这里去掉 `_0_<长数字>` / 结尾的 `_<10 位以上数字>` / 首尾空白。
    """
    text = str(stem or "").strip()
    text = re.sub(r"_0_\d{6,}$", "", text)
    text = re.sub(r"[_\-\s]+\d{10,}$", "", text)
    # 平台下载后缀 `(1)`/`（1）`：同一个文件下过两次就会带上，卡片名别把这个也印出来
    # （实测侧栏出现「马原试卷1(1)」，和「选择试卷」区的「马原试卷1」对不上）。
    text = re.sub(r"[(（]\s*\d{1,2}\s*[)）]$", "", text)
    return text.strip() or str(stem or "").strip()


def collect_pdfs(folder: Path) -> list[Path]:
    """文件夹里的 PDF（不递归子目录；按文件名排序，保证卡片顺序稳定）。"""
    pdfs = sorted(
        (p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"),
        key=lambda p: p.name,
    )
    return pdfs


def plan(folder: Path, pdfs: list[Path], entry_key: str, prefix: str, paper_prefix: str) -> list[dict]:
    """每份 PDF 一行计划：分类名 / 试卷标题 / 输入路径。

    **每份卷一个独立目录**：分类名就是它的目录名（`data/raw/<分类名>/` 放最终 md、
    `pdf-ocr/work/<分类名>/` 放页图与每页 JSON），S1 会自动建。源 PDF **不复制入库**。
    分类名优先用 PDF 文件名推出来的 ASCII 短名；推不出（纯中文名）时退回 `<前缀>-<序号>`。
    卡片标题用文件名清洗后的结果（去掉平台导出的 `_0_<长数字>` 尾巴）。
    """
    rows = []
    used: set[str] = set()
    for index, pdf in enumerate(pdfs, start=1):
        title = clean_paper_title(pdf.stem)
        slugged = slug(title)
        # 必须**含字母**才算"推得出目录名"：纯中文名 slug 后往往只剩几个数字
        # （`马原试卷1(1)` → `1-1`），拿它当目录名既无意义又容易撞车。
        usable = slugged if re.search(r"[a-z]", slugged) else ""
        if len(pdfs) > 1:
            category = usable or f"{prefix}-{index}"
        else:
            category = usable or prefix
        while category in used:  # 两份卷同名时避免撞目录
            category = f"{category}-{index}"
        used.add(category)
        rows.append(
            {
                "index": index,
                "pdf": pdf,
                "category": category,
                "paper": f"{paper_prefix}{title}".strip(),
            }
        )
    return rows


def run_step(step: int, args: list[str], quiet: bool) -> int:
    """跑一个阶段（子进程；stdio 继承，进度行直接打到终端）。"""
    script = c.TOOL_ROOT / STEPS[step - 1][1]
    cmd = [sys.executable, str(script), *args]
    if not quiet:
        c.info(f"      $ python pdf-ocr/{script.name} {' '.join(args)}")
    # 不捕获输出：子进程自己按 §6 的进度规范打印（捕获会破坏进度条与颜色）
    proc = subprocess.run(cmd, cwd=str(c.REPO_ROOT))
    return proc.returncode


def blocked_pages(category: str) -> list[int]:
    """从工作目录的 manifest 里读"因内容审核被拦、重试到头仍不过"的页号。

    S7 不捕获子进程输出（stdio 继承，为了不破坏进度行），所以子步骤把结论写进
    `work/<分类名>/source-manifest.json` 的 `blocked_pages`，这里读出来。
    """
    path = c.WORK_ROOT / category / "source-manifest.json"
    if not path.exists():
        return []
    try:
        data = c.read_json(path) or {}
    except Exception:
        return []
    return [int(n) for n in (data.get("blocked_pages") or [])]


def import_one(row: dict, opts: argparse.Namespace, first: bool) -> int:
    """把一份 PDF 从 S1 跑到 S6。返回最后一个非零退出码（0 = 成功）。"""
    category = row["category"]
    pdf: Path = row["pdf"]
    steps = [s for s, _f, _d in STEPS]
    if opts.only_step:
        steps = [opts.only_step]
    elif opts.from_step > 1:
        steps = [s for s in steps if s >= opts.from_step]

    # **续跑预检**：这份卷的最终 md 已经在 → 说明 S1–S4 跑过了，跳过它们只补 S5/S6
    # （S5 结论可能在、也可能被清掉；S6 挂卡是幂等的）。
    # 否则 S1 会因"最终产物目录已存在且非空"报错，把整批拖停（实测踩过）。
    md_path = c.RAW_ROOT / category / f"{category}.md"
    if md_path.exists() and not opts.force and not opts.only_step:
        c.always(
            f"[{STAGE}] {pdf.name}：已存在 {md_path.name} → 跳过 S1–S4，只补 S5/S6"
            f"（要整条重做加 --force）"
        )
        steps = [s for s in steps if s >= 5]
        if not steps:
            return 0

    for step in steps:
        started = time.perf_counter()
        if step == 1:
            argv = [str(pdf), "--category", category, "--dpi", str(opts.dpi)]
            if opts.force:
                argv.append("--force")
        elif step == 6:
            argv = ["--category", category, "--entry", opts.entry, "--entry-key", opts.entry_key,
                    "--paper", row["paper"], "--position", str(row["index"])]
            if opts.entry_icon:
                argv += ["--entry-icon", opts.entry_icon]
            if opts.entry_desc:
                argv += ["--entry-desc", opts.entry_desc]
            if opts.no_build:
                argv.append("--no-build")
            if opts.no_verify:
                argv.append("--no-verify")
        else:
            argv = ["--category", category]
            if step == 4 and opts.force:
                argv.append("--force")
        if opts.quiet:
            argv.append("--quiet")

        code = run_step(step, argv, opts.quiet)
        name, desc = STEPS[step - 1][1], STEPS[step - 1][2]
        # 退出码约定：0 = 全绿；**2 = 有警告（正常通过）**；1 = 参数/环境；3 = 有失败；4 = 预算耗尽。
        # 以前把"非 0"一律当失败 → S5 只要带待复核警告（exit 2）就被判失败、
        # **根本不会去跑 S6**，于是题库和卡片永远不出现（实测坑了两份卷）。
        if code not in (0, 2):
            # **内容审核拦截（重试到头仍不过）→ 放弃这一套试卷**（用户要求）。
            # 与"可修的失败"区分开：给出 ⊘ 放弃 的明确结论，并记进 row 供汇总统计。
            # 只在**第 2 步（OCR）**判定：拦截记录是那一步写进 manifest 的；后面几步失败
            # 时 manifest 里仍留着旧记录，若不加 step 判断就会把"构建/上传失败"误报成放弃。
            blocked = blocked_pages(category) if step == 2 else []
            if blocked:
                row["abandoned"] = True
                c.always(
                    f"[{STAGE}] ⊘ 放弃本卷：第 {'、'.join(str(n) for n in blocked)} 页内容审核拦截"
                    f"（重试 {3} 次仍不过）→ 跳过后续步骤，数据不完整、不发布"
                )
            c.always(
                f"[{STAGE}] ✗ {row['pdf'].name} 在 {desc}（{name}）失败，退出码 {code}"
                f"（{c.human_ms(started)}ms）"
            )
            return code
        if not opts.quiet:
            warn_note = "（有警告，按约定算通过）" if code == 2 else ""
            c.info(f"      ✓ {desc}（{c.human_ms(started)}ms）{warn_note}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="S7：文件夹批量导入（一个文件夹 = 一个入口，每个 PDF = 一张试卷；S1→S6 全自动）"
    )
    parser.add_argument("--folder", required=True, help="装着 PDF 的文件夹；默认用它当入口名")
    parser.add_argument("--entry", help="入口名（默认=文件夹名）")
    parser.add_argument("--entry-key", help="入口 key（路由 /<key>；默认由入口名推，推不出必须显式给）")
    parser.add_argument("--entry-icon", help="入口图标（1 个字，如「马」）")
    parser.add_argument("--entry-desc", help="入口描述")
    parser.add_argument("--paper-prefix", default="", help="卡片标题前缀（默认空，标题就是 PDF 文件名）")
    parser.add_argument(
        "--only",
        help="只跑文件名里含这个子串的卷（可逗号分隔多个）；分类名与卡片顺序仍按全量计划，不变",
    )
    parser.add_argument("--category-prefix", help="分类名前缀（默认=入口 key）")
    parser.add_argument("--dpi", type=int, default=200, help="S1 渲染分辨率（默认 200）")
    parser.add_argument("--from-step", type=int, default=1, choices=range(1, 7), help="从第几步开始（断点续跑）")
    parser.add_argument("--only-step", type=int, choices=range(1, 7), help="只跑这一步")
    parser.add_argument("--force", action="store_true", help="让 S1/S4 覆盖已存在的产物")
    parser.add_argument(
        "--stop-on-error",
        action="store_true",
        help="某份失败就停下（**默认继续**跑下一份 —— 一份失败不该让另外六份白等）",
    )
    parser.add_argument("--keep-going", action="store_true", help="（兼容旧写法，默认就是继续）")
    parser.add_argument("--no-build", action="store_true", help="S6 跳过 vue-tsc/vite build")
    parser.add_argument("--no-verify", action="store_true", help="S6 跳过全部校验")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不执行")
    parser.add_argument("--quiet", action="store_true", help="只打印每份试卷的完成行")
    args = parser.parse_args()
    args.keep_going = not args.stop_on_error

    c.setup_stdio()
    c.set_quiet(args.quiet)

    folder = Path(args.folder).expanduser()
    if not folder.is_absolute():
        folder = (c.REPO_ROOT / folder).resolve()
    if not folder.is_dir():
        c.fail(f"找不到文件夹：{folder}", 1)

    # 入口名默认 = 文件夹名（用户要求）
    args.entry = (args.entry or folder.name).strip()
    args.entry_key = (args.entry_key or slug(args.entry)).strip()
    if not args.entry_key:
        # 中文文件夹名推不出 ASCII key —— 但**不能因此停住**（用户要求全自动）。
        # 用名字的短哈希当兜底：同一个文件夹名永远得到同一个 key，续跑/重跑都幂等。
        digest = hashlib.sha1(args.entry.encode("utf-8")).hexdigest()[:6]
        args.entry_key = f"entry-{digest}"
        c.warn(
            f"入口名「{args.entry}」推不出 ASCII 路由，已自动用 /{args.entry_key}；"
            f"想要好记的路由请重跑时加 --entry-key <英文短名>，例如 --entry-key marxism"
        )
    prefix = (args.category_prefix or args.entry_key).strip()
    if not slug(prefix):
        c.fail(f"--category-prefix「{prefix}」不合法（只能用 a-z 0-9 -）", 1)

    pdfs = collect_pdfs(folder)
    if not pdfs:
        c.fail(f"文件夹里没有 PDF：{folder}", 1)
    rows = plan(folder, pdfs, args.entry_key, prefix, args.paper_prefix)
    total_rows = len(rows)
    if args.only:
        wanted = [w.strip().lower() for w in str(args.only).split(",") if w.strip()]
        kept = [r for r in rows if any(w in r["pdf"].name.lower() for w in wanted)]
        missing = [w for w in wanted if not any(w in r["pdf"].name.lower() for r in rows)]
        if missing:
            c.fail(f"--only 在 {folder} 里找不到：{'、'.join(missing)}", 1)
        rows = kept
        if not rows:
            c.fail("--only 没匹配到任何 PDF", 1)
        # **序号保持不变**：`row['index']` 还要喂给 S6 的 `--position`（卡片顺序），
        # 重排会让补跑的那份卷跑到别的卷前面去。
        c.always(
            f"[{STAGE}] --only：{len(rows)}/{total_rows} 份 "
            + "、".join(r["pdf"].name for r in rows)
        )

    c.always(f"[{STAGE}] 文件夹：{folder}")
    c.always(
        f"[{STAGE}] 入口「{args.entry}」（/{args.entry_key}）"
        + (f"，图标 {args.entry_icon}" if args.entry_icon else "")
        + f" ← {len(pdfs)} 份试卷"
    )
    for row in rows:
        c.always(f"[{STAGE}]   {row['index']}. {row['pdf'].name}  →  分类 {row['category']} / 卡片「{row['paper']}」")
    if args.dry_run:
        c.always(f"[{STAGE}] --dry-run：只列计划，未执行（去掉 --dry-run 即开跑）")
        return 0

    started = time.perf_counter()
    failed: list[tuple[str, int]] = []
    abandoned: list[str] = []
    done: list[str] = []
    for position, row in enumerate(rows, 1):
        where = f"{position}/{len(rows)}"
        if len(rows) != total_rows:
            where += f"（全列第 {row['index']} 份）"
        c.always(
            f"[{STAGE}] === 试卷 {where}：{row['pdf'].name}"
            f"（分类 {row['category']}）==="
        )
        code = import_one(row, args, first=row["index"] == 1)
        if code != 0:
            if row.get("abandoned"):
                abandoned.append(row["category"])
            else:
                failed.append((row["category"], code))
            if not args.keep_going:
                c.always(
                    f"[{STAGE}] 已停下（加 --keep-going 可跳过失败项继续）。"
                    f"续跑：python pdf-ocr/7_import.py --folder \"{folder}\" "
                    f"--category-prefix {prefix} --from-step <失败那一步>"
                )
                break
            # **失败/放弃后自动继续下一份**（用户要求；这是默认行为，--stop-on-error 可关掉）。
            # 顺带把"只重跑这一份"的命令打出来：各步都有续跑预检（有产物就跳过），
            # 所以重跑不用挑 --from-step，从头跑一遍只会补上缺的那一步。
            c.always(
                f"[{STAGE}] ↷ 自动继续下一份；单独重跑这一份："
                f"python pdf-ocr/7_import.py --folder \"{folder}\" --entry \"{args.entry}\" "
                f"--entry-key {args.entry_key}   # 各步有产物即跳过，从头跑即可"
            )
        else:
            done.append(row["category"])
            c.always(f"[{STAGE}] ✓ {row['pdf'].name} 全流程完成")

    # **成功数只数真跑完的**：直接 `总数 - 失败 - 放弃` 会把 --stop-on-error 中断后
    # 根本没跑的那几份也报成"成功"（实测 6c 里 3 份只跑了 1 份却显示 2/3）。
    ok = len(done)
    c.always(
        f"[完成] 批量导入：成功 {ok}/{len(rows)}"
        + (f"｜放弃（内容审核拦截）：{', '.join(abandoned)}" if abandoned else "")
        + (f"｜失败：{', '.join(f'{k}(码 {v})' for k, v in failed)}" if failed else "")
        + (f"｜未跑（已中断）：{len(rows) - ok - len(failed) - len(abandoned)} 份"
           if len(rows) > ok + len(failed) + len(abandoned) else "")
        + f"｜总耗时 {c.human_ms(started) / 1000:.1f}s"
    )
    # **只有"真失败"才算错**：被审核拦截而主动放弃的卷是既定决策，不该让自动化流程报错
    # （否则 CI/脚本会把"这一套不要了"当成异常）。有真失败时仍返回 3。
    return 3 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
