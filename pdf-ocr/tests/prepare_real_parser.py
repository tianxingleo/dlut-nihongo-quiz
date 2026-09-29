"""用**真实 TS 解析器**验收生成的 md（不联网、0 token）。

这是 P4/P6 最硬的一道验收：把 `scripts/parse-japanese-2024-markdown.ts` 复制一份，
**只替换两行路径**（读我们的 md、写临时库），解析逻辑一个字不改，然后真跑一遍，
看解析端到底收下多少题、每题存进库的题干长什么样。

用法：
  python pdf-ocr/tests/prepare_real_parser.py --category LL11512
  npx tsx pdf-ocr/work/.tmp/realparse.ts
  # 然后看打印出来的统计（每题的题组 / 题号 / 题干前 80 字）

本脚本只负责"生成打补丁的副本 + 打印命令"，跑 tsx 由你手动执行（故意不做 subprocess，
免得被沙箱的管道限制挡住）。产物都落在 `pdf-ocr/work/.tmp/`（已 gitignore）。
"""

import argparse
import re
import sys
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1]
REPO = TOOL.parent
sys.path.insert(0, str(TOOL))

import _common as c  # noqa: E402

PARSER = REPO / "scripts" / "parse-japanese-2024-markdown.ts"
OLD_RAW = "const rawPath = path.resolve(__dirname, '../data/raw/japanese/2024年日语期末试卷.md')"
OLD_BANK = "const existingBankPath = path.resolve(__dirname, '../public/question-bank.json')"


def main() -> int:
    parser = argparse.ArgumentParser(description="生成「真实解析器跑我们的 md」用的临时副本")
    parser.add_argument("--category", help="分类名（读 data/raw/<分类名>/<分类名>.md）")
    parser.add_argument("--md", help="直接指定 md 路径")
    args = parser.parse_args()

    c.setup_stdio()
    if not args.category and not args.md:
        c.fail("必须给 --category 或 --md 之一", 1)
    md_path = (
        Path(args.md).expanduser().resolve()
        if args.md
        else (c.RAW_ROOT / c.safe_name(args.category) / f"{c.safe_name(args.category)}.md")
    )
    if not md_path.exists():
        c.fail(f"找不到 {md_path}", 1)

    src = PARSER.read_text(encoding="utf-8")
    if OLD_RAW not in src or OLD_BANK not in src:
        c.fail(f"{PARSER.name} 的两行路径锚点变了，请更新 {Path(__file__).name}", 1)

    c.TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    target = c.TEMP_ROOT / "realparse.ts"
    bank = c.TEMP_ROOT / "real-bank.json"
    src = src.replace(OLD_RAW, f"const rawPath = '{md_path.as_posix()}'")
    src = src.replace(OLD_BANK, f"const existingBankPath = '{bank.as_posix()}'")
    target.write_text(src, encoding="utf-8")

    # 解析端还会往 `__dirname/../data/processed` 写报告（__dirname = work/.tmp）→ 先把目录建好，
    # 否则最后一步 ENOENT（不影响银行产物，但退出码会变成 1）
    (c.TEMP_ROOT.parent / "data" / "processed").mkdir(parents=True, exist_ok=True)

    rel = target.relative_to(REPO)
    c.always(f"[准备] 已生成 {rel}（只改了 rawPath / existingBankPath 两行）")
    c.always(f"[准备] 读入：{md_path.relative_to(REPO)}")
    c.always(f"[准备] 输出：{bank.relative_to(REPO)}")
    c.always("")
    c.always(f"请执行：npx tsx {rel.as_posix()}")
    c.always(
        "然后核对：解析端收下的题数是否等于 `5_check.py` 预告的数量，"
        "以及每题的 numberInGroup / options / answerKey 是否正确。"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
