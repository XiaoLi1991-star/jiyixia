import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const qaDir = resolve(root, 'qa')
mkdirSync(qaDir, { recursive: true })

const adb = process.env.ADB || 'C:\\Users\\zhujianhua\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe'
const serial = process.env.ADB_SERIAL || 'emulator-5554'
const adbPort = process.env.ADB_PORT || '5038'
const devtoolsPort = process.env.DEVTOOLS_PORT || '9222'
const packageName = 'com.jiyixia.app'
const activityName = 'com.jiyixia.app/.MainActivity'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = {
  createdAt: new Date().toISOString(),
  device: {},
  dataset: {},
  steps: [],
  issues: [],
  screenshots: []
}

function adbFile(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args])
}

function adbText(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args], { encoding: 'utf8' })
}

async function retry(fn, attempts = 20, delayMs = 400) {
  let lastError
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      await sleep(delayMs)
    }
  }
  throw lastError
}

function saveScreenshot(name) {
  const file = resolve(qaDir, name)
  writeFileSync(file, adbFile(['exec-out', 'screencap', '-p']))
  report.screenshots.push(file)
  return file
}

async function findWebviewSocket() {
  return retry(() => {
    const unix = adbText(['shell', 'cat', '/proc/net/unix'])
    const sockets = [...unix.matchAll(/@?(webview_devtools_remote_\d+)/g)].map(match => match[1])
    if (!sockets.length) throw new Error('No WebView devtools socket found')
    return sockets[sockets.length - 1]
  })
}

async function connectPage() {
  const socket = await findWebviewSocket()
  execFileSync(adb, ['-P', adbPort, '-s', serial, 'forward', `tcp:${devtoolsPort}`, `localabstract:${socket}`])
  const targets = await retry(() => fetch(`http://127.0.0.1:${devtoolsPort}/json`).then(res => res.json()))
  const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl) || targets[0]
  if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable WebView page found')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true })
    ws.addEventListener('error', rejectOpen, { once: true })
  })

  let id = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolveMessage, rejectMessage, timer } = pending.get(message.id)
    clearTimeout(timer)
    pending.delete(message.id)
    if (message.error) rejectMessage(new Error(JSON.stringify(message.error)))
    else resolveMessage(message.result)
  })

  const send = (method, params = {}, timeoutMs = 30000) => new Promise((resolveMessage, rejectMessage) => {
    const messageId = ++id
    const timer = setTimeout(() => {
      pending.delete(messageId)
      rejectMessage(new Error(`${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    pending.set(messageId, { resolveMessage, rejectMessage, timer })
    ws.send(JSON.stringify({ id: messageId, method, params }))
  })

  return { ws, send }
}

function collectIssue(step, item) {
  report.issues.push({ step, ...item })
}

async function main() {
  adbText(['logcat', '-c'])
  adbText(['shell', 'am', 'force-stop', packageName])
  adbText(['shell', 'am', 'start', '-n', activityName])
  await sleep(1800)

  report.device = {
    serial,
    wmSize: adbText(['shell', 'wm', 'size']).trim(),
    wmDensity: adbText(['shell', 'wm', 'density']).trim()
  }

  const { ws, send } = await connectPage()
  await send('Runtime.enable')

  async function evaluate(fn, args = [], timeoutMs = 30000) {
    const result = await send('Runtime.evaluate', {
      expression: `(${fn})(...${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true
    }, timeoutMs)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
    return result.result?.value ?? null
  }

  async function waitForText(text, timeoutMs = 12000) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const found = await evaluate(value => document.body.innerText.includes(value), [text]).catch(() => false)
      if (found) return true
      await sleep(250)
    }
    throw new Error(`Timed out waiting for ${text}`)
  }

  async function waitForCompositor() {
    await evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }), [], 3000).catch(() => null)
    await sleep(450)
  }

  async function click(selector, index = 0) {
    return evaluate((selector, index) => {
      const element = document.querySelectorAll(selector)[index]
      if (!element) throw new Error(`Missing ${selector}[${index}]`)
      element.click()
      return (element.textContent || element.getAttribute('aria-label') || selector).replace(/\s+/g, ' ').trim()
    }, [selector, index])
  }

  async function clickText(selector, text) {
    return evaluate((selector, text) => {
      const element = [...document.querySelectorAll(selector)].find(item => (item.textContent || '').includes(text))
      if (!element) throw new Error(`Missing ${selector} containing ${text}`)
      element.click()
      return (element.textContent || text).replace(/\s+/g, ' ').trim()
    }, [selector, text])
  }

  async function setValue(selector, value, index = 0) {
    return evaluate((selector, value, index) => {
      const element = document.querySelectorAll(selector)[index]
      if (!element) throw new Error(`Missing ${selector}[${index}]`)
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set
      setter?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return value
    }, [selector, value, index])
  }

  const snapshot = await evaluate(() => ({
    store: localStorage.getItem('jiyixia-store'),
    apiKey: localStorage.getItem('jiyixia-ai-api-key')
  }))

  try {
    await waitForText('首页')
    const seedSummary = await evaluate(() => {
      const raw = localStorage.getItem('jiyixia-store')
      const existing = JSON.parse(raw || '{}')?.state || {}
      const categories = existing.categories || []
      const settings = existing.settings || {
        model: {
          baseUrl: 'https://api.minimaxi.com/v1',
          model: 'MiniMax-M2.7-highspeed',
          requestPath: '/chat/completions',
          temperature: 0.1,
          maxTokens: 1200,
          timeoutMs: 60000
        },
        privacy: { hideAmounts: false }
      }
      const pad = value => String(value).padStart(2, '0')
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1
      const day = now.getDate()
      const today = `${year}-${pad(month)}-${pad(day)}`
      const monthPrefix = `${year}-${pad(month)}`
      const expenseCategories = categories.filter(item => item.type === 'expense')
      const incomeCategories = categories.filter(item => item.type === 'income')
      const pick = (pool, index) => pool[index % Math.max(pool.length, 1)] || categories[0]
      const longMerchant = '小米14挖孔屏适配压力测试超长商户名称'.repeat(3)
      const longNote = '这是一段用于测试手机端换行遮挡和账单列表高度稳定性的超长备注'.repeat(4)
      const tx = []
      let index = 0
      const make = (date, type, amountCents, overrides = {}) => {
        const category = pick(type === 'income' ? incomeCategories : expenseCategories, index)
        const subcategories = category?.subcategories || []
        const subcategory = subcategories[index % Math.max(subcategories.length, 1)]
        const item = {
          id: `multi-stress-${index}`,
          type,
          date,
          categoryId: category?.id || '',
          subcategoryId: subcategory?.id || '',
          accountName: index % 3 === 0 ? '招商银行储蓄卡' : '现金账户',
          currency: 'CNY',
          amountCents,
          memberName: index % 2 === 0 ? '朱建华' : '家人',
          merchant: index % 13 === 0 ? '压力测试商户' : '',
          projectCategory: '',
          projectName: '',
          note: index % 17 === 0 ? '压力测试流水' : '',
          source: 'backup',
          status: 'confirmed',
          createdAt: date,
          updatedAt: date,
          ...overrides
        }
        index += 1
        return item
      }

      tx.push(make(`${today}T23:48:00`, 'expense', 12345678, { merchant: longMerchant, note: longNote }))
      tx.push(make(`${today}T22:18:00`, 'income', 98765432109, { merchant: '一次性大额收入测试', note: longNote }))
      for (let i = 0; i < 118; i += 1) {
        const type = i % 10 === 0 ? 'income' : 'expense'
        const amount = type === 'income' ? 700000 + (i % 19) * 32111 : 800 + (i % 57) * 137
        tx.push(make(`${today}T${pad(6 + (i % 17))}:${pad(i % 60)}:00`, type, amount))
      }
      for (let i = 0; i < 1380; i += 1) {
        const date = `${monthPrefix}-${pad(1 + (i % Math.max(day, 1)))}T${pad(7 + (i % 12))}:${pad(i % 60)}:00`
        const type = i % 11 === 0 ? 'income' : 'expense'
        const amount = type === 'income' ? 900000 + (i % 23) * 21000 : 500 + (i % 83) * 121
        tx.push(make(date, type, amount))
      }
      for (let i = 0; i < 3500; i += 1) {
        const date = `${year}-${pad(1 + (i % 12))}-${pad(1 + (i % 27))}T${pad(8 + (i % 10))}:${pad(i % 60)}:00`
        const type = i % 13 === 0 ? 'income' : 'expense'
        const amount = type === 'income' ? 600000 + (i % 29) * 11111 : 300 + (i % 97) * 99
        tx.push(make(date, type, amount))
      }
      for (let i = 0; i < 1000; i += 1) {
        const priorYear = year - 1 - (i % 2)
        const date = `${priorYear}-${pad(1 + (i % 12))}-${pad(1 + (i % 27))}T09:${pad(i % 60)}:00`
        const type = i % 12 === 0 ? 'income' : 'expense'
        const amount = type === 'income' ? 500000 + (i % 17) * 10000 : 600 + (i % 70) * 88
        tx.push(make(date, type, amount))
      }

      const store = {
        state: {
          transactions: tx,
          categories,
          drafts: [],
          settings: { ...settings, privacy: { ...settings.privacy, hideAmounts: false } },
          importSummary: {
            fileName: 'android-multi-round-stress',
            importedAt: new Date().toISOString(),
            transactionCount: tx.length,
            dateStart: `${year - 2}-01-01`,
            dateEnd: today,
            warnings: []
          }
        },
        version: 1
      }
      localStorage.setItem('jiyixia-store', JSON.stringify(store))
      return {
        count: tx.length,
        today: tx.filter(item => item.date.startsWith(today)).length,
        month: tx.filter(item => item.date.startsWith(monthPrefix)).length,
        year: tx.filter(item => item.date.startsWith(String(year))).length,
        prior: tx.filter(item => !item.date.startsWith(String(year))).length,
        todayDate: today
      }
    })
    report.dataset = seedSummary
    await evaluate(() => location.reload())
    await sleep(1100)
    await waitForText('一句话快记')

    async function audit(label, screenshotName) {
      await waitForCompositor()
      const screenshot = saveScreenshot(screenshotName)
      const result = await evaluate(label => {
        const viewport = { width: innerWidth, height: innerHeight, scrollY, scrollHeight: document.documentElement.scrollHeight }
        const targetSelector = [
          '.app-header', '.page-header', '.month-switch', '.month-card', '.quick-dock',
          '.period-tabs', '.period-tabs button', '.search-field', '.smart-search-toggle',
          '.filter-chips button', '.ledger-summary', '.ledger-item', '.transaction-row',
          '.transaction-copy strong', '.transaction-copy span', '.transaction-copy p', '.amount',
          '.date-group-head', '.load-more-panel', '.report-switch', '.report-switch button',
          '.report-card', '.metric', '.metric strong', '.chart-box', '.annual-trend',
          '.rank-list', '.rank-row', '.settings-card', '.file-button', '.toggle-row',
          '.capture-sheet', '.sheet-tabs button', '.form-panel', '.primary-button',
          '.secondary-button', '.danger-button', '.small-button', '.text-button',
          'input', 'textarea', 'select', '.bottom-nav', '.nav-button', '.nav-capture'
        ].join(',')
        const text = element => (element.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
        const visible = element => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        }
        const keyName = element => {
          if (element.className && typeof element.className === 'string') return `${element.tagName.toLowerCase()}.${element.className.split(/\s+/).slice(0, 3).join('.')}`
          return element.tagName.toLowerCase()
        }
        const unique = [...new Set([...document.querySelectorAll(targetSelector)])].filter(visible)
        const offscreen = unique.map(element => {
          const rect = element.getBoundingClientRect()
          return { element, rect }
        }).filter(({ rect }) => rect.left < -1 || rect.right > viewport.width + 1)
          .slice(0, 20)
          .map(({ element, rect }) => ({
            selector: keyName(element),
            text: text(element).slice(0, 80),
            rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }
          }))

        const overflowRisks = unique.filter(element => text(element).length > 0).map(element => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          const horizontal = element.scrollWidth - element.clientWidth
          const vertical = element.scrollHeight - element.clientHeight
          return { element, style, rect, horizontal, vertical }
        }).filter(({ element, style, horizontal, vertical }) => {
          if (element.matches('svg, path, input[type="file"]')) return false
          if (element.matches('.annual-trend, .trend-month, .trend-bars')) return false
          if (style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap' && ['hidden', 'clip'].includes(style.overflowX)) return false
          return horizontal > 3 || (vertical > 3 && ['hidden', 'clip'].includes(style.overflowY))
        }).slice(0, 24).map(({ element, style, horizontal, vertical }) => ({
          selector: keyName(element),
          text: text(element).slice(0, 100),
          horizontal: Math.round(horizontal),
          vertical: Math.round(vertical),
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          whiteSpace: style.whiteSpace
        }))
        const wrapRisks = [...document.querySelectorAll('.amount, .metric strong, .mini-metric strong, .month-card-head strong, .rank-value b')]
          .filter(visible)
          .map(element => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2
            return { element, rect, style, lineHeight }
          })
          .filter(({ rect, lineHeight }) => rect.height > lineHeight * 1.45)
          .slice(0, 20)
          .map(({ element, rect, lineHeight }) => ({
            selector: keyName(element),
            text: text(element).slice(0, 100),
            height: Math.round(rect.height),
            expectedLineHeight: Math.round(lineHeight)
          }))

        const activeControls = [...document.querySelectorAll('button.active, .nav-button.active')].filter(visible).map(element => {
          const style = getComputedStyle(element)
          return {
            selector: keyName(element),
            text: text(element),
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            borderColor: style.borderColor,
            appearance: style.appearance || style.webkitAppearance
          }
        })
        const whiteActive = activeControls.filter(item => /rgb\(255,\s*255,\s*255\)|rgb\(255,\s*254,\s*250\)/.test(item.backgroundColor) && (!item.backgroundImage || item.backgroundImage === 'none'))
        const nativeControls = [...document.querySelectorAll('select, input[type="checkbox"]')].filter(visible).map(element => {
          const style = getComputedStyle(element)
          return {
            selector: keyName(element),
            type: element.getAttribute('type') || element.tagName.toLowerCase(),
            text: text(element).slice(0, 80),
            appearance: style.appearance || style.webkitAppearance,
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage
          }
        })
        const nativeRisk = nativeControls.filter(item => item.appearance !== 'none')
        const screenTop = document.querySelector('.screen, .home-screen')?.getBoundingClientRect().top ?? 0
        const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect()
        const lastMeaningful = [...document.querySelectorAll('.ledger-item, .report-card, .settings-card, .month-card')].filter(visible).at(-1)?.getBoundingClientRect()
        const nearBottom = viewport.scrollY + viewport.height >= viewport.scrollHeight - 8
        const navOverlapRisk = nearBottom && nav && lastMeaningful && lastMeaningful.bottom > nav.top && lastMeaningful.top < nav.bottom
        return {
          label,
          viewport,
          activeNav: text(document.querySelector('.nav-button.active')),
          header: text(document.querySelector('.page-header h1, .app-header h1')),
          activeControls,
          whiteActive,
          nativeControls,
          nativeRisk,
          offscreen,
          overflowRisks,
          wrapRisks,
          horizontalScroll: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          safeTop: Math.round(screenTop),
          navOverlapRisk: !!navOverlapRisk,
          visibleLedgerRows: document.querySelectorAll('.ledger-item').length,
          visibleTrendBars: [...document.querySelectorAll('.trend-income, .trend-expense')].filter(item => parseFloat(getComputedStyle(item).height) > 0).length
        }
      }, [label])
      report.steps.push({ label, screenshot, ...result })
      for (const item of result.whiteActive) collectIssue(label, { type: 'white-active', detail: item })
      for (const item of result.nativeRisk) collectIssue(label, { type: 'native-control', detail: item })
      for (const item of result.offscreen) collectIssue(label, { type: 'offscreen', detail: item })
      for (const item of result.overflowRisks) collectIssue(label, { type: 'overflow-risk', detail: item })
      for (const item of result.wrapRisks) collectIssue(label, { type: 'amount-or-metric-wrap', detail: item })
      if (result.horizontalScroll > 1) collectIssue(label, { type: 'page-horizontal-scroll', detail: result.horizontalScroll })
      if (result.viewport.scrollY < 2 && result.safeTop < 24) collectIssue(label, { type: 'statusbar-safe-area', detail: result.safeTop })
      if (result.navOverlapRisk) collectIssue(label, { type: 'bottom-nav-overlap', detail: true })
      return result
    }

    await audit('home-initial', 'stress-multi-01-home.png')
    await click('.ai-dock-button')
    await sleep(250)
    await audit('capture-ai-sheet', 'stress-multi-02-capture-ai.png')
    await clickText('.sheet-tabs button', '手动')
    await sleep(250)
    await audit('capture-manual-sheet', 'stress-multi-03-capture-manual.png')
    await click('.icon-button.ghost')
    await sleep(250)

    for (let round = 1; round <= 3; round += 1) {
      await click('.nav-button', 1)
      await sleep(200)
      for (const period of ['今天', '本月', '本年', '所有']) {
        await clickText('.period-tabs button', period)
        await sleep(220)
        await audit(`ledger-round-${round}-${period}`, `stress-multi-ledger-r${round}-${period}.png`)
      }
      for (const type of ['支出', '收入', '全部']) {
        await clickText('.filter-chips button', type)
        await sleep(180)
        await audit(`ledger-round-${round}-filter-${type}`, `stress-multi-ledger-r${round}-filter-${type}.png`)
      }
      await setValue('.search-field input', round === 1 ? '停车' : round === 2 ? '小米14挖孔屏适配' : '不存在的压力搜索词')
      await sleep(260)
      await click('.smart-search-toggle')
      await sleep(180)
      await audit(`ledger-round-${round}-search`, `stress-multi-ledger-r${round}-search.png`)
      const clearCount = await evaluate(() => document.querySelectorAll('.search-clear').length)
      if (clearCount) await click('.search-clear')
      await sleep(160)
    }

    await clickText('.period-tabs button', '所有')
    await sleep(200)
    await evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(400)
    await audit('ledger-all-bottom-before-load-more', 'stress-multi-04-ledger-bottom-before-load.png')
    const loadMoreCount = await evaluate(() => document.querySelectorAll('.load-more-panel button').length)
    if (loadMoreCount) {
      await click('.load-more-panel button')
      await sleep(260)
      await click('.load-more-panel button')
      await sleep(260)
      await audit('ledger-all-after-load-more', 'stress-multi-05-ledger-load-more.png')
    }
    await evaluate(() => window.scrollTo(0, 0))
    await sleep(250)
    const itemCount = await evaluate(() => document.querySelectorAll('.ledger-item-button').length)
    if (itemCount) {
      await click('.ledger-item-button')
      await sleep(260)
      await audit('ledger-edit-sheet-long-row', 'stress-multi-06-ledger-edit-sheet.png')
      await click('.icon-button.ghost')
      await sleep(180)
    }

    await click('.nav-button', 2)
    await sleep(260)
    await audit('stats-month-top', 'stress-multi-07-stats-month.png')
    await clickText('.report-switch button', '年报')
    await sleep(280)
    await audit('stats-year-top', 'stress-multi-08-stats-year.png')
    await evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(300)
    await audit('stats-year-bottom', 'stress-multi-09-stats-year-bottom.png')
    const yearSelectOptions = await evaluate(() => document.querySelector('select')?.options.length || 0)
    if (yearSelectOptions > 1) {
      await evaluate(() => {
        const select = document.querySelector('select')
        select.selectedIndex = Math.min(1, select.options.length - 1)
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await sleep(280)
      await audit('stats-year-select-previous', 'stress-multi-10-stats-prev-year.png')
    }

    await click('.nav-button', 3)
    await sleep(260)
    await audit('settings-top', 'stress-multi-11-settings-top.png')
    await evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(300)
    await audit('settings-bottom', 'stress-multi-12-settings-bottom.png')

    const appPid = adbText(['shell', 'pidof', '-s', packageName]).trim()
    const log = appPid ? adbText(['logcat', '-d', '--pid', appPid]) : ''
    const logFile = resolve(qaDir, 'stress-multi-logcat.txt')
    writeFileSync(logFile, log)
    const fatalOrJsErrors = log.split(/\r?\n/).filter(line => /FATAL EXCEPTION|AndroidRuntime|TypeError|ReferenceError|Uncaught/i.test(line)).slice(-80)
    report.logcat = { logFile, appPid, fatalOrJsErrors }
    for (const line of fatalOrJsErrors) collectIssue('logcat', { type: 'fatal-or-js-error', detail: line })
  } finally {
    await evaluate(snapshot => {
      if (snapshot.store === null) localStorage.removeItem('jiyixia-store')
      else localStorage.setItem('jiyixia-store', snapshot.store)
      if (snapshot.apiKey === null) localStorage.removeItem('jiyixia-ai-api-key')
      else localStorage.setItem('jiyixia-ai-api-key', snapshot.apiKey)
      location.reload()
      return true
    }, [snapshot]).catch(() => null)
    ws.close()
  }

  report.summary = {
    steps: report.steps.length,
    issueCount: report.issues.length,
    issueTypes: report.issues.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1
      return acc
    }, {})
  }
  const reportPath = resolve(qaDir, 'android-stress-ui-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.summary, null, 2))
}

await main()
