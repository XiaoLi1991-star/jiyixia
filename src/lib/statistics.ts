import { monthOf, yearOf } from '@/lib/dates'
import type { Category, Transaction } from '@/types'

export interface RankItem {
  id: string
  name: string
  amountCents: number
  count: number
}

export interface PeriodSummary {
  incomeCents: number
  expenseCents: number
  balanceCents: number
  expenseRank: RankItem[]
  incomeRank: RankItem[]
}

export interface AnnualMonthSummary {
  month: string
  incomeCents: number
  expenseCents: number
  balanceCents: number
}

export interface AnnualSummary extends PeriodSummary {
  year: string
  months: AnnualMonthSummary[]
}

export function confirmedTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter(item => item.status === 'confirmed')
}

export function createMonthSummary(transactions: Transaction[], categories: Category[], month: string): PeriodSummary {
  const items = confirmedTransactions(transactions).filter(item => monthOf(item.date) === month)
  return summarize(items, categories)
}

export function createAnnualSummary(transactions: Transaction[], categories: Category[], year: string): AnnualSummary {
  const items = confirmedTransactions(transactions).filter(item => yearOf(item.date) === year)
  const summary = summarize(items, categories)
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`
    const monthSummary = summarize(items.filter(item => monthOf(item.date) === month), categories)
    return {
      month,
      incomeCents: monthSummary.incomeCents,
      expenseCents: monthSummary.expenseCents,
      balanceCents: monthSummary.balanceCents
    }
  })
  return { year, ...summary, months }
}

function summarize(items: Transaction[], categories: Category[]): PeriodSummary {
  const incomeCents = sum(items.filter(item => item.type === 'income'))
  const expenseCents = sum(items.filter(item => item.type === 'expense'))
  return {
    incomeCents,
    expenseCents,
    balanceCents: incomeCents - expenseCents,
    expenseRank: rankByCategory(items, categories, 'expense'),
    incomeRank: rankByCategory(items, categories, 'income')
  }
}

function sum(items: Transaction[]): number {
  return items.reduce((total, item) => total + item.amountCents, 0)
}

function rankByCategory(items: Transaction[], categories: Category[], type: 'expense' | 'income'): RankItem[] {
  const categoryNameById = new Map(categories.map(item => [item.id, item.name]))
  const bucket = new Map<string, RankItem>()
  for (const item of items) {
    if (item.type !== type) continue
    const existing = bucket.get(item.categoryId)
    if (existing) {
      existing.amountCents += item.amountCents
      existing.count += 1
    } else {
      bucket.set(item.categoryId, {
        id: item.categoryId,
        name: categoryNameById.get(item.categoryId) || '未分类',
        amountCents: item.amountCents,
        count: 1
      })
    }
  }
  return [...bucket.values()].sort((a, b) => b.amountCents - a.amountCents)
}

export function availableYears(transactions: Transaction[]): string[] {
  const years = new Set(confirmedTransactions(transactions).map(item => yearOf(item.date)))
  return [...years].sort((a, b) => b.localeCompare(a))
}

export function availableMonths(transactions: Transaction[]): string[] {
  const months = new Set(confirmedTransactions(transactions).map(item => monthOf(item.date)))
  return [...months].sort((a, b) => b.localeCompare(a))
}
