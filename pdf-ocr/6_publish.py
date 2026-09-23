"""S6：把**通过 S5 校验的** md 发布上站 —— 生成题库 + 把分类"拼接"进站点源码。

用法：
  python pdf-ocr/6_publish.py --category computer-2026-midterm
  python pdf-ocr/6_publish.py --category X --short "2026期中（软国）" --long "计算机组成 · 2026期中" --dry-run

**下架**（把一套卷 / 一个入口从站点撤掉，改动量与发布对称）：
  python pdf-ocr/6_publish.py --unpublish --category marxism-4            # 只下架这一套卷
  python pdf-ocr/6_publish.py --unpublish --entry-key marxism             # 整个入口（含它下面的卷）
  python pdf-ocr/6_publish.py --unpublish --category marxism-4 --purge    # 连 data/raw 与 work 一起删

它做两件事（都是幂等的，重复跑不会插重复条目）：

  1. **生成题目卡片的数据**：调 `scripts/parse-computer-paper.ts`（复用与日语 2024 同一套解析器）
     → `public/<分类名>-question-bank.json` + `data/processed/<分类名>-validation-report.json`
  2. **把新分类"拼接"进站点源码**，共 6 处（少一处卡片就不出现 / 或不被审计覆盖）：

     | 文件 | 拼什么 |
     |---|---|
     | `src/types/question.ts` | `Category` 联合类型 |
     | `src/config/categories.ts` | `CATEGORIES` 条目（短名/长名/描述/图标/bankFile/题单视图） |
     | `src/config/courseTree.ts` | `computer-organization` 组下的叶子（侧栏/课程树入口） |
     | `src/config/categories.test.ts` | 硬编码的 key 列表 |
     | `scripts/generate-meta.mjs` | `banks` 列表 → `public/_meta.json`（首页题数） |
     | `scripts/audit-banks.mjs` | `BANKS` 列表（否则新库不在审计范围内） |

     > 试卷清单本身**不需要登记**：`parse-computer-paper.ts` 从 `data/processed/*-check.json`
     > （S5 写的结论）自动发现所有已通过校验的试卷。

然后重建 `_meta.json`、跑类型检查与题库审计，最后（默认）构建一次网页。

前置：`python pdf-ocr/5_check.py --category <分类名>` 必须先跑过（发布门禁）。

退出码：0 成功；1 参数/环境错误；3 有步骤失败。
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as c  # noqa: E402

STAGE = "S6/6 发布上站"
STEPS = 6


# ── 跑外部命令 ──────────────────────────────────────────────────────────
def _resolve(name: str) -> str:
    """Windows 上 npm/npx 是 .cmd，得先解析出全路径。"""
    found = shutil.which(name) or shutil.which(f"{name}.cmd") or shutil.which(f"{name}.exe")
    if not found:
        c.fail(f"找不到命令 {name}（需要 Node.js / npm 在 PATH 里）", 1)
    return found


def run(args: list[str], label: str, attempts: int = 2) -> tuple[int, str]:
    """跑一条外部命令，**失败自动重试**（默认 1 次）。

    为什么：`vue-tsc` / `vite build` / `tsx` 都是 node 进程，机器内存吃紧时会偶发
    `VirtualAlloc failed` 直接崩掉（实测遇到过：批量导入同时跑 OCR + 构建）。
    这类失败重跑一次就好，不该让整份试卷的发布白费。**重试只是重跑同一条命令**，
    不影响幂等性（源码拼接是幂等的、构建无副作用）。
    """
    last_code, last_output = 1, ""
    for attempt in range(1, attempts + 1):
        suffix = "" if attempt == 1 else f"（重试 {attempt - 1}/{attempts - 1}）"
        last_code, last_output = _run_once(args, label + suffix)
        if last_code == 0 or attempt == attempts:
            return last_code, last_output
        c.warn(
            f"命令失败（退出码 {last_code}），立即重试一次：{' '.join(args[:3])} … "
            f"（node 偶发崩溃/OOM 时重试通常就能过）"
        )
    return last_code, last_output


def _run_once(args: list[str], label: str) -> tuple[int, str]:
    """跑一条命令并返回 (退出码, 输出)。故意同时用 shell 兜底（.cmd 在 Windows 上要 cmd.exe）。"""
    display = " ".join(["npx" if i == 0 else a for i, a in enumerate(args)])
    c.info(f"    $ {display}")
    try:
        proc = subprocess.run(
            [_resolve(args[0]), *args[1:]],
            cwd=str(c.REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except OSError:
        proc = subprocess.run(
            " ".join([f'"{_resolve(args[0])}"', *[f'"{a}"' for a in args[1:]]]),
            cwd=str(c.REPO_ROOT),
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def step(index: int, status: str, ms: int, extra: str) -> None:
    c.always(f"[{STAGE}] step {index}/{STEPS} ({index}/{STEPS})  {status} {ms}ms  {extra}")


# ── 站点源码拼接 ────────────────────────────────────────────────────────
def _sorted_insert(entries: list[str], value: str) -> list[str]:
    return sorted({*entries, value})


# `--position 1` 的意思是"该入口下的第 1 张"，不是"整份 CATEGORIES 的第 1 条"。
def insertion_index(existing: list[str], order: dict) -> int:
    """按 `--position/--before/--after` 算出插到 `existing`（**已排除自己**）的第几个位置（0-based）。

    默认（没给这三个参数）＝追加到末尾，也就是"新发布的卡片排在最后一张"。
    找不到锚点 key 时一律退化成追加（不猜、不报错）。
    """
    mode = (order or {}).get("mode", "last")
    value = (order or {}).get("value")
    if mode == "first":
        return 0
    if mode == "index":
        try:
            return max(0, min(len(existing), int(value) - 1))
        except (TypeError, ValueError):
            return len(existing)
    if mode == "before":
        return existing.index(value) if value in existing else len(existing)
    if mode == "after":
        return existing.index(value) + 1 if value in existing else len(existing)
    return len(existing)


def _describe_position(existing: list[str], index: int) -> str:
    if not existing:
        return "唯一一张"
    if index <= 0:
        return f"第 1 张（{existing[0]} 之前）"
    if index >= len(existing):
        return f"第 {len(existing) + 1} 张（{existing[-1]} 之后）"
    return f"第 {index + 1} 张（{existing[index - 1]} 与 {existing[index]} 之间）"


def patch_category_union(text: str, key: str, meta: dict, order: dict) -> tuple[str, str]:
    """`src/types/question.ts` 的 Category 联合类型。

    联合类型的**顺序完全不影响语义**，所以只**追加到末尾**（1 行 diff），
    不为了让 computer-* 排在一起去重排整段（那会造出 8 行无关改动）。
    """
    if f"| '{key}'" in text:
        return text, "已存在"
    match = re.search(r"(export type Category =\n)((?:  \| '[^']+'\n)+)", text)
    if not match:
        c.fail("types/question.ts 里找不到 `export type Category =` 的联合类型写法", 3)
    count = len(re.findall(r"  \| '[^']+'", match.group(2))) + 1
    return text[: match.end(2)] + f"  | '{key}'\n" + text[match.end(2) :], f"共 {count} 个 key（追加到末尾）"


def patch_categories_array(text: str, key: str, meta: dict, order: dict) -> tuple[str, str]:
    """`src/config/categories.ts` 的分类条目（短名/长名/描述/图标/bankFile/题单视图）。

    **顺序不在这里管**：卡片顺序由 `src/config/entries.ts` 的 `papers[]` 决定（见 `patch_entries`）。
    所以这里只做"没有就追加"，1 行 diff、不重排。
    """
    if re.search(rf"(?m)^    key: '{re.escape(key)}',$", text):
        return text, "已存在"
    quote = lambda value: str(value).replace("\\", "\\\\").replace("'", "\\'")  # noqa: E731
    block = (
        "  {\n"
        f"    key: '{key}',\n"
        f"    short: '{quote(meta['short'])}',\n"
        f"    long: '{quote(meta['long'])}',\n"
        f"    desc: '{quote(meta['desc'])}',\n"
        f"    icon: '{quote(meta['icon'])}',\n"
        f"    bankFile: '{key}-question-bank.json',\n"
        f"    groupViewTitle: '{quote(meta['groupViewTitle'])}',\n"
        f"    groupViewHint: '{quote(meta['groupViewHint'])}',\n"
        "  },\n"
    )
    end = text.index("\n]\n", text.index("export const CATEGORIES: CategoryMeta[] = [")) + 1
    return text[:end] + block + text[end:], f"short='{meta['short']}'"


def patch_course_tree(text: str, key: str, meta: dict, order: dict) -> tuple[str, str]:
    """`src/config/courseTree.ts`：把试卷作为叶子挂进课程树（侧栏入口）。

    分组的选用规则（**通用，不再只认 computer-***）：
      1. `--course-group <组key>` 指定 → 挂进那个已有分组（不存在就报错并列出可用分组）；
      2. 分类名以 `computer-` 开头 → 挂进「计算机组成（软国际）」（老行为不变）；
      3. 其它分类名 → **自动新建一个分组**（组名 = 入口名，图标 = 入口图标）。

    以前第 3 种情况直接报错"请手动往 courseTree.ts 加叶子" —— 那是把工具该干的活推给人。
    位置规则与 CATEGORIES 一致，**保证侧栏顺序和「选择试卷」区顺序相同**。
    """
    leaf_re = re.compile(r"(?m)^      \{\n        type: 'leaf',\n        key: '([^']+)',")
    remove_re = re.compile(
        rf"(?m)^      \{{\n        type: 'leaf',\n        key: '{re.escape(key)}',\n(?:.*\n)*?      \}},\n"
    )
    label = str(meta["short"]).replace("\\", "\\\\").replace("'", "\\'")
    leaf = (
        "      {\n"
        "        type: 'leaf',\n"
        f"        key: '{key}',\n"
        f"        label: '{label}',\n"
        f"        category: '{key}',\n"
        "      },\n"
    )

    group_key = str(meta.get("courseGroup") or "").strip()
    if not group_key:
        group_key = "computer-organization" if key.startswith("computer-") else ""

    if group_key and f"key: '{group_key}'," not in text:
        available = re.findall(r"(?m)^    key: '([^']+)',$", text)
        c.fail(
            f"--course-group 指定的分组 `{group_key}` 在 src/config/courseTree.ts 里不存在。\n"
            f"        现有分组：{'、'.join(available) if available else '（无）'}\n"
            f"        不指定 --course-group 时，非 computer-* 的试卷会**自动新建分组**（组名=入口名）",
            1,
        )

    if not group_key:
        # 自动分组：**先找同名分组并进去**。早期版本每份卷都新建一个 `<分类>-group`，
        # 结果侧栏里并排出现 5 个一模一样的「马克思主义原理」，每组只挂 1 份卷。
        group_label = str(meta.get("entryName") or meta["short"]).replace("\\", "\\\\").replace("'", "\\'")
        same = re.search(
            rf"(?m)^    key: '([^']+)',\n    label: '{re.escape(group_label)}',$", text
        )
        if same:
            group_key = same.group(1)
        else:
            group_key = f"{key}-group"
            if f"key: '{group_key}'," in text:
                return text, "分组与叶子已存在（位置不变）"
            icon = str(meta.get("entryIcon") or "书").replace("\\", "\\\\").replace("'", "\\'")
            block = (
                "  {\n"
                "    type: 'group',\n"
                f"    key: '{group_key}',\n"
                f"    label: '{group_label}',\n"
                f"    icon: '{icon}',\n"
                "    children: [\n"
                f"{leaf}"
                "    ],\n"
                "  },\n"
            )
            # 找到 **COURSE_TREE 数组字面量**的结尾（不能 rindex("]") —— 文件后面还有别的 `]`）
            anchor = text.index("export const COURSE_TREE")
            end = text.index("\n]", anchor) + 1
            return text[:end] + block + text[end:], f"已新建分组「{group_label}」（{group_key}）并挂上叶子"

    group = text.index(f"key: '{group_key}',")
    children_start = text.index("children: [", group) + len("children: [")
    children_end = text.index("\n    ],", children_start)

    exists = any(m.group(1) == key for m in leaf_re.finditer(text, children_start, children_end))
    explicit = (order or {}).get("mode", "last") != "last" or bool((order or {}).get("explicit"))
    if exists and not explicit:
        # 叶子已在（位置不动），但**标题可能变了** —— 实测文件名带下载后缀 `马原试卷1(1)`，
        # 后来名字改干净了，侧栏却还挂着旧标题（和「选择试卷」卡片的名字对不上）。
        # 这里只刷新 label 那一行（类别/位置一概不动，避免把手工写过的叶子改坏）。
        current = re.search(
            rf"(?m)^      \{{\n        type: 'leaf',\n        key: '{re.escape(key)}',\n"
            rf"        label: '([^']*)',$",
            text[children_start:children_end],
        )
        if current and current.group(1) != label:
            start = children_start + current.start(1)
            return (
                text[:start] + label + text[start + len(current.group(1)) :],
                f"标题刷新为「{meta['short']}」（位置不变）",
            )
        return text, "已存在（位置不变）"
    before = text
    if exists:
        text = remove_re.sub("", text, count=1)
        group = text.index(f"key: '{group_key}',")
        children_start = text.index("children: [", group) + len("children: [")
        children_end = text.index("\n    ],", children_start)

    spans = [
        (m.start(), m.group(1)) for m in leaf_re.finditer(text, children_start, children_end)
    ]
    siblings = [k for _, k in spans]
    index = insertion_index(siblings, order)
    offset = spans[index][0] if index < len(spans) else children_end + 1
    result = text[:offset] + leaf + text[offset:]
    if result == before:
        return before, f"已在该位置（{_describe_position(siblings, index)}）"
    detail = f"{'移动' if exists else '插入'}到{_describe_position(siblings, index)}"
    return result, detail


def patch_test_key_list(text: str, key: str, meta: dict, order: dict) -> tuple[str, str]:
    """`src/config/categories.test.ts` 里硬编码的 key 列表（不改测试会红）。"""
    if f"'{key}'," in text:
        return text, "已存在"
    marker = "expect(CATEGORIES.map((c) => c.key).sort()).toEqual(["
    start = text.index(marker) + len(marker)
    end = text.index("])", start)
    entries = _sorted_insert(re.findall(r"'([^']+)'", text[start:end]), key)
    block = "\n" + "".join(f"      '{e}',\n" for e in entries) + "    "
    return text[:start] + block + text[end:], f"共 {len(entries)} 个 key"


def patch_meta_keys(text: str, key: str, meta: dict, order: dict) -> tuple[str, str]:
    """`scripts/generate-meta.mjs` 的 banks 列表（决定首页题数）。

    数组**单行**时按单行插入、**多行**时才整段重排成有序多行。
    结尾锚点用数组自己的 `]`，不要写死 `.map((key) =>` —— 仓库里这个数组曾经是单行，
    `.map(` 后面的换行位置不一样（实测踩过）。
    """
    if f"'{key}'," in text:
        return text, "已存在"
    marker = "  ...["
    start = text.index(marker) + len(marker)
    end = text.index("]", start)
    segment = text[start:end]
    entries = _sorted_insert(re.findall(r"'([^']+)'", segment), key)
    if "\n" not in segment:
        return text[:start] + ", ".join(f"'{e}'" for e in entries) + text[end:], f"共 {len(entries)} 个题库（单行插入）"
    block = "\n" + "".join(f"    '{e}',\n" for e in entries) + "  "
    return text[:start] + block + text[end:], f"共 {len(entries)} 个题库"


def patch_audit_banks(text: str, key: str, meta: dict, order: dict) -> tuple[str, str]:
    """`scripts/audit-banks.mjs` 的 BANKS 列表（否则新库不在审计范围内）。

    这个列表本来就不是排好序的（BANKS 前面是 question/word/history/party/military），
    所以**保持原顺序、追加到末尾**，避免把无关的行也重排（diff 越小越好）。
    """
    name = f"{key}-question-bank.json"
    if f"'{name}'" in text:
        return text, "已存在"
    marker = "const BANKS = ["
    start = text.index(marker) + len(marker)
    end = text.index("]", start)
    return text[:end] + f"  '{name}',\n" + text[end:], "追加到末尾"


# 读写源码：**保留文件原有的行尾符**（仓库里同时存在 CRLF 与 LF，统一改写会造出一堆假 diff）
def read_source(path: Path) -> tuple[str, bool]:
    raw = path.read_bytes().decode("utf-8")
    return raw.replace("\r\n", "\n"), "\r\n" in raw


def write_source(path: Path, text: str, crlf: bool) -> None:
    path.write_bytes((text.replace("\n", "\r\n") if crlf else text).encode("utf-8"))


PATCHERS = [
    ("src/types/question.ts", patch_category_union),
    ("src/config/categories.ts", patch_categories_array),
    ("src/config/courseTree.ts", patch_course_tree),
    ("src/config/categories.test.ts", patch_test_key_list),
    ("scripts/generate-meta.mjs", patch_meta_keys),
    ("scripts/audit-banks.mjs", patch_audit_banks),
]
ENTRIES_RELATIVE = "src/config/entries.ts"


# ── 入口卡（src/config/entries.ts）：先建入口，再挂试卷 ──────────────────
ENTRIES_MARKER = "export const ENTRIES: EntryMeta[] = ["


def parse_entries(text: str) -> tuple[str, list[dict], str]:
    """把 `src/config/entries.ts` 拆成 (前文, 入口列表, 后文)。

    这个文件是**我们生成的**（格式固定），所以直接解析结构比正则手术稳。
    人类在数组里加的注释会在重写时丢掉 —— 注释请写在文件头的文档串里。
    """
    start = text.index(ENTRIES_MARKER) + len(ENTRIES_MARKER)
    end = text.index("\n]\n", start)
    entries: list[dict] = []
    # 注意结尾是 `  },` **不带换行**（那个换行属于后面的 `\n]`），别写成 `\n  },\n`
    for chunk in re.findall(r"  \{\n(.*?)\n  \},", text[start:end], re.S):
        key = re.search(r"key: '([^']+)'", chunk)
        name = re.search(r"name: '([^']*)'", chunk)
        icon = re.search(r"icon: '([^']*)'", chunk)
        desc = re.search(r"desc: '([^']*)'", chunk)
        papers_block = re.search(r"papers: \[(.*?)\]", chunk, re.S)
        if not key:
            continue
        entries.append(
            {
                "key": key.group(1),
                "name": name.group(1) if name else key.group(1),
                "icon": icon.group(1) if icon else "组",
                "desc": desc.group(1) if desc else "",
                "papers": re.findall(r"'([^']+)'", papers_block.group(1)) if papers_block else [],
            }
        )
    return text[:start], entries, text[end:]


def render_entries(entries: list[dict]) -> str:
    """渲染 ENTRIES 数组的**内部文本**：以 `\\n` 开头、结尾**不带**换行。

    这样 `head`（到 `[` 为止）+ 本函数结果 + `tail`（从 `\\n]` 开始）拼起来才刚好，
    不会多出空行（实测：边界差一个换行会直接让解析器数出 0 个入口）。
    """
    blocks: list[str] = []
    for entry in entries:
        lines = [
            "  {",
            f"    key: '{entry['key']}',",
            f"    name: '{entry['name']}',",
            f"    icon: '{entry['icon']}',",
        ]
        if entry.get("desc"):
            lines.append(f"    desc: '{entry['desc']}',")
        lines.append("    papers: [")
        lines.extend(f"      '{paper}'," for paper in entry["papers"])
        lines.append("    ],")
        lines.append("  },")
        blocks.append("\n".join(lines))
    return "\n" + "\n".join(blocks)


def resolve_entry(text: str, category: str, meta: dict, want_name: str, want_key: str) -> tuple[str, str, str, str, bool]:
    """决定这份试卷挂到哪个入口：**存在就加进去，不存在就新建**。

    返回 (入口 key, 入口名, 图标, 副标题, 是否新建)。
    匹配顺序：`--entry-key` 精确 → `--entry` 名字精确 → 这份试卷当前所在入口 → 新建。
    """
    _, entries, _ = parse_entries(text)
    by_key = {e["key"]: e for e in entries}
    by_name = {e["name"]: e for e in entries}

    if want_key and want_key in by_key:
        e = by_key[want_key]
        return e["key"], e["name"], e["icon"], e["desc"], False
    if want_name and want_name in by_name:
        e = by_name[want_name]
        return e["key"], e["name"], e["icon"], e["desc"], False
    if not want_key and not want_name:
        current = next((e for e in entries if category in e["papers"]), None)
        if current:
            return current["key"], current["name"], current["icon"], current["desc"], False

    # 新建：key 优先用 --entry-key，否则从名字里抽 ASCII（中文名抽不出来就必须显式给）
    new_key = re.sub(r"[^a-z0-9-]+", "-", (want_key or "").lower()).strip("-")
    if not new_key:
        new_key = re.sub(r"[^a-z0-9-]+", "-", (want_name or "").lower()).strip("-")
    if not new_key or not re.fullmatch(r"[a-z0-9-]+", new_key):
        c.fail(
            f"要新建入口「{want_name or want_key}」，但推不出合法的 key（只能用 a-z 0-9 -）。"
            f"请加 --entry-key，例如 --entry-key cs-organization",
            1,
        )
    if new_key in by_key:
        c.fail(f"入口 key {new_key} 已被「{by_key[new_key]['name']}」占用", 1)
    return new_key, (want_name or new_key), meta.get("entryIcon") or "组", meta.get("entryDesc") or "", True


def patch_entries(text: str, key: str, meta: dict, order: dict) -> tuple[str, str]:
    """把这份试卷挂进目标入口的 `papers[]`（**顺序即「选择试卷」区卡片顺序**）。

    - 入口已存在 → 只加试卷；不存在 → 先新建入口再挂。
    - 一份试卷只能属于一个入口：会先从其它入口的 `papers` 里摘掉它。
    - 已经在目标入口里时，位置参数会把它**移动**到新位置（默认追加到最后）。
    """
    head, entries, tail = parse_entries(text)
    target_key = meta["entryKey"]
    target_before = next((e for e in entries if e["key"] == target_key), None)
    present_here = target_before is not None and key in target_before["papers"]
    for entry in entries:
        entry["papers"] = [p for p in entry["papers"] if p != key]

    target = target_before
    created = target is None
    if created:
        target = {
            "key": target_key,
            "name": meta["entryName"],
            "icon": meta.get("entryIcon") or "组",
            "desc": meta.get("entryDesc") or "",
            "papers": [],
        }
        entries.append(target)

    assert target is not None
    siblings = list(target["papers"])
    index = insertion_index(siblings, order)
    target["papers"].insert(index, key)
    result = head + render_entries(entries) + tail
    if result == text:
        return text, f"已在第 {index + 1} 张（无改动）"
    if created:
        detail = f"新建入口「{target['name']}」（/{target_key}）并把试卷挂到第 {index + 1} 张"
    elif present_here:
        detail = f"入口「{target['name']}」：试卷移动到{_describe_position(siblings, index)}"
    else:
        detail = f"入口「{target['name']}」：试卷插入到{_describe_position(siblings, index)}"
    return result, detail


def category_order() -> list[str]:
    """「选择试卷」区的**实际顺序**（读 entries.ts 里第一个入口的 papers，给用户看结果）。"""
    path = c.REPO_ROOT / "src" / "config" / "entries.ts"
    if not path.exists():
        return []
    text, _ = read_source(path)
    _, entries, _ = parse_entries(text)
    return list(entries[0]["papers"]) if entries else []


def paper_labels() -> list[str]:
    """把 `category_order()` 的 key 换成卡片上真正显示的 `short` 名。"""
    order = category_order()
    path = c.REPO_ROOT / "src" / "config" / "categories.ts"
    if not path.exists():
        return order
    text, _ = read_source(path)
    shorts = dict(re.findall(r"(?m)^    key: '([^']+)',\n    short: '([^']*)',", text))
    return [shorts.get(key, key) for key in order]


# ── 卷名 / 展示信息 ─────────────────────────────────────────────────────
def paper_title(category: str) -> str:
    """从 md 的第一个 `## 题组X：<名字>` 取卷名（S4 写的就是它）。"""
    md = c.RAW_ROOT / category / f"{category}.md"
    if md.exists():
        match = re.search(r"(?m)^##\s*题组[一二三四五六七八九十][：:]\s*(.+?)\s*$", md.read_text(encoding="utf-8"))
        if match and match.group(1).strip():
            return match.group(1).strip()
    return category


def default_meta(category: str) -> dict:
    title = paper_title(category)
    desc = ""
    report = c.REPO_ROOT / "data" / "processed" / f"{category}-validation-report.json"
    if report.exists():
        data = c.read_json(report)
        source = data.get("explanationSource") or {}
        desc = f"{data.get('questions', 0)}题 · 双路 OCR 校对"
        if source.get("generated"):
            desc += f" · AI 解析 {source['generated']} 题"
    return {
        "short": title,
        "long": title,
        "desc": desc or "双路 OCR 校对",
        "icon": "组",
        "groupViewTitle": "刷题单",
        "groupViewHint": "全卷 1 张题单；匹配题的公共题干已复制到每道小题的题干上方。",
    }


# ── 入口 ────────────────────────────────────────────────────────────────
# ── 下架（--unpublish）：把一套卷 / 一个入口从站点侧撤掉 ──────────────────
# 以前这是一次性脚本（`_unpublish_marx.py`：手工改 7 个文件 + 删 3 个文件），
# 改哪儿、删哪儿这套知识只该有一份 —— 现在收进发布器，脚本已删。
def remove_entries(text: str, category: str | None, entry_key: str | None) -> tuple[str, str]:
    """`src/config/entries.ts`：摘掉一套卷；某个入口被摘空就整个删掉。

    `entry_key` 给了就整个入口下架（它下面的试卷一起摘）。
    """
    head, entries, tail = parse_entries(text)
    before = sum(len(entry["papers"]) for entry in entries)
    kept: list[dict] = []
    dropped = 0
    for entry in entries:
        if entry_key and entry["key"] == entry_key:
            dropped += 1
            continue
        if category and category in entry["papers"]:
            entry["papers"] = [p for p in entry["papers"] if p != category]
        if entry["papers"]:
            kept.append(entry)
        else:
            dropped += 1
    after = sum(len(entry["papers"]) for entry in kept)
    detail = f"摘掉 {before - after} 套卷"
    if dropped:
        detail += f"、删掉 {dropped} 个空入口"
    return head + render_entries(kept) + tail, detail


def remove_course_tree_leaf(text: str, key: str) -> tuple[str, str]:
    """`src/config/courseTree.ts`：删掉这份卷的叶子；分组空了连分组一起删。"""
    leaf_re = re.compile(
        rf"(?m)^      \{{\n        type: 'leaf',\n        key: '{re.escape(key)}',\n(?:.*\n)*?      \}},\n"
    )
    match = leaf_re.search(text)
    if not match:
        return text, "课程树里没有这份卷（可能本来就没上过站）"
    removed = text[: match.start()] + text[match.end() :]
    # 空分组：type/label/icon 之后直接是空的 children。用负向先行断言卡住"别跨到下一个分组"
    group_re = re.compile(
        r"(?m)^  \{\n    type: 'group',\n(?:(?!^  \{\n).*\n)*?    children: \[\n    \],\n  \},\n"
    )
    empty = group_re.search(removed)
    if empty:
        return removed[: empty.start()] + removed[empty.end() :], "删掉叶子（分组已空 → 连分组一起删）"
    return removed, "删掉叶子"


def remove_category_union(text: str, key: str) -> tuple[str, str]:
    """`src/types/question.ts` 的 Category 联合类型。"""
    new, count = re.subn(rf"\n  \| '{re.escape(key)}'", "", text, count=1)
    return (new, "删掉联合类型里的 key") if count else (text, "联合类型里没有这个 key")


def remove_categories_block(text: str, key: str) -> tuple[str, str]:
    """`src/config/categories.ts` 的分类块。"""
    new, count = re.subn(
        rf"(?m)^  \{{\n    key: '{re.escape(key)}',\n(?:.*\n)*?  \}},\n", "", text, count=1
    )
    return (new, "删掉分类块") if count else (text, "分类数组里没有这个 key")


def remove_test_key(text: str, key: str) -> tuple[str, str]:
    """`src/config/categories.test.ts` 里硬编码的 key 列表（不改会红）。"""
    new, count = re.subn(rf"(?m)^      '{re.escape(key)}',\n", "", text, count=1)
    return (new, "删掉期望列表里的 key") if count else (text, "期望列表里没有这个 key")


def remove_meta_key(text: str, key: str) -> tuple[str, str]:
    """`scripts/generate-meta.mjs` 的 banks 列表（多行/单行、末项/中间项都要吃得下）。"""
    for pattern in (
        rf"(?m)^    '{re.escape(key)}',\n",  # 多行写法：整行删掉
        rf"'{re.escape(key)}',\s*",  # 单行、不是最后一项
        rf",\s*'{re.escape(key)}'",  # 单行、是最后一项 → 连前面的逗号一起摘
    ):
        new, count = re.subn(pattern, "", text, count=1)
        if count:
            return new, "从题库清单里摘掉"
    return text, "题库清单里没有这个 key"


def remove_audit_bank(text: str, key: str) -> tuple[str, str]:
    """`scripts/audit-banks.mjs` 的 BANKS 列表。"""
    new, count = re.subn(
        rf"(?m)^  '{re.escape(key)}-question-bank\.json',\n", "", text, count=1
    )
    return (new, "从审计清单里摘掉") if count else (text, "审计清单里没有这个题库")


UNPUBLISH_PATCHERS = [
    ("src/types/question.ts", remove_category_union),
    ("src/config/categories.ts", remove_categories_block),
    ("src/config/courseTree.ts", remove_course_tree_leaf),
    ("src/config/categories.test.ts", remove_test_key),
    ("scripts/generate-meta.mjs", remove_meta_key),
    ("scripts/audit-banks.mjs", remove_audit_bank),
]


def unpublish(args) -> int:
    """下架：摘注册点 → 删产物 → 重建 _meta → 类型检查 / 审计 / 构建。

    `--purge` 连 `data/raw/<分类>/` 与 `pdf-ocr/work/<分类>/`（花过 token 的原始材料）一起删。
    """
    category = c.safe_name(args.category) if args.category else ""
    entry_key = (args.entry_key or "").strip()
    if not category and not entry_key:
        c.fail("--unpublish 要配 --category（下架一套卷）或 --entry-key（下架整个入口）", 1)

    started_all = time.perf_counter()
    c.always(
        f"[{STAGE}] 下架："
        + "、".join(x for x in (f"分类 {category}" if category else "", f"入口 {entry_key}" if entry_key else "") if x)
        + ("（--purge：连原始材料一起删）" if args.purge else "")
    )
    changed: list[str] = []

    # 入口下架时先记下它下面有哪些卷 —— 那些卷的题库/清单也要清
    entries_path = c.REPO_ROOT / ENTRIES_RELATIVE
    original, crlf = read_source(entries_path)
    _head, entries_before, _tail = parse_entries(original)
    papers: list[str] = [category] if category else []
    if entry_key:
        for entry in entries_before:
            if entry["key"] == entry_key:
                papers.extend(entry["papers"])
    papers = sorted({p for p in papers if p})

    # ① entries.ts
    t0 = time.perf_counter()
    updated, detail = remove_entries(original, category or None, entry_key or None)
    if updated == original:
        c.info(f"    {ENTRIES_RELATIVE}：{detail}")
    else:
        changed.append(ENTRIES_RELATIVE)
        if args.dry_run:
            c.info(f"    {ENTRIES_RELATIVE}：将{detail}")
        else:
            write_source(entries_path, updated, crlf)
            c.info(f"    {ENTRIES_RELATIVE}：已{detail}")
    step(1, "✓", c.human_ms(t0), f"入口注册 {'，'.join(papers) if papers else '（无）'}")

    # ② 其余注册点：**按文件**处理（一个文件一次把 N 套卷都摘掉，日志才不刷屏）
    t0 = time.perf_counter()
    keys = papers or []
    if entry_key and not keys:
        c.fail(f"入口 {entry_key} 在 entries.ts 里不存在（或底下没有试卷）", 1)
    for relative, remover in UNPUBLISH_PATCHERS:
        path = c.REPO_ROOT / relative
        if not path.exists():
            c.fail(f"找不到要改的文件 {relative}", 1)
        text, crlf = read_source(path)
        original = text
        hits = 0
        for key in keys:
            text, detail = remover(text, key)
            if text != original:
                hits += 1
                original = text
        if not hits:
            c.info(f"    {relative}：{detail}")
            continue
        changed.append(relative)
        if args.dry_run:
            c.info(f"    {relative}：将摘掉 {hits} 套卷的注册（{detail}）")
        else:
            write_source(path, text, crlf)
            c.info(f"    {relative}：已摘掉 {hits} 套卷的注册（{detail}）")
    step(2, "✓", c.human_ms(t0), f"{len(keys)} 套卷 × {len(UNPUBLISH_PATCHERS)} 处注册点")

    # ③ 删产物文件（题库、清单；--purge 连原始材料）
    t0 = time.perf_counter()
    removed_files: list[str] = []
    targets = [
        *[f"public/{key}-question-bank.json" for key in keys],
        *[f"data/processed/{key}-check.json" for key in keys],
        *[f"data/processed/{key}-validation-report.json" for key in keys],
    ]
    if args.purge:
        targets += [f"data/raw/{key}" for key in keys] + [f"pdf-ocr/work/{key}" for key in keys]
    for relative in targets:
        path = c.REPO_ROOT / relative
        if not path.exists():
            continue
        removed_files.append(relative)
        if args.dry_run:
            continue
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    step(
        3,
        "✓",
        c.human_ms(t0),
        ("将删除 " if args.dry_run else "已删除 ")
        + (f"{len(removed_files)} 项：{', '.join(removed_files[:4])}" + ("…" if len(removed_files) > 4 else "")
           if removed_files else "0 项（本来就没有）"),
    )

    # ④ 重建 _meta.json（题库文件已删 → 这里必须不再列出这些 key）
    t0 = time.perf_counter()
    if args.dry_run:
        step(4, "·", 0, "dry-run：跳过 generate:meta")
    else:
        code, output = run(["npm", "run", "generate:meta", "--silent"], "S6")
        if code != 0:
            c.fail(f"generate:meta 失败（退出码 {code}）：\n{output[-500:]}", 3)
        meta_json = c.read_json(c.REPO_ROOT / "public" / "_meta.json") or {}
        left = [key for key in keys if key in meta_json]
        if left:
            c.fail(f"_meta.json 里还留着 {'、'.join(left)}（检查 scripts/generate-meta.mjs）", 3)
        step(4, "✓", c.human_ms(t0), f"public/_meta.json → 已去掉 {len(keys)} 个 key")

    # ⑤ 类型检查 + 题库审计；⑥ 构建
    t0 = time.perf_counter()
    if args.dry_run or args.no_verify:
        step(5, "·", 0, "跳过类型检查 + 审计")
    else:
        code, output = run(["npx", "vue-tsc", "-b"], "S6")
        if code != 0:
            c.fail(f"vue-tsc 类型检查失败（退出码 {code}）：\n{output[-800:]}", 3)
        code, output = run(["npm", "run", "audit:banks", "--silent"], "S6")
        if code != 0:
            c.fail(f"题库审计未通过（退出码 {code}）：\n{output[-800:]}", 3)
        step(5, "✓", c.human_ms(t0), "vue-tsc ✓ / 审计 ✓")
    t0 = time.perf_counter()
    if args.dry_run or args.no_build:
        step(6, "·", 0, "跳过 vite build")
    else:
        code, output = run(["npx", "vite", "build"], "S6")
        if code != 0:
            c.fail(f"vite build 失败（退出码 {code}）：\n{output[-800:]}", 3)
        built = [line for line in output.splitlines() if "built in" in line]
        step(6, "✓", c.human_ms(t0), built[-1].strip() if built else "vite build ✓")

    c.always("")
    c.always(f"[{STAGE}] 下架 {'、'.join(keys) if keys else '（无）'}；站点源码改动 {len(changed)} 处")
    if not args.purge and not args.dry_run:
        c.info("原始材料保留在 data/raw/<分类>/ 与 pdf-ocr/work/<分类>/（要一起删加 --purge）")
    c.always(
        f"[完成] 下架 {'（dry-run，未写盘）' if args.dry_run else '✓'} | 总耗时 {c.human_ms(started_all) / 1000:.1f}s"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="S6：生成题库 + 把分类拼接进站点源码（docs/pdf-ocr-pipeline.md §29）"
    )
    parser.add_argument("--category", help="分类名（= data/processed/<分类名>-check.json 的 key）")
    parser.add_argument("--short", help="分类短名（默认取卷名）")
    parser.add_argument("--long", help="分类长名（默认取卷名）")
    parser.add_argument("--desc", help="一句话描述（默认按题数/解析数自动生成）")
    parser.add_argument("--icon", help="图标字（默认「组」）")
    # 入口卡：先建入口，再挂试卷（存在就加，不存在就新建）
    parser.add_argument("--entry", help="入口名（如「计算机组成（软国际）」）；不存在则新建该入口")
    parser.add_argument("--entry-key", help="新入口的 key（路由路径，只能 a-z0-9-；中文入口名必须给）")
    parser.add_argument("--entry-icon", help="新入口的图标字（默认「组」）")
    parser.add_argument("--entry-desc", help="新入口卡的副标题（默认自动「N 份试卷 · M 题」）")
    parser.add_argument("--paper", help="试卷名 = 卡片标题（等价于 --short）")
    # 卡片位置（同类卡片之间，默认追加到最后一张）
    parser.add_argument("--position", type=int, help="放在同类卡片的第几张（1 = 最前）")
    parser.add_argument("--before", help="放在这份试卷之前（填分类名，如 computer-2021-final）")
    parser.add_argument(
        "--course-group",
        help="挂进哪个课程树分组（src/config/courseTree.ts 里的 group key）。"
        "不填时：computer-* 挂「计算机组成（软国际）」，其它分类名**自动新建一个分组**（组名=入口名）",
    )
    parser.add_argument("--after", help="放在这份试卷之后（填分类名）")
    parser.add_argument("--last", action="store_true", help="挪回同类卡片的最后一张")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要做的改动，不写盘")
    parser.add_argument("--no-build", action="store_true", help="跳过最后的 vite build")
    parser.add_argument("--no-verify", action="store_true", help="跳过 vue-tsc + 题库审计")
    parser.add_argument("--quiet", action="store_true", help="只打印每步完成行与最终摘要")
    # 下架：把已上站的卷/入口从站点撤掉（与发布对称的 6 步）
    parser.add_argument("--unpublish", action="store_true", help="下架模式：配 --category 或 --entry-key")
    parser.add_argument("--purge", action="store_true", help="下架时连 data/raw 与 pdf-ocr/work 一起删")
    args = parser.parse_args()

    c.setup_stdio()
    c.set_quiet(args.quiet)

    if args.unpublish:
        return unpublish(args)

    if not args.category:
        c.fail("发布要 --category <分类名>（下架用 --unpublish）", 1)

    category = c.safe_name(args.category)
    started_all = time.perf_counter()
    changed: list[str] = []

    # ① 门禁：S5 结论必须存在、通过、且对得上这份 md
    t0 = time.perf_counter()
    verdict_path = c.REPO_ROOT / "data" / "processed" / f"{category}-check.json"
    if not verdict_path.exists():
        c.fail(
            f"没有 S5 校验结论 {verdict_path.relative_to(c.REPO_ROOT)}；"
            f"请先跑：python pdf-ocr/5_check.py --category {category}",
            1,
        )
    verdict = c.read_json(verdict_path)
    if verdict.get("passed") is not True:
        c.fail(
            f"S5 校验未通过（{len(verdict.get('hard_errors') or [])} 条硬错误），拒绝发布："
            + "；".join(verdict.get("hard_errors") or [])[:300],
            3,
        )
    md_path = c.REPO_ROOT / str(verdict.get("md") or "")
    if not md_path.exists():
        c.fail(f"结论里记的 md 不存在：{verdict.get('md')}", 1)
    actual_sha = c.sha256_of_file(md_path)
    if actual_sha != verdict.get("md_sha256"):
        c.fail(
            f"md 在 S5 校验之后又变了（sha256 不一致），请重跑："
            f"python pdf-ocr/5_check.py --category {category}",
            3,
        )
    step(1, "✓", c.human_ms(t0), f"门禁通过（exit {verdict.get('exit_code')}，警告 {len(verdict.get('warnings') or [])}）")

    # ② 生成题库（调 TS 入口，复用与日语 2024 同一套解析器）
    t0 = time.perf_counter()
    if args.dry_run:
        step(2, "·", 0, "dry-run：跳过生成题库")
    else:
        code, output = run(["npx", "tsx", "scripts/parse-computer-paper.ts", "--key", category], "S6")
        for line in output.strip().splitlines():
            c.info(f"    {line}")
        if code != 0:
            c.fail(f"生成题库失败（tsx 退出码 {code}）", 3)
        bank = c.REPO_ROOT / "public" / f"{category}-question-bank.json"
        if not bank.exists():
            c.fail(f"tsx 说成功了但没看到 {bank.relative_to(c.REPO_ROOT)}", 3)
        step(2, "✓", c.human_ms(t0), f"{bank.relative_to(c.REPO_ROOT)} ✓ {bank.stat().st_size} 字节")

    # ③ 拼接进站点源码（入口卡 + 6 处注册；`--position/--before/--after/--last` 控制试卷位置）
    t0 = time.perf_counter()
    meta = default_meta(category)
    if args.paper:  # 试卷名 = 卡片标题
        meta["short"] = args.paper
        if not args.long:
            meta["long"] = args.paper
    for name, value in (
        ("short", args.short),
        ("long", args.long),
        ("desc", args.desc),
        ("icon", args.icon),
    ):
        if value:
            meta[name] = value
    meta["entryIcon"] = args.entry_icon
    meta["entryDesc"] = args.entry_desc
    meta["courseGroup"] = getattr(args, "course_group", None)

    picked = [
        x
        for x in (
            (args.position is not None, "--position"),
            (bool(args.before), "--before"),
            (bool(args.after), "--after"),
            (bool(args.last), "--last"),
        )
        if x[0]
    ]
    if len(picked) > 1:
        c.fail(f"{'、'.join(x[1] for x in picked)} 只能给一个", 1)
    if args.position is not None:
        order = {"mode": "first"} if args.position <= 1 else {"mode": "index", "value": args.position}
    elif args.before:
        order = {"mode": "before", "value": args.before}
    elif args.after:
        order = {"mode": "after", "value": args.after}
    elif args.last:
        order = {"mode": "last", "explicit": True}
    else:
        order = {"mode": "last"}

    # ③-1 入口卡：存在就把试卷加进去，不存在就新建入口（entries.ts）
    entries_path = c.REPO_ROOT / ENTRIES_RELATIVE
    if not entries_path.exists():
        c.fail(f"找不到 {ENTRIES_RELATIVE}", 1)
    original, crlf = read_source(entries_path)
    entry_key, entry_name, entry_icon, entry_desc, created = resolve_entry(
        original, category, meta, args.entry, args.entry_key
    )
    meta.update(
        entryKey=entry_key,
        entryName=entry_name,
        entryIcon=args.entry_icon or entry_icon,
        entryDesc=args.entry_desc or entry_desc,
    )
    c.info(
        f"    入口：{'新建 ' if created else '已有 '}「{entry_name}」（/{entry_key}）"
        f"{'，图标 ' + meta['entryIcon'] if created else ''}"
    )
    updated, detail = patch_entries(original, category, meta, order)
    if updated == original:
        c.info(f"    {ENTRIES_RELATIVE}：{detail}")
    else:
        changed.append(ENTRIES_RELATIVE)
        if args.dry_run:
            c.info(f"    {ENTRIES_RELATIVE}：将{detail}")
        else:
            write_source(entries_path, updated, crlf)
            c.info(f"    {ENTRIES_RELATIVE}：已{detail}")

    # ③-2 其余注册点
    for relative, patcher in PATCHERS:
        path = c.REPO_ROOT / relative
        if not path.exists():
            c.fail(f"找不到要拼接的文件 {relative}", 1)
        original, crlf = read_source(path)
        updated, detail = patcher(original, category, meta, order)
        if updated == original:
            c.info(f"    {relative}：{detail}")
            continue
        changed.append(relative)
        if args.dry_run:
            c.info(f"    {relative}：将{detail}")
        else:
            write_source(path, updated, crlf)
            c.info(f"    {relative}：已{detail}")
    step(
        3,
        "✓",
        c.human_ms(t0),
        f"站点源码 {len(PATCHERS) + 1} 处：改动 {len(changed)} 处"
        + (f" → {', '.join(changed)}" if changed else "（都已在位）"),
    )
    # 打印「选择试卷」区的实际顺序（= entries.ts 第一个入口的 papers）
    order_line = paper_labels()
    if order_line:
        c.info(f"    「选择试卷」区顺序：{' → '.join(order_line)}")

    # ④ 重建 _meta.json（首页题数）
    t0 = time.perf_counter()
    if args.dry_run:
        step(4, "·", 0, "dry-run：跳过 generate:meta")
    else:
        code, output = run(["npm", "run", "generate:meta", "--silent"], "S6")
        if code != 0:
            c.fail(f"generate:meta 失败（退出码 {code}）：\n{output[-500:]}", 3)
        meta_json = c.read_json(c.REPO_ROOT / "public" / "_meta.json")
        if category not in meta_json:
            c.fail(f"_meta.json 里还是没有 {category}（检查 scripts/generate-meta.mjs）", 3)
        step(4, "✓", c.human_ms(t0), f"public/_meta.json → {category}: {meta_json[category].get('count')} 题")

    # ⑤ 类型检查 + 题库审计
    t0 = time.perf_counter()
    if args.dry_run or args.no_verify:
        step(5, "·", 0, "跳过类型检查 + 审计")
    else:
        code, output = run(["npx", "vue-tsc", "-b"], "S6")
        if code != 0:
            c.fail(f"vue-tsc 类型检查失败（退出码 {code}）：\n{output[-800:]}", 3)
        code, output = run(["npm", "run", "audit:banks", "--silent"], "S6")
        if code != 0:
            c.fail(f"题库审计未通过（退出码 {code}）：\n{output[-800:]}", 3)
        hit = [line for line in output.splitlines() if category in line or "题库审计通过" in line]
        step(5, "✓", c.human_ms(t0), "vue-tsc ✓ / 审计 ✓ " + ("| " + " ".join(x.strip() for x in hit[-2:]) if hit else ""))

    # ⑥ 构建网页
    t0 = time.perf_counter()
    if args.dry_run or args.no_build:
        step(6, "·", 0, "跳过 vite build")
    else:
        code, output = run(["npx", "vite", "build"], "S6")
        if code != 0:
            c.fail(f"vite build 失败（退出码 {code}）：\n{output[-800:]}", 3)
        built = [line for line in output.splitlines() if "built in" in line]
        step(6, "✓", c.human_ms(t0), built[-1].strip() if built else "vite build ✓")

    c.always("")
    c.always(f"[{STAGE}] 入口「{meta['entryName']}」（/{meta['entryKey']}）")
    c.always(f"[{STAGE}] 试卷卡「{meta['short']}」{meta['desc']}")
    c.always(f"[{STAGE}] 题库 public/{category}-question-bank.json；站点源码改动 {len(changed)} 处")
    c.always(f"[完成] 发布上站 {'（dry-run，未写盘）' if args.dry_run else '✓'} | 总耗时 {c.human_ms(started_all) / 1000:.1f}s")
    if not args.dry_run:
        c.info("下一步：npm run dev 打开落地页确认卡片、进 /home 刷题、看代码块与 AI 解析")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n[中断] 已写的改动保留；拼接是幂等的，重跑不会插重复条目", file=sys.stderr)
        sys.exit(130)
