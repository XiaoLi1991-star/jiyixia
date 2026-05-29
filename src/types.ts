export type TransactionType = 'expense' | 'income'
export type TransactionStatus = 'confirmed' | 'draft'
export type TransactionSource = 'manual' | 'excel' | 'ai' | 'backup'

export interface Subcategory {
  id: string
  name: string
}

export interface Category {
  id: string
  type: TransactionType
  name: string
  subcategories: Subcategory[]
}

export interface Transaction {
  id: string
  type: TransactionType
  date: string
  categoryId: string
  subcategoryId: string
  accountName: string
  currency: string
  amountCents: number
  memberName: string
  merchant: string
  projectCategory: string
  projectName: string
  note: string
  source: TransactionSource
  status: TransactionStatus
  confidence?: number
  warnings?: string[]
  createdAt: string
  updatedAt: string
}

export interface ModelSettings {
  baseUrl: string
  model: string
  requestPath: string
  temperature: number
  maxTokens: number
  timeoutMs: number
}

export interface PrivacySettings {
  hideAmounts: boolean
}

export interface AppSettings {
  model: ModelSettings
  privacy: PrivacySettings
  lastImportName?: string
  lastImportAt?: string
}

export interface AiDraft extends Transaction {
  status: 'draft'
  source: 'ai'
  rawInput: string
}

export interface ImportSummary {
  fileName: string
  importedAt: string
  transactionCount: number
  dateStart: string
  dateEnd: string
  warnings: string[]
}

export interface BackupData {
  schemaVersion: 1
  exportedAt: string
  transactions: Transaction[]
  categories: Category[]
  drafts: AiDraft[]
  settings: AppSettings
  importSummary?: ImportSummary
}
