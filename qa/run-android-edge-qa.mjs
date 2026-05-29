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
  summary: { total: 0, passed: 0, failed: 0 },
  steps: [],
  screenshots: []
}

function adbFile(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args])
}

function adbText(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args], { encoding: 'utf8' })
}

function saveScreenshot(name) {
  const file = resolve(qaDir, name)
  writeFileSync(file, adbFile(['exec-out', 'screencap', '-p']))
  report.screenshots.push(file)
  return file
}

async function retry(fn, attempts = 25, delayMs = 300) {
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  adbText(['logcat', '-c'])
  adbText(['shell', 'am', 'force-stop', packageName])
  adbText(['shell', 'am', 'start', '-n', activityName])
  await sleep(1600)

  const { ws, send } = await connectPage()
  await send('Runtime.enable')

  async function evaluate(fn, args = [], timeoutMs = 30000) {
    const result = await send('Runtime.evaluate', {
      expression: `(${fn})(...${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true
    }, timeoutMs)
    if (result.exceptionDetails) {
      const exception = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed'
      throw new Error(exception)
    }
    return result.result?.value ?? null
  }

  async function step(name, fn) {
    report.summary.total += 1
    try {
      const detail = await fn()
      report.summary.passed += 1
      report.steps.push({ name, ok: true, detail })
    } catch (error) {
      report.summary.failed += 1
      report.steps.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  async function waitForText(text, timeoutMs = 12000) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const found = await evaluate(value => document.body.innerText.includes(value), [text]).catch(() => false)
      if (found) return true
      await sleep(300)
    }
    throw new Error(`Timed out waiting for ${text}`)
  }

  async function waitForCompositor() {
    await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))), [], 3000).catch(() => null)
    await sleep(500)
  }

  async function click(selector, index = 0) {
    return evaluate((selector, index) => {
      const element = document.querySelectorAll(selector)[index]
      if (!element) throw new Error(`Missing ${selector}[${index}]`)
      element.click()
      return (element.textContent || element.getAttribute('aria-label') || selector).replace(/\s+/g, ' ').trim()
    }, [selector, index])
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
    await waitForText('一句话快记')

    await step('空账本首页与流水空状态', async () => {
      const detail = await evaluate(() => {
        const store = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')
        const state = store.state || {}
        state.transactions = []
        state.drafts = []
        state.importSummary = undefined
        state.settings = {
          ...state.settings,
          privacy: { hideAmounts: false }
        }
        localStorage.setItem('jiyixia-store', JSON.stringify({ ...store, state }))
        location.reload()
        return { categories: state.categories?.length || 0 }
      })
      await waitForText('一句话快记')
      await waitForCompositor()
      const homeText = await evaluate(() => document.body.innerText)
      assert(homeText.includes('还没有正式流水') || homeText.includes('先记第一笔'), 'Home empty state was not visible')
      await click('.nav-button', 1)
      await waitForText('流水')
      const ledgerText = await evaluate(() => document.body.innerText)
      assert(ledgerText.includes('还没有流水') || ledgerText.includes('0 条'), 'Ledger empty state was not visible')
      saveScreenshot('edge-01-empty-ledger.png')
      return detail
    })

    await step('手动记账边界：空金额禁用、长文本保存、金额精度', async () => {
      await click('.nav-button', 0)
      await waitForText('一句话快记')
      await click('.manual-dock-button')
      await waitForText('手动记一笔')
      const disabled = await evaluate(() => document.querySelector('.compact-form .primary-button')?.disabled === true)
      assert(disabled, 'Submit button should stay disabled when amount is empty')
      await setValue('.amount-input', '123456789.12')
      await setValue('input[placeholder="账户"]', '招商银行测试账户')
      await setValue('input[placeholder="商家"]', '超长商户名称用于测试手机端布局是否稳定'.repeat(3))
      await setValue('.compact-form textarea', '超长备注用于测试换行、省略、按钮与底部安全区是否互相遮挡。'.repeat(4))
      await click('.compact-form .primary-button')
      await waitForText('¥ 1.23亿')
      const state = await evaluate(() => {
        const app = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state || {}
        const latest = app.transactions?.[0]
        return {
          count: app.transactions?.length || 0,
          latestAmount: latest?.amountCents,
          latestMerchantLength: latest?.merchant?.length || 0,
          latestNoteLength: latest?.note?.length || 0
        }
      })
      assert(state.count === 1, `Expected 1 manual transaction, got ${state.count}`)
      assert(state.latestAmount === 12345678912, `Amount cents mismatch: ${state.latestAmount}`)
      assert(state.latestMerchantLength > 40 && state.latestNoteLength > 80, 'Long merchant/note were not saved')
      saveScreenshot('edge-02-long-manual-saved.png')
      return state
    })

    await step('隐私隐藏金额并在刷新后保持', async () => {
      await click('.nav-button', 3)
      await waitForText('设置')
      await evaluate(() => document.querySelector('.toggle-row input')?.click())
      await click('.nav-button', 0)
      await waitForText('¥ ****')
      const beforeReload = await evaluate(() => ({
        hiddenTextCount: (document.body.innerText.match(/¥ \*\*\*\*/g) || []).length,
        privacy: JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state?.settings?.privacy?.hideAmounts
      }))
      assert(beforeReload.privacy === true, 'Privacy setting did not persist to store')
      assert(beforeReload.hiddenTextCount >= 3, 'Hidden amount mask was not visible on home')
      await evaluate(() => location.reload())
      await waitForText('¥ ****')
      const afterReload = await evaluate(() => ({
        hiddenTextCount: (document.body.innerText.match(/¥ \*\*\*\*/g) || []).length,
        privacy: JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state?.settings?.privacy?.hideAmounts
      }))
      assert(afterReload.privacy === true && afterReload.hiddenTextCount >= 3, 'Privacy setting did not survive reload')
      saveScreenshot('edge-03-privacy-hidden.png')
      return { beforeReload, afterReload }
    })

    await step('JSON 备份恢复与清空确认保护', async () => {
      await click('.nav-button', 3)
      await waitForText('设置')
      const backupText = await evaluate(() => {
        const state = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state || {}
        return JSON.stringify({
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          transactions: state.transactions || [],
          categories: state.categories || [],
          drafts: state.drafts || [],
          settings: state.settings,
          importSummary: state.importSummary
        })
      })
      await evaluate(() => {
        const originalConfirm = window.confirm
        window.confirm = () => false
        document.querySelector('.danger-button')?.click()
        window.confirm = originalConfirm
      })
      const afterCancel = await evaluate(() => JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state?.transactions?.length || 0)
      assert(afterCancel === 1, 'Canceling reset should preserve transactions')
      await evaluate(() => {
        const originalConfirm = window.confirm
        window.confirm = () => true
        document.querySelector('.danger-button')?.click()
        window.confirm = originalConfirm
      })
      await sleep(300)
      const afterReset = await evaluate(() => JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state?.transactions?.length || 0)
      assert(afterReset === 0, 'Confirmed reset did not clear transactions')
      const restored = await evaluate((backupText) => new Promise(resolve => {
        const input = [...document.querySelectorAll('input[type="file"]')].find(item => item.accept === '.json')
        const file = new File([backupText], 'edge-backup.json', { type: 'application/json' })
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(file)
        Object.defineProperty(input, 'files', { configurable: true, value: dataTransfer.files })
        input.dispatchEvent(new Event('change', { bubbles: true }))
        setTimeout(() => {
          const state = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state || {}
          resolve({
            transactions: state.transactions?.length || 0,
            notice: document.body.innerText.includes('备份已恢复')
          })
        }, 500)
      }), [backupText])
      assert(restored.transactions === 1, 'Backup restore did not restore the transaction')
      assert(restored.notice, 'Backup restore notice was not visible')
      saveScreenshot('edge-04-backup-restore.png')
      return restored
    })

    await step('AI 失败保护：无效密钥不入账、不清空输入', async () => {
      await evaluate(() => localStorage.setItem('jiyixia-ai-api-key', 'qa-invalid-key'))
      await click('.nav-button', 0)
      await waitForText('一句话快记')
      await click('.ai-dock-button')
      await waitForText('一句话快记')
      await setValue('.sheet-ai textarea', '停车12，午饭18，红包88.66')
      const before = await evaluate(() => {
        const state = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state || {}
        return { transactions: state.transactions?.length || 0, drafts: state.drafts?.length || 0 }
      })
      await click('.sheet-ai .primary-button')
      const result = await retry(async () => {
        const detail = await evaluate(() => {
          const state = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state || {}
          return {
            error: document.querySelector('.inline-error')?.textContent || '',
            textarea: document.querySelector('.sheet-ai textarea')?.value || '',
            transactions: state.transactions?.length || 0,
            drafts: state.drafts?.length || 0
          }
        })
        if (!detail.error) throw new Error('Waiting for AI error')
        return detail
      }, 90, 500)
      assert(result.textarea.includes('停车12'), 'AI input was cleared after failure')
      assert(result.transactions === before.transactions, 'AI failure changed transaction count')
      assert(result.drafts === before.drafts, 'AI failure created drafts')
      saveScreenshot('edge-05-ai-failure-protection.png')
      return result
    })

    await step('视觉与移动端控件审计：无原生 select、无明显横向溢出、触控尺寸合格', async () => {
      const audit = await evaluate(() => {
        const overflow = [...document.querySelectorAll('body *')]
          .filter(element => {
            const rect = element.getBoundingClientRect()
            if (rect.width <= 1 || rect.height <= 1) return false
            if (element.tagName === 'HTML' || element.tagName === 'BODY') return false
            const style = getComputedStyle(element)
            if (['hidden', 'auto', 'scroll'].includes(style.overflowX)) return false
            if (style.textOverflow === 'ellipsis') return false
            return element.scrollWidth - element.clientWidth > 3
          })
          .slice(0, 12)
          .map(element => ({
            tag: element.tagName.toLowerCase(),
            className: String(element.className || ''),
            text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth
          }))
        const touchSelectors = [
          '.nav-button',
          '.nav-capture',
          '.primary-button',
          '.secondary-button',
          '.danger-button',
          '.ai-dock-button',
          '.manual-dock-button',
          '.period-tabs button',
          '.filter-chips button',
          '.sheet-tabs button'
        ]
        const smallTargets = touchSelectors.flatMap(selector => [...document.querySelectorAll(selector)].map(element => {
          const rect = element.getBoundingClientRect()
          return { selector, width: Math.round(rect.width), height: Math.round(rect.height), text: (element.textContent || element.getAttribute('aria-label') || '').trim() }
        })).filter(item => item.width < 44 || item.height < 36)
        const whiteActive = [...document.querySelectorAll('.active')].filter(element => {
          const style = getComputedStyle(element)
          return ['rgb(255, 255, 255)', 'rgba(255, 255, 255, 1)'].includes(style.backgroundColor) && style.backgroundImage === 'none'
        }).map(element => (element.textContent || '').trim())
        return {
          selectCount: document.querySelectorAll('select').length,
          overflow,
          smallTargets,
          whiteActive
        }
      })
      assert(audit.selectCount === 0, `Native select count should be 0, got ${audit.selectCount}`)
      assert(audit.overflow.length === 0, `Found horizontal overflow: ${JSON.stringify(audit.overflow.slice(0, 3))}`)
      assert(audit.smallTargets.length === 0, `Found small touch targets: ${JSON.stringify(audit.smallTargets.slice(0, 3))}`)
      assert(audit.whiteActive.length === 0, `Found white active states: ${audit.whiteActive.join(', ')}`)
      return audit
    })
  } finally {
    await evaluate((snapshot) => {
      if (snapshot.store) localStorage.setItem('jiyixia-store', snapshot.store)
      else localStorage.removeItem('jiyixia-store')
      if (snapshot.apiKey) localStorage.setItem('jiyixia-ai-api-key', snapshot.apiKey)
      else localStorage.removeItem('jiyixia-ai-api-key')
      location.reload()
      return true
    }, [snapshot]).catch(() => null)
    ws.close()
  }

  report.device = {
    serial,
    wmSize: adbText(['shell', 'wm', 'size']).trim(),
    wmDensity: adbText(['shell', 'wm', 'density']).trim()
  }
  report.logFile = resolve(qaDir, 'edgeqa-logcat.txt')
  writeFileSync(report.logFile, adbText(['logcat', '-d']))
  writeFileSync(resolve(qaDir, 'android-edge-qa-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))

  if (report.summary.failed > 0) process.exitCode = 1
}

main().catch(error => {
  report.summary.failed += 1
  report.steps.push({ name: 'edge qa runner', ok: false, error: error instanceof Error ? error.message : String(error) })
  writeFileSync(resolve(qaDir, 'android-edge-qa-report.json'), JSON.stringify(report, null, 2))
  console.error(JSON.stringify(report, null, 2))
  process.exitCode = 1
})
