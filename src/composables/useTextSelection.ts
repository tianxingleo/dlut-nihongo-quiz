/**
 * 文字选中 composable - 监听用户选中文字并提供浮动工具栏定位
 */
import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

export interface TextSelection {
  text: string
  /** 选中文字相对于视口的位置 */
  viewportRect: DOMRect
  /** 容器相对于视口的位置 */
  containerRect: DOMRect
  range: Range
  /** 选中文字所在的上下文（前后各 N 个字符） */
  contextBefore: string
  contextAfter: string
  /** 选中文字所在的父元素文本 */
  parentText: string
  /** 选中文字所在章节的标题（最近的 h1-h3 标题） */
  sectionTitle: string
}

/** 从选中文字中提取上下文 */
function extractContext(
  range: Range,
  maxChars: number = 200,
): {
  contextBefore: string
  contextAfter: string
  parentText: string
  sectionTitle: string
} {
  const container = range.commonAncestorContainer
  const parentElement =
    container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as HTMLElement)

  if (!parentElement) {
    return { contextBefore: '', contextAfter: '', parentText: '', sectionTitle: '' }
  }

  const selectedText = range.toString()

  // 找到选中文字在父文本中的位置
  const tempRange = document.createRange()
  tempRange.selectNodeContents(parentElement)
  const fullRangeText = tempRange.toString()
  const selectionStart = fullRangeText.indexOf(selectedText)

  let contextBefore = ''
  let contextAfter = ''

  if (selectionStart !== -1) {
    contextBefore = fullRangeText.slice(Math.max(0, selectionStart - maxChars), selectionStart)
    contextAfter = fullRangeText.slice(
      selectionStart + selectedText.length,
      selectionStart + selectedText.length + maxChars,
    )
  }

  // 查找最近的章节标题（h1-h3）
  let sectionTitle = ''
  let current: HTMLElement | null = parentElement
  while (current) {
    const heading = current.querySelector('h1, h2, h3')
    if (heading) {
      sectionTitle = heading.textContent?.trim() || ''
      break
    }
    // 向前查找兄弟节点中的标题
    let prev = current.previousElementSibling
    while (prev) {
      if (prev.matches('h1, h2, h3')) {
        sectionTitle = prev.textContent?.trim() || ''
        break
      }
      // 也检查子节点中的标题
      const prevHeading = prev.querySelector('h1, h2, h3')
      if (prevHeading) {
        sectionTitle = prevHeading.textContent?.trim() || ''
        break
      }
      prev = prev.previousElementSibling
    }
    if (sectionTitle) break
    current = current.parentElement
  }

  return { contextBefore, contextAfter, parentText: fullRangeText.slice(0, 500), sectionTitle }
}

export function useTextSelection(containerRef: Ref<HTMLElement | null>) {
  const selection = ref<TextSelection | null>(null)
  const isVisible = ref(false)

  function handleMouseUp(e: MouseEvent) {
    const target = e.target as HTMLElement
    // 忽略来自工具栏的点击
    if (target.closest('.text-selection-toolbar')) {
      return
    }

    // 延迟检查，确保 selection 已更新
    setTimeout(() => {
      const sel = window.getSelection()

      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        return
      }

      const text = sel.toString().trim()
      if (!text || text.length < 2) {
        return
      }

      const range = sel.getRangeAt(0)

      // 检查选中是否在指定容器内
      if (containerRef.value && !containerRef.value.contains(range.commonAncestorContainer)) {
        return
      }

      const viewportRect = range.getBoundingClientRect()
      const containerRect = containerRef.value?.getBoundingClientRect() || new DOMRect(0, 0, 0, 0)
      const { contextBefore, contextAfter, parentText, sectionTitle } = extractContext(range)

      selection.value = {
        text,
        viewportRect,
        containerRect,
        range,
        contextBefore,
        contextAfter,
        parentText,
        sectionTitle,
      }
      isVisible.value = true
    }, 10)
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement
    // 如果点击在工具栏内，不做任何处理
    if (target.closest('.text-selection-toolbar')) {
      return
    }
    // 点击其他地方时隐藏工具栏
    isVisible.value = false
  }

  function handleKeyDown(e: KeyboardEvent) {
    // ESC 键隐藏工具栏
    if (e.key === 'Escape') {
      isVisible.value = false
    }
  }

  function clearSelection() {
    isVisible.value = false
    selection.value = null
    window.getSelection()?.removeAllRanges()
  }

  onMounted(() => {
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('mouseup', handleMouseUp)
    document.removeEventListener('click', handleClickOutside)
    document.removeEventListener('keydown', handleKeyDown)
  })

  return {
    selection,
    isVisible,
    clearSelection,
  }
}
