import type { BackupData } from '@/types'

export function serializeBackup(data: Omit<BackupData, 'schemaVersion' | 'exportedAt'>): string {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    ...data
  } satisfies BackupData, null, 2)
}

export function parseBackup(text: string): BackupData {
  const data = JSON.parse(text) as BackupData
  if (data.schemaVersion !== 1) throw new Error('暂不支持这个备份版本。')
  if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) throw new Error('备份文件格式不正确。')
  return data
}
