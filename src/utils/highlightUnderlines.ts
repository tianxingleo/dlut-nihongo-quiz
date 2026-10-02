/**
 * 题干里的「下划线标记」→ 上色显示。
 *
 * 两个来源：
 *   1. `<u>…</u>`：OCR 标出来的**卷面上真正被划住的文字**（S2 提示词的硬要求），
 *      只应该出现在正题题干里 —— 那是阅读/词汇题真正考的那几个词；
 *   2. `____` / `＿＿`：模型把"空白横线"转写成的下划线串（填空/排序题里很常见）。
 *
 * 只在**题干**上用（选项、解析保持原样），所以这里既不改 markdown 渲染器、
 * 也不引入新的数据字段 —— 拿到已经渲染并消毒过的 HTML，把这两类标记包一层 span 即可。
 */

/** 只在标签之外做替换，避免动到 HTML 结构（`<a href="__">` 这种不能碰）。 */
function mapTextNodes(html: string, transform: (text: string) => string): string {
  return html
    .split(/(<[^>]*>)/g)
    .map((chunk) => (chunk.startsWith('<') && chunk.endsWith('>') ? chunk : transform(chunk)))
    .join('')
}

/** `<u>文字</u>` → 上色（OCR 标的真实下划线）。 */
function markUnderlineTags(text: string): string {
  return text.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<u>$1</u>')
}

/** `____` / `＿＿`（≥2 个）→ 标记成"空栏"。 */
function markBlankRuns(text: string): string {
  return text.replace(/_{2,}|＿{2,}/g, (run) => `<span class="u-blank">${run}</span>`)
}

/**
 * 给题干 HTML 里的下划线/空栏加上可见标记。
 *
 * 输入必须是**已消毒**的 HTML（`sanitizeHtml` 的产物）；本函数只做包裹，不注入任何新内容。
 */
export function highlightUnderlines(html: string): string {
  // `<u>` 在 marked + DOMPurify 之后仍是真标签；`____` 是纯文本
  const withTags = html.replace(/<u>([\s\S]*?)<\/u>/g, '<u class="u-mark">$1</u>')
  return mapTextNodes(withTags, (text) => markBlankRuns(markUnderlineTags(text)))
}

/** 题干里有没有下划线标记（用来决定要不要显示一行提示）。 */
export function hasUnderlineMark(text: string): boolean {
  return /<u>[\s\S]*?<\/u>|_{2,}|＿{2,}/.test(text || '')
}
