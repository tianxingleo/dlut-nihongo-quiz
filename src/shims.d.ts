/**
 * 第三方模块类型声明
 */

declare module 'kuroshiro-browser' {
  export class Kuroshiro {
    static buildAndInitWithKuromoji(isProd: boolean): Promise<Kuroshiro>
    convert(
      input: string,
      options: {
        mode: 'furigana' | 'normal' | 'spaced'
        to: 'hiragana' | 'katakana' | 'romaji'
      },
    ): Promise<string>
  }
}
