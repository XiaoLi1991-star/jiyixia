const API_KEY_STORAGE_KEY = 'jiyixia-ai-api-key'

export function getAiApiKey(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(API_KEY_STORAGE_KEY) || ''
}

export function setAiApiKey(value: string): void {
  if (typeof localStorage === 'undefined') return
  const trimmed = value.trim()
  if (!trimmed) {
    localStorage.removeItem(API_KEY_STORAGE_KEY)
    return
  }
  localStorage.setItem(API_KEY_STORAGE_KEY, trimmed)
}

export function maskSecret(value: string): string {
  if (!value) return '未设置'
  if (value.length <= 8) return '已设置'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}
