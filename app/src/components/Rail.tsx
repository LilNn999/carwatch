import type { ModelItem } from '../api'
import { deltaClass, deltaText, price } from '../format'

export type RailItem = { model: ModelItem; count: number; latest: number | null; change: number | null; series: number[] }

type Props = { items: RailItem[]; selectedId: number | null; onSelect: (id: number) => void; loading: boolean }

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="spark" />
  const w = 96
  const h = 24
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const step = w / (values.length - 1)
  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${(h - 3 - ((value - lo) / span) * (h - 6)).toFixed(1)}`).join(' ')
  return (
    <svg className="spark" width={w} height={h}>
      <path d={path} fill="none" stroke="var(--acc)" strokeWidth="1.3" opacity="0.75" />
    </svg>
  )
}

export default function Rail({ items, selectedId, onSelect, loading }: Props) {
  return (
    <aside className="rail">
      <div className="rail-head">
        <span>我的关注</span>
        <span>{items.length} 系</span>
      </div>
      {loading && items.length === 0 && <div className="rail-empty">加载中…</div>}
      {items.map((item) => (
        <button
          key={item.model.id}
          className={`rail-item${item.model.id === selectedId ? ' on' : ''}`}
          onClick={() => onSelect(item.model.id)}
        >
          <div className="rail-line">
            <span className="rail-name">{item.model.name}</span>
            <span className="rail-count num">{item.count} 辆</span>
          </div>
          <div className="rail-price">
            <span className="num">{item.latest == null ? '—' : price(item.latest)}</span>
            <span className="rail-unit">万</span>
            <span className={`rail-delta ${deltaClass(item.change)}`}>{deltaText(item.change)}</span>
          </div>
          <Spark values={item.series} />
        </button>
      ))}
      <div className="rail-foot">全部车型 →</div>
    </aside>
  )
}