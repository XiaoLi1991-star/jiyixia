export function parseAmountCents(value: unknown): number {
  const normalized = String(value ?? '')
    .trim()
    .replace(/,/g, '')
    .replace(/[￥¥元\s]/g, '')
  if (!normalized) return 0
  const amount = Number(normalized)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

export function formatMoney(cents: number, hide = false): string {
  if (hide) return '¥ ****'
  const sign = cents < 0 ? '-' : ''
  const value = Math.abs(cents) / 100
  return `${sign}¥ ${value.toLocaleString('zh-CN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })}`
}

export function formatCompactMoney(cents: number, hide = false): string {
  if (hide) return '¥ ****'
  const sign = cents < 0 ? '-' : ''
  const value = Math.abs(cents) / 100
  if (value < 100000) return formatMoney(cents)
  if (value >= 100000000) {
    return `${sign}¥ ${(value / 100000000).toLocaleString('zh-CN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })}亿`
  }
  return `${sign}¥ ${(value / 10000).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}万`
}

export function centsToYuan(cents: number): number {
  return Math.round(cents) / 100
}
