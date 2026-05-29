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
const smokeInput = process.env.AI_SMOKE_INPUT || '停车12，午饭18，红包88.66'

function adbText(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args], { encoding: 'utf8' })
}

function findWebviewSocket() {
  const unix = adbText(['shell', 'cat', '/proc/net/unix'])
  const sockets = [...unix.matchAll(/@?(webview_devtools_remote_\d+)/g)].map(match => match[1])
  if (!sockets.length) throw new Error('No WebView devtools socket found')
  return sockets[sockets.length - 1]
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

function readChatContent(payload) {
  const choice = payload?.choices?.[0]
  return choice?.message?.content || choice?.delta?.content || choice?.text || payload?.message?.content || payload?.reply || payload?.output_text || ''
}

function extractJson(text) {
  const stripped = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim()
  try {
    return JSON.parse(stripped)
  } catch {
    const objectStart = stripped.indexOf('{')
    const objectEnd = stripped.lastIndexOf('}')
    if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(stripped.slice(objectStart, objectEnd + 1))
    throw new Error('MiniMax returned non-JSON content.')
  }
}

function joinUrl(baseUrl, requestPath) {
  const trimmedBase = baseUrl.trim().replace(/\/+$/, '')
  return `${trimmedBase}/${requestPath.replace(/^\/+/, '')}`
}

const { ws, send } = await connectPage()
await send('Runtime.enable')

const state = await send('Runtime.evaluate', {
  expression: `(() => {
    const store = JSON.parse(localStorage.getItem('jiyixia-store') || '{}')?.state || {};
    return {
      key: localStorage.getItem('jiyixia-ai-api-key') || '',
      settings: store.settings?.model || {},
      categories: store.categories || []
    };
  })()`,
  awaitPromise: true,
  returnByValue: true
}).then(result => result.result?.value)
ws.close()

if (!state?.key) throw new Error('API key is required in WebView localStorage.')

const dictionary = state.categories.map(category => ({
  type: category.type,
  category: category.name,
  subcategories: category.subcategories.map(item => item.name)
}))
const messages = [
  {
    role: 'system',
    content: [
      '你是一个个人流水账录入助手。',
      '只把用户输入解析成 JSON，不要输出解释。',
      '金额默认按人民币“元”理解；如果用户明确写“万”，请换算成元。',
      '只能使用给定分类表里的一级分类和二级分类；无法判断时选择最接近分类并降低 confidence。',
      '所有记录都只是待确认草稿，不要声称已经入账。'
    ].join('\n')
  },
  {
    role: 'user',
    content: [
      '分类表：',
      JSON.stringify(dictionary),
      '',
      '输出 JSON 格式：',
      '{"records":[{"type":"expense|income","date":"YYYY-MM-DD HH:mm:ss or empty","category":"一级分类","subcategory":"二级分类","amountYuan":number,"accountName":"string","memberName":"string","merchant":"string","note":"string","confidence":number,"warnings":["string"]}]}',
      '',
      '用户输入：',
      smokeInput
    ].join('\n')
  }
]

const started = Date.now()
let report
try {
  const response = await fetch(joinUrl(state.settings.baseUrl || 'https://api.minimaxi.com/v1', state.settings.requestPath || '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.key}`
    },
    body: JSON.stringify({
      model: state.settings.model || 'MiniMax-M2.7-highspeed',
      messages,
      temperature: state.settings.temperature ?? 0.1,
      stream: false,
      max_completion_tokens: state.settings.maxTokens || 1200
    })
  })
  const raw = await response.json()
  if (!response.ok) throw new Error(raw?.error?.message || raw?.message || `MiniMax request failed: ${response.status}`)
  const content = readChatContent(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const parsed = extractJson(content)
  const records = Array.isArray(parsed) ? parsed : parsed.records
  if (!Array.isArray(records)) throw new Error('MiniMax JSON did not contain records[].')
  report = {
    createdAt: new Date().toISOString(),
    ok: true,
    input: smokeInput,
    elapsedMs: Date.now() - started,
    recordCount: records.length,
    records: records.map(record => ({
      type: record.type,
      category: record.category,
      subcategory: record.subcategory,
      amountYuan: record.amountYuan,
      confidence: record.confidence,
      warnings: record.warnings || []
    }))
  }
} catch (error) {
  report = {
    createdAt: new Date().toISOString(),
    ok: false,
    input: smokeInput,
    elapsedMs: Date.now() - started,
    error: error instanceof Error ? error.message : String(error)
  }
}

writeFileSync(resolve(qaDir, 'ai-host-minimax-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
