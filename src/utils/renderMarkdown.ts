import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { CACHE } from '../constants'

const markdownRenderer = new Marked()

// Strip inline markdown for plain-text contexts (search, truncation)
export function stripMarkdown(md: string): string {
  return md
    .replace(/\*\*([^*]+?)\*\*/g, '$1')
    .replace(/\*([^*]+?)\*/g, '$1')
    .replace(/`([^`]+?)`/g, '$1')
    .replace(/\[([^\]]+?)\]\([^)]+?\)/g, '$1')
    .replace(/\n/g, ' ')
}

// LRU-like cache with size limit to prevent unbounded memory growth
const mdCache = new Map<string, string>()

// Sanitize every HTML string before passing it to Vue's v-html.
// Keep MathML/SVG so marked-katex output continues to render correctly.
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
  })
}

// Render markdown to safe (sanitized) HTML
export function renderMarkdown(md: string): string {
  const cached = mdCache.get(md)
  if (cached) {
    // 命中时移到末尾，使其成为真正的 LRU（最近最少使用）
    mdCache.delete(md)
    mdCache.set(md, cached)
    return cached
  }
  const rawHtml = markdownRenderer.parse(md.trim(), { async: false }) as string
  // 清理 marked 产生的空 <p> 标签（题干尾部换行等场景）
  const cleaned = rawHtml.replace(/<p>\s*<\/p>/g, '').trim()
  const result = sanitizeHtml(cleaned)
  // 超出上限时淘汰最旧（Map 迭代顺序即插入顺序，首条即最久未访问）
  if (mdCache.size >= CACHE.MAX_RENDER_CACHE) {
    const firstKey = mdCache.keys().next().value
    if (firstKey !== undefined) mdCache.delete(firstKey)
  }
  mdCache.set(md, result)
  return result
}
