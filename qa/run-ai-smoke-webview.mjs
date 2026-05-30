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
const smokeInput = process.env.AI_SMOKE_INPUT || '停车12，午饭18'

function adbFile(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args])
}

function adbText(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args], { encoding: 'utf8' })
}

function saveScreenshot(name) {
  const file = resolve(qaDir, name)
  writeFileSync(file, adbFile(['exec-out', 'screencap', '-p']))
  return file
}

function findWebviewSocket() {
  const unix = adbText(['shell', 'cat', '/proc/net/unix'])
  const sockets = [...unix.matchAll(/@?(webview_devtools_remote_\d+)/g)].map(match => match[1])
  if (!sockets.length) throw new Error('No WebView devtools socket found')
  return sockets[sockets.length - 1]
}

function readStdin(timeoutMs = 250) {
  return new Promise((resolve, reject) => {
    let data = ''
    let done = false
    const finish = () => {
      if (done) return
      done = true
      process.stdin.pause()
      resolve(data.trim())
    }
    const timer = setTimeout(finish, timeoutMs)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
      if (data.includes('\n')) finish()
    })
    process.stdin.on('end', () => {
      clearTimeout(timer)
      finish()
    })
    process.stdin.on('error', reject)
  })
}

async function connectPage() {
  const socket = findWebviewSocket()
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
    const { resolveMessage, rejectMessage } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) rejectMessage(new Error(JSON.stringify(message.error)))
    else resolveMessage(message.result)
  })

  const send = (method, params = {}) => new Promise((resolveMessage, rejectMessage) => {
    const messageId = ++id
    pending.set(messageId, { resolveMessage, rejectMessage })
    ws.send(JSON.stringify({ id: messageId, method, params }))
  })

  return { ws, send }
}

const { ws, send } = await connectPage()
await send('Runtime.enable')

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
  return result.result?.value ?? null
}

const apiKey = (process.env.MINIMAX_API_KEY || await readStdin()).trim()
const prepared = await evaluate(`
  (() => {
    const key = ${JSON.stringify(apiKey)};
    if (key) localStorage.setItem('jiyixia-ai-api-key', key);
    const rawStore = localStorage.getItem('jiyixia-store');
    if (rawStore) {
      const store = JSON.parse(rawStore);
      if (store?.state) {
        store.state.drafts = [];
        localStorage.setItem('jiyixia-store', JSON.stringify(store));
      }
    }
    setTimeout(() => location.reload(), 120);
    return {
      hadStore: !!rawStore,
      keyStored: localStorage.getItem('jiyixia-ai-api-key')?.length > 0
    };
  })()
`)

if (!prepared.keyStored) throw new Error('API key is required on stdin or in WebView localStorage.')

await new Promise(resolve => setTimeout(resolve, 1400))

const report = await evaluate(`
  (async () => {
    const input = ${JSON.stringify(smokeInput)};
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const text = el => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
    const setNativeValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const getStore = () => JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state || {};
    const beforeStore = getStore();
    const beforeTransactionCount = beforeStore.transactions?.length || 0;
    const started = performance.now();

    document.querySelectorAll('.nav-button')[0]?.click();
    await sleep(300);
    document.querySelector('.ai-dock-button')?.click();
    await sleep(300);
    const textarea = document.querySelector('.sheet-ai textarea');
    if (!textarea) return { ok: false, error: 'AI sheet textarea not found' };
    setNativeValue(textarea, input);
    await sleep(100);
    document.querySelector('.sheet-ai .primary-button')?.click();

    let errorText = '';
    for (let i = 0; i < 120; i += 1) {
      await sleep(500);
      const inlineError = document.querySelector('.sheet-ai .inline-error');
      errorText = text(inlineError);
      if (errorText) break;
      if ((getStore().drafts?.length || 0) > 0) break;
    }

    const afterDraftStore = getStore();
    const draftDetails = (afterDraftStore.drafts || []).map(draft => ({
      type: draft.type,
      amountCents: draft.amountCents,
      categoryId: draft.categoryId,
      subcategoryId: draft.subcategoryId,
      warnings: draft.warnings || [],
      status: draft.status
    }));

    const firstConfirm = document.querySelector('.draft-card .small-button.success');
    if (firstConfirm) {
      firstConfirm.click();
      await sleep(600);
    }

    const afterConfirmStore = getStore();
    return {
      ok: !errorText && draftDetails.length > 0,
      input,
      elapsedMs: Math.round(performance.now() - started),
      errorText,
      draftCountBeforeConfirm: draftDetails.length,
      draftDetails,
      transactionCountBefore: beforeTransactionCount,
      transactionCountAfterConfirm: afterConfirmStore.transactions?.length || 0,
      draftCountAfterConfirm: afterConfirmStore.drafts?.length || 0,
      officialRowsVisible: document.querySelectorAll('.ledger-item').length,
      keyStored: localStorage.getItem('jiyixia-ai-api-key')?.length > 0
    };
  })()
`)

const draftScreenshot = saveScreenshot('ai-smoke-after-confirm.png')
const finalReport = {
  createdAt: new Date().toISOString(),
  prepared,
  ...report,
  screenshot: draftScreenshot
}

writeFileSync(resolve(qaDir, 'ai-smoke-report.json'), JSON.stringify(finalReport, null, 2))
ws.close()
console.log(JSON.stringify(finalReport, null, 2))
