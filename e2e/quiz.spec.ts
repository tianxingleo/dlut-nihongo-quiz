import { writeFile, unlink } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const historyBank = 'history-question-bank.json'
const firstStem = '中国近代史的起点是'

async function search(page: Page, term: string) {
  await page.locator('.search-trigger').click()
  await page.getByRole('textbox', { name: '搜索题目' }).fill(term)
}

async function correctHistoryAnswer(page: Page) {
  await page.getByRole('radio', { name: /鸦片战争/ }).click()
  await page.getByRole('button', { name: '提交答案' }).click()
  await expect(page.getByRole('button', { name: /下一题|完成/ })).toBeVisible()
}

async function controlled(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
}

test('全库搜索按需加载索引和题库，首页与仪表盘统计一致', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  await page.goto('./')
  await search(page, firstStem)
  const result = page.getByRole('button', { name: new RegExp(firstStem) }).first()
  await expect(result).toBeVisible()
  expect(requests.some((url) => url.endsWith('-question-bank.json'))).toBe(false)
  expect(requests.some((url) => url.endsWith('question-explanations.json'))).toBe(false)
  await page
    .getByRole('textbox', { name: '搜索题目' })
    .fill('鸦片战争的直接导火索，但并未改变中国社会性质')
  await expect(page.getByText('未找到相关题目')).toBeVisible()
  await page.getByRole('checkbox', { name: '同时搜索解析' }).check()
  await expect(result).toBeVisible()
  expect(requests.some((url) => url.endsWith('question-explanations.json'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.locator('.search-trigger')).toBeFocused()
  await search(page, firstStem)
  await result.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.q-stem')).toContainText(firstStem)
  expect(
    requests
      .filter((url) => url.endsWith('-question-bank.json'))
      .map((url) => url.split('/').pop()),
  ).toEqual([historyBank])
  await correctHistoryAnswer(page)
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  const card = page.locator('.subject-card').filter({ hasText: '中国近现代史' }).first()
  await expect(card).toContainText('已做 1 题 · 正确率 100%')
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.summary-item').filter({ hasText: '总进度' })).toContainText(
    '已做 1 题',
  )
  await expect(page.locator('.stat-card').filter({ hasText: '总正确率' })).toContainText('100%')
})

test('同科和跨科搜索单题不会覆盖整套进度', async ({ page }) => {
  await page.goto('#/quiz?category=history&group=t0')
  await expect(page.locator('.q-stem')).toContainText(firstStem)
  await correctHistoryAnswer(page)
  await page.getByRole('button', { name: '下一题', exact: true }).click()
  const secondStem = await page.locator('.q-stem').textContent()
  await search(page, firstStem)
  await page
    .getByRole('button', { name: new RegExp(firstStem) })
    .first()
    .click()
  await page.getByRole('button', { name: '确认离开' }).click()
  await expect(page.locator('.q-stem')).toContainText(firstStem)
  await correctHistoryAnswer(page)
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await search(page, '美籍经济学家熊彼特在1912年')
  const cross = page.locator('.search-result-item').filter({ hasText: 'creativity-' }).first()
  await cross.click()
  await expect(page).toHaveURL(/category=creativity/)
  await expect(page.locator('.question-card')).toBeVisible()
  const firstOption = page.locator('.opt-btn').first()
  await firstOption.click()
  await page.getByRole('button', { name: '提交答案' }).click()
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  const resume = page.getByRole('link', { name: '继续上次' })
  await expect(page.locator('.resume-detail')).toContainText('第 2/')
  await resume.click()
  await expect(page.locator('.q-stem')).toHaveText(secondStem!)
})

test('断网硬刷新后恢复已访问课程，未缓存课程给出返回入口', async ({ page, context }) => {
  await page.goto('./')
  await controlled(page)
  await page.goto('#/quiz?category=history&group=t0')
  await expect(page.locator('.q-stem')).toContainText(firstStem)
  await correctHistoryAnswer(page)
  await page.getByRole('button', { name: '下一题', exact: true }).click()
  const secondStem = await page.locator('.q-stem').textContent()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await page.getByRole('button', { name: '确认离开' }).click()
  await expect(page.getByRole('link', { name: '继续上次' })).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '期末复习题库' })).toBeVisible()
  await page.getByRole('link', { name: '继续上次' }).click()
  await expect(page.locator('.q-stem')).toHaveText(secondStem!)
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await page.getByRole('button', { name: '确认离开' }).click()
  await expect(page.getByRole('heading', { name: '期末复习题库' })).toBeVisible()
  await search(page, firstStem)
  await expect(page.getByText('索引暂不可用，仅搜索已缓存内容')).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(firstStem) }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('a.subject-card[href="#/home?category=party"]').click()
  await expect(page.getByText(/该题库尚未缓存/)).toBeVisible()
  await expect(page.getByRole('link', { name: '返回课程列表' })).toBeVisible()
})

test('新版等待用户确认，接管后保留旧题库和续刷进度', async ({ page, context }) => {
  const legacy = 'sw-legacy-test.js'
  const legacyPath = 'dist/' + legacy
  await writeFile(
    legacyPath,
    `
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
  `,
  )
  try {
    await page.goto('favicon.svg')
    await page.evaluate(
      async ({ bank, legacy }) => {
        const cache = await caches.open('quiz-cache-legacy')
        await cache.add(new URL(bank, location.href).href)
        await caches.open('other-app-cache')
        await navigator.serviceWorker.register(new URL(legacy, location.href))
      },
      { bank: historyBank, legacy },
    )
    await controlled(page)
    await page.goto('#/quiz?category=history&group=t0')
    await expect(page.locator('.q-stem')).toContainText(firstStem)
    await correctHistoryAnswer(page)
    await page.getByRole('button', { name: '下一题', exact: true }).click()
    const secondStem = await page.locator('.q-stem').textContent()
    const update = page.getByRole('button', { name: '立即生效' })
    await expect(update).toBeVisible()
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain(
      legacy,
    )
    page.on('dialog', (dialog) => dialog.accept())
    await update.click()
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
      .toMatch(/\/sw\.js$/)
    await expect(page.locator('.q-stem')).toHaveText(secondStem!)
    expect(await page.evaluate(() => caches.keys())).toContain('other-app-cache')
    await context.setOffline(true)
    await page.reload()
    await expect(page.locator('.q-stem')).toHaveText(secondStem!)
  } finally {
    await unlink(legacyPath)
  }
})

test('手机首屏显示选课程和卡片，窄屏无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  const choose = page.getByRole('button', { name: '选课程' })
  await expect(choose).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.subject-card').first()).toBeInViewport({ ratio: 1 })
  await choose.click()
  await expect(page.getByRole('heading', { name: '课程列表' })).toBeFocused()
  await page.setViewportSize({ width: 320, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
})

test('窄屏课程先显示题单，且可直接开始指定题单', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 })
  await page.goto('#/home?category=history')
  const card = page.locator('.group-card').filter({ hasText: '核心必刷' })
  await expect(card).toBeInViewport()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await card.getByRole('button', { name: '顺序', exact: true }).click()
  await expect(page.locator('.q-stem')).toContainText(firstStem)
})
