"""S6 发布器的入口/位置逻辑离线验收（不联网、0 token、不碰真文件）。

跑法：`python pdf-ocr/tests/test_p6_publish.py`

覆盖：
  * 入口已存在 → 把试卷加进去（不新建）
  * 入口不存在 → 新建入口再挂试卷（`--entry` + `--entry-key`）
  * 中文入口名推不出 key 时必须报错退出（不猜）
  * 位置参数：`--position N` / `--before` / `--after` / `--last`
  * 幂等：同样的输入不产生改动
  * 一份试卷只能属于一个入口（会从别的入口摘掉）
  * 课程树自动分组：同名分组要复用（不能一份卷建一个同名分组）
"""

import importlib.util
import pathlib
import sys

TOOL = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))

spec = importlib.util.spec_from_file_location("pub6", TOOL / "6_publish.py")
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)

SAMPLE = """\
/** 文件头注释 */

import type { Category } from '../types/question'

export const ENTRIES: EntryMeta[] = [
  {
    key: 'computer-organization',
    name: '计算机组成（软国际）',
    icon: '组',
    papers: [
      'computer-2021-final',
      'computer-2024-final',
      'computer-c-exam',
    ],
  },
]

export function findEntry() {}
"""


def meta_for(entry_key: str, entry_name: str, **kw) -> dict:
    return {
        "short": '2026期中（软国）',
        "long": '2026期中（软国）',
        "entryKey": entry_key,
        "entryName": entry_name,
        "entryIcon": "组",
        "entryDesc": "",
        **kw,
    }


def papers_of(text: str, entry_key: str) -> list[str]:
    _, entries, _ = pub.parse_entries(text)
    for entry in entries:
        if entry["key"] == entry_key:
            return entry["papers"]
    return []


# ① 解析
_, entries, _ = pub.parse_entries(SAMPLE)
assert len(entries) == 1, entries
assert entries[0]["papers"] == ["computer-2021-final", "computer-2024-final", "computer-c-exam"]
# 渲染一次再解析，必须完全等价（幂等的根基）
_start = SAMPLE.index(pub.ENTRIES_MARKER) + len(pub.ENTRIES_MARKER)
_end = SAMPLE.index("\n]\n", _start)
_rebuilt = SAMPLE[:_start] + pub.render_entries(entries) + SAMPLE[_end:]
assert pub.parse_entries(_rebuilt)[1] == entries, pub.parse_entries(_rebuilt)[1]
print("[1] parse_entries / render_entries 往返一致")

# ② 入口已存在 → 直接加进去，不新建
text = SAMPLE
key, name, icon, desc, created = pub.resolve_entry(
    text, "computer-2026-midterm", {}, "计算机组成（软国际）", None
)
assert (key, name, created) == ("computer-organization", "计算机组成（软国际）", False), (key, name, created)
updated, detail = pub.patch_entries(text, "computer-2026-midterm", meta_for(key, name), {"mode": "last"})
assert papers_of(updated, key)[-1] == "computer-2026-midterm", papers_of(updated, key)
assert "插入到" in detail, detail
print("[2] 入口存在 → 追加试卷：", detail)

# ③ 入口不存在 → 新建（并挂上试卷）
key2, name2, _, _, created2 = pub.resolve_entry(text, "english-2026", {}, "英语四级", "english-cet4")
assert (key2, name2, created2) == ("english-cet4", "英语四级", True), (key2, name2, created2)
updated2, detail2 = pub.patch_entries(text, "english-2026", meta_for(key2, name2), {"mode": "last"})
assert "新建入口" in detail2 and "英语四级" in detail2, detail2
assert papers_of(updated2, "english-cet4") == ["english-2026"], papers_of(updated2, "english-cet4")
assert papers_of(updated2, "computer-organization") == [
    "computer-2021-final",
    "computer-2024-final",
    "computer-c-exam",
], papers_of(updated2, "computer-organization")
print("[3] 入口不存在 → 新建入口：", detail2)

# ④ 中文入口名推不出 key → 必须报错（不猜、不静默）
try:
    pub.resolve_entry(text, "english-2026", {}, "英语四级", None)
except SystemExit as exc:
    assert exc.code == 1, exc.code
else:  # pragma: no cover
    raise SystemExit("中文入口名没给 --entry-key 时应该报错")
print("[4] 中文入口名没给 --entry-key → 退出码 1")

# ⑤ 位置：第一张 / 某张之后 / 最后一张
first, _ = pub.patch_entries(text, "computer-2026-midterm", meta_for("computer-organization", "计算机组成（软国际）"), {"mode": "first"})
assert papers_of(first, "computer-organization")[0] == "computer-2026-midterm"
after, _ = pub.patch_entries(text, "computer-2026-midterm", meta_for("computer-organization", "计算机组成（软国际）"), {"mode": "after", "value": "computer-2024-final"})
assert papers_of(after, "computer-organization") == [
    "computer-2021-final",
    "computer-2024-final",
    "computer-2026-midterm",
    "computer-c-exam",
], papers_of(after, "computer-organization")
last, _ = pub.patch_entries(text, "computer-2026-midterm", meta_for("computer-organization", "计算机组成（软国际）"), {"mode": "last", "explicit": True})
assert papers_of(last, "computer-organization")[-1] == "computer-2026-midterm"
# 找不到锚点时退化成追加，不报错
nope, _ = pub.patch_entries(text, "computer-2026-midterm", meta_for("computer-organization", "计算机组成（软国际）"), {"mode": "before", "value": "不存在"})
assert papers_of(nope, "computer-organization")[-1] == "computer-2026-midterm"
print("[5] 位置：first / after / last / 锚点不存在 都正确")

# ⑥ 幂等：把同一份试卷再挂一次（已在最后一张）→ 不改动
same, detail_same = pub.patch_entries(last, "computer-2026-midterm", meta_for("computer-organization", "计算机组成（软国际）"), {"mode": "last"})
assert same == last, "同位置重挂不该产生改动"
assert "无改动" in detail_same, detail_same
print("[6] 幂等：同位置重挂 →", detail_same)

# ⑦ 一份试卷只能属于一个入口：挂到新入口时要从旧入口摘掉
moved, _ = pub.patch_entries(updated, "computer-2026-midterm", meta_for("english-cet4", "英语四级"), {"mode": "last"})
assert "computer-2026-midterm" not in papers_of(moved, "computer-organization"), papers_of(moved, "computer-organization")
assert papers_of(moved, "english-cet4") == ["computer-2026-midterm"]
print("[7] 跨入口移动：旧入口已摘掉")

# ⑧ 课程树分组：自动分组要**并进同名分组**，不能一份卷新建一个同名分组
TREE = """\
import type { TreeNode } from '../types/question'

export const COURSE_TREE: TreeNode[] = [
  {
    type: 'group',
    key: 'computer-organization',
    label: '计算机组成（软国际）',
    children: [
      {
        type: 'leaf',
        key: 'computer-2021-final',
        label: '2021期末',
        category: 'computer-2021-final',
      },
    ],
  },
  {
    type: 'group',
    key: 'marxism-group',
    label: '马克思主义原理',
    icon: '马',
    children: [
      {
        type: 'leaf',
        key: 'marxism-1',
        label: '马原试卷1',
        category: 'marxism-1',
      },
    ],
  },
]
"""
tree2, detail_t = pub.patch_course_tree(
    TREE, "marxism-7", meta_for("marxism-7", "马克思主义原理"), {"mode": "last"}
)
assert tree2.count("type: 'group'") == 2, tree2          # 没有新建第 3 个分组
assert "marxism-7-group" not in tree2, tree2
_seg = tree2[tree2.index("key: 'marxism-group'") :]
_seg = _seg[: _seg.index("\n    ],")]
assert "marxism-7" in _seg, tree2                        # 新叶子挂在同一个组里
assert "marxism-1" in _seg, tree2
# 组名确实是新的才新建分组
tree3, _ = pub.patch_course_tree(
    tree2, "jp-2026", meta_for("jp-2026", "日语二级"), {"mode": "last"}
)
assert tree3.count("type: 'group'") == 3, tree3
assert "label: '日语二级'" in tree3, tree3
# 幂等：同一位再挂一次 → 不改动
same_tree, detail_same_tree = pub.patch_course_tree(
    tree3, "marxism-7", meta_for("marxism-7", "马克思主义原理"), {"mode": "last"}
)
assert same_tree == tree3 and "已存在" in detail_same_tree, detail_same_tree

# 名字变了（文件名带过 `(1)` 下载后缀）→ 只刷新 label，位置/类别不动
stale = tree2.replace("label: '马原试卷1',", "label: '马原试卷1(1)',")
assert "马原试卷1(1)" in stale, stale
renamed, detail_renamed = pub.patch_course_tree(
    stale,
    "marxism-1",
    meta_for("marxism-1", "马克思主义原理", short="马原试卷1", long="马原试卷1"),
    {"mode": "last"},
)
assert "label: '马原试卷1'," in renamed, renamed
assert "马原试卷1(1)" not in renamed, renamed
assert "标题刷新" in detail_renamed, detail_renamed
# 标题一致时依然是"无改动"
same_again, detail_again = pub.patch_course_tree(
    renamed,
    "marxism-1",
    meta_for("marxism-1", "马克思主义原理", short="马原试卷1", long="马原试卷1"),
    {"mode": "last"},
)
assert same_again == renamed and "位置不变" in detail_again, detail_again
print("[8] 课程树：同名分组复用（不重复建组）：", detail_t)

# ⑨ 下架：摘卷 / 摘入口 / 删叶子（分组空了连分组一起删）+ 其余注册点
# 9a) 摘一套卷，入口留着
removed1, _ = pub.remove_entries(SAMPLE, "computer-c-exam", None)
assert papers_of(removed1, "computer-organization") == [
    "computer-2021-final",
    "computer-2024-final",
], papers_of(removed1, "computer-organization")
# 9b) 摘到一张不剩 → 整个入口块删掉（不能留个空入口卡在首页）
removed2, _ = pub.remove_entries(removed1, "computer-2021-final", None)
removed3, _ = pub.remove_entries(removed2, "computer-2024-final", None)
assert pub.parse_entries(removed3)[1] == [], pub.parse_entries(removed3)[1]
assert "computer-organization" not in removed3, removed3
# 9c) 按入口 key 整个下架
removed4, detail_r4 = pub.remove_entries(SAMPLE, None, "computer-organization")
assert pub.parse_entries(removed4)[1] == [], pub.parse_entries(removed4)[1]
assert detail_r4 == "摘掉 3 套卷、删掉 1 个空入口", detail_r4
# 9d) 课程树：叶子删掉；分组空了连分组一起删；还有别的叶子时只删叶子
t_one, detail_t1 = pub.remove_course_tree_leaf(TREE, "marxism-1")
assert "marxism-1" not in t_one and "marxism-group" not in t_one, t_one
assert "computer-organization" in t_one, t_one
assert "连分组一起删" in detail_t1, detail_t1
t_keep, detail_t2 = pub.remove_course_tree_leaf(tree2, "marxism-7")
assert "marxism-group" in t_keep and "'marxism-7'" not in t_keep, t_keep
assert "连分组一起删" not in detail_t2, detail_t2
# 9e) 其余 4 处注册点
CAT = """\
export const CATEGORIES: CategoryMeta[] = [
  {
    key: 'marxism-1',
    short: '马原试卷1',
  },
  {
    key: 'marxism-4',
    short: '马原试卷4',
  },
]
"""
cat_after, _ = pub.remove_categories_block(CAT, "marxism-4")
assert "marxism-4" not in cat_after and "marxism-1" in cat_after, cat_after
assert pub.remove_category_union("  | 'marxism-1'\n  | 'marxism-4'\n", "marxism-4")[0] == "  | 'marxism-1'\n"
assert pub.remove_test_key("      'marxism-1',\n      'marxism-4',\n", "marxism-4")[0] == "      'marxism-1',\n"
meta_after, _ = pub.remove_meta_key("  ...['marxism-1', 'marxism-4'].map(\n", "marxism-4")
assert "marxism-4" not in meta_after and "marxism-1" in meta_after, meta_after
audit_after, _ = pub.remove_audit_bank(
    "const BANKS = [\n  'marxism-1-question-bank.json',\n  'marxism-4-question-bank.json',\n]\n",
    "marxism-4",
)
assert audit_after.count("question-bank") == 1, audit_after
print("[9] 下架：摘卷/摘入口/删叶子（空分组连带删）+ 其它 4 处注册点都摘得掉")

print("\n全部通过：9 组断言")
