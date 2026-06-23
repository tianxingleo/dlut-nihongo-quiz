import { marked } from 'marked'

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
const MAX_CACHE_SIZE = 500
const mdCache = new Map<string, string>()

// Render markdown to safe HTML
export function renderMarkdown(md: string): string {
  const cached = mdCache.get(md)
  if (cached) return cached
  const result = marked.parse(md, { async: false }) as string
  // Evict oldest entries when cache exceeds limit
  if (mdCache.size >= MAX_CACHE_SIZE) {
    const firstKey = mdCache.keys().next().value
    if (firstKey !== undefined) mdCache.delete(firstKey)
  }
  mdCache.set(md, result)
  return result
}
