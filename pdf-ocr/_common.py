"""pdf-ocr 工作流通用工具：.env 解析、HTTP 调用、进度输出、JSON 读写、路径护栏。

约定见 docs/pdf-ocr-pipeline.md（§2.4 .env / §6 进度输出 / §12 安全）。
刻意不引入额外依赖：.env 由本文件自行解析（不需要 python-dotenv），HTTP 只用 requests。
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

# ── 位置 ────────────────────────────────────────────────────────────────
# <repo>/pdf-ocr/_common.py -> <repo>；<repo>/pdf-ocr -> 工具目录
TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parent
# 所有中间产物（页图、每页 JSON、manifest、report）都留在工具目录里，不污染 data/raw
WORK_ROOT = TOOL_ROOT / "work"
# 最终结果唯一落点：data/raw/<分类名>/<分类名>.md
RAW_ROOT = REPO_ROOT / "data" / "raw"
TEMP_ROOT = WORK_ROOT / ".tmp"
ENV_PATH = REPO_ROOT / ".env"

# ── 默认值（docs §2.4，已定稿） ──────────────────────────────────────────
DEFAULTS = {
    "STEPFUN_BASE_URL": "https://api.stepfun.com/step_plan/v1/chat/completions",
    "STEPFUN_MODEL": "step-3.7-flash",
    "DEEPSEEK_BASE_URL": "https://api.deepseek.com/v1/chat/completions",
    "DEEPSEEK_MODEL": "deepseek-flash",
}

# 阶段标签（docs §6）
STAGES = {1: "S1/4 渲染", 2: "S2/4 OCR", 3: "S3/4 比对提取", 4: "S4/4 汇总写盘"}

# ── 题型：合法值 + 从"卷面大题标题"读题型（S3 与 S4 共用，见 docs §34）────────
#
# questionType 的合法值 = `src/types/question.ts` 里的联合类型（`other` 不是合法值）。
QUIZ_TYPES = ("single", "multi", "judgement", "fill")

# 卷面大题标题（"二、多项选择题"）比模型逐题猜的题型可靠得多：实测 Principles-of-Marxism
# 第二大题写着「二、多项选择题」、每题 5 个选项，模型却逐题给了 `single`，站上就变单选。
# 顺序有意义 —— 先判"多项选择"，再判"单项选择"。
SECTION_TYPE_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("多项选择", "多选", "不定项"), "multi"),
    (("单项选择", "单选", "单向选择"), "single"),
    (("判断", "正误", "是非"), "judgement"),
    (("填空",), "fill"),
    (("论述", "简答", "问答", "名词解释", "案例", "辨析", "分析", "思考", "计算"), "fill"),
)


def squash_text(text) -> str:
    """判题型/归一分区用的压缩：去空白与常见标点、转小写、去掉全角括号。"""
    flat = str(text or "").strip().lower()
    return re.sub(r"[\s_\-/、，,。.：:；;（）()\[\]【】]+", "", flat)


def question_type_from_section(section: str) -> str:
    """从"题组名 / 大题标题"里读题型（读不出返回空串）。"""
    flat = squash_text(section)
    if not flat:
        return ""
    for keywords, quiz_type in SECTION_TYPE_RULES:
        if any(keyword in flat for keyword in keywords):
            return quiz_type
    return ""


# 模型给"这一页没有题干"的行写的占位文字（参考答案 / 评分标准页的每一行都长这样，
# 各次运行措辞不同）。这种题干**不是题干**：既不能判重（每行都一模一样，
# 实测 23 条答案会被判重删到只剩 1 条），也不能当成"题目"（详见 docs §34）。
ANSWER_ROW_STEM = re.compile(r"未印题干|无题干|仅有答案|只有答案|本题无题干")


def is_placeholder_stem(text) -> bool:
    """题干是不是"空的 / 只是模型写的占位"（= 这一行不是一道真题）。"""
    flat = "".join(str(text or "").split())
    return (not flat) or bool(ANSWER_ROW_STEM.search(flat))


# 单次响应 token 上限（docs §18.5 / §20.5）。**已按用户要求放开到各端点允许的最大值。**
#
# 实测（2026-09-22，见 docs §20.5）：
#   * DeepSeek：合法区间恰好 [1, 393216]，写 10000000 会被 HTTP 400 直接打回；
#   * StepFun：服务端不校验（连 2000000000 都照收），所以 10,000,000 只是我们自设的兜底。
#
# 放开上限**不会因为数字大而多花钱**：max_tokens 只是截止线，没生成的 token 不计费。
# 它唯一的影响是"模型真话痨/死循环时最多能产多少"——所以主闸门仍然是 --budget-tokens。
DEFAULT_MAX_TOKENS = {"ocr": 10_000_000, "merge": 393_216}
MAX_TOKENS_CEILING = {"ocr": 10_000_000, "merge": 393_216}


def check_max_tokens(stage_key: str, value: int) -> int:
    """把 --max-tokens 挡在端点校验之前。

    否则一旦设超，就会变成"每一页都报一次 HTTP 400"（DeepSeek 是 4xx，不重试但照样刷屏）。
    """
    ceiling = MAX_TOKENS_CEILING[stage_key]
    if value < 1:
        fail(f"--max-tokens 必须 ≥ 1（收到 {value}）", 1)
    if value > ceiling:
        why = (
            "DeepSeek 的合法区间是 [1, 393216]"
            if stage_key == "merge"
            else "StepFun 侧不校验，这里按 10,000,000 自设上限"
        )
        fail(
            f"--max-tokens {value} 超出本阶段上限 {ceiling}（{why}）；"
            f"用默认值 {DEFAULT_MAX_TOKENS[stage_key]} 即可，不需要设得更大",
            1,
        )
    return value


def is_timeout(message: str) -> bool:
    """这条报错是不是"服务端没回包"？requests 抛的是 ReadTimeout / ConnectTimeout。"""
    text = (message or "").lower()
    return "timeout" in text or "timed out" in text


def timeout_hint() -> str:
    """超时是偶发的服务端卡顿，重试通常就过 —— 明确写出来，免得看到 180s 就手动中断。"""
    return (
        "[提示] 这是服务端偶发卡住（本 PDF 正常单页 30~45s），不是参数/密钥问题；"
        "脚本会自动重试，重试一般 30s 内就返回，不用手动中断"
    )


_QUIET = False


# ── 控制台 ──────────────────────────────────────────────────────────────
def setup_stdio() -> None:
    """把 stdio 固定成 UTF-8。

    - stdout/stderr：对齐既有 scripts 的做法，避免 Windows 控制台乱码。
    - stdin：管道传入的中文（如交互确认的分类名）默认会按 ANSI 代码页解码成乱码，
      这里显式按 UTF-8 读取（真实控制台输入走 Windows 宽字符 API，不受影响）。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except Exception:
            try:
                if stream is sys.stdout:
                    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
                else:
                    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
            except Exception:
                pass
    try:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:
        pass


def set_quiet(quiet: bool) -> None:
    global _QUIET
    _QUIET = bool(quiet)


def info(message: str) -> None:
    if not _QUIET:
        print(message, flush=True)


def always(message: str) -> None:
    print(message, flush=True)


def warn(message: str) -> None:
    print(f"[警告] {message}", flush=True)


def fail(message: str, code: int = 1) -> "None":
    print(f"[错误] {message}", file=sys.stderr, flush=True)
    sys.exit(code)


# 进度行：`[S1/4 渲染] page  1/12 (1/12)  ✓ 412ms  page-001.png 1654×2339`
def progress(stage: str, index: int, total: int, status: str, ms: int, extra: str = "") -> None:
    line = f"[{stage}] page {index:>3}/{total} ({index}/{total})  {status} {ms}ms"
    if extra:
        line += f"  {extra}"
    always(line)


def retry_line(stage: str, index: int, total: int, attempt: int, retries: int, why: str, ms: int) -> None:
    always(
        f"[{stage}] page {index:>3}/{total} ({index}/{total})  ↻ 重试 {attempt}/{retries}（{why}）{ms}ms"
    )


def page_done(
    index: int,
    total: int,
    parts: list[str],
    total_questions: int | None = None,
    usage_note: str = "",
) -> None:
    line = f"== 第 {index}/{total} 页完成：" + " | ".join(parts)
    if total_questions is not None:
        line += f" | 累计题数 {total_questions}"
    if usage_note:
        line += f" | {usage_note}"
    always(line + " ==")


def stage_done(stage: str, count: int, total: int, elapsed_ms: int) -> None:
    always(f"[{stage}] 完成 ({count}/{total}) ✓ 总耗时 {elapsed_ms / 1000:.1f}s")


def human_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


# ── 用量与预算（docs §18.5）─────────────────────────────────────────────
def usage_tokens(usage) -> int:
    """从接口返回的 usage 里取总 token，兼容几种常见字段名。"""
    if not isinstance(usage, dict):
        return 0
    for key in ("total_tokens", "totalTokens", "total"):
        value = usage.get(key)
        if isinstance(value, (int, float)):
            return int(value)
    total = 0
    for key in ("prompt_tokens", "input_tokens", "completion_tokens", "output_tokens"):
        value = usage.get(key)
        if isinstance(value, (int, float)):
            total += int(value)
    return total


def usage_block(manifest: dict) -> dict:
    """manifest 里的累计用量块（跨运行累加，用于看历史与做跨运行预算）。"""
    usage = manifest.get("usage")
    if not isinstance(usage, dict):
        usage = {}
    usage.setdefault("calls", 0)
    usage.setdefault("tokens", 0)
    return usage


def add_usage(manifest: dict, *, calls: int = 0, tokens: int = 0) -> dict:
    usage = usage_block(manifest)
    usage["calls"] = int(usage.get("calls", 0)) + calls
    usage["tokens"] = int(usage.get("tokens", 0)) + tokens
    usage["updated_at"] = now_iso()
    manifest["usage"] = usage
    return usage


def human_tokens(count: int) -> str:
    return f"{count / 1000:.1f}k" if count >= 1000 else str(count)


def budget_stop(spent: int, budget: int) -> bool:
    """预算检查：每次调用**之前**判断；budget<=0 表示不限。"""
    return budget > 0 and spent >= budget


# ── .env ────────────────────────────────────────────────────────────────
def read_env_file(path: Path = ENV_PATH) -> dict[str, str]:
    """极简 .env 解析：KEY=VALUE、支持 # 注释、可选的单双引号包裹。

    用 utf-8-sig 读：用记事本另存为"UTF-8 带 BOM"时，BOM 会粘在第一个键名上，
    那样第一个键就永远匹配不上（`\\ufeffSTEPFUN_...`）。
    """
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().lstrip("\ufeff")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def env(name: str, default: str | None = None) -> str | None:
    """取值优先级：.env > 进程环境变量 > 默认值（docs §2.4）。"""
    dotenv = read_env_file()
    if name in dotenv and dotenv[name] != "":
        return dotenv[name]
    value = os.environ.get(name)
    if value:
        return value
    return DEFAULTS.get(name, default)


def ocr_config() -> dict[str, str | None]:
    return {
        "base_url": env("STEPFUN_BASE_URL"),
        "model": env("STEPFUN_MODEL"),
        "api_key": env("STEPFUN_API_KEY"),
    }


def merge_config() -> dict[str, str | None]:
    """DeepSeek 配置；缺 DEEPSEEK_* 时回退到仓库既有的 ANTHROPIC_* 入口。"""
    base_url = env("DEEPSEEK_BASE_URL")
    model = env("DEEPSEEK_MODEL")
    api_key = env("DEEPSEEK_API_KEY")
    if not api_key:
        api_key = env("ANTHROPIC_AUTH_TOKEN")
        base_url = env("DEEPSEEK_BASE_URL") or env("ANTHROPIC_BASE_URL") or base_url
    return {"base_url": base_url, "model": model, "api_key": api_key}


# ── HTTP ────────────────────────────────────────────────────────────────
class ApiError(Exception):
    """接口调用失败。retryable=False 表示 4xx 这类重试也没用的情况。"""

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


def post_json(url: str, payload: dict, api_key: str | None, *, timeout: int = 120) -> dict:
    """单次 POST JSON。成功返回解析后的 JSON；失败抛 ApiError（由调用方决定重试还是记错）。"""
    import requests  # 局部导入：只有真正调 API 的步骤才需要

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=timeout)
    except Exception as exc:  # 网络/超时
        raise ApiError(f"{type(exc).__name__}: {exc}", retryable=True) from exc

    if response.status_code == 200:
        try:
            return response.json()
        except Exception as exc:
            raise ApiError(f"响应不是合法 JSON：{exc}", retryable=True) from exc
    if response.status_code == 429 or response.status_code >= 500:
        raise ApiError(f"HTTP {response.status_code}", retryable=True)
    # **内容审核拦截**（HTTP 451 / censorship_blocked）：按用户要求**重试两次**
    # （--max-retries 默认 3 次尝试 = 2 次重试，间隔按指数退避）。实测同一页重试常常能过
    # （审核带随机性）；一直不过就如实记错 —— 那一页交给人工补，绝不让整卷静默丢答案。
    if response.status_code == 451 or "censorship_blocked" in (response.text or ""):
        raise ApiError(
            f"HTTP {response.status_code}（内容审核拦截，将重试）：{(response.text or '')[:160]}",
            retryable=True,
        )
    raise ApiError(f"HTTP {response.status_code}：{response.text[:200]}", retryable=False)


def call_with_retry(
    url: str,
    payload: dict,
    api_key: str | None,
    *,
    timeout: int = 120,
    max_retries: int = 3,
    on_retry=None,
) -> dict:
    """带指数退避的调用；耗尽后抛 ApiError。

    on_retry(attempt, retries, why, elapsed_ms) 由调用方决定怎么打印进度。
    """
    last: ApiError | None = None
    for attempt in range(1, max_retries + 1):
        started = time.perf_counter()
        try:
            return post_json(url, payload, api_key, timeout=timeout)
        except ApiError as exc:
            last = exc
            if not exc.retryable:
                raise
            if attempt < max_retries:
                if on_retry:
                    on_retry(attempt, max_retries, str(exc), human_ms(started))
                time.sleep(min(2**attempt, 10))
    raise last or ApiError("未知错误")


def image_data_url(png: Path) -> str:
    """把页图编码成 OpenAI 兼容接口用的 data URL。"""
    import base64

    return "data:image/png;base64," + base64.b64encode(png.read_bytes()).decode("ascii")


def preview(text, limit: int = 200) -> str:
    """把任意响应文本压成一行短预览，用于失败时打日志（ASCII 安全）。"""
    if not isinstance(text, str):
        text = json.dumps(text, ensure_ascii=False) if text is not None else ""
    flat = " ".join(text.split())
    return flat[:limit] + ("…" if len(flat) > limit else "")


def response_text(response) -> str:
    """从 OpenAI 兼容响应里取正文（不关心取自哪个字段）。"""
    return response_text_ex(response)[0]


def response_text_ex(response) -> tuple[str, str]:
    """→ (正文, 取到的字段名)。

    推理模型（本项目连的 DeepSeek 只提供推理模型）正文在 content、思维链在 reasoning_content。
    只有 content 为空时才退到 reasoning_content：那时拿到的是思维链散文，JSON 解析多半失败，
    调用方应配合 reasoning_hint() 把真实原因写进报错，避免又变成"回复里找不到 JSON 对象"。
    """
    if not isinstance(response, dict):
        return "", ""
    choices = response.get("choices") or []
    if not choices:
        return "", ""
    message = choices[0].get("message") or {}
    for key in ("content", "reasoning_content", "reasoning", "text"):
        value = message.get(key) if key != "text" else choices[0].get("text")
        if isinstance(value, str) and value.strip():
            return value, key
        if isinstance(value, list):  # 分段返回
            joined = "".join(p.get("text", "") for p in value if isinstance(p, dict))
            if joined.strip():
                return joined, key
    return "", ""


def reasoning_hint(field: str, finish_reason: str, max_tokens: int = 0, stage_key: str = "") -> str:
    """正文缺失/只拿到思维链时，给一句照着做就能好的补救说明（拼在报错后面）。

    默认值已放到端点上限，所以"调大 --max-tokens"这条建议只在还没到顶时成立；
    已经顶到上限还截断，就说明是模型侧的生成长度限制，重跑没有意义。
    """
    ceiling = MAX_TOKENS_CEILING.get(stage_key, 0)
    if max_tokens and ceiling and max_tokens >= ceiling:
        advice = (
            f"当前 --max-tokens {max_tokens} 已经是该端点允许的上限，"
            f"加大没用 —— 这是模型侧的生成长度限制，只能拆页/拆请求或换模型"
        )
    elif max_tokens:
        advice = f"请调大 --max-tokens 重跑（当前 {max_tokens}）"
    else:
        advice = "请调大 --max-tokens 重跑"
    if field and field != "content":
        if finish_reason == "length":
            return (
                f"；正文为空、只取到 {field}，且 finish_reason=length ——"
                f"该模型是推理模型，max_tokens 被思维链吃光：{advice}"
            )
        return f"；正文为空、只取到 {field}（思维链，不含最终 JSON）：{advice}"
    if finish_reason == "length":
        return f"；finish_reason=length，回复被 max_tokens 截断：{advice}"
    return ""


def response_finish_reason(response) -> str:
    if not isinstance(response, dict):
        return ""
    choices = response.get("choices") or []
    if not choices:
        return ""
    return str(choices[0].get("finish_reason") or "")


def _escape_control_in_strings(text: str) -> str:
    """把 JSON 字符串内部的裸换行/制表符/控制字符转义 —— 长转写文本最常见的翻车点。"""
    out: list[str] = []
    in_string = False
    escaped = False
    for ch in text:
        if in_string:
            if escaped:
                out.append(ch)
                escaped = False
                continue
            if ch == "\\":
                out.append(ch)
                escaped = True
                continue
            if ch == '"':
                out.append(ch)
                in_string = False
                continue
            if ch == "\n":
                out.append("\\n")
                continue
            if ch == "\r":
                out.append("\\r")
                continue
            if ch == "\t":
                out.append("\\t")
                continue
            if ord(ch) < 0x20:
                out.append(f"\\u{ord(ch):04x}")
                continue
            out.append(ch)
            continue
        if ch == '"':
            in_string = True
        out.append(ch)
    return "".join(out)


def _close_truncated(text: str) -> str:
    """尽力把被 max_tokens 截断的 JSON 补成可解析（末尾补引号 + 补齐括号）。"""
    stack: list[str] = []
    in_string = False
    escaped = False
    for ch in text:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]" and stack:
            stack.pop()

    repaired = text.rstrip()
    if in_string:
        repaired += '"'
    repaired = re.sub(r",\s*$", "", repaired)
    for opener in reversed(stack):
        repaired += "}" if opener == "{" else "]"
    return repaired


def _repair_truncated(candidate: str, tries: int = 12) -> dict | None:
    """截断修复：先按原样补引号/括号，不行就逐步回退到上一个分隔符再试。

    覆盖两种常见截断位置：
      1) 切在字符串中间（能保住半截文本，优先）
      2) 切在冒号/逗号之后（此时把不完整的那个键值丢掉）
    """
    body = _escape_control_in_strings(candidate)
    for _ in range(tries):
        closed = _close_truncated(body)
        try:
            parsed = json.loads(re.sub(r",\s*([}\]])", r"\1", closed))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        cut = max(body.rfind(","), body.rfind("{"), body.rfind("["))
        if cut <= 0:
            return None
        body = body[:cut]
    return None


def extract_json(text: str) -> tuple[dict, dict]:
    """从模型回复里取出 JSON 对象，返回 (对象, 修复信息)。

    依次尝试：原样 → 转义字符串内裸换行 → 去掉尾随逗号 → 截断逐步回退修复。
    修复信息形如 {"repaired": bool, "truncated": bool}，供调用方记进产物以便复核。
    """
    if not isinstance(text, str):
        text = str(text)
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3]
        cleaned = cleaned.strip()

    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0:
        raise ApiError(f"回复里找不到 JSON 对象（原文预览：{preview(cleaned) or '空'}）", retryable=True)
    candidate = cleaned[start : end + 1] if end > start else cleaned[start:]

    attempts = [
        (candidate, {"repaired": False, "truncated": False}),
        (_escape_control_in_strings(candidate), {"repaired": True, "truncated": False}),
    ]
    for body, meta in attempts:
        try:
            parsed = json.loads(re.sub(r",\s*([}\]])", r"\1", body))
        except Exception:
            continue
        if isinstance(parsed, dict):
            return parsed, meta

    parsed = _repair_truncated(candidate)
    if parsed is not None:
        return parsed, {"repaired": True, "truncated": True}

    raise ApiError(
        f"JSON 解析失败（原文预览：{preview(cleaned)}）", retryable=True
    )


def extract_json_object(text: str) -> dict:
    """兼容旧调用：只用对象，不要修复信息。"""
    return extract_json(text)[0]


# ── 文件 ────────────────────────────────────────────────────────────────
def sha256_of_file(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, data) -> None:
    """先写临时文件再原子改名，避免半截文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def write_text_no_overwrite(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:  # 'x' = 已存在就报错
        handle.write(text)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


# ── 路径护栏（docs §12） ────────────────────────────────────────────────
_ILLEGAL = '\\/:*?"<>|'


def safe_name(name: str) -> str:
    # 去掉可能的孤立代理字符（管道编码不对时会产生），否则后续无法编码成路径
    cleaned = "".join(ch for ch in name if not (0xDC80 <= ord(ch) <= 0xDCFF))
    cleaned = "".join("_" if ch in _ILLEGAL else ch for ch in cleaned).strip().strip(".")
    return cleaned or "unnamed"


def ensure_under(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    root_resolved = root.resolve()
    if root_resolved != resolved and root_resolved not in resolved.parents:
        fail(f"拒绝写入 {resolved}：不在允许的目录 {root_resolved} 之下")
    return resolved


def format_pages(pages: list[int]) -> str:
    """[1,2,3,7,9,10] -> "1-3,7,9-10"（用于日志里紧凑显示）。"""
    if not pages:
        return "（空）"
    parts: list[str] = []
    start = prev = pages[0]
    for number in pages[1:]:
        if number == prev + 1:
            prev = number
            continue
        parts.append(str(start) if start == prev else f"{start}-{prev}")
        start = prev = number
    parts.append(str(start) if start == prev else f"{start}-{prev}")
    return ",".join(parts)


def parse_pages(spec: str | None, page_count: int) -> list[int]:
    """把 `--pages` 解析成 1 基页码列表（去重升序）。

    接受 `1-3,7`、`3`、`0-3` 三种写法。**页码从 1 开始**：写 0 时按"从头开始"处理
    （0 会被归一化成第 1 页，并打印一行提示），因为 0 号页并不存在。
    """
    if not spec:
        return list(range(1, page_count + 1))

    picked: set[int] = set()
    saw_zero = False
    try:
        for chunk in spec.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            if "-" in chunk:
                start_text, _, end_text = chunk.partition("-")
                start, end = int(start_text), int(end_text)
                if start > end:
                    start, end = end, start
                if start <= 0:
                    saw_zero = True
                picked.update(range(start, end + 1))
            else:
                number = int(chunk)
                if number <= 0:
                    saw_zero = True
                picked.add(number)
    except ValueError:
        fail(f"--pages 只接受形如 1-3,7 的写法；收到：{spec}", 1)

    if 0 in picked:
        # 页码从 1 开始：0 按"起点"处理成第 1 页（--pages 0 与 --pages 0-3 都适用）
        picked.discard(0)
        picked.add(1)

    result = sorted(n for n in picked if 1 <= n <= page_count)
    if saw_zero:
        info(f"[提示] --pages {spec}：页码从 1 开始，0 按起点处理 → 实际处理 {format_pages(result)} 页")
    if not result:
        fail(
            f"--pages {spec} 没有落在 1..{page_count} 范围内的页"
            f"（页码从 1 开始，例如想跑前 3 页请写 --pages 1-3）",
            1,
        )
    return result
