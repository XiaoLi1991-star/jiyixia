export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export function currentYear(): string {
  return new Date().getFullYear().toString()
}

export function monthOf(date: string): string {
  return normalizeDate(date).slice(0, 7)
}

export function yearOf(date: string): string {
  return normalizeDate(date).slice(0, 4)
}

export function normalizeDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toLocalIso(value)
  const text = String(value ?? '').trim()
  if (!text) return toLocalIso(new Date())
  const normalized = text.replace(/\//g, '-').replace(' ', 'T')
  const parsed = new Date(normalized)
  if (!Number.isNaN(parsed.getTime())) return toLocalIso(parsed)
  const datePart = text.match(/\d{4}-\d{1,2}-\d{1,2}/)?.[0]
  return datePart ? `${datePart}T00:00:00` : toLocalIso(new Date())
}

function toLocalIso(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds())
  ].join('')
}
