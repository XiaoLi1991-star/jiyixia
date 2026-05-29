import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const qaDir = resolve(root, 'qa')
mkdirSync(qaDir, { recursive: true })

const adb = process.env.ADB || 'C:\\Users\\zhujianhua\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe'
const serial = process.env.ADB_SERIAL || 'emulator-5554'
const adbPort = process.env.ADB_PORT || '5038'
const devtoolsPort = process.env.DEVTOOLS_PORT || '9222'
const skillDir = 'C:\\Users\\zhujianhua\\.codex\\plugins\\cache\\openai-curated\\test-android-apps\\acdd3141\\skills\\android-emulator-qa'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = []
const screenshots = []

function pass(name, detail = {}) {
  results.push({ name, ok: true, detail })
}

function fail(name, error, detail = {}) {
  results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error), detail })
}

async function step(name, fn) {
  try {
    const detail = await fn()
    pass(name, detail)
    return detail
  } catch (error) {
    fail(name, error)
    return null
  }
}

function adbFile(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args])
}

function adbText(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args], { encoding: 'utf8' })
}

async function adbTextRetry(args, attempts = 3) {
  let lastError
  for (let index = 0; index < attempts; index += 1) {
    try {
      return adbText(args)
    } catch (error) {
      lastError = error
      await sleep(500)
    }
  }
  throw lastError
}

function saveScreenshot(name) {
  const file = resolve(qaDir, name)
  const image = adbFile(['exec-out', 'screencap', '-p'])
  writeFileSync(file, image)
  screenshots.push(file)
  return file
}

function countContentDarkPixels(image) {
  const pngSignature = '89504e470d0a1a0a'
  if (image.subarray(0, 8).toString('hex') !== pngSignature) return 0
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const chunks = []
  while (offset < image.length) {
    const length = image.readUInt32BE(offset)
    const type = image.subarray(offset + 4, offset + 8).toString('ascii')
    const data = image.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      chunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || !width || !height || !chunks.length) return 0
  const bytesPerPixel = colorType === 6 ? 4 : 3
  const stride = width * bytesPerPixel
  const raw = inflateSync(Buffer.concat(chunks))
  let rawOffset = 0
  let previous = Buffer.alloc(stride)
  let darkPixels = 0
  const top = Math.round(height * 0.08)
  const bottom = Math.round(height * 0.84)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset]
    rawOffset += 1
    const source = raw.subarray(rawOffset, rawOffset + stride)
    rawOffset += stride
    const row = Buffer.alloc(stride)
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0
      const up = previous[x] || 0
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] || 0 : 0
      let value = source[x]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += Math.floor((left + up) / 2)
      else if (filter === 4) value += paeth(left, up, upLeft)
      row[x] = value & 255
    }
    if (y >= top && y <= bottom) {
      for (let x = 0; x < width; x += 4) {
        const pixel = x * bytesPerPixel
        const r = row[pixel]
        const g = row[pixel + 1]
        const b = row[pixel + 2]
        if (r < 75 && g < 85 && b < 85) darkPixels += 1
      }
    }
    previous = row
  }
  return darkPixels
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  if (upDistance <= upLeftDistance) return up
  return upLeft
}

async function saveRenderedScreenshot(name, attempts = 6) {
  const file = resolve(qaDir, name)
  let darkPixels = 0
  for (let index = 0; index < attempts; index += 1) {
    const image = adbFile(['exec-out', 'screencap', '-p'])
    darkPixels = countContentDarkPixels(image)
    writeFileSync(file, image)
    if (darkPixels > 2500) {
      screenshots.push(file)
      return file
    }
    await sleep(500)
  }
  throw new Error(`Screenshot still looks blank after ${attempts} attempts (${darkPixels} dark content pixels)`)
}

async function findWebviewSocket() {
  for (let index = 0; index < 20; index += 1) {
    const unix = adbText(['shell', 'cat', '/proc/net/unix'])
    const sockets = [...unix.matchAll(/@?(webview_devtools_remote_\d+)/g)].map(match => match[1])
    if (sockets.length) return sockets[sockets.length - 1]
    await sleep(500)
  }
  throw new Error('No WebView devtools socket found')
}

async function connectPage() {
  const socket = await findWebviewSocket()
  execFileSync(adb, ['-P', adbPort, '-s', serial, 'forward', `tcp:${devtoolsPort}`, `localabstract:${socket}`])
  const targets = await fetch(`http://127.0.0.1:${devtoolsPort}/json`).then(res => res.json())
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

  const send = (method, params = {}, timeoutMs = 20000) => new Promise((resolveMessage, rejectMessage) => {
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

async function main() {
  await adbTextRetry(['shell', 'am', 'force-stop', 'com.jiyixia.app'])
  await adbTextRetry(['shell', 'am', 'start', '-n', 'com.jiyixia.app/.MainActivity'])
  await sleep(1800)

  const { ws, send } = await connectPage()
  await send('Runtime.enable')

  async function evaluate(fn, args = [], timeoutMs = 20000) {
    const result = await send('Runtime.evaluate', {
      expression: `(${fn})(...${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true
    }, timeoutMs)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
    return result.result?.value ?? null
  }

  const snapshot = await evaluate(() => ({
    store: localStorage.getItem('jiyixia-store'),
    apiKey: localStorage.getItem('jiyixia-ai-api-key')
  }))

  const getState = () => evaluate(() => {
    const store = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state || {}
    return {
      tx: store.transactions?.length || 0,
      drafts: store.drafts?.length || 0,
      hidden: !!store.settings?.privacy?.hideAmounts,
      timeoutMs: store.settings?.model?.timeoutMs,
      activeNav: document.querySelector('.nav-button.active')?.textContent?.trim() || '',
      header: document.querySelector('.page-header h1, .app-header h1')?.textContent || '',
      sheetTitle: document.querySelector('.capture-sheet h2')?.textContent || '',
      bodyText: document.body.innerText
    }
  })

  const click = (selector, index = 0) => evaluate((selector, index) => {
    const element = document.querySelectorAll(selector)[index]
    if (!element) throw new Error(`Missing ${selector}[${index}]`)
    element.click()
    return element.textContent?.replace(/\s+/g, ' ').trim() || element.getAttribute('aria-label') || selector
  }, [selector, index])

  const clickText = (selector, text) => evaluate((selector, text) => {
    const element = [...document.querySelectorAll(selector)].find(item => (item.textContent || '').includes(text))
    if (!element) throw new Error(`Missing ${selector} containing ${text}`)
    element.click()
    return element.textContent?.replace(/\s+/g, ' ').trim() || text
  }, [selector, text])

  const setValue = (selector, value, index = 0) => evaluate((selector, value, index) => {
    const element = document.querySelectorAll(selector)[index]
    if (!element) throw new Error(`Missing ${selector}[${index}]`)
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return value
  }, [selector, value, index])

  async function waitForPageText(text, timeoutMs = 12000) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const visible = await evaluate((text) => document.body.innerText.includes(text), [text]).catch(() => false)
      if (visible) return true
      await sleep(300)
    }
    throw new Error(`Timed out waiting for ${text}`)
  }

  async function waitForCompositor() {
    await evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }), [], 3000).catch(() => null)
    await sleep(800)
  }

  await waitForPageText('首页')
  await waitForPageText('一句话快记')

  await step('启动与首页渲染', async () => {
    const state = await getState()
    await waitForCompositor()
    const screenshot = await saveRenderedScreenshot('fullqa-01-home.png')
    if (!state.bodyText.includes('一句话快记')) throw new Error('Home quick entry missing')
    return { activeNav: state.activeNav, tx: state.tx, screenshot }
  })

  await step('底部导航逐项切换', async () => {
    const pages = []
    for (const index of [1, 2, 3, 0]) {
      await click('.nav-button', index)
      await sleep(350)
      const state = await getState()
      pages.push({ index, activeNav: state.activeNav, header: state.header })
      saveScreenshot(`fullqa-02-nav-${index}.png`)
    }
    if (!pages.some(item => item.header === '流水')) throw new Error('Ledger page not reached')
    if (!pages.some(item => item.header === '统计')) throw new Error('Stats page not reached')
    if (!pages.some(item => item.header === '设置')) throw new Error('Settings page not reached')
    return { pages }
  })

  await step('流水页周期、搜索、智能搜索、类型筛选', async () => {
    await click('.nav-button', 1)
    await sleep(300)
    const periods = []
    for (const label of ['今天', '本月', '本年', '所有']) {
      await clickText('.period-tabs button', label)
      await sleep(180)
      periods.push(await evaluate((label) => ({
        label,
        subtitle: document.querySelector('.page-header p')?.textContent || '',
        active: document.querySelector('.period-tabs button.active')?.textContent?.trim() || ''
      }), [label]))
    }
    await setValue('.search-field input', '午餐')
    await sleep(250)
    const searchOn = await evaluate(() => ({
      subtitle: document.querySelector('.page-header p')?.textContent || '',
      note: document.querySelector('.ai-search-note')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      rows: document.querySelectorAll('.ledger-item').length
    }))
    await click('.smart-search-toggle')
    await sleep(180)
    const searchOff = await evaluate(() => ({
      noteVisible: !!document.querySelector('.ai-search-note'),
      active: document.querySelector('.smart-search-toggle')?.classList.contains('active')
    }))
    await clickText('.filter-chips button', '支出')
    await sleep(180)
    const expenseRows = await evaluate(() => document.querySelectorAll('.ledger-item').length)
    await clickText('.filter-chips button', '收入')
    await sleep(180)
    const incomeRows = await evaluate(() => document.querySelectorAll('.ledger-item').length)
    await click('.search-clear')
    await sleep(180)
    saveScreenshot('fullqa-03-ledger-filtered.png')
    if (!searchOn.subtitle.includes('匹配')) throw new Error('Search did not update subtitle')
    return { searchOn, searchOff, expenseRows, incomeRows, periodsTested: ['今天', '本月', '本年', '所有'] }
  })

  await step('手动新增、编辑、删除流水', async () => {
    await click('.nav-button', 1)
    await sleep(250)
    await clickText('.period-tabs button', '所有')
    await clickText('.filter-chips button', '全部')
    await sleep(150)
    await click('.nav-capture')
    await sleep(300)
    await setValue('.amount-input', '12.34')
    await setValue('input[placeholder="商家"]', 'QA商户')
    await setValue('textarea[placeholder="备注"]', 'QA临时流水')
    const before = await getState()
    const beforeIds = await evaluate(() => new Set((JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state?.transactions || []).map(item => item.id)).size)
    await clickText('.primary-button', '加入流水')
    await sleep(450)
    const afterAdd = await getState()
    if (afterAdd.tx !== before.tx + 1) throw new Error(`Manual add failed: ${before.tx} -> ${afterAdd.tx}`)
    const added = await evaluate(() => {
      const transactions = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state?.transactions || []
      return transactions.find(item => item.merchant === 'QA商户' && item.note === 'QA临时流水')
    })
    if (!added?.id) throw new Error(`Added transaction not found; before id count ${beforeIds}`)
    await click('.nav-button', 1)
    await sleep(300)
    await clickText('.period-tabs button', '所有')
    await clickText('.filter-chips button', '全部')
    await sleep(150)
    await evaluate((id) => {
      const transactions = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state?.transactions || []
      const tx = transactions.find(item => item.id === id)
      const target = [...document.querySelectorAll('.ledger-item-button')]
        .find(item => tx && item.textContent?.includes(tx.merchant) && item.textContent?.includes(tx.note))
      if (!target) throw new Error(`Added transaction row not visible: ${id}`)
      target.click()
      return true
    }, [added.id])
    await sleep(300)
    await setValue('.amount-input', '56.78')
    await setValue('textarea[placeholder="备注"]', 'QA已编辑')
    await clickText('.primary-button', '保存修改')
    await sleep(350)
    const edited = await evaluate((id) => {
      const tx = (JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state?.transactions || []).find(item => item.id === id)
      return { amountCents: tx?.amountCents, note: tx?.note }
    }, [added.id])
    if (edited.amountCents !== 5678 || edited.note !== 'QA已编辑') throw new Error('Edit did not persist')
    await evaluate((id) => {
      const transactions = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state?.transactions || []
      const tx = transactions.find(item => item.id === id)
      const target = [...document.querySelectorAll('.ledger-item-button')]
        .find(item => tx && item.textContent?.includes(tx.merchant) && item.textContent?.includes(tx.note))
      if (!target) throw new Error(`Edited transaction row not visible: ${id}`)
      target.click()
      return true
    }, [added.id])
    await sleep(250)
    await evaluate(() => {
      window.__qaConfirmMessages = []
      window.confirm = message => {
        window.__qaConfirmMessages.push(message)
        return true
      }
      return true
    })
    await clickText('.danger-button', '删除流水')
    await sleep(350)
    const afterDelete = await getState()
    if (afterDelete.tx !== before.tx) throw new Error(`Delete failed: expected ${before.tx}, got ${afterDelete.tx}`)
    return { before: before.tx, afterAdd: afterAdd.tx, afterDelete: afterDelete.tx, edited }
  })

  await step('快速入账 Sheet、AI 失败保护和草稿安全', async () => {
    await click('.nav-button', 0)
    await sleep(250)
    await evaluate(() => {
      const raw = localStorage.getItem('jiyixia-store')
      const store = JSON.parse(raw)
      store.state.settings.model.timeoutMs = 1200
      store.state.drafts = []
      localStorage.setItem('jiyixia-store', JSON.stringify(store))
      localStorage.setItem('jiyixia-ai-api-key', 'qa-dummy-key')
      return true
    })
    await click('.ai-dock-button')
    await sleep(250)
    await clickText('.quick-chips button', '停车12')
    await sleep(120)
    const before = await getState()
    await clickText('.primary-button', '生成待确认草稿')
    await sleep(3200)
    const after = await getState()
    const error = await evaluate(() => document.querySelector('.inline-error')?.textContent || '')
    await click('.icon-button.ghost')
    await sleep(200)
    if (!error) throw new Error('AI failure did not show an error')
    if (after.tx !== before.tx || after.drafts !== 0) throw new Error('AI failure changed ledger data')
    return { error, tx: after.tx, drafts: after.drafts }
  })

  await step('统计页月报、年报、年月控件', async () => {
    await click('.nav-button', 2)
    await sleep(300)
    saveScreenshot('fullqa-04-stats-month.png')
    const month = await evaluate(() => ({
      active: document.querySelector('.report-switch button.active')?.textContent || '',
      metrics: [...document.querySelectorAll('.metric strong')].map(item => item.textContent)
    }))
    await clickText('.report-switch button', '年报')
    await sleep(300)
    saveScreenshot('fullqa-05-stats-year.png')
    const year = await evaluate(() => ({
      active: document.querySelector('.report-switch button.active')?.textContent || '',
      months: document.querySelectorAll('.trend-month').length,
      ranks: [...document.querySelectorAll('.rank-list h3')].map(item => item.textContent)
    }))
    if (month.active !== '月报') throw new Error('Month report tab not active')
    if (year.active !== '年报' || year.months !== 12) throw new Error('Year report did not render 12 months')
    return { month, year }
  })

  await step('设置页保存密钥、隐藏金额、导出、导入控件、清空保护', async () => {
    await click('.nav-button', 3)
    await sleep(250)
    saveScreenshot('fullqa-06-settings.png')
    await setValue('input[type="password"]', 'qa-temp-key')
    await clickText('.primary-button', '保存密钥')
    await sleep(200)
    const notice = await evaluate(() => document.querySelector('.notice')?.textContent || '')
    await evaluate(() => {
      window.__qaExport = { clicked: false, objectUrlCreated: false }
      URL.createObjectURL = () => {
        window.__qaExport.objectUrlCreated = true
        return 'blob:qa'
      }
      URL.revokeObjectURL = () => true
      HTMLAnchorElement.prototype.click = function () {
        window.__qaExport.clicked = true
      }
      return true
    })
    await clickText('.secondary-button', '导出 JSON 备份')
    await sleep(150)
    const exportState = await evaluate(() => window.__qaExport)
    await click('input[type="checkbox"]')
    await sleep(180)
    const hiddenOn = await getState()
    await evaluate(() => {
      window.__qaConfirmMessages = []
      window.confirm = message => {
        window.__qaConfirmMessages.push(message)
        return false
      }
      return true
    })
    const before = hiddenOn.tx
    await clickText('.danger-button', '清空本地数据')
    await sleep(200)
    const after = await getState()
    const fileInputs = await evaluate(() => [...document.querySelectorAll('input[type="file"]')].map(item => item.accept))
    if (!notice.includes('已保存')) throw new Error('Save key notice missing')
    if (!exportState?.clicked || !exportState?.objectUrlCreated) throw new Error('Export backup did not trigger')
    if (!hiddenOn.hidden) throw new Error('Hide amounts toggle did not turn on')
    if (after.tx !== before) throw new Error('Reset should have been cancelled')
    return { notice, exportState, fileInputs, resetCancelled: true }
  })

  await step('UI 一致性与选中态审计', async () => {
    const captures = []
    await click('.nav-button', 0)
    await sleep(200)
    captures.push(['home', await evaluate(() => document.body.innerHTML)])
    await click('.nav-button', 1)
    await sleep(200)
    captures.push(['ledger', await evaluate(() => document.body.innerHTML)])
    const ledgerAudit = await evaluate(() => {
      const styleOf = selector => [...document.querySelectorAll(selector)].map(item => {
        const style = getComputedStyle(item)
        return {
          selector,
          text: item.textContent?.replace(/\s+/g, ' ').trim() || item.getAttribute('aria-label') || '',
          tag: item.tagName.toLowerCase(),
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
          appearance: style.appearance || style.webkitAppearance || ''
        }
      })
      return {
        activeControls: [
          ...styleOf('.period-tabs button.active'),
          ...styleOf('.filter-chips button.active'),
          ...styleOf('.nav-button.active')
        ]
      }
    })
    await click('.nav-button', 2)
    await sleep(200)
    const statsAudit = await evaluate(() => {
      const styleOf = selector => [...document.querySelectorAll(selector)].map(item => {
        const style = getComputedStyle(item)
        return {
          selector,
          text: item.textContent?.replace(/\s+/g, ' ').trim() || item.getAttribute('aria-label') || '',
          tag: item.tagName.toLowerCase(),
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
          appearance: style.appearance || style.webkitAppearance || ''
        }
      })
      return {
        activeControls: [
          ...styleOf('.report-switch button.active'),
          ...styleOf('.nav-button.active')
        ],
        selects: styleOf('select')
      }
    })
    await click('.nav-capture')
    await sleep(200)
    const sheetAudit = await evaluate(() => {
      const styleOf = selector => [...document.querySelectorAll(selector)].map(item => {
        const style = getComputedStyle(item)
        return {
          selector,
          text: item.textContent?.replace(/\s+/g, ' ').trim() || item.getAttribute('aria-label') || '',
          tag: item.tagName.toLowerCase(),
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
          appearance: style.appearance || style.webkitAppearance || ''
        }
      })
      return {
        activeControls: [
          ...styleOf('.sheet-tabs button.active')
        ],
        selects: styleOf('select')
      }
    })
    await click('.icon-button.ghost')
    await sleep(150)
    await click('.nav-button', 3)
    await sleep(200)
    const settingsAudit = await evaluate(() => {
      const styleOf = selector => [...document.querySelectorAll(selector)].map(item => {
        const style = getComputedStyle(item)
        return {
          selector,
          text: item.textContent?.replace(/\s+/g, ' ').trim() || item.getAttribute('aria-label') || '',
          tag: item.tagName.toLowerCase(),
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
          appearance: style.appearance || style.webkitAppearance || ''
        }
      })
      return {
        fileLabels: styleOf('.file-button')
      }
    })
    await click('.nav-button', 0)
    await sleep(150)
    const homeAudit = await evaluate(() => ({
      monthSwitchTag: document.querySelector('.month-switch')?.tagName.toLowerCase() || '',
      monthSwitchText: document.querySelector('.month-switch')?.textContent?.replace(/\s+/g, ' ').trim() || ''
    }))
    const activeControls = [
      ...ledgerAudit.activeControls,
      ...statsAudit.activeControls,
      ...sheetAudit.activeControls
    ]
    const whiteActive = activeControls.filter(item => /rgb\(255,\s*254,\s*250\)|rgb\(255,\s*255,\s*255\)/.test(item.backgroundColor))
    return {
      activeControls,
      whiteActiveCount: whiteActive.length,
      whiteActive,
      selects: statsAudit.selects.concat(sheetAudit.selects),
      fileLabels: settingsAudit.fileLabels,
      homeAudit
    }
  })

  await step('Android UI 树与 logcat', async () => {
    const uiXml = resolve(qaDir, 'fullqa-ui.xml')
    const uiSummary = resolve(qaDir, 'fullqa-ui-summary.txt')
    writeFileSync(uiXml, adbText(['exec-out', 'uiautomator', 'dump', '/dev/tty']))
    try {
      const summary = execFileSync('python', [resolve(skillDir, 'scripts', 'ui_tree_summarize.py'), uiXml, uiSummary], { encoding: 'utf8' })
      void summary
    } catch {
      writeFileSync(uiSummary, 'ui_tree_summarize.py unavailable or failed.')
    }
    const appPid = adbText(['shell', 'pidof', '-s', 'com.jiyixia.app']).trim()
    const log = appPid ? adbText(['logcat', '-d', '--pid', appPid]) : ''
    const logFile = resolve(qaDir, 'fullqa-logcat.txt')
    writeFileSync(logFile, log)
    const errorLines = log.split(/\r?\n/).filter(line => /FATAL EXCEPTION|AndroidRuntime|TypeError|ReferenceError|Uncaught/i.test(line)).slice(-50)
    return { uiXml, uiSummary, logFile, appPid, fatalOrJsErrors: errorLines }
  })

  await evaluate((snapshot) => {
    if (snapshot.store === null) localStorage.removeItem('jiyixia-store')
    else localStorage.setItem('jiyixia-store', snapshot.store)
    if (snapshot.apiKey === null) localStorage.removeItem('jiyixia-ai-api-key')
    else localStorage.setItem('jiyixia-ai-api-key', snapshot.apiKey)
    location.reload()
    return true
  }, [snapshot])

  ws.close()

  const report = {
    createdAt: new Date().toISOString(),
    device: {
      serial,
      wmSize: adbText(['shell', 'wm', 'size']).trim(),
      wmDensity: adbText(['shell', 'wm', 'density']).trim()
    },
    summary: {
      total: results.length,
      passed: results.filter(item => item.ok).length,
      failed: results.filter(item => !item.ok).length
    },
    results,
    screenshots
  }
  writeFileSync(resolve(qaDir, 'android-full-qa-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

await main()
