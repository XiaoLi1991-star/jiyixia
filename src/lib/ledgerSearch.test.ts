import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '@/data/categories'
import { searchLedger } from './ledgerSearch'
import type { Transaction } from '@/types'

const tx = (patch: Partial<Transaction>): Transaction => ({
  id: patch.id || Math.random().toString(36),
  type: patch.type || 'expense',
  date: patch.date || '2026-05-28T12:00:00',
  categoryId: patch.categoryId || 'expense-food',
  subcategoryId: patch.subcategoryId || 'expense-food-14i87f',
  accountName: '现金',
  currency: 'CNY',
  amountCents: patch.amountCents || 0,
  memberName: '朱建华',
  merchant: '',
  projectCategory: '',
  projectName: '',
  note: '',
  source: patch.source || 'manual',
  status: patch.status || 'confirmed',
  createdAt: '2026-05-28T12:00:00',
  updatedAt: '2026-05-28T12:00:00',
  ...patch
})

describe('ledger search', () => {
  it('filters by today, month, year and all', () => {
    const transactions = [
      tx({ id: 'today', date: '2026-05-28T08:00:00' }),
      tx({ id: 'month', date: '2026-05-01T08:00:00' }),
      tx({ id: 'year', date: '2026-01-01T08:00:00' }),
      tx({ id: 'old', date: '2025-12-31T08:00:00' })
    ]
    const now = new Date('2026-05-28T10:00:00')

    expect(searchLedger({ transactions, categories: DEFAULT_CATEGORIES, period: 'today', type: 'all', query: '', aiAssist: true, now }).items.map(item => item.id)).toEqual(['today'])
    expect(searchLedger({ transactions, categories: DEFAULT_CATEGORIES, period: 'month', type: 'all', query: '', aiAssist: true, now }).items.map(item => item.id)).toEqual(['today', 'month'])
    expect(searchLedger({ transactions, categories: DEFAULT_CATEGORIES, period: 'year', type: 'all', query: '', aiAssist: true, now }).items.map(item => item.id)).toEqual(['today', 'month', 'year'])
    expect(searchLedger({ transactions, categories: DEFAULT_CATEGORIES, period: 'all', type: 'all', query: '', aiAssist: true, now }).items).toHaveLength(4)
  })

  it('expands fuzzy bookkeeping words without sending ledger history', () => {
    const result = searchLedger({
      transactions: [
        tx({ id: 'food', categoryId: 'expense-food', subcategoryId: 'expense-food-14i87f', note: '公司楼下' }),
        tx({ id: 'home', categoryId: 'expense-home', subcategoryId: 'expense-home-1czn1l' })
      ],
      categories: DEFAULT_CATEGORIES,
      period: 'month',
      type: 'all',
      query: '吃饭',
      aiAssist: true,
      now: new Date('2026-05-28T10:00:00')
    })

    expect(result.items.map(item => item.id)).toEqual(['food'])
    expect(result.aiMatchedCount).toBe(1)
    expect(result.aiTerms).toContain('中餐')
  })

  it('matches common pinyin aliases locally', () => {
    const result = searchLedger({
      transactions: [
        tx({ id: 'food', categoryId: 'expense-food', subcategoryId: 'expense-food-14i87f' }),
        tx({ id: 'home', categoryId: 'expense-home', subcategoryId: 'expense-home-1czn1l' })
      ],
      categories: DEFAULT_CATEGORIES,
      period: 'month',
      type: 'all',
      query: 'zhongcan',
      aiAssist: true,
      now: new Date('2026-05-28T10:00:00')
    })

    expect(result.items.map(item => item.id)).toEqual(['food'])
    expect(result.aiMatchedCount).toBe(1)
  })

  it('searches year and month words in all ledger records', () => {
    const transactions = [
      tx({ id: 'may', date: '2026-05-12T08:00:00' }),
      tx({ id: 'jan', date: '2026-01-12T08:00:00' }),
      tx({ id: 'old', date: '2025-05-12T08:00:00' })
    ]

    expect(searchLedger({
      transactions,
      categories: DEFAULT_CATEGORIES,
      period: 'all',
      type: 'all',
      query: '2026年5月',
      aiAssist: true
    }).items.map(item => item.id)).toEqual(['may'])

    expect(searchLedger({
      transactions,
      categories: DEFAULT_CATEGORIES,
      period: 'all',
      type: 'all',
      query: '2026年',
      aiAssist: true
    }).items.map(item => item.id)).toEqual(['may', 'jan'])
  })

  it('filters all records by explicit year or month controls', () => {
    const transactions = [
      tx({ id: 'may', date: '2026-05-12T08:00:00' }),
      tx({ id: 'jan', date: '2026-01-12T08:00:00' }),
      tx({ id: 'old', date: '2025-05-12T08:00:00' })
    ]

    expect(searchLedger({
      transactions,
      categories: DEFAULT_CATEGORIES,
      period: 'all',
      type: 'all',
      query: '',
      aiAssist: true,
      dateFilter: { year: '2026' }
    }).items.map(item => item.id)).toEqual(['may', 'jan'])

    expect(searchLedger({
      transactions,
      categories: DEFAULT_CATEGORIES,
      period: 'all',
      type: 'all',
      query: '',
      aiAssist: true,
      dateFilter: { month: '2026-05' }
    }).items.map(item => item.id)).toEqual(['may'])
  })
})
