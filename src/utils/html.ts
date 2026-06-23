/**
 * HTML 工具函数
 *
 * 统一的 HTML 转义，消除 SearchOverlay.vue 和 renderMarkdown.ts 中的重复实现。
 */

/** 转义 HTML 特殊字符，防止 XSS */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
