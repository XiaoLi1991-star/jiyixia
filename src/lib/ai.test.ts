import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '@/data/categories'
import { createDraftsFromAiRecords, parseAiEntryRecords } from './ai'

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
      { type: '收入', category: '职业收入', subcategory: '工资收入', amountYuan: 88.66 }
    ], '红包88.66', DEFAULT_CATEGORIES, '2026-05-28T10:00:00')

    expect(result.drafts[0]?.type).toBe('income')
    expect(result.drafts[0]?.amountCents).toBe(8866)
  })
})
