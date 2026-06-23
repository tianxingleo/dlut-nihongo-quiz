/**
 * 日语假名注音工具模块
 * 使用 kuroshiro-browser 实现自动为日语汉字添加平假名注音
 * kuroshiro-browser 使用 Brotli 压缩字典，不会被 IDM 等下载管理器拦截
 */

import { Kuroshiro } from 'kuroshiro-browser'

let kuroshiro: Kuroshiro | null = null
let initPromise: Promise<void> | null = null
let isInitializing = false

/**
 * 初始化 kuroshiro（仅执行一次）
 * 使用 Brotli 压缩字典，首次加载需要一些时间
 */
export async function initFurigana(): Promise<void> {
  // 已经初始化完成
  if (kuroshiro) return

  // 正在初始化中，等待完成
  if (initPromise) return initPromise

  // 开始初始化
  isInitializing = true
  initPromise = (async () => {
    try {
      // IS_PROD = true 表示从 public/dict/ 加载字典
      kuroshiro = await Kuroshiro.buildAndInitWithKuromoji(true)
    } catch (error) {
      console.error('Failed to initialize furigana:', error)
      kuroshiro = null
      initPromise = null
      throw error
    } finally {
      isInitializing = false
    }
  })()

  return initPromise
}

/**
 * 过滤掉无效的 ruby 标签
 * 当注音和原文相同时（如中文简体字没有日语读音），移除 ruby 标签只保留原文
 */
function filterInvalidRuby(html: string): string {
  // 匹配 <ruby>原文<rp>...</rp><rt>注音</rt><rp>...</rp></ruby>
  // 如果注音和原文相同，则只保留原文
  return html.replace(
    /<ruby>([^<]+)<rp>[^<]*<\/rp><rt>([^<]+)<\/rt><rp>[^<]*<\/rp><\/ruby>/g,
    (match, original, reading) => {
      // 如果注音和原文相同，说明没有有效的日语读音
      if (original === reading) {
        return original
      }
      return match
    },
  )
}

/**
 * 为 HTML 中的日语汉字添加假名注音
 * @param html 原始 HTML 字符串
 * @returns 添加注音后的 HTML 字符串
 */
export async function addFurigana(html: string): Promise<string> {
  if (!kuroshiro) {
    await initFurigana()
  }

  if (!kuroshiro) {
    console.warn('Kuroshiro not initialized, returning original HTML')
    return html
  }

  try {
    const converted = await kuroshiro.convert(html, {
      mode: 'furigana',
      to: 'hiragana',
    })
    // 过滤掉无效的 ruby 标签（中文汉字没有日语读音的情况）
    return filterInvalidRuby(converted)
  } catch (error) {
    console.error('Failed to add furigana:', error)
    return html
  }
}

/**
 * 检查是否正在初始化
 */
export function isFuriganaInitializing(): boolean {
  return isInitializing
}

/**
 * 检查是否已初始化
 */
export function isFuriganaReady(): boolean {
  return kuroshiro !== null
}
