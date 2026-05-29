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

function adbOut(args) {
  return execFileSync(adb, ['-P', adbPort, '-s', serial, ...args], { encoding: 'utf8' })
}

function findWebviewSocket() {
  const unix = adbOut(['shell', 'cat', '/proc/net/unix'])
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

const categories = [
  category('expense-food', 'expense', '食品酒水', ['中餐', '伙食费', '外出美食', '早餐', '晚餐', '柴米油盐', '水果', '零食', '饮料酒水']),
  category('expense-child', 'expense', '宝宝费用', ['医疗护理', '妈妈用品', '宝宝其他', '宝宝教育', '宝宝用品', '宝宝食品']),
  category('expense-shopping', 'expense', '购物消费', ['书报杂志', '会员费', '办公用品', '宠物支出', '家具家电', '日常用品', '汽车用品', '洗护用品', '电子数码', '美妆护肤', '衣裤鞋帽', '超市购物']),
  category('expense-transport', 'expense', '行车交通', ['保养', '保险', '停车', '充电', '加油', '地铁', '打车', '火车', '维修', '驾照']),
  category('expense-home', 'expense', '居家生活', ['快递费', '水费', '燃气费', '物业费', '电费', '维修费']),
  category('expense-finance', 'expense', '金融保险', ['人身保险', '房贷', '税费', '车位费']),
  category('income-work', 'income', '职业收入', ['公积金提现', '兼职收入', '工资收入', '理财收入']),
  category('income-gift', 'income', '人情收礼', ['所收红包']),
  category('income-other', 'income', '其他收入', ['二手', '回收', '意外来钱', '租房补贴', '经营所得', '其他'])
]

function category(id, type, name, subcategories) {
  return {
    id,
    type,
    name,
    subcategories: subcategories.map(name => ({ id: `${id}-${slug(name)}`, name }))
  }
}

function slug(value) {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash.toString(36)
}

function makeTransaction(index, date, type, amountCents) {
  const expenseCategories = ['expense-food', 'expense-transport', 'expense-home', 'expense-child', 'expense-shopping', 'expense-finance']
  const incomeCategories = ['income-work', 'income-gift', 'income-other']
  const categoryId = type === 'income'
    ? incomeCategories[index % incomeCategories.length]
    : expenseCategories[index % expenseCategories.length]
  const currentCategory = categories.find(item => item.id === categoryId)
  return {
    id: `android-stress-${index}`,
    type,
    date,
    categoryId,
    subcategoryId: currentCategory?.subcategories[index % Math.max(1, currentCategory.subcategories.length)]?.id || '',
    accountName: index % 3 === 0 ? '招商银行' : '现金',
    currency: 'CNY',
    amountCents,
    memberName: index % 2 === 0 ? '朱建华' : '家人',
    merchant: index % 5 === 0 ? '压力测试商户' : '',
    projectCategory: '',
    projectName: '',
    note: index % 7 === 0 ? '压力测试流水' : '',
    source: 'backup',
    status: 'confirmed',
    createdAt: date,
    updatedAt: date
  }
}

function makeStressTransactions() {
  const items = []
  let index = 0
  const add = (count, dateFactory) => {
    for (let i = 0; i < count; i += 1) {
      const type = i % 9 === 0 ? 'income' : 'expense'
      const amount = type === 'income'
        ? 8_000_00 + (i % 17) * 321_00
        : 8_00 + (i % 53) * 137
      items.push(makeTransaction(index, dateFactory(i), type, amount))
      index += 1
    }
  }

  add(48, i => `2026-05-28T${String(7 + (i % 13)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`)
  add(452, i => `2026-05-${String(1 + (i % 27)).padStart(2, '0')}T12:${String(i % 60).padStart(2, '0')}:00`)
  add(1500, i => `2026-${String(1 + (i % 4)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}T09:${String(i % 60).padStart(2, '0')}:00`)
  add(441, i => `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}T08:${String(i % 60).padStart(2, '0')}:00`)
  return items
}

const transactions = makeStressTransactions()
const store = {
  state: {
    transactions,
    categories,
    drafts: [
      {
        ...makeTransaction(9999, '2026-05-28T23:00:00', 'expense', 99_99),
        id: 'android-stress-draft',
        source: 'ai',
        status: 'draft',
        rawInput: '压力测试草稿'
      }
    ],
    settings: {
      model: {
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7-highspeed',
        requestPath: '/chat/completions',
        temperature: 0.1,
        maxTokens: 1200,
        timeoutMs: 60000
      },
      privacy: { hideAmounts: false },
      lastImportName: 'android-stress-seed',
      lastImportAt: '2026-05-28T15:00:00.000Z'
    },
    importSummary: {
      fileName: 'android-stress-seed',
      importedAt: '2026-05-28T15:00:00.000Z',
      transactionCount: transactions.length,
      dateStart: '2025-01-01',
      dateEnd: '2026-05-28',
      warnings: []
    }
  },
  version: 1
}

const { ws, send } = await connectPage()
await send('Runtime.enable')
const before = await send('Runtime.evaluate', {
  expression: 'localStorage.getItem("jiyixia-store")',
  returnByValue: true
})
writeFileSync(resolve(qaDir, 'android-stress-store-before.json'), before.result.value || '')

const encoded = JSON.stringify(JSON.stringify(store))
const summary = await send('Runtime.evaluate', {
  expression: `
    (() => {
      const payload = ${encoded};
      localStorage.setItem('jiyixia-store', payload);
      const parsed = JSON.parse(payload);
      const confirmed = parsed.state.transactions.filter(item => item.status === 'confirmed');
      const result = {
        confirmed: confirmed.length,
        drafts: parsed.state.drafts.length,
        today: confirmed.filter(item => item.date.startsWith('2026-05-28')).length,
        month: confirmed.filter(item => item.date.startsWith('2026-05')).length,
        year: confirmed.filter(item => item.date.startsWith('2026')).length,
        all: confirmed.length
      };
      setTimeout(() => location.reload(), 100);
      return result;
    })()
  `,
  returnByValue: true
})

writeFileSync(resolve(qaDir, 'android-stress-summary.json'), JSON.stringify(summary.result.value, null, 2))
ws.close()
console.log(JSON.stringify(summary.result.value, null, 2))
