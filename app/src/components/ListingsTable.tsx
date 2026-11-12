import type { ListingItem } from '../api'
import { mileageLabel, money, stampDate } from '../format'

function metaLine(row: ListingItem) {
  const parts = [row.year ? `上牌 ${row.year}` : null, row.condition ? row.condition.slice(0, 18) : null]
  return parts.filter(Boolean).join(' · ') || `${row.model_year ?? '—'}款 · ${row.engine ?? '排量未标'}`
}

export default function ListingsTable({ rows }: { rows: ListingItem[] }) {
  if (!rows.length) return <div className="empty">该范围下暂无可比车源</div>
  return (
    <table className="listings">
      <thead>
        <tr>
          <th style={{ width: 52 }} />
          <th>车源</th>
          <th style={{ width: 96 }}>报价</th>
          <th style={{ width: 110 }}>里程</th>
          <th style={{ width: 120 }}>地区</th>
          <th style={{ width: 72 }}>发布</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              {row.thumbnail
                ? <img className="row-thumb" src={row.thumbnail} alt="" loading="lazy" />
                : <div className="row-thumb row-thumb-empty" />}
            </td>
            <td>
              <div className="row-title">{row.display_name ?? `${row.name} ${row.trim ?? ''}`}</div>
              <div className="row-meta">{metaLine(row)}</div>
            </td>
            <td className="num row-price">{money(row.price)}<span className="row-unit">万</span></td>
            <td className="num mut">{mileageLabel(row)}</td>
            <td className="mut">{row.region || '—'}</td>
            <td className="mut num">{stampDate(row.posted)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}