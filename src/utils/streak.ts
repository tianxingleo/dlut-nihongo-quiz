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
