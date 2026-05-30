import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '@/data/categories'
import { DEFAULT_SETTINGS, useAppStore } from './store'
import type { Transaction } from '@/types'

const expenseCategory = DEFAULT_CATEGORIES.find(item => item.type === 'expense')!
const expenseSubcategory = expenseCategory.subcategories[0]!

const duplicateTransaction: Omit<Transaction, 'id' | 'source' | 'status' | 'createdAt' | 'updatedAt'> = {
  type: 'expense',
  date: '2026-05-30T12:00',
  categoryId: expenseCategory.id,
  subcategoryId: expenseSubcategory.id,
  accountName: '现金',
  currency: 'CNY',
  amountCents: 1200,
  memberName: '',
  merchant: '停车场',
  projectCategory: '',
  projectName: '',
  note: '同一时间真实消费'
}

describe('app store transactions', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState({
      transactions: [],
      categories: DEFAULT_CATEGORIES,
      drafts: [],
      settings: DEFAULT_SETTINGS,
      importSummary: undefined
    })
  })

  it('keeps separate manual transactions even when all bookkeeping fields match', () => {
    useAppStore.getState().addTransaction(duplicateTransaction)
    useAppStore.getState().addTransaction(duplicateTransaction)

    const transactions = useAppStore.getState().transactions
    expect(transactions).toHaveLength(2)
    expect(new Set(transactions.map(item => item.id)).size).toBe(2)
    expect(transactions.every(item => item.date === duplicateTransaction.date)).toBe(true)
    expect(transactions.every(item => item.amountCents === duplicateTransaction.amountCents)).toBe(true)
    expect(transactions.every(item => item.note === duplicateTransaction.note)).toBe(true)
  })
})
