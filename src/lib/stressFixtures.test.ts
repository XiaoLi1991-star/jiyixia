import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '@/data/categories'
import { countTransactionsByPeriod, searchLedger } from './ledgerSearch'
import { availableMonths, availableYears, createAnnualSummary, createMonthSummary } from './statistics'
import type { Transaction, TransactionType } from '@/types'

const now = new Date('2026-05-28T10:00:00')

function makeTransaction(index: number, date: string, type: TransactionType, amountCents: number): Transaction {
  const expenseCategories = ['expense-food', 'expense-transport', 'expense-home', 'expense-child', 'expense-shopping', 'expense-finance']
  const incomeCategories = ['income-work', 'income-gift', 'income-other']
  const categoryId = type === 'income'
    ? incomeCategories[index % incomeCategories.length]
    : expenseCategories[index % expenseCategories.length]
  const category = DEFAULT_CATEGORIES.find(item => item.id === categoryId)
  return {
    id: `stress-${index}`,
    type,
    date,
    categoryId,
    subcategoryId: category?.subcategories[index % Math.max(1, category.subcategories.length)]?.id || '',
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

function makeStressTransactions(): Transaction[] {
  const items: Transaction[] = []
  let index = 0
  const add = (count: number, dateFactory: (offset: number) => string) => {
    for (let i = 0; i < count; i += 1) {
      const type: TransactionType = i % 9 === 0 ? 'income' : 'expense'
      const amount = type === 'income'
        ? 8_000_00 + (i % 17) * 321_00
        : 8_00 + (i % 53) * 137
      items.push(makeTransaction(index, dateFactory(i), type, amount))
      index += 1
    }
  }

  add(48, i => `2026-05-28T${String(7 + (i % 13)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`)
  add(452, i => `2026-05-${String(1 + (i % 27)).padStart(2, '0')}T12:${String(i % 60).padStart(2, '0')}:00`)
  add(1500, i => {
    const month = 1 + (i % 4)
    const day = 1 + (i % 27)
    return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T09:${String(i % 60).padStart(2, '0')}:00`
  })
  add(441, i => `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}T08:${String(i % 60).padStart(2, '0')}:00`)

  return [
    ...items,
    {
      ...makeTransaction(index, '2026-05-28T23:00:00', 'expense', 99_99),
      id: 'stress-draft',
      status: 'draft',
      source: 'ai'
    }
  ]
}

function manualSummary(transactions: Transaction[], predicate: (item: Transaction) => boolean) {
  return transactions
    .filter(item => item.status === 'confirmed')
    .filter(predicate)
    .reduce((summary, item) => {
      if (item.type === 'income') summary.incomeCents += item.amountCents
      else summary.expenseCents += item.amountCents
      return summary
    }, { incomeCents: 0, expenseCents: 0 })
}

describe('stress statistics and ledger periods', () => {
  it('keeps month and annual totals correct with thousands of transactions', () => {
    const transactions = makeStressTransactions()
    const monthSummary = createMonthSummary(transactions, DEFAULT_CATEGORIES, '2026-05')
    const annualSummary = createAnnualSummary(transactions, DEFAULT_CATEGORIES, '2026')
    const expectedMonth = manualSummary(transactions, item => item.date.startsWith('2026-05'))
    const expectedYear = manualSummary(transactions, item => item.date.startsWith('2026'))
    const monthRollup = annualSummary.months.reduce((summary, item) => ({
      incomeCents: summary.incomeCents + item.incomeCents,
      expenseCents: summary.expenseCents + item.expenseCents
    }), { incomeCents: 0, expenseCents: 0 })

    expect(transactions).toHaveLength(2442)
    expect(monthSummary.incomeCents).toBe(expectedMonth.incomeCents)
    expect(monthSummary.expenseCents).toBe(expectedMonth.expenseCents)
    expect(monthSummary.balanceCents).toBe(expectedMonth.incomeCents - expectedMonth.expenseCents)
    expect(annualSummary.months).toHaveLength(12)
    expect(annualSummary.incomeCents).toBe(expectedYear.incomeCents)
    expect(annualSummary.expenseCents).toBe(expectedYear.expenseCents)
    expect(monthRollup).toEqual(expectedYear)
    expect(annualSummary.expenseRank.length).toBeGreaterThan(1)
    expect(annualSummary.incomeRank.length).toBeGreaterThan(1)
  })

  it('keeps today, month, year and all period counts stable under load', () => {
    const transactions = makeStressTransactions()

    expect(countTransactionsByPeriod(transactions, 'today', now)).toBe(48)
    expect(countTransactionsByPeriod(transactions, 'month', now)).toBe(500)
    expect(countTransactionsByPeriod(transactions, 'year', now)).toBe(2000)
    expect(countTransactionsByPeriod(transactions, 'all', now)).toBe(2441)
    expect(searchLedger({ transactions, categories: DEFAULT_CATEGORIES, period: 'today', type: 'all', query: '', aiAssist: true, now }).items).toHaveLength(48)
    expect(searchLedger({ transactions, categories: DEFAULT_CATEGORIES, period: 'month', type: 'expense', query: '', aiAssist: true, now }).items).toHaveLength(443)
    expect(searchLedger({ transactions, categories: DEFAULT_CATEGORIES, period: 'year', type: 'income', query: '', aiAssist: true, now }).items).toHaveLength(224)
    expect(availableYears(transactions)).toEqual(['2026', '2025'])
    expect(availableMonths(transactions)[0]).toBe('2026-05')
  })
})
