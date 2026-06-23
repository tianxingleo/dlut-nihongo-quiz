// 把 ISO 时间戳列表折算成「连续学习天数」。
// 规则：
//   - 按本地日期（YYYY-MM-DD）去重
//   - 今天有活动 → 从今天开始往回数；今天没有活动 → 从昨天开始数（grace period，
//     不至于让用户晚上 23:59 答完一题到 00:01 就断）
//   - 一旦遇到缺失的日期就停
export function computeStreak(
  timestamps: (string | undefined | null)[],
  now: Date = new Date(),
): number {
  const days = new Set<string>()
  for (const ts of timestamps) {
    if (!ts) continue
    const d = new Date(ts)
    if (isNaN(d.getTime())) continue
    days.add(toLocalDateKey(d))
  }
  if (days.size === 0) return 0

  const today = startOfLocalDay(now)
  let cursor = new Date(today)
  if (!days.has(toLocalDateKey(today))) {
    // 今天还没答 → 从昨天开始数（保留连续性）
    cursor.setDate(cursor.getDate() - 1)
  }

  let streak = 0
  while (days.has(toLocalDateKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/**
 * 计算历史最长连续天数
 */
export function computeLongestStreak(
  timestamps: (string | undefined | null)[],
): number {
  const days = new Set<string>()
  for (const ts of timestamps) {
    if (!ts) continue
    const d = new Date(ts)
    if (isNaN(d.getTime())) continue
    days.add(toLocalDateKey(d))
  }
  if (days.size === 0) return 0

  // 将日期排序
  const sortedDays = [...days].sort()
  let longest = 1
  let current = 1

  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(sortedDays[i - 1])
    const curr = new Date(sortedDays[i])
    const diffTime = curr.getTime() - prev.getTime()
    const diffDays = diffTime / (1000 * 60 * 60 * 24)

    if (diffDays === 1) {
      current++
      longest = Math.max(longest, current)
    } else {
      current = 1
    }
  }

  return longest
}

/**
 * 获取活跃日历数据（最近 N 天的活跃情况）
 */
export function getActiveDays(
  timestamps: (string | undefined | null)[],
  days: number = 30,
): Array<{ date: string; active: boolean }> {
  const activeDays = new Set<string>()
  for (const ts of timestamps) {
    if (!ts) continue
    const d = new Date(ts)
    if (isNaN(d.getTime())) continue
    activeDays.add(toLocalDateKey(d))
  }

  const result: Array<{ date: string; active: boolean }> = []
  const now = new Date()

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const dateKey = toLocalDateKey(date)
    result.push({
      date: dateKey,
      active: activeDays.has(dateKey),
    })
  }

  return result
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
