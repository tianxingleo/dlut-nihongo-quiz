export type Category = 'grammar' | 'word' | 'history' | 'party' | 'military'

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
  questionType?: 'single' | 'multi' | 'judgement'
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

export type QuizMode = 'sequential' | 'random' | 'wrong' | 'tag' | 'weakness' | 'exam'
