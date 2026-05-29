import { execFileSync } from 'node:child_process'

const adb = process.env.ADB || 'C:\\Users\\zhujianhua\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe'
const serial = process.env.ADB_SERIAL || 'emulator-5554'
const adbPort = process.env.ADB_PORT || '5038'
const devtoolsPort = process.env.DEVTOOLS_PORT || '9222'
const evalTimeoutMs = Number(process.env.EVAL_TIMEOUT_MS || 30000)
const expression = process.argv.slice(2).join(' ')

if (!expression) {
  console.error('Usage: node qa/eval-android-webview.mjs "<javascript expression>"')
  process.exit(1)
}

function adbOut(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args], { encoding: 'utf8' })
}

const unix = adbOut(['shell', 'cat', '/proc/net/unix'])
const sockets = [...unix.matchAll(/@?(webview_devtools_remote_\d+)/g)].map(match => match[1])
if (!sockets.length) throw new Error('No WebView devtools socket found')
execFileSync(adb, ['-P', adbPort, '-s', serial, 'forward', `tcp:${devtoolsPort}`, `localabstract:${sockets[sockets.length - 1]}`])

const targets = await fetch(`http://127.0.0.1:${devtoolsPort}/json`).then(res => res.json())
const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl) || targets[0]
if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable WebView page found')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let id = 0
const pending = new Map()
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject, timer } = pending.get(message.id)
  clearTimeout(timer)
  pending.delete(message.id)
  if (message.error) reject(new Error(JSON.stringify(message.error)))
  else resolve(message.result)
})

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const messageId = ++id
  const timer = setTimeout(() => {
    pending.delete(messageId)
    reject(new Error(`${method} timed out after ${evalTimeoutMs}ms`))
  }, evalTimeoutMs)
  pending.set(messageId, { resolve, reject, timer })
  ws.send(JSON.stringify({ id: messageId, method, params }))
})

await send('Runtime.enable')
const result = await send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true
})
ws.close()
console.log(JSON.stringify(result.result?.value ?? result.result ?? null, null, 2))
