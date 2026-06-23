import { getSetting, setSetting } from '../db/database'
import { STORAGE_KEYS, SESSION } from '../constants'
import type { ActiveSession } from '../types/question'

export type { ActiveSession }

const KEY = STORAGE_KEYS.ACTIVE_SESSION

export async function saveActiveSession(s: ActiveSession): Promise<void> {
  await setSetting(KEY, s)
}

export async function loadActiveSession(): Promise<ActiveSession | null> {
  return await getSetting(KEY, null as ActiveSession | null)
}

export async function clearActiveSession(): Promise<void> {
  await setSetting(KEY, null)
}

export function isSessionInProgress(s: ActiveSession | null): s is ActiveSession {
  if (!s) return false
  if (!s.questionIds || s.questionIds.length === 0) return false

  // 检查会话是否过期
  const sessionAge = Date.now() - new Date(s.startedAt).getTime()
  if (sessionAge > SESSION.MAX_AGE_MS) return false

  const nextIndex = s.submitted ? s.currentIndex + 1 : s.currentIndex
  return nextIndex < s.totalQuestions
}
