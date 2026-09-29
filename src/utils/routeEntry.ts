import type { LocationQuery } from 'vue-router'

/**
 * 路由入口签名：把 query 里「换了一批题」的入口参数归一化成一个稳定字符串。
 *
 * 用途是给页面组件当 `:key`。同一路径但入口参数变了时必须重新挂载组件，
 * 否则组件被复用、`onMounted` 不再执行 —— 例如刷题页完成页的「只刷错题」是
 * `router.push({ path: '/quiz', query: { ids } })`，与当前路径相同，点了会毫无反应。
 *
 * `fresh` 只是"开新一轮"的一次性标记：组件挂载后会自己把它从 URL 抹掉
 * （见 QuizPage 的 tryRestoreSession），若把它算进签名，那次 replace 又会
 * 触发一次多余的重挂载，所以这里刻意排除。
 */
export function routeEntryKey(query: LocationQuery): string {
  const entries = Object.entries(query)
    .filter(([key]) => key !== 'fresh')
    .map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(',') : ((value ?? '') as string),
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return JSON.stringify(entries)
}
