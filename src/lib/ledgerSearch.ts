import type { Category, Transaction, TransactionType } from '@/types'

export type LedgerPeriod = 'today' | 'month' | 'year' | 'all'

export interface LedgerSearchOptions {
  transactions: Transaction[]
  categories: Category[]
  period: LedgerPeriod
  type: TransactionType | 'all'
  query: string
  aiAssist: boolean
  now?: Date
}

export interface LedgerSearchResult {
  items: Transaction[]
  aiTerms: string[]
  aiMatchedCount: number
}

interface SearchRecord {
  transaction: Transaction
  text: string
}

const LEDGER_SEARCH_SYNONYMS: Array<{ triggers: string[]; terms: string[] }> = [
  {
    triggers: ['吃饭', '饭', '午饭', '晚饭', '早饭', '早餐', '中饭', '中餐', '晚餐', '外卖', '餐饮', '餐厅', '食物', '买菜', '水果', '零食', '喝的', 'chifan', 'zaofan', 'wufan', 'wanfan', 'zhongfan', 'zhongcan', 'waimai', 'maicai', 'shuiguo', 'lingshi'],
    terms: ['食品酒水', '中餐', '早餐', '晚餐', '外出美食', '餐饮费', '伙食费', '柴米油盐', '水果', '零食', '饮料酒水']
  },
  {
    triggers: ['车', '车费', '开车', '交通', '路费', '停车费', '油费', '充电费', '打车', '出租车', '地铁', '高铁', '火车', 'che', 'jiaotong', 'tingche', 'youfei', 'jiayou', 'chongdian', 'dache', 'ditie', 'gaotie', 'huoche'],
    terms: ['行车交通', '停车', '加油', '充电', '打车', '地铁', '火车', '交通费', '保养', '维修', '保险']
  },
  {
    triggers: ['宝宝', '孩子', '娃', '小孩', '奶粉', '尿不湿', '玩具', '儿童', '育儿', 'baobao', 'haizi', 'wawa', 'naifen', 'niaobushi', 'wanju'],
    terms: ['宝宝费用', '宝宝其他', '宝宝用品', '宝宝食品', '宝宝教育', '医疗护理', '妈妈用品']
  },
  {
    triggers: ['买东西', '购物', '网购', '淘宝', '京东', '拼多多', '超市', '生活用品', '日用品', '衣服', '鞋', 'gouwu', 'wanggou', 'taobao', 'jingdong', 'pinduoduo', 'chaoshi', 'riyongpin', 'yifu', 'xie'],
    terms: ['购物消费', '超市购物', '日常用品', '衣裤鞋帽', '电子数码', '洗护用品', '美妆护肤', '家具家电']
  },
  {
    triggers: ['房子', '房贷', '房租', '家里', '水电', '水费', '电费', '燃气', '物业', '快递', '维修', 'fangzi', 'fangdai', 'fangzu', 'jiali', 'shuidian', 'shuifei', 'dianfei', 'ranqi', 'wuye', 'kuaidi', 'weixiu'],
    terms: ['居家生活', '房贷', '快递费', '水费', '电费', '燃气费', '物业费', '维修费']
  },
  {
    triggers: ['保险', '保费', '金融', '税', '税费', '车位', 'baoxian', 'baofei', 'jinrong', 'shuifei', 'chewei'],
    terms: ['金融保险', '人身保险', '保险', '税费', '车位费']
  },
  {
    triggers: ['红包', '礼金', '人情', '随礼', '婚礼', '孝敬', '长辈', '礼物', '收礼', 'hongbao', 'lijin', 'renqing', 'suili', 'hunli', 'xiaojing', 'zhangbei', 'liwu', 'shouli'],
    terms: ['人情费用', '人情收礼', '红包', '所收红包', '婚嫁', '孝敬长辈', '乔迁', '寿辰', '纪念日']
  },
  {
    triggers: ['电话', '话费', '手机', '流量', '通讯', 'dianhua', 'huafei', 'shouji', 'liuliang', 'tongxun'],
    terms: ['交流通讯', '手机话费']
  },
  {
    triggers: ['医院', '看病', '买药', '药', '医疗', '教育', '学费', '课程', '知识付费', 'yiyuan', 'kanbing', 'maiyao', 'yao', 'yiliao', 'jiaoyu', 'xuefei', 'kecheng'],
    terms: ['医疗教育', '治疗费', '药品费', '学费', '知识付费', '医疗护理']
  },
  {
    triggers: ['玩', '娱乐', '游戏', '网游', '休闲', '电影', 'wan', 'yule', 'youxi', 'wangyou', 'dianying'],
    terms: ['休闲娱乐', '网游', '娱乐费']
  },
  {
    triggers: ['工资', '奖金', '收入', '发钱', '到账', '公积金', '补贴', '兼职', '理财', '租房补贴', 'gongzi', 'jiangjin', 'shouru', 'faqian', 'daozhang', 'gongjijin', 'butie', 'jianzhi', 'licai', 'zufangbutie'],
    terms: ['职业收入', '工资收入', '公积金提现', '租房补贴', '兼职收入', '理财收入', '其他收入']
  }
]

export function searchLedger(options: LedgerSearchOptions): LedgerSearchResult {
  const query = normalize(options.query)
  const now = options.now || new Date()
  const aiTerms = query ? expandAiTerms(query, options.categories) : []

  let aiMatchedCount = 0
  const records = options.transactions
    .filter(item => item.status === 'confirmed')
    .filter(item => options.type === 'all' || item.type === options.type)
    .filter(item => isInPeriod(item, options.period, now))
    .map(item => ({ transaction: item, text: createSearchText(item, options.categories) }))

  const items = records.filter(record => {
    if (!query) return true
    if (record.text.includes(query)) return true
    if (!options.aiAssist) return false
    const matched = matchesAiSearch(record, query, aiTerms)
    if (matched) aiMatchedCount += 1
    return matched
  }).map(record => record.transaction)

  return {
    items,
    aiTerms,
    aiMatchedCount
  }
}

export function countTransactionsByPeriod(transactions: Transaction[], period: LedgerPeriod, now = new Date()) {
  return transactions.filter(item => item.status === 'confirmed' && isInPeriod(item, period, now)).length
}

function isInPeriod(transaction: Transaction, period: LedgerPeriod, now: Date) {
  const date = transaction.date.slice(0, 10)
  if (period === 'all') return true
  if (period === 'today') return date === localDateKey(now)
  if (period === 'month') return date.startsWith(localMonthKey(now))
  return date.startsWith(String(now.getFullYear()))
}

function createSearchText(transaction: Transaction, categories: Category[]) {
  const category = categories.find(item => item.id === transaction.categoryId)
  const subcategory = category?.subcategories.find(item => item.id === transaction.subcategoryId)
  const amountYuan = String(transaction.amountCents / 100)
  return [
    transaction.type === 'income' ? '收入' : '支出',
    category?.name,
    subcategory?.name,
    transaction.accountName,
    transaction.memberName,
    transaction.merchant,
    transaction.projectCategory,
    transaction.projectName,
    transaction.note,
    amountYuan,
    amountYuan.replace('.00', '')
  ].map(value => normalize(value || '')).filter(Boolean).join(' ')
}

function expandAiTerms(query: string, categories: Category[]) {
  const terms = new Set<string>()
  terms.add(query)
  tokenize(query).forEach(term => terms.add(term))

  for (const group of LEDGER_SEARCH_SYNONYMS) {
    if (group.triggers.some(trigger => query.includes(normalize(trigger)) || normalize(trigger).includes(query))) {
      group.terms.forEach(term => terms.add(normalize(term)))
    }
  }

  for (const category of categories) {
    const names = [category.name, ...category.subcategories.map(item => item.name)]
    if (names.some(name => normalize(name).includes(query) || query.includes(normalize(name)))) {
      names.forEach(name => terms.add(normalize(name)))
    }
  }

  return [...terms].filter(term => term.length >= 2).slice(0, 18)
}

function matchesAiSearch(record: SearchRecord, query: string, aiTerms: string[]) {
  if (aiTerms.some(term => record.text.includes(term))) return true
  return bestCharacterOverlap(query, record.text) >= 0.72
}

function bestCharacterOverlap(query: string, text: string) {
  const words = text.split(/\s+/).filter(Boolean)
  return Math.max(0, ...words.map(word => characterOverlap(query, word)))
}

function characterOverlap(a: string, b: string) {
  if (a.length < 2 || b.length < 2) return 0
  const aChars = new Set([...a])
  const bChars = new Set([...b])
  const shared = [...aChars].filter(char => bChars.has(char)).length
  return shared / Math.min(aChars.size, bChars.size)
}

function tokenize(value: string) {
  const tokens = value.match(/[a-z0-9.]+|[\u4e00-\u9fa5]{2,}/gi) || []
  return tokens.map(normalize).filter(Boolean)
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localMonthKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}
