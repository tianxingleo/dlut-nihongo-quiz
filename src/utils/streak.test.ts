import { describe, it, expect } from 'vitest'
import { computeStreak } from './streak'

const NOW = new Date('2026-06-19T12:00:00.000') // 本地时间 2026-06-19 中午
const dayMs = 86_400_000
const iso = (offsetDays: number, hour = 10) =>
  new Date(NOW.getTime() - offsetDays * dayMs)
    .toISOString()
    .replace(/T\d+:\d+:\d+/, `T${String(hour).padStart(2, '0')}:00:00`)

describe('computeStreak', () => {
  it('returns 0 for empty input', () => {
    expect(computeStreak([], NOW)).toBe(0)
  })

  it('returns 0 when all entries are invalid', () => {
    expect(computeStreak(['', 'garbage', undefined, null], NOW)).toBe(0)
  })

  it('counts today only as streak = 1', () => {
    expect(computeStreak([iso(0)], NOW)).toBe(1)
  })

  it('counts today + yesterday as streak = 2', () => {
    expect(computeStreak([iso(0), iso(1)], NOW)).toBe(2)
  })

  it('counts a 5-day streak ending today', () => {
    expect(computeStreak([iso(0), iso(1), iso(2), iso(3), iso(4)], NOW)).toBe(5)
  })

  it('breaks on gap: today + 2 days ago → streak = 1', () => {
    expect(computeStreak([iso(0), iso(2)], NOW)).toBe(1)
  })

  it('grace period: yesterday only (no today) → streak = 1', () => {
    expect(computeStreak([iso(1)], NOW)).toBe(1)
  })

  it('grace period: yesterday + 2 days ago → streak = 2', () => {
    expect(computeStreak([iso(1), iso(2)], NOW)).toBe(2)
  })

  it('dedupes multiple attempts on the same day', () => {
    expect(computeStreak([iso(0, 8), iso(0, 10), iso(0, 22), iso(1)], NOW)).toBe(2)
  })
})
