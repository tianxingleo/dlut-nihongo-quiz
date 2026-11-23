// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { optionSignature } from '../services/sessionAnswers'
import type { ActiveSession, Question } from '../types/question'

const mocks = vi.hoisted(() => ({
  questions: [] as Question[],
  savedSession: null as ActiveSession | null,
  putBookmark: vi.fn(async () => {}),
  recordAttempt: vi.fn(async () => 1),
  updateTagStats: vi.fn(async () => {}),
  putSession: vi.fn(async () => 1),
  saveSession: vi.fn(async (_session: ActiveSession) => {}),
}))
vi.mock('../services/quizEngine', () => ({
  loadQuestionBank: async () => mocks.questions,
  getQuestionsByTag: () => mocks.questions,
  shuffleArray: <T>(items: T[]) => [...items],
  generateSessionId: () => 'session-computer',
  filterVisibleQuestions: <T>(items: T[]) => items,
  isMultiAnswerCorrect: (actual: string, expected: string) => actual === expected,
  isFillAnswerCorrect: (actual: string, expected: string) => actual === expected,
}))
vi.mock('../db/database', () => ({
  recordAttempt: mocks.recordAttempt,
  updateTagStats: mocks.updateTagStats,
  createDefaultStats: (id: string) => ({ questionId: id }),
  createSession: (input: unknown) => input,
  getSetting: async (_key: string, fallback: unknown) => fallback,
  setSetting: async () => {},
  db: {
    questionStats: { toArray: async () => [], get: async () => undefined, put: mocks.putBookmark },
    sessions: { put: mocks.putSession },
  },
}))
vi.mock(import('../services/sessionResume'), async (importOriginal) => ({
  ...(await importOriginal()),
  saveActiveSession: mocks.saveSession,
  loadActiveSession: async () => mocks.savedSession,
  clearActiveSession: async () => {},
  isSessionInProgress: (session: ActiveSession | null) => !!session,
}))
vi.mock('../composables/useAI', async () => {
  const { ref } = await import('vue')
  return { useAI: () => ({ aiEnabled: ref(false), initAI: async () => {} }) }
})
vi.mock('../composables/useHiddenSite', async () => {
  const { ref } = await import('vue')
  return { useHiddenSite: () => ({ isUnlocked: ref(false) }) }
})
vi.mock('../components/ai/AIExplanation.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../components/ai/AIChat.vue', () => ({ default: { template: '<div />' } }))
import QuizPage from './QuizPage.vue'
import QuestionCard from '../components/quiz/QuestionCard.vue'

const sample = (overrides: Partial<Question> = {}): Question => ({
  id: 'computer-2021-final-001',
  category: 'computer-2021-final',
  groupId: 'group1',
  groupTitle: '第一题单',
  numberInGroup: 1,
  stem: '计算存储容量',
  options: [
    { key: 'A', text: '16 KB' },
    { key: 'B', text: '32 KB' },
  ],
  answerKey: 'A',
  answerText: '16 KB',
  answerProvenance: 'generated',
  status: 'ready',
  questionType: 'single',
  translation: '',
  explanation: '',
  grammarPoints: [],
  tags: [],
  source: {
    file: '原卷.pdf',
    group: '一',
    position: 1,
    pages: [1],
  },
  ...overrides,
})
let app: App | undefined
let host: HTMLDivElement
async function mountQuiz(extraQuery = 'fresh=1', empty = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/quiz', component: QuizPage },
      { path: '/home', component: { template: '<div />' } },
    ],
  })
  await router.push(`/quiz?category=computer-2021-final&${extraQuery}`)
  await router.isReady()
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(QuizPage).use(router)
  app.mount(host)
  await vi.waitFor(() =>
    expect(host.querySelector(empty ? '[role="status"]' : '.question-card')).not.toBeNull(),
  )
  return router
}
function button(label: string) {
  const result = Array.from(host.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === label,
  )
  expect(result, `button ${label}`).toBeDefined()
  return result!
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.savedSession = null
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  )
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('computer question bank uses the existing quiz flow', () => {
  it('shows an empty state when the selected question type has no questions', async () => {
    mocks.questions = [sample({ questionType: 'single' })]
    const router = await mountQuiz('fresh=1&questionType=fill', true)
    expect(host.textContent).toContain('暂无符合条件的题目')
    expect(mocks.saveSession).not.toHaveBeenCalled()
    expect(host.querySelector('.page-skeleton')).toBeNull()
    button('返回题库').click()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/home'))
  })
  it.each(['single', 'fill'] as const)(
    'renders and sanitizes technical %s answers and translations',
    async (questionType) => {
      host = document.createElement('div')
      document.body.append(host)
      app = createApp(QuestionCard, {
        question: sample({
          questionType,
          answerText: '$2^{16}$ <img src="x" onerror="alert(1)">',
          translation:
            '$2^{16}$ 字节\n\n```asm\nMOV AX, BX\nADD AX, 1\n```\n\n<script>alert(1)</script>',
        }),
        selectedKey: 'A',
        submitted: true,
        showExplanation: true,
        mode: 'sequential',
        questionIndex: 0,
        totalQuestions: 1,
        bookmarked: false,
      })
      app.mount(host)
      await nextTick()
      const result = host.querySelector('.q-result')!
      const explanation = host.querySelector('.q-explanation')!
      expect(result.querySelector('.katex')).not.toBeNull()
      expect(result.querySelector('strong p, span p')).toBeNull()
      expect(explanation.querySelector('.katex')).not.toBeNull()
      expect(explanation.querySelector('pre code')?.textContent).toBe('MOV AX, BX\nADD AX, 1\n')
      expect(explanation.querySelector('p pre')).toBeNull()
      expect(host.querySelector('[onerror], script')).toBeNull()
    },
  )

  it('keeps ordinary subject answers and translations as escaped plain text', async () => {
    const text = '$2^{16}$ <b>literal text</b>'
    host = document.createElement('div')
    document.body.append(host)
    app = createApp(QuestionCard, {
      question: sample({ category: 'japanese2', answerText: text, translation: text }),
      selectedKey: 'A',
      submitted: true,
      showExplanation: true,
      mode: 'sequential',
      questionIndex: 0,
      totalQuestions: 1,
      bookmarked: false,
    })
    app.mount(host)
    await nextTick()
    expect(host.querySelector('.q-result')?.textContent).toContain(text)
    expect(host.querySelector('.q-explanation')?.textContent).toContain(text)
    expect(host.querySelector('.katex, b')).toBeNull()
  })

  it('updates the question and its formatted content in the same render as navigation', async () => {
    mocks.questions = [
      sample({ questionType: 'fill', options: [] }),
      sample({ id: 'computer-2021-final-002', stem: '**题目二** $2^{16}$' }),
    ]
    await mountQuiz()
    host.querySelector<HTMLButtonElement>('.expand-btn')!.click()
    await nextTick()
    host.querySelectorAll<HTMLButtonElement>('.gcell')[1]!.click()
    await nextTick()

    expect(host.querySelector('.navigator .cur')?.textContent).toBe('2')
    expect(host.querySelectorAll('.question-card')).toHaveLength(1)
    expect(host.querySelector('.q-stem strong')?.textContent).toBe('题目二')
    expect(host.querySelector('.q-stem .katex')).not.toBeNull()
    expect(host.querySelector('.fill-input')).toBeNull()
  })

  it.each([false, true])(
    'restores the original selected text after reshuffle (revised: %s)',
    async (revised) => {
      const original = sample({
        options: [
          { key: 'A', text: '16 KB' },
          { key: 'B', text: '32 KB' },
        ],
      })
      const shuffled = sample({
        options: [
          { key: 'A', originalKey: 'B', text: '32 KB' },
          { key: 'B', originalKey: 'A', text: revised ? '64 KB' : '16 KB' },
        ],
        answerKey: 'B',
      })
      const second = sample({ id: 'computer-2021-final-002' })
      mocks.questions = [shuffled, second]
      mocks.savedSession = {
        sessionId: 'saved-shuffle',
        mode: 'sequential',
        questionIds: [original.id, second.id],
        totalQuestions: 2,
        currentIndex: 0,
        submitted: true,
        correctCount: 1,
        wrongList: [],
        startedAt: new Date().toISOString(),
        history: [{ questionId: original.id, selectedKey: 'A', isCorrect: true }],
        optionSignatures: { [original.id]: optionSignature(original) },
      }
      await mountQuiz('mode=sequential')
      button('上一题').click()
      await nextTick()
      if (revised) {
        expect(host.querySelector('.opt-btn.selected')).toBeNull()
        expect(host.textContent).toContain('原选项无法恢复')
      } else {
        expect(host.querySelector('.opt-btn.selected')?.textContent).toContain('16 KB')
      }
      expect(mocks.saveSession.mock.lastCall?.[0].history?.[0]?.isCorrect).toBe(true)
    },
  )

  it('submits generated answers and records attempts using ordinary scoring', async () => {
    mocks.questions = [sample()]
    await mountQuiz()
    expect(host.querySelector('.q-source')).toBeNull()
    expect(host.querySelector('.q-reading-notice')).toBeNull()
    host.querySelector<HTMLButtonElement>('.opt-btn')!.click()
    await nextTick()
    button('提交答案').click()
    await vi.waitFor(() => expect(mocks.recordAttempt).toHaveBeenCalledOnce())
    expect(mocks.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: mocks.questions[0]!.id, isCorrect: true }),
      expect.anything(),
    )
    button('完成').click()
    await nextTick()
    expect(host.querySelector('.finish-pct')?.textContent).toBe('100%')
  })

  it('uses the existing fill answer input for computer open-response questions', async () => {
    mocks.questions = [
      sample({ questionType: 'fill', options: [], answerKey: '', answerText: '16 KB' }),
    ]
    await mountQuiz()
    const input = host.querySelector<HTMLInputElement>('.fill-input')!
    input.value = '16 KB'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    button('提交答案').click()
    await vi.waitFor(() => expect(mocks.recordAttempt).toHaveBeenCalledOnce())
    expect(mocks.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ isCorrect: true }),
      expect.anything(),
    )
    expect(host.querySelector('.q-result')?.textContent).toContain('16 KB')
  })

  it('records a mathematics self-assessment only after revealing the reference', async () => {
    mocks.questions = [
      sample({
        questionType: 'fill',
        options: [],
        answerKey: '',
        answerText: '见解析。',
        selfAssessment: true,
      }),
    ]
    await mountQuiz()
    expect(host.querySelector('.fill-input')).toBeNull()
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
    button('查看参考解答').click()
    await nextTick()
    button('自评：答对了').click()
    await vi.waitFor(() => expect(mocks.recordAttempt).toHaveBeenCalledOnce())
    expect(mocks.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ isCorrect: true, selectedKey: '__self_correct__' }),
      expect.anything(),
    )
  })

  it.each([
    { answerFirst: true, expected: '50%' },
    { answerFirst: false, expected: '0%' },
  ])(
    'counts unanswered questions in exam results ($expected)',
    async ({ answerFirst, expected }) => {
      mocks.questions = [sample(), sample({ id: 'computer-2021-final-002' })]
      await mountQuiz('fresh=1&mode=exam')
      if (answerFirst) {
        host.querySelector<HTMLButtonElement>('.opt-btn')!.click()
        await nextTick()
        button('提交答案').click()
        await vi.waitFor(() => expect(mocks.recordAttempt).toHaveBeenCalledOnce())
      }
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60 * 1000 + 1)
      await vi.waitFor(() => expect(host.querySelector('.finish-page')).not.toBeNull(), {
        timeout: 2000,
      })
      expect(host.querySelector('.finish-pct')?.textContent).toBe(expected)
      expect(mocks.putSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ totalQuestions: 2 }),
      )
    },
  )
})
