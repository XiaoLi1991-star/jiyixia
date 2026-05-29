import { DEFAULT_CATEGORIES, ensureCategory, findCategory, findSubcategory, normalizeName } from '@/data/categories'
import { normalizeDate } from '@/lib/dates'
import { createId } from '@/lib/ids'
import { parseAmountCents } from '@/lib/money'
import type { AiDraft, Category, TransactionType } from '@/types'

export interface AiEntryRecord {
  type?: TransactionType | '支出' | '收入'
  date?: string
  category?: string
  subcategory?: string
  amountYuan?: number | string
  accountName?: string
  memberName?: string
  merchant?: string
  note?: string
  confidence?: number
  warnings?: string[]
}

export function aiEntryMessages(input: string, categories: Category[]) {
  const dictionary = categories.map(category => ({
    type: category.type,
    category: category.name,
    subcategories: category.subcategories.map(item => item.name)
  }))
  return [
    {
      role: 'system' as const,
      content: [
        '你是一个个人流水账录入助手。',
        '只把用户输入解析成 JSON，不要输出解释。',
        '金额默认按人民币“元”理解；如果用户明确写“万”，请换算成元。',
        '只能使用给定分类表里的一级分类和二级分类；无法判断时选择最接近分类并降低 confidence。',
        '所有记录都只是待确认草稿，不要声称已经入账。'
      ].join('\n')
    },
    {
      role: 'user' as const,
      content: [
        '分类表：',
        JSON.stringify(dictionary),
        '',
        '输出 JSON 格式：',
        '{"records":[{"type":"expense|income","date":"YYYY-MM-DD HH:mm:ss or empty","category":"一级分类","subcategory":"二级分类","amountYuan":number,"accountName":"string","memberName":"string","merchant":"string","note":"string","confidence":number,"warnings":["string"]}]}',
        '',
        '用户输入：',
        input
      ].join('\n')
    }
  ]
}

export function parseAiEntryRecords(text: string): AiEntryRecord[] {
  const parsed = extractJson(text) as { records?: AiEntryRecord[] } | AiEntryRecord[]
  const records = Array.isArray(parsed) ? parsed : parsed.records
  if (!Array.isArray(records)) throw new Error('AI 返回格式不符合要求，请稍后重试或调整描述。')
  return records
}

export function createDraftsFromAiRecords(records: AiEntryRecord[], input: string, categories = DEFAULT_CATEGORIES, now = new Date().toISOString()): {
  drafts: AiDraft[]
  categories: Category[]
} {
  let nextCategories = categories
  const drafts = records.map((record, index) => {
    const type = normalizeType(record.type)
    const warnings = [...(record.warnings || [])]
    const amountCents = parseAmountCents(record.amountYuan)
    const categoryName = normalizeName(record.category) || (type === 'income' ? '其他收入' : '其他支出')
    const subcategoryName = normalizeName(record.subcategory) || '其他'
    const mapping = ensureCategory(nextCategories, type, categoryName, subcategoryName)
    nextCategories = mapping.categories

    if (!record.date) warnings.push('缺少日期，已按当前时间处理。')
    if (!record.amountYuan || amountCents <= 0) warnings.push('金额无法确认，请确认后再入账。')
    if (!findCategory(categories, type, categoryName) || !findSubcategory(nextCategories.find(item => item.id === mapping.categoryId)!, subcategoryName)) {
      warnings.push('分类来自 AI 判断，请确认是否符合你的习惯。')
    }

    return {
      id: createId('draft', `${input}-${index}-${now}`),
      type,
      date: normalizeDate(record.date || now),
      categoryId: mapping.categoryId,
      subcategoryId: mapping.subcategoryId,
      accountName: normalizeName(record.accountName) || '现金',
      currency: 'CNY',
      amountCents,
      memberName: normalizeName(record.memberName) || '朱建华',
      merchant: normalizeName(record.merchant),
      projectCategory: '',
      projectName: '',
      note: normalizeName(record.note),
      source: 'ai',
      status: 'draft',
      confidence: record.confidence ?? 0.7,
      warnings,
      rawInput: input,
      createdAt: now,
      updatedAt: now
    } satisfies AiDraft
  })

  return { drafts, categories: nextCategories }
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced?.[1]?.trim() || trimmed
}

function extractJson(text: string): unknown {
  const stripped = stripJsonFence(text)
  try {
    return JSON.parse(stripped)
  } catch {
    const repairedWarnings = repairWarningsArrays(stripped)
    if (repairedWarnings !== stripped) {
      try {
        return JSON.parse(repairedWarnings)
      } catch {
        // Continue with candidate extraction below; the malformed content was not limited to warnings.
      }
    }

    const objectStart = stripped.indexOf('{')
    const objectEnd = stripped.lastIndexOf('}')
    if (objectStart >= 0 && objectEnd > objectStart) {
      const candidate = stripped.slice(objectStart, objectEnd + 1)
      try {
        return JSON.parse(candidate)
      } catch {
        return JSON.parse(repairWarningsArrays(candidate))
      }
    }
    const arrayStart = stripped.indexOf('[')
    const arrayEnd = stripped.lastIndexOf(']')
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      const candidate = stripped.slice(arrayStart, arrayEnd + 1)
      try {
        return JSON.parse(candidate)
      } catch {
        return JSON.parse(repairWarningsArrays(candidate))
      }
    }
    throw new Error('AI 返回格式不符合要求，请稍后重试或调整描述。')
  }
}

function repairWarningsArrays(text: string): string {
  return text.replace(
    /"warnings"\s*:\s*\[[\s\S]*?\](?=\s*[,}])/g,
    '"warnings":["AI returned a malformed warning; please verify this draft."]'
  )
}

function normalizeType(value: AiEntryRecord['type']): TransactionType {
  if (value === 'income' || value === '收入') return 'income'
  return 'expense'
}
