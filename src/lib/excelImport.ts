import readExcelFile, { type Sheet } from 'read-excel-file/browser'
import { DEFAULT_CATEGORIES, ensureCategory, normalizeName } from '@/data/categories'
import { normalizeDate } from '@/lib/dates'
import { createId, hashString } from '@/lib/ids'
import { parseAmountCents } from '@/lib/money'
import type { Category, ImportSummary, Transaction, TransactionType } from '@/types'

export interface ImportResult {
  transactions: Transaction[]
  categories: Category[]
  summary: ImportSummary
}

const KNOWN_SHEETS: Record<string, TransactionType> = {
  支出: 'expense',
  收入: 'income'
}

export function parseWorkbookSheets(sheets: Sheet[], fileName = '账本.xlsx', now = new Date().toISOString()): ImportResult {
  let categories = DEFAULT_CATEGORIES
  const transactions: Transaction[] = []
  const warnings: string[] = []

  for (const sheet of sheets) {
    const sheetName = sheet.sheet
    const type = inferSheetType(sheetName)
    if (!type) continue
    const rows = sheet.data
    if (rows.length <= 1) continue
    const headers = rows[0].map(normalizeName)
    const index = indexHeaders(headers)

    rows.slice(1).forEach((row, offset) => {
      if (!row.some(cell => normalizeName(cell))) return

      const rowType = inferTransactionType(readCell(row, index.transactionType)) || type
      const categoryName = readCell(row, index.category)
      const subcategoryName = readCell(row, index.subcategory)
      const amountCents = parseAmountCents(readCell(row, index.amount))
      const date = normalizeDate(readCell(row, index.date))
      const mapping = ensureCategory(categories, rowType, categoryName, subcategoryName)
      categories = mapping.categories

      if (amountCents <= 0) warnings.push(`${sheetName} 第 ${offset + 2} 行金额为空或无效。`)

      const transaction: Transaction = {
        id: createId('excel', `${sheetName}-${offset + 2}-${date}-${amountCents}-${categoryName}-${subcategoryName}`),
        type: rowType,
        date,
        categoryId: mapping.categoryId,
        subcategoryId: mapping.subcategoryId,
        accountName: readCell(row, index.account) || '现金',
        currency: readCell(row, index.currency) || 'CNY',
        amountCents,
        memberName: '',
        merchant: readCell(row, index.merchant),
        projectCategory: readCell(row, index.projectCategory),
        projectName: readCell(row, index.projectName),
        note: buildNote(readCell(row, index.note), readCell(row, index.projectCategory), readCell(row, index.projectName)),
        source: 'excel',
        status: 'confirmed',
        createdAt: now,
        updatedAt: now
      }
      transactions.push(transaction)
    })
  }

  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date))
  const dates = sorted.map(item => item.date.slice(0, 10)).sort()

  return {
    transactions: sorted,
    categories,
    summary: {
      fileName,
      importedAt: now,
      transactionCount: sorted.length,
      dateStart: dates[0] || '',
      dateEnd: dates[dates.length - 1] || '',
      warnings: warnings.slice(0, 20)
    }
  }
}

export async function parseExcelFile(file: File): Promise<ImportResult> {
  return parseWorkbookSheets(await readExcelFile(file), file.name)
}

function inferSheetType(sheetName: string): TransactionType | null {
  if (KNOWN_SHEETS[sheetName]) return KNOWN_SHEETS[sheetName]
  if (sheetName.includes('支出')) return 'expense'
  if (sheetName.includes('收入')) return 'income'
  return null
}

function inferTransactionType(value: string): TransactionType | null {
  if (value.includes('收入')) return 'income'
  if (value.includes('支出')) return 'expense'
  return null
}

function indexHeaders(headers: string[]) {
  const find = (...names: string[]) => {
    const index = headers.findIndex(header => names.includes(header))
    return index >= 0 ? index : -1
  }
  return {
    transactionType: find('交易类型'),
    date: find('日期', '交易日期'),
    category: find('一级分类'),
    subcategory: find('二级分类'),
    account: find('账户1', '账户'),
    currency: find('账户币种', '币种'),
    amount: find('金额'),
    member: find('成员'),
    merchant: find('商家'),
    projectCategory: find('项目分类'),
    projectName: find('项目'),
    note: find('备注', '说明')
  }
}

function readCell(row: unknown[], index: number): string {
  if (index < 0) return ''
  return normalizeName(row[index])
}

function buildNote(note: string, projectCategory: string, projectName: string): string {
  const project = [projectCategory, projectName].filter(Boolean).join(' / ')
  return [note, project ? `项目：${project}` : ''].filter(Boolean).join(' · ')
}

export function fingerprintTransactions(transactions: Transaction[]): string {
  return hashString(transactions.map(item => `${item.date}|${item.type}|${item.amountCents}|${item.categoryId}|${item.subcategoryId}`).join('\n'))
}
