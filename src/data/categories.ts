import type { Category, TransactionType } from '@/types'

export const DEFAULT_CATEGORIES: Category[] = [
  category('expense-food', 'expense', '食品酒水', ['中餐', '伙食费', '外出美食', '早餐', '晚餐', '柴米油盐', '水果', '零食', '饮料酒水']),
  category('expense-child', 'expense', '宝宝费用', ['医疗护理', '妈妈用品', '宝宝其他', '宝宝教育', '宝宝用品', '宝宝食品']),
  category('expense-shopping', 'expense', '购物消费', ['书报杂志', '会员费', '办公用品', '宠物支出', '家具家电', '日常用品', '汽车用品', '洗护用品', '电子数码', '美妆护肤', '衣裤鞋帽', '超市购物']),
  category('expense-transport', 'expense', '行车交通', ['保养', '保险', '停车', '充电', '加油', '地铁', '打车', '火车', '维修', '驾照']),
  category('expense-travel', 'expense', '出差旅游', ['交通费', '住宿费', '其他消费', '娱乐费', '门票', '餐饮费']),
  category('expense-home', 'expense', '居家生活', ['快递费', '水费', '燃气费', '物业费', '电费', '维修费']),
  category('expense-finance', 'expense', '金融保险', ['人身保险', '房贷', '税费', '车位费']),
  category('expense-gift', 'expense', '人情费用', ['乔迁', '婚嫁', '孝敬长辈', '寿辰', '红包', '纪念日']),
  category('expense-phone', 'expense', '交流通讯', ['手机话费']),
  category('expense-medical', 'expense', '医疗教育', ['学费', '治疗费', '知识付费', '药品费']),
  category('expense-fun', 'expense', '休闲娱乐', ['网游']),
  category('expense-other', 'expense', '其他支出', ['其他']),
  category('income-work', 'income', '职业收入', ['公积金提现', '兼职收入', '工资收入', '理财收入']),
  category('income-gift', 'income', '人情收礼', ['所收红包']),
  category('income-other', 'income', '其他收入', ['二手', '回收', '意外来钱', '租房补贴', '经营所得', '其他'])
]

function category(id: string, type: TransactionType, name: string, subcategoryNames: string[]): Category {
  return {
    id,
    type,
    name,
    subcategories: subcategoryNames.map(name => ({ id: `${id}-${slugifyName(name)}`, name }))
  }
}

export function normalizeName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

export function slugifyName(value: string): string {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash.toString(36)
}

export function findCategory(categories: Category[], type: TransactionType, name: string): Category | undefined {
  const normalized = normalizeName(name)
  return categories.find(item => item.type === type && item.name === normalized)
}

export function findSubcategory(category: Category, name: string) {
  const normalized = normalizeName(name)
  return category.subcategories.find(item => item.name === normalized)
}

export function ensureCategory(categories: Category[], type: TransactionType, categoryName: string, subcategoryName: string): {
  categories: Category[]
  categoryId: string
  subcategoryId: string
} {
  const normalizedCategory = normalizeName(categoryName) || (type === 'income' ? '其他收入' : '其他支出')
  const normalizedSubcategory = normalizeName(subcategoryName) || '其他'
  const existingCategory = findCategory(categories, type, normalizedCategory)

  if (existingCategory) {
    const existingSubcategory = findSubcategory(existingCategory, normalizedSubcategory)
    if (existingSubcategory) {
      return { categories, categoryId: existingCategory.id, subcategoryId: existingSubcategory.id }
    }
    const subcategory = { id: `${existingCategory.id}-${slugifyName(normalizedSubcategory)}`, name: normalizedSubcategory }
    return {
      categories: categories.map(item => item.id === existingCategory.id ? { ...item, subcategories: [...item.subcategories, subcategory] } : item),
      categoryId: existingCategory.id,
      subcategoryId: subcategory.id
    }
  }

  const id = `${type}-custom-${slugifyName(normalizedCategory)}`
  const subcategory = { id: `${id}-${slugifyName(normalizedSubcategory)}`, name: normalizedSubcategory }
  return {
    categories: [...categories, { id, type, name: normalizedCategory, subcategories: [subcategory] }],
    categoryId: id,
    subcategoryId: subcategory.id
  }
}
