import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '@/data/categories'
import { aiEntryMessages, createDraftsFromAiRecords, parseAiEntryRecords } from './ai'

describe('AI entry', () => {
  it('parses fenced JSON and creates drafts', () => {
    const records = parseAiEntryRecords('```json\n{"records":[{"type":"expense","category":"行车交通","subcategory":"停车","amountYuan":12,"confidence":0.9}]}\n```')
    const result = createDraftsFromAiRecords(records, '停车12', DEFAULT_CATEGORIES, '2026-05-28T10:00:00')

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]?.type).toBe('expense')
    expect(result.drafts[0]?.amountCents).toBe(1200)
    expect(result.drafts[0]?.status).toBe('draft')
  })

  it('keeps records when model warning text contains unescaped quotes', () => {
    const records = parseAiEntryRecords('{"records":[{"type":"expense","category":"food","subcategory":"lunch","amountYuan":18,"confidence":0.7,"warnings":["recommended "lunch" label"]}]}')

    expect(records).toHaveLength(1)
    expect(records[0]?.amountYuan).toBe(18)
    expect(records[0]?.warnings?.[0]).toContain('malformed warning')
  })

  it('supports Chinese income type', () => {
    const result = createDraftsFromAiRecords([
      { type: '收入', category: '人情收礼', subcategory: '所收红包', amountYuan: 88.66 }
    ], '红包88.66', DEFAULT_CATEGORIES, '2026-05-28T10:00:00')

    expect(result.drafts[0]?.type).toBe('income')
    expect(result.drafts[0]?.amountCents).toBe(8866)
    expect(result.drafts[0]?.memberName).toBe('')
  })

  it('keeps duplicate drafts distinct even with the same input time', () => {
    const records = [{ type: 'expense' as const, category: '行车交通', subcategory: '停车', amountYuan: 12 }]
    const first = createDraftsFromAiRecords(records, '停车12', DEFAULT_CATEGORIES, '2026-05-28T10:00:00')
    const second = createDraftsFromAiRecords(records, '停车12', DEFAULT_CATEGORIES, '2026-05-28T10:00:00')

    expect(first.drafts[0]?.id).not.toBe(second.drafts[0]?.id)
  })

  it('includes local classification hints without ledger history', () => {
    const messages = createDraftsPromptText('停车12，水蜜桃49.14')

    expect(messages).toContain('停车/停车费 -> 行车交通 / 停车')
    expect(messages).toContain('把食材、用途、补充说明等保留到 note')
    expect(messages).toContain('memberName 固定输出空字符串')
  })
})

function createDraftsPromptText(input: string) {
  return aiEntryMessages(input, DEFAULT_CATEGORIES).map(message => message.content).join('\n')
}
