import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '@/data/categories'
import { createAnnualSummary, createMonthSummary } from './statistics'
import type { Transaction } from '@/types'

const tx = (patch: Partial<Transaction>): Transaction => ({
  id: patch.id || Math.random().toString(36),
  type: patch.type || 'expense',
  date: patch.date || '2026-05-01T12:00:00',
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
  createdAt: '2026-05-01T12:00:00',
  updatedAt: '2026-05-01T12:00:00',
  ...patch
})

describe('statistics', () => {
  it('summarizes month and ignores drafts', () => {
    const result = createMonthSummary([
      tx({ type: 'income', categoryId: 'income-work', amountCents: 100_00 }),
      tx({ type: 'expense', categoryId: 'expense-food', amountCents: 30_00 }),
      tx({ type: 'expense', categoryId: 'expense-food', amountCents: 20_00, status: 'draft' })
    ], DEFAULT_CATEGORIES, '2026-05')

    expect(result.incomeCents).toBe(100_00)
    expect(result.expenseCents).toBe(30_00)
    expect(result.balanceCents).toBe(70_00)
    expect(result.expenseRank[0]?.name).toBe('食品酒水')
  })

  it('builds a 12 month annual trend', () => {
    const result = createAnnualSummary([
      tx({ type: 'income', categoryId: 'income-work', date: '2026-01-15T12:00:00', amountCents: 100_00 }),
      tx({ type: 'expense', categoryId: 'expense-transport', date: '2026-02-01T12:00:00', amountCents: 35_00 })
    ], DEFAULT_CATEGORIES, '2026')

    expect(result.months).toHaveLength(12)
    expect(result.months[0]?.incomeCents).toBe(100_00)
    expect(result.months[1]?.expenseCents).toBe(35_00)
    expect(result.balanceCents).toBe(65_00)
  })
})
