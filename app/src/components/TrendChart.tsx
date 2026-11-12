import { useEffect, useMemo, useRef, useState } from 'react'
import type { Analysis, ListingItem } from '../api'
import { money, shortDate } from '../format'

const YEAR_COLORS = ['#5b5bd6', '#38bdf8', '#f472b6', '#fb923c', '#34d399', '#a78bfa', '#fbbf24']

type Props = { analysis: Analysis; listings: Map<number, ListingItem> }

export default function TrendChart({ analysis, listings }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(920)
  const [hovered, setHovered] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 920
      setWidth(Math.max(560, Math.round(next)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const H = 320
  const L = 54
  const R = 26
  const T = 14
  const B = 62
  const plotW = width - L - R
  const plotH = H - T - B

  const labels = analysis.labels.length ? analysis.labels : [...new Set(analysis.observations.map((o) => o.observed_at))].sort()
  const points = analysis.observations
  const series = analysis.series

  const years = useMemo(() => [...new Set(points.map((p) => p.model_year ?? 0))].sort(), [points])
  const colorOf = (year: number | null) => YEAR_COLORS[Math.max(0, years.indexOf(year ?? 0)) % YEAR_COLORS.length]

  const allValues = [...points.map((p) => p.price), ...series]
  const rawMin = Math.min(...allValues)
  const rawMax = Math.max(...allValues)
  const pad = Math.max(0.25, (rawMax - rawMin) * 0.08)
  const lo = rawMin - pad
  const hi = rawMax + pad

  const xOf = (index: number) => (labels.length <= 1 ? L + plotW / 2 : L + (index / (labels.length - 1)) * plotW)
  const yOf = (value: number) => T + plotH - ((value - lo) / (hi - lo)) * plotH

  const linePath = series
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${xOf(index).toFixed(1)},${yOf(value).toFixed(1)}`)
    .join(' ')

  const maxCount = Math.max(1, ...analysis.daily_counts)
  const hoveredPoint = points.find((p) => p.id === hovered) ?? null
  const hoveredIndex = hoveredPoint ? labels.indexOf(hoveredPoint.observed_at) : -1

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * width
    const y = ((event.clientY - rect.top) / rect.height) * H
    let best: { id: number; dist: number } | null = null
    for (const point of points) {
      const index = labels.indexOf(point.observed_at)
      if (index < 0) continue
      const dist = Math.hypot(xOf(index) - x, yOf(point.price) - y)
      if (dist < 18 && (!best || dist < best.dist)) best = { id: point.id, dist }
    }
    setHovered(best ? best.id : null)
  }

  const tooltipLeft = hoveredIndex >= 0 ? Math.min(width - 250, Math.max(8, xOf(hoveredIndex) + 16)) : 0
  const tooltipTop = hoveredPoint ? Math.max(8, yOf(hoveredPoint.price) - 62) : 0

  return (
    <div className="chart" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${width} ${H}`}
        width="100%"
        height={H}
        onMouseMove={handleMove}
        onMouseLeave={() => setHovered(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = lo + (hi - lo) * ratio
          const y = yOf(value)
          return (
            <g key={ratio}>
              <line x1={L} y1={y} x2={L + plotW} y2={y} stroke="var(--grid)" strokeWidth="1" />
              <text x={L - 10} y={y + 3.5} textAnchor="end" fontSize="10.5" fill="var(--mut)">{value.toFixed(1)}</text>
            </g>
          )
        })}

        {labels.map((label, index) => (
          <text key={label} x={xOf(index)} y={T + plotH + 50} textAnchor="middle" fontSize="10.5" fill="var(--mut)">
            {shortDate(label)}
          </text>
        ))}

        {analysis.daily_counts.map((count, index) => {
          const height = Math.max(2, (count / maxCount) * 12)
          return (
            <g key={labels[index] ?? index}>
              <rect x={xOf(index) - 9} y={T + plotH + 12 - height} width="18" height={height} rx="1" fill="var(--acc-soft)" />
              <text x={xOf(index)} y={T + plotH + 36} textAnchor="middle" fontSize="9.5" fill="var(--mut)">{count}</text>
            </g>
          )
        })}

        {series.length > 1 && (
          <path d={linePath} fill="none" stroke="var(--acc)" strokeWidth="1.7" strokeLinejoin="round" />
        )}

        {points.map((point) => {
          const index = labels.indexOf(point.observed_at)
          if (index < 0) return null
          return (
            <circle
              key={point.id}
              cx={xOf(index)}
              cy={yOf(point.price)}
              r={hovered === point.id ? 5.4 : 4.2}
              fill={colorOf(point.model_year)}
              stroke="var(--panel)"
              strokeWidth="1.3"
              opacity={hovered === null || hovered === point.id ? 0.92 : 0.55}
            />
          )
        })}

        {hoveredPoint && hoveredIndex >= 0 && (
          <line
            x1={xOf(hoveredIndex)} y1={T} x2={xOf(hoveredIndex)} y2={T + plotH}
            stroke="var(--bd-strong)" strokeDasharray="3 3"
          />
        )}
      </svg>

      {hoveredPoint && (
        <div className="chart-tip" style={{ left: tooltipLeft, top: tooltipTop }}>
          <TipBody point={hoveredPoint} listing={listings.get(hoveredPoint.id)} />
        </div>
      )}
    </div>
  )
}

function TipBody({ point, listing }: { point: Analysis['observations'][number]; listing?: ListingItem }) {
  return (
    <div className="tip-grid">
      {listing?.thumbnail
        ? <img className="tip-thumb" src={listing.thumbnail} alt="" />
        : <div className="tip-thumb tip-thumb-empty" />}
      <div className="tip-main">
        <div className="tip-title">{listing?.display_name ?? `${point.name ?? ''} ${point.trim ?? ''}`}</div>
        <div className="tip-meta">{point.model_year ?? '—'}款 · {point.engine ?? '排量未标'} · {money(listing?.mileage)}万公里</div>
        <div className="tip-meta">{point.region ?? '地区未标'} · {point.observed_at}</div>
        <div className="tip-price num">
          {money(point.price)}<span className="tip-unit">万元</span>
        </div>
      </div>
    </div>
  )
}
