/**
 * E2E 实机截图：用真浏览器走一遍「入口 → 选卷 → 刷题 → 错题本 → 分析」，把关键页面拍下来。
 *
 * 用法（先起站点，再跑脚本）：
 *   npm run dev                                   # 另开一个终端，默认 http://localhost:5173
 *   node scripts/e2e-screenshots.mjs              # 截图落到 docs/screenshots/e2e-*.png
 *   node scripts/e2e-screenshots.mjs --headed      # 想看着它跑
 *   node scripts/e2e-screenshots.mjs --mobile-only # 只拍手机视口
 *   node scripts/e2e-screenshots.mjs --base https://tianxingleo.top/dlut-nihongo-quiz/
 *
 * 依赖：本脚本**不写进 package.json**（避免给 CI 的 npm ci 加几十 MB 依赖），
 * 需要自己装一次浏览器驱动（浏览器本体一般已经在 ms-playwright 里了）：
 *   npm i --no-save playwright-core
 * 若报「找不到 Chromium」，设环境变量指定可执行文件，或装完整包：
 *   $env:PLAYWRIGHT_CHROME="C:\Users\me\AppData\Local\ms-playwright\chromium-1208\chrome-win64\chrome.exe"
 *   npm i -D playwright && npx playwright install chromium
 *
 * 产物：docs/screenshots/e2e-*.png（每张对应一个可验证的行为，见 docs/e2e-screenshots.md）
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const BASE = argValue('--base', 'http://localhost:5173').replace(/\/$/, '')
const OUT = resolve(argValue('--out', 'docs/screenshots'))
const HEADED = args.includes('--headed')
const MOBILE_ONLY = args.includes('--mobile-only')
const ENTRY_KEY = argValue('--entry-key', 'marxism')
const PAPER = argValue('--paper', '马原试卷7')
const VIEWPORT = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }
// 默认存 JPG：截图进库要控制体积（12 张 PNG 有 6MB，JPG q88 只有 ~2MB，文字照样清晰）
const FORMAT = argValue('--format', 'jpg').toLowerCase() === 'png' ? 'png' : 'jpg'
const QUALITY = Number(argValue('--quality', '88'))

/** 在 ms-playwright 缓存里找一个 Chromium（playwright-core 不认版本号，直接给路径最稳）。 */
function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME) return process.env.PLAYWRIGHT_CHROME
  const cache = join(
    process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData/Local'),
    'ms-playwright',
  )
  if (!existsSync(cache)) return undefined
  const candidates = readdirSync(cache)
    .filter((name) => name.startsWith('chromium-'))
    .flatMap((name) => [
      join(cache, name, 'chrome-win64', 'chrome.exe'),
      join(cache, name, 'chrome-win', 'chrome.exe'),
      join(cache, name, 'chrome-linux', 'chrome'),
      join(cache, name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ])
  return candidates.find((path) => existsSync(path))
}

async function loadChromium() {
  try {
    const module = await import('playwright-core')
    return module.chromium
  } catch {
    try {
      const module = await import('playwright')
      return module.chromium
    } catch {
      console.error(
        '✗ 找不到 playwright-core / playwright。请先：npm i --no-save playwright-core\n' +
          '  （本脚本刻意不写进 package.json，避免 CI 多装几十 MB）',
      )
      process.exit(1)
    }
  }
}

const chromium = await loadChromium()
const executablePath = findChrome()
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath,
  headless: !HEADED,
  args: ['--hide-scrollbars'],
})
console.log(`浏览器：${executablePath || '（默认 Chromium）'}｜站点：${BASE}｜输出：${OUT}`)

const problems = []
const shots = []

async function newPage(viewport, deviceScaleFactor = 1) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => problems.push(`pageerror: ${String(error).slice(0, 200)}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text().slice(0, 200)}`)
  })
  return { context, page }
}

async function shot(page, name, note) {
  const path = join(OUT, `${name}.${FORMAT}`)
  await page.screenshot(
    FORMAT === 'jpg' ? { path, type: 'jpeg', quality: QUALITY } : { path, type: 'png' },
  )
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  shots.push({ name, note, path, text })
  console.log(`  ✓ ${name}.${FORMAT} — ${note}`)
}

const text = (page) => page.locator('body').innerText()

/** 点第一个匹配到的可见元素（找不到就记一笔，不中断）。 */
async function clickText(page, needle, { exact = false } = {}) {
  const target = page.getByText(needle, { exact }).first()
  try {
    await target.waitFor({ state: 'visible', timeout: 8000 })
    await target.click()
    return true
  } catch {
    problems.push(`点不到「${needle}」`)
    return false
  }
}

async function openQuiz(page) {
  // 试卷页 → 刷整套 · 顺序
  await clickText(page, '刷整套 · 顺序')
  await page.waitForTimeout(1200)
  // 有的模式会先停在准备页
  const start = page.getByRole('button', { name: /开始|继续|开始刷题/ }).first()
  if (await start.isVisible().catch(() => false)) {
    await start.click()
    await page.waitForTimeout(800)
  }
}

/** 点顶部导航（比直接改 hash 可靠：SPA 的 hash-only goto 有时不重渲染，实测拍出过两张一样的图）。
 *  从答题页离开会弹「确认离开」，第一次点击可能被弹窗挡住 —— 所以短超时点一次、再确认离开。 */
async function clickNav(page, label, expectHash) {
  const link = page.getByRole('link', { name: label }).first()
  if (await link.isVisible().catch(() => false)) {
    await link.click({ timeout: 2500 }).catch(() => {})
  }
  const confirm = page.getByRole('button', { name: /确认离开/ }).first()
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click().catch(() => {})
    await page.waitForTimeout(500)
  }
  if (!page.url().includes(expectHash)) {
    await page
      .evaluate((hash) => {
        window.location.hash = hash
      }, expectHash)
      .catch(() => {})
  }
  await page
    .waitForFunction((hash) => window.location.hash.startsWith(hash), expectHash, { timeout: 5000 })
    .catch(() => problems.push(`导航到 ${expectHash} 超时`))
  await page.waitForTimeout(1500)
  if (!page.url().includes(expectHash))
    problems.push(`导航后 URL 不是 ${expectHash}：${page.url()}`)
}

/** 刷题页的导航：只有**提交后** N 才生效（未提交时按 N 不动），所以"提交 → 下一题"要成对做。 */
async function submitAndNext(page) {
  await page.keyboard.press('a')
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  await page.keyboard.press('n')
  await page.waitForTimeout(400)
}

/** 题卡上的选项文字（去掉序号字母），用来判断题型，比翻整页文本可靠。 */
async function optionLabels(page) {
  const texts = await page
    .locator('button, [role=button], label')
    .allInnerTexts()
    .catch(() => [])
  return texts
    .map((item) => item.replace(/\s+/g, ''))
    .filter((item) => /^[A-E][、.．:：]?\S/.test(item))
    .map((item) => item.replace(/^[A-E][、.．:：]?/, ''))
}

/** 判断题 = 两个选项正好是「正确 / 错误」（提交后页面上的"解析里的正确/错误"不算）。 */
async function hasJudgementOptions(page) {
  const labels = await optionLabels(page)
  return labels.includes('正确') && labels.includes('错误')
}

/** 往后翻到满足条件的题（试卷7 的判断题在 q014–q018，多选 q009 起，所以最多翻 30 题足够）。 */
async function findQuestion(page, predicate, limit = 30) {
  for (let step = 0; step < limit; step += 1) {
    if (await predicate()) return true
    await submitAndNext(page)
  }
  return false
}

/** 电脑视口：完整旅程 */
async function desktopJourney() {
  const { context, page } = await newPage(VIEWPORT)
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await shot(page, 'e2e-01-landing', '落地页：学科入口卡（含「马克思主义原理 510 题」）')

  await page.goto(`${BASE}/#/${ENTRY_KEY}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const entryText = await text(page)
  if (!entryText.includes('选择试卷')) problems.push('入口页没出现「选择试卷」')
  for (const paper of ['机考真题', '马原试卷1', '马原试卷5', '马原试卷6', PAPER]) {
    if (!entryText.includes(paper)) problems.push(`入口页缺少试卷卡：${paper}`)
  }
  await shot(page, 'e2e-02-entry-papers', '入口页：7 张试卷卡（机考真题 + 试卷1/2/3/5/6/7）')

  await clickText(page, PAPER)
  await page.waitForTimeout(1200)
  await shot(page, 'e2e-03-paper-home', '试卷页：33 题与「刷整套 · 顺序/随机」入口')

  await openQuiz(page)
  await page.waitForTimeout(1200)
  const first = await text(page)
  if (!first.includes('marxism-7-q001')) problems.push('刷题页第一题不是 marxism-7-q001')
  await shot(page, 'e2e-04-quiz-first', '刷题页：第一题（单选 + 选项）')

  // 故意选错一个（B 不是 q001 的答案），提交后看答案与解析
  await page.keyboard.press('b')
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  const answered = await text(page)
  if (!/正确答案|解析/.test(answered)) problems.push('提交后没看到正确答案/解析')
  await shot(page, 'e2e-05-quiz-answered', '提交后：正确答案 + 解析（含 AI 生成标记）')

  // 判断题（q014–q018）：卷面 √/× 应渲染成 A. 正确 / B. 错误
  const gotJudgement = await findQuestion(page, () => hasJudgementOptions(page))
  if (!gotJudgement) {
    problems.push('翻了 30 题没遇到判断题（试卷7 的 q014–q018 应是判断题）')
  } else {
    await shot(page, 'e2e-06-quiz-judgement', '判断题：卷面「√/×」被渲染成 A. 正确 / B. 错误')
    await page.keyboard.press('a')
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1200)
    await shot(page, 'e2e-07-quiz-judgement-answered', '判断题提交后：答案与解析')
  }

  // 主观题（q019–q021）：答案是评分标准正文
  const gotFill = await findQuestion(page, async () => (await text(page)).includes('填空'), 10)
  if (!gotFill) {
    problems.push('没翻到填空题（试卷7 的 q019–q021 应是主观题）')
  } else {
    await shot(page, 'e2e-08-quiz-subjective', '主观题：只有材料与题干、没有选项')
    // 主观题要自己敲一点答案，「提交答案」才会从 disabled 变可点
    const input = page.locator('.fill-input, textarea, input[type="text"]').first()
    if (await input.isVisible().catch(() => false)) {
      await input.fill('（E2E 自动化截图用的占位作答）').catch(() => {})
      await page.waitForTimeout(300)
    } else {
      problems.push('主观题没找到作答输入框')
    }
    const submitButton = page.getByRole('button', { name: /提交答案/ }).first()
    if (await submitButton.isEnabled().catch(() => false)) {
      await submitButton
        .click({ timeout: 5000 })
        .catch((error) => problems.push(`点提交失败：${error.message.slice(0, 80)}`))
    } else {
      problems.push('主观题的「提交答案」仍是 disabled')
    }
    await page.waitForTimeout(1200)
    const answer = page.getByText(/答案[:：]|得分点|正确答案|参考答案/).first()
    if (await answer.isVisible().catch(() => false)) {
      await answer.scrollIntoViewIfNeeded()
      await page.waitForTimeout(400)
    } else {
      problems.push('主观题提交后没看到答案区')
    }
    await shot(
      page,
      'e2e-09-quiz-subjective-answer',
      '主观题提交后：答案就是评分标准（非官方答案）',
    )
  }

  await clickNav(page, '错题本', '#/wrong')
  const wrongText = await text(page)
  if (!/错题|答错|收录/.test(wrongText)) problems.push('错题本页没看到错题相关内容')
  await shot(page, 'e2e-10-wrongbook', '错题本：刚答错的题被收录')

  await clickNav(page, '分析', '#/analysis')
  const analysisText = await text(page)
  if (!/正确率|掌握|分析/.test(analysisText)) problems.push('分析页没看到统计内容')
  await shot(page, 'e2e-11-analysis', '分析页：本次会话 33 题 / 已做 19 / 正确率 26%')

  await context.close()
}

/** 手机视口：响应式 */
async function mobileJourney() {
  const { context, page } = await newPage(MOBILE, 2)
  await page.goto(`${BASE}/#/${ENTRY_KEY}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await shot(page, 'e2e-12-mobile-entry', '手机视口（390×844）：入口与试卷卡')

  await clickText(page, PAPER)
  await page.waitForTimeout(1200)
  await openQuiz(page)
  await page.waitForTimeout(1200)
  await shot(page, 'e2e-13-mobile-quiz', '手机视口：刷题页与选项排版')
  await context.close()
}

if (!MOBILE_ONLY) await desktopJourney()
await mobileJourney()
await browser.close()

console.log(`\n完成：${shots.length} 张 → ${OUT}`)
if (problems.length) {
  console.log('\n⚠ 过程中有这些问题（截图仅供参考，请人工确认）：')
  for (const problem of [...new Set(problems)]) console.log(`  - ${problem}`)
  process.exitCode = 2
} else {
  console.log('✓ 没有任何 console 报错 / 缺元素')
}
