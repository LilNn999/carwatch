export const price = (value: number | null | undefined) =>
  value == null ? '—' : value.toFixed(2)

export const money = (value: number | null | undefined) =>
  value == null ? '—' : (Math.round(value * 100) / 100).toString()

export const mileage = (value: number | null | undefined) =>
  value == null ? '—' : (Math.round(value * 10) / 10).toString()

export const mileageLabel = (row: { mileage?: number | null; mileage_text?: string | null }) => {
  const raw = (row.mileage_text ?? '').replace(/\s+/g, '')
  if (/万\+|万-|万左右/.test(raw)) return raw.replace('公里', '')
  return row.mileage == null ? '—' : `${mileage(row.mileage)} 万公里`
}

export const shortDate = (iso: string) => iso.slice(5)

export const stampDate = (unix: number) => {
  const d = new Date(unix * 1000)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}

export const deltaText = (value: number | null | undefined) =>
  value == null ? '—' : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`

export const deltaClass = (value: number | null | undefined) =>
  value == null ? 'mut' : value >= 0 ? 'up' : 'down'