import { describe, expect, it } from 'vitest'
import { highlightUnderlines, hasUnderlineMark } from './highlightUnderlines'

describe('highlightUnderlines（题干里的下划线标记上色）', () => {
  it('把 OCR 标的 <u>…</u> 变成带标记的下划线', () => {
    expect(highlightUnderlines('<p>この文の<u>欠点</u>を選びなさい。</p>')).toBe(
      '<p>この文の<u class="u-mark">欠点</u>を選びなさい。</p>',
    )
  })

  it('把空栏下划线（____ / ＿＿）包成 u-blank', () => {
    expect(highlightUnderlines('<p>4 バイト = ______ ビット。</p>')).toBe(
      '<p>4 バイト = <span class="u-blank">______</span> ビット。</p>',
    )
    expect(highlightUnderlines('<p>わざわざ資料を____★____</p>')).toBe(
      '<p>わざわざ資料を<span class="u-blank">____</span>★<span class="u-blank">____</span></p>',
    )
  })

  it('只动文本、不动标签（不能破坏 <a> 之类）', () => {
    expect(highlightUnderlines('<p><a href="/x__y">____</a></p>')).toBe(
      '<p><a href="/x__y"><span class="u-blank">____</span></a></p>',
    )
  })

  it('下划线之外的正文原样保留', () => {
    const html = '<p>「並ぶ」は自動詞である。</p>'
    expect(highlightUnderlines(html)).toBe(html)
  })

  it('hasUnderlineMark 判定', () => {
    expect(hasUnderlineMark('この文の<u>欠点</u>')).toBe(true)
    expect(hasUnderlineMark('4 バイト = ______ ビット。')).toBe(true)
    expect(hasUnderlineMark('ふつうの文です。')).toBe(false)
  })
})
