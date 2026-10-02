"""S4「阅读题：文章补到同组每道小题」的离线验收（不联网、0 token）。

场景（实测自 综合日语3 期末 2024）：
  * 第 1 题带整段「花見」文章，同组的第 2/3/4 题只有问句 → 站点上第 2 题看不到文章；
  * 第 90 题整个题干就是「船旅」文章（空栏 [96]…[100] 在文章里），第 91–94 题各是一小段。

跑法：`python pdf-ocr/tests/test_reading_passages.py`
"""

import importlib.util
import sys
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))

import _common as c  # noqa: E402


def load(name):
    spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load("4_build_md")

PASSAGE = (
    "日本に来て初めての春、おもしろかったのは花見という習慣です。もちろん私の国でも、花を見て、"
    "みんなで楽しみますが、日本のように桜という特別な花のための特別な習慣はありません。\n"
    "でも、一番驚いたのは特別な習慣があることではなく、三月の終わりごろから、四月初めまで、"
    "天気予報やニュースでも花見について教えてくれることです。"
)


def entry(number, stem, group="题组一", title="(三) 花見", page=1):
    return {
        "page": page,
        "index": number,
        "numeral": "一",
        "q": {"number": number, "stem": stem, "options": [], "group": group, "groupTitle": title},
    }


def new_report():
    return {"reading_groups": [], "reading_articles_filled": []}


# ── 1) 文章 + 问句 → 拆得开；同组小题补上文章 ─────────────────────────────
carrier = entry(1, f"{PASSAGE}\n\nこの人はどうして花見が面白かったと思うのですか。")
q2 = entry(2, "一番驚いたことはなんですか。")
q3 = entry(3, "「ちょっとおかしいと思いました」のはなぜですか。")
stranger = entry(4, "○ ピアノコンクールで一等賞をじゅしょうした。", group="题组二", title="第八题 漢字読み")
entries = [carrier, q2, q3, stranger]
report = new_report()
build.attach_reading_passages(entries, report)
assert carrier["q"]["stem"].startswith("日本に来て"), carrier["q"]["stem"][:40]
assert q2["q"]["stem"].startswith("日本に来て"), q2["q"]["stem"][:40]
assert "一番驚いたことはなんですか。" in q2["q"]["stem"]
assert q3["q"]["stem"].startswith("日本に来て")
assert stranger["q"]["stem"] == "○ ピアノコンクールで一等賞をじゅしょうした。"  # 别的大题不动
assert [(p, n) for p, n in report["reading_articles_filled"]] == [(1, 2), (1, 3)]
assert report["reading_groups"] and report["reading_groups"][0][3] == 2, report["reading_groups"]
print("[1] 文章+问句：文章复制到同组小题，其它大题不动")

# ── 2) 整个题干就是文章（空栏在文章里）→ 整段当文章 ───────────────────────
LONG = "ある日、知人と喫茶店で話していた時、おもしろい話を聞きました。" * 20
article, question = build.split_article(LONG)
assert article and not question and article.startswith("ある日"), (article[:30], question)
# 太短的（<300 字）整段题干不当文章，免得把普通长题当文章复制给同组
short_article, short_question = build.split_article("ある日、知人と喫茶店で話していた時。" * 6)
assert not short_article and short_question
print("[2] 题干本身就是文章（空栏嵌在文章里）→ 整段当文章；太短的整段题干不误判")

# ── 3) 普通长问句不能被当成文章 ──────────────────────────────────────────
plain = "次の文の（ ）に入れる最もよいものを、A・B・C・Dから一つ選びなさい。" * 3
article, question = build.split_article(plain)
assert not article and question == plain, (article[:30], question[:30])
print("[3] 普通的长问句不误判成文章")

# ── 4) 同组已经带文章 → 不重复补；跨页同名大题（另一篇文章）→ 不补 ──────────
dup = entry(2, f"{PASSAGE}\n\nもう一度同じ問い。")
cache = entry(3, "別のページの問い。", group="题组一", title="読解・空欄補充", page=5)
carrier2 = entry(1, f"{PASSAGE}\n\n問い。", group="题组一", title="読解・空欄補充", page=1)
report = new_report()
build.attach_reading_passages([carrier2, dup, cache], report)
assert dup["q"]["stem"].count("日本に来て") == 1, dup["q"]["stem"][:60]
assert cache["q"]["stem"] == "別のページの問い。", cache["q"]["stem"][:40]
print("[4] 已经带文章的不重复补；跨页同名大题不补（可能不是同一篇）")

print("\n全部通过：阅读题文章补到同组小题 ✓")
