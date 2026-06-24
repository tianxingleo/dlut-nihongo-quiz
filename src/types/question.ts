export type Category = 'japanese2' | 'history' | 'party' | 'military'

export interface SubBankMeta {
  key: string
  name: string
  desc: string
  groupOrder: string[]
  requireUnlock?: boolean
  groupViewTitle?: string
  groupViewHint?: string
}

export interface Question {
  id: string
  category: Category
  groupId: string
  groupTitle: string
  numberInGroup: number
  stem: string
  options: { key: string; text: string }[]
  answerKey: string
  answerText: string
  translation: string
  explanation: string
  grammarPoints: string[]
  tags: string[]
  source: { file: string; group: string; position: number }
  status: 'ready' | 'needs_review'
  subType?: 'kana-to-kanji' | 'kanji-to-kana'
  headword?: string
  multiAnswer?: boolean
  questionType?: 'single' | 'multi' | 'judgement' | 'fill'
}

export interface Attempt {
  id?: number
  questionId: string
  sessionId: string
  selectedKey: string
  correctKey: string
  isCorrect: boolean
  elapsedMs: number
  mode: string
  createdAt: string
}

export interface QuestionStats {
  questionId: string
  attemptCount: number
  correctCount: number
  wrongCount: number
  lastSelectedKey: string
  lastCorrect: boolean
  lastAttemptAt: string
  masteryLevel: number
  reviewDueAt: string
  isBookmarked: boolean
}

export interface TagStats {
  tag: string
  attemptCount: number
  correctCount: number
  wrongCount: number
}

export interface Session {
  id?: number
  mode: string
  totalQuestions: number
  correctCount: number
  wrongCount: number
  startedAt: string
  finishedAt?: string
  tagFilter?: string
}

export type QuizMode = 'sequential' | 'random' | 'wrong' | 'untouched' | 'tag' | 'weakness' | 'exam'

/** 中断的答题会话快照，用于会话恢复 */
export interface ActiveSession {
  sessionId: string
  mode: string
  questionIds: string[]
  totalQuestions: number
  currentIndex: number
  submitted: boolean
  correctCount: number
  wrongList: string[]
  startedAt: string
  history?: Array<{ questionId: string; selectedKey: string; isCorrect: boolean }>
  elapsedSeconds?: number
  drafts?: Record<number, string>
  // 进入刷题页的入口签名（category/mode/group 等 query 的拼接）。
  // 直接刷新页面（无 resume=1）时，用它判断存盘会话是否属于当前入口，从而自动恢复进度。
  entryKey?: string
  // 重做错题模式：答对时立即清零 wrongCount、提升 masteryLevel
  wrongRedo?: boolean
}
