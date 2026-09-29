# E2E 实机测试截图

用真浏览器（本机 Chromium）走一遍「入口 → 选卷 → 刷题 → 主观题 → 错题本 → 分析 → 手机视口」，
把关键页面拍下来，作为「新题库在站上真的能刷」的证据。产物在 `docs/screenshots/e2e-*.jpg`。

## 怎么跑（3 步）

```bash
# 1) 先起站点（另开一个终端，别关）
npm run dev                                  # 默认 http://localhost:5173

# 2) 装一次浏览器驱动（浏览器本体一般已经在 ms-playwright 里了）
npm i --no-save playwright-core

# 3) 拍图（13 张 → docs/screenshots/e2e-*.jpg）
node scripts/e2e-screenshots.mjs
```

想看着它点：

```bash
node scripts/e2e-screenshots.mjs --headed
```

拍线上站点 / 换成别的卷：

```bash
node scripts/e2e-screenshots.mjs --base https://tianxingleo.top/dlut-nihongo-quiz/
node scripts/e2e-screenshots.mjs --entry-key marxism --paper 马原试卷5
```

> **为什么不写进 `package.json`**：截图是本地人工验证，不该让 CI 的 `npm ci` 多装几十 MB。
> 所以脚本用 `--no-save` 装 `playwright-core`，浏览器从 `%LOCALAPPDATA%\ms-playwright` 里找现成的 Chromium。
> 找不到时：设 `PLAYWRIGHT_CHROME=<chrome.exe 路径>`，或者 `npm i -D playwright && npx playwright install chromium`。

## 参数

| 参数                | 默认                    | 说明                                  |
| ------------------- | ----------------------- | ------------------------------------- |
| `--base <url>`      | `http://localhost:5173` | 站点地址（dev / preview / 线上都行）  |
| `--out <dir>`       | `docs/screenshots`      | 输出目录                              |
| `--format png\|jpg` | `jpg`                   | JPG 体积只有 PNG 的 1/5，文字照样清晰 |
| `--quality <1-100>` | `88`                    | JPG 质量                              |
| `--entry-key <key>` | `marxism`               | 拍哪个入口                            |
| `--paper <名字>`    | `马原试卷7`             | 拍哪张试卷卡                          |
| `--headed`          | 关                      | 显示浏览器窗口（看着它点）            |
| `--mobile-only`     | 关                      | 只拍手机视口                          |

退出码：`0` 全过；`2` 拍完了但有 console 报错 / 找不到元素（截图仍会生成，需要人工确认）。

## 脚本走的路径（也是它检查的东西）

1. `#/` → 落地页（入口卡上的题数是不是 7,064 / 510）
2. `#/marxism` → 入口页「选择试卷」：7 张卡（机考真题 + 试卷1/2/3/5/6/7）都在
3. 点「马原试卷7」→ 试卷页：33 题 + 「刷整套 · 顺序/随机」
4. 「刷整套 · 顺序」→ 刷题页（`#/quiz?mode=sequential`），第一题是 `marxism-7-q001`
5. 选 B 提交 → 看正确答案与解析
6. 逐题「提交 → 下一题」翻到 **判断题**（q014–q018）：选项必须是 `A 正确 / B 错误`
7. 提交判断题 → 看答案（应显示 `错误`，对应卷面的 `×`）
8. 翻到 **主观题**（q019–q021）：只有材料与题干、没有选项；填一点字后提交 → 答案应是评分标准正文
9. `#/wrong` 错题本、`#/analysis` 分析页
10. 手机视口（390×844）：入口页 + 刷题页（响应式）

> 刷题页的键盘规则：**未提交时** `A/B/C/D` 选择、`Enter` 提交；**提交后** `N`/`Enter` 才翻页。
> 所以脚本里「提交 → 下一题」是成对做的（只按 `N` 不会动，这是页面本该有的行为）。

## 13 张截图分别证明什么

| 截图                                 | 证明                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `e2e-01-landing.jpg`                 | 落地页出现「马克思主义原理」入口卡（510 题），页头统计 7,064 题 / 7 学科门类 |
| `e2e-02-entry-papers.jpg`            | 入口页 7 张试卷卡（机考真题 + 试卷1/2/3/5/6/7）                              |
| `e2e-03-paper-home.jpg`              | 试卷页题数 33（= 题库 JSON 里的 33 题）                                      |
| `e2e-04-quiz-first.jpg`              | 刷题页第一题单选 + 四个选项                                                  |
| `e2e-05-quiz-answered.jpg`           | 提交后给正确答案 + 解析（AI 生成的标了来源）                                 |
| `e2e-06-quiz-judgement.jpg`          | 判断题：卷面 `√/×` 渲染成 `A 正确 / B 错误`（徽章「判断」，marxism-7-q014）  |
| `e2e-07-quiz-judgement-answered.jpg` | 判断题答案是 `错误`（对应卷面第 1 道辨析题的 `×`）                           |
| `e2e-08-quiz-subjective.jpg`         | 主观题（q019）：只有材料与题干、没有选项                                     |
| `e2e-09-quiz-subjective-answer.jpg`  | 主观题答案是**评分标准正文**（踩点分数都在），并显示「你的答案」对照         |
| `e2e-10-wrongbook.jpg`               | 答错的题进了错题本                                                           |
| `e2e-11-analysis.jpg`                | 分析页：本次会话 33 题 / 已做 19 / 正确率 26%，按题组统计                    |
| `e2e-12-mobile-entry.jpg`            | 手机视口（390×844）入口与试卷卡排版                                          |
| `e2e-13-mobile-quiz.jpg`             | 手机视口刷题页排版                                                           |

## 什么时候要重跑

- 改了 `src/config/entries.ts` / `categories.ts` / `courseTree.ts` / 题库文件 → 入口或卡片变了；
- 改了刷题页渲染（尤其是判断题、主观题、材料题的展示）；
- PR / Issue 要求"补一张实机截图"时。
