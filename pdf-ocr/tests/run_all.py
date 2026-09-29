"""跑完 `pdf-ocr/tests/` 下所有测试（离线、不联网、0 token）。

用法：
    python pdf-ocr/tests/run_all.py            # 全跑，失败时打印末尾几行
    python pdf-ocr/tests/run_all.py --quiet     # 只打印每行结果

退出码：0 全过；1 有失败。单个文件也可以直接 `python pdf-ocr/tests/test_xxx.py`。
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent


def main() -> int:
    quiet = "--quiet" in sys.argv[1:]
    files = sorted(TESTS_DIR.glob("test_*.py"))
    if not files:
        print("没有找到测试文件（test_*.py）", file=sys.stderr)
        return 1

    failed: list[str] = []
    started_all = time.perf_counter()
    for path in files:
        started = time.perf_counter()
        proc = subprocess.run(
            [sys.executable, str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        ms = (time.perf_counter() - started) * 1000
        status = "✓" if proc.returncode == 0 else "✗"
        lines = [line for line in (proc.stdout or "").splitlines() if line.strip()]
        summary = lines[-1].strip() if lines else ""
        print(f"[{status}] {path.name:<34} {ms:6.0f}ms  {summary}")
        if proc.returncode != 0:
            failed.append(path.name)
            if not quiet:
                tail = ((proc.stdout or "") + (proc.stderr or "")).splitlines()[-12:]
                print("    " + "\n    ".join(tail))

    passed = len(files) - len(failed)
    print(f"\n{passed}/{len(files)} 通过 | 总耗时 {time.perf_counter() - started_all:.1f}s")
    if failed:
        print("失败：" + "、".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
