import { describe, expect, it } from 'vitest'
import type { Sheet } from 'read-excel-file/browser'
import { parseWorkbookSheets } from './excelImport'

describe('Excel import', () => {
  it('imports Suishouji-style expense and income sheets', () => {
    const sheets: Sheet[] = [
      {
        sheet: '支出',
        data: [
          ['交易类型', '日期', '一级分类', '二级分类', '账户1', '账户币种', '金额', '成员', '商家', '项目分类', '项目'],
          ['支出', '2024-01-01', '食品酒水', ' 中餐 ', '现金', 'CNY', '18.50', '朱建华', '食堂', '餐饮', '午餐'],
          ['支出', '2026-05-28', '行车交通', ' 停车 ', '招商银行', 'CNY', '12', '朱建华', '停车场', '', '']
        ]
      },
      {
        sheet: '收入',
        data: [
          ['交易类型', '日期', '一级分类', '二级分类', '账户1', '账户币种', '金额', '成员', '商家', '项目分类', '项目'],
          ['收入', '2026-05-01', '职业收入', '工资收入', '招商银行', 'CNY', '88.66', '朱建华', '公司', '', '']
        ]
      },
      {
        sheet: '忽略',
        data: [
          ['日期', '金额'],
          ['2026-01-01', '999']
        ]
      }
    ]

    const result = parseWorkbookSheets(sheets, 'sample.xlsx', '2026-05-28T10:00:00')

    expect(result.summary.transactionCount).toBe(3)
    expect(result.summary.dateStart).toBe('2024-01-01')
    expect(result.summary.dateEnd).toBe('2026-05-28')
    expect(result.transactions.some(item => item.type === 'expense')).toBe(true)
    expect(result.transactions.some(item => item.type === 'income')).toBe(true)
    expect(result.categories.find(item => item.name === '食品酒水')?.subcategories.some(item => item.name === '中餐')).toBe(true)
    expect(result.categories.find(item => item.name === '行车交通')?.subcategories.some(item => item.name === '停车')).toBe(true)
  })
})
