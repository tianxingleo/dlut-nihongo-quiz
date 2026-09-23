"""S2 双路 OCR 并行/串行的离线验收（不联网、0 token、不碰真 data/raw）。

跑法：`python pdf-ocr/tests/test_p2_parallel.py`

做法：把 `ocr_one_pass` 换成一个"睡 0.4 秒 + 记录并发数"的假函数，
然后跑完整的 `2_ocr.py` 主流程，断言：
  * 默认**两路并行**（观测到的最大并发 = 2），墙钟时间 ≈ 单次耗时而不是两倍；
  * `--sequential` 时最大并发 = 1，墙钟时间 ≈ 两倍；
  * 两路的 `review.json` 都正确落盘；
  * 每页的完成行顺序**固定**（OCR-A 在 OCR-B 前，不会因为并行而打乱）。
"""

import importlib.util
import io
import json
import shutil
import sys
import threading
import time
from contextlib import redirect_stdout
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))

import _common as c  # noqa: E402

SANDBOX = TOOL / "work" / ".tmp" / "p2"
CATEGORY = "_p2parallel"
PAGES = [1, 2]
SLEEP = 0.4


def load(name):
    spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def prepare() -> None:
    if SANDBOX.exists():
        shutil.rmtree(SANDBOX)
    work = SANDBOX / "work" / CATEGORY
    pages_dir = work / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    (work / "source-manifest.json").write_text(
        json.dumps(
            {
                "category": CATEGORY,
                "documents": [
                    {
                        "source": "fixture.pdf",
                        "sha256": "a" * 64,
                        "pages": len(PAGES),
                        "rendered_pages": PAGES,
                    }
                ],
                "errors": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    for number in PAGES:
        (pages_dir / f"page-{number:03d}.png").write_bytes(b"\x89PNG\r\n\x1a\n")


def instrument(ocr2):
    """把 ocr_one_pass 换成"睡一会儿 + 记录并发"的假函数。"""
    lock = threading.Lock()
    state = {"current": 0, "max": 0, "calls": []}

    def fake(cfg, png, number, pass_key, index, total, timeout, max_retries, max_tokens):
        with lock:
            state["current"] += 1
            state["max"] = max(state["max"], state["current"])
            state["calls"].append((number, pass_key))
        time.sleep(SLEEP)
        with lock:
            state["current"] -= 1
        return {
            "page": number,
            "printed_page_labels": [],
            "paper_identity": {"title": "fixture"},
            "question_ranges": [],
            "page_condition": "clear",
            "transcription_md": "x",
            "corrections": [],
            "uncertain": [],
            "call": {
                "pass": pass_key,
                "model": "fake",
                "elapsed_ms": int(SLEEP * 1000),
                "usage": {"total_tokens": 10},
            },
        }

    ocr2.ocr_one_pass = fake
    return state


def run(ocr2, extra):
    sys.argv = ["2_ocr.py", "--category", CATEGORY, "--force", *extra]
    buffer = io.StringIO()
    started = time.perf_counter()
    with redirect_stdout(buffer):
        code = ocr2.main()
    return code, time.perf_counter() - started, buffer.getvalue()


# ── 并行（默认）────────────────────────────────────────────────────────
prepare()
ocr2 = load("2_ocr")
c.WORK_ROOT = SANDBOX / "work"
c.RAW_ROOT = SANDBOX / "raw"
c.TEMP_ROOT = SANDBOX / "tmp"
c.ocr_config = lambda: {"model": "fake", "base_url": "https://x", "api_key": "k"}

state = instrument(ocr2)
code, parallel_elapsed, out = run(ocr2, [])
assert code == 0, (code, out)
pages_dir = SANDBOX / "work" / CATEGORY / "pages"
for number in PAGES:
    for key in ("a", "b"):
        assert (pages_dir / f"page-{number:03d}.{key}.review.json").exists(), (number, key)
assert state["max"] == 2, f"默认应当两路并行，实际最大并发 {state['max']}"
assert len(state["calls"]) == len(PAGES) * 2, state["calls"]
# 并行墙钟 ≈ 单次耗时（两页各 0.4s），串行会是 1.6s
assert parallel_elapsed < len(PAGES) * SLEEP * 1.6, f"并行太慢：{parallel_elapsed:.2f}s"
# 完成行顺序固定：每页都是 OCR-A 在前
for line in out.splitlines():
    if "页完成" in line:
        assert line.index("OCR-A") < line.index("OCR-B"), line
print(f"[1] 默认并行：最大并发 {state['max']}，{len(PAGES)} 页 × 2 路耗时 {parallel_elapsed:.2f}s（串行约 {len(PAGES) * 2 * SLEEP:.2f}s）")
print("[2] 两路产物齐全，且完成行顺序固定（OCR-A 在 OCR-B 前）")

# ── 串行（--sequential）────────────────────────────────────────────────
prepare()
state2 = instrument(ocr2)
code2, seq_elapsed, out2 = run(ocr2, ["--sequential"])
assert code2 == 0, (code2, out2)
assert state2["max"] == 1, f"--sequential 时最大并发应当是 1，实际 {state2['max']}"
assert seq_elapsed > parallel_elapsed, f"串行({seq_elapsed:.2f}s) 应该比并行({parallel_elapsed:.2f}s) 慢"
print(f"[3] --sequential：最大并发 {state2['max']}，耗时 {seq_elapsed:.2f}s（并行 {parallel_elapsed:.2f}s）")

# ── 预算护栏：整页开跑前就判，所以最多多花"一页" ────────────────────────
prepare()
state3 = instrument(ocr2)
code3, _, out3 = run(ocr2, ["--budget-tokens", "5"])
assert code3 == 4, (code3, out3)
assert sorted(state3["calls"]) == [(1, "a"), (1, "b")], state3["calls"]
assert (pages_dir / "page-001.a.review.json").exists(), "第一页应当整页跑完并落盘"
assert not (pages_dir / "page-002.a.review.json").exists(), "第二页应当在开跑前就停下"
assert "预算已用尽" in out3, out3
print("[4] 预算护栏：上限小于单次消耗 → 第一页跑完后停在第二页之前，退出码 4")

shutil.rmtree(SANDBOX)
print("\n全部通过：4 组断言 / 沙箱已清理")
