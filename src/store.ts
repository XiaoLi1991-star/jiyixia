import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_CATEGORIES, ensureCategory } from '@/data/categories'
import { createId } from '@/lib/ids'
import type { AiDraft, AppSettings, Category, ImportSummary, ModelSettings, PrivacySettings, Transaction } from '@/types'

export const DEFAULT_SETTINGS: AppSettings = {
  model: {
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M2.7-highspeed',
    requestPath: '/chat/completions',
    temperature: 0.1,
    maxTokens: 1200,
    timeoutMs: 60000
  },
  privacy: {
    hideAmounts: false
  }
}

type SettingsPatch = Partial<Omit<AppSettings, 'model' | 'privacy'>> & {
  model?: Partial<ModelSettings>
  privacy?: Partial<PrivacySettings>
}

interface AppState {
  transactions: Transaction[]
  categories: Category[]
  drafts: AiDraft[]
  settings: AppSettings
  importSummary?: ImportSummary
  addTransaction: (transaction: Omit<Transaction, 'id' | 'source' | 'status' | 'createdAt' | 'updatedAt'>) => void
  updateTransaction: (id: string, patch: Partial<Transaction>) => void
  deleteTransaction: (id: string) => void
  addDrafts: (drafts: AiDraft[], categories: Category[]) => void
  confirmDraft: (id: string) => void
  discardDraft: (id: string) => void
  importExcelData: (transactions: Transaction[], categories: Category[], summary: ImportSummary) => void
  restoreBackup: (state: Pick<AppState, 'transactions' | 'categories' | 'drafts' | 'settings' | 'importSummary'>) => void
  updateSettings: (settings: SettingsPatch) => void
  resetAll: () => void
}

function createInitialState() {
  return {
    transactions: [],
    categories: DEFAULT_CATEGORIES,
    drafts: [],
    settings: DEFAULT_SETTINGS
  }
}

function createUnusedId(prefix: string, existingIds: Set<string>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = createId(prefix, `${Date.now()}-${Math.random()}-${attempt}`)
    if (!existingIds.has(id)) return id
  }

  return createId(prefix, `${Date.now()}-${Math.random()}-${globalThis.crypto?.randomUUID?.() || existingIds.size}`)
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...createInitialState(),

      addTransaction: (transaction) => {
        const now = new Date().toISOString()
        set(state => {
          const category = state.categories.find(item => item.id === transaction.categoryId)
          const subcategory = category?.subcategories.find(item => item.id === transaction.subcategoryId)
          const mapping = ensureCategory(state.categories, transaction.type, category?.name || '', subcategory?.name || '')
          const id = createUnusedId('tx', new Set(state.transactions.map(item => item.id)))
          return {
            categories: mapping.categories,
            transactions: [
              {
                ...transaction,
                id,
                categoryId: transaction.categoryId || mapping.categoryId,
                subcategoryId: transaction.subcategoryId || mapping.subcategoryId,
                source: 'manual',
                status: 'confirmed',
                createdAt: now,
                updatedAt: now
              },
              ...state.transactions
            ]
          }
        })
      },

      updateTransaction: (id, patch) => {
        const now = new Date().toISOString()
        set(state => ({
          transactions: state.transactions.map(item => item.id === id ? { ...item, ...patch, updatedAt: now } : item)
        }))
      },

      deleteTransaction: (id) => {
        set(state => ({ transactions: state.transactions.filter(item => item.id !== id) }))
      },

      addDrafts: (drafts, categories) => {
        set(state => ({
          categories,
          drafts: [...drafts, ...state.drafts.filter(existing => !drafts.some(draft => draft.id === existing.id))]
        }))
      },

      confirmDraft: (id) => {
        const now = new Date().toISOString()
        set(state => {
          const draft = state.drafts.find(item => item.id === id)
          if (!draft) return state
          const { rawInput: _rawInput, ...transaction } = draft
          return {
            drafts: state.drafts.filter(item => item.id !== id),
            transactions: [
              { ...transaction, status: 'confirmed', updatedAt: now },
              ...state.transactions
            ]
          }
        })
      },

      discardDraft: (id) => {
        set(state => ({ drafts: state.drafts.filter(item => item.id !== id) }))
      },

      importExcelData: (transactions, categories, summary) => {
        set(state => ({
          categories,
          transactions: [
            ...transactions,
            ...state.transactions.filter(item => item.source !== 'excel')
          ],
          settings: {
            ...state.settings,
            lastImportName: summary.fileName,
            lastImportAt: summary.importedAt
          },
          importSummary: summary
        }))
      },

      restoreBackup: (backup) => {
        set({
          transactions: backup.transactions,
          categories: backup.categories,
          drafts: backup.drafts,
          settings: backup.settings,
          importSummary: backup.importSummary
        })
      },

      updateSettings: (settings) => {
        set(state => ({
          settings: {
            ...state.settings,
            ...settings,
            model: { ...state.settings.model, ...settings.model },
            privacy: { ...state.settings.privacy, ...settings.privacy }
          }
        }))
      },

      resetAll: () => {
        set(createInitialState())
      }
    }),
    {
      name: 'jiyixia-store',
      version: 1,
      storage: createJSONStorage(() => localStorage)
    }
  )
)
