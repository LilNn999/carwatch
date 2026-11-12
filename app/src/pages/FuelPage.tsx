import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { FuelData } from '../api'

export default function FuelPage() {
  const [province, setProvince] = useState('浙江')
  const [data, setData] = useState<FuelData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState({ effective_date: '', p92: '', p95: '', source_url: '' })

  const load = (target = province) => {
    api.fuel(target).then((next) => { setData(next); setError(null) })
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
  }

  useEffect(() => { load() }, [province])

  const records = data?.records ?? []
  const latest = records[records.length - 1]
  const previous = records[records.length - 2]
  const delta92 = latest && previous ? latest.p92 - previous.p92 : null

  const chart = useMemo(() => {
    const slice = records.slice(-60)
    if (slice.length < 2) return null
    const w = 900
    const h = 260
    const L = 46
    const R = 16
    const T = 12
    const B = 34
    const values = slice.flatMap((r) => [r.p92, r.p95])
    const lo = Math.min(...values) - 0.2
    const hi = Math.max(...values) + 0.2
    const x = (i: number) => L + (i / (slice.length - 1)) * (w - L - R)
    const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B)
    const line = (key: 'p92' | 'p95') => slice.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ')
    const ticks = [0, 0.5, 1].map((ratio) => lo + (hi - lo) * ratio)
    return { w, h, L, T, B, R, x, y, line, ticks, slice }
  }, [records])

  const refresh = async () => {
    setBusy(true)
    try {
      const next = await api.refreshFuel(province)
      setData(next)
      setError(next.error ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新失败')
    } finally { setBusy(false) }
  }

  const submitManual = async () => {
    setBusy(true)
    try {
      const next = await api.manualFuel({
        province,
        effective_date: manual.effective_date,
        p92: Number(manual.p92),
        p95: Number(manual.p95),
        source_url: manual.source_url,
      })
      setData(next)
      setManual({ effective_date: '', p92: '', p95: '', source_url: '' })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally { setBusy(false) }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>油价</h1>
        <span className="sub">{data?.source || '东方财富'} {data?.latest ? `· ${data.latest.effective_date} 起生效` : ''}</span>
        <div className="days">
          <select className="select" value={province} onChange={(event) => setProvince(event.target.value)}>
            {(data?.provinces ?? ['浙江']).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button className="chip" disabled={busy} onClick={refresh}>{busy ? '获取中…' : '获取最新'}</button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <section className="kpis">
        <div>
          <div className="k">92 号（元/升）</div>
          <div className="kv num">{latest ? latest.p92.toFixed(2) : '—'}{latest && <small>{data?.latest?.effective_date}</small>}</div>
        </div>
        <div>
          <div className="k">95 号（元/升）</div>
          <div className="kv num">{latest ? latest.p95.toFixed(2) : '—'}</div>
        </div>
        <div>
          <div className="k">较上次调价（92）</div>
          <div className={`kv num ${delta92 == null ? 'mut' : delta92 >= 0 ? 'up' : 'down'}`}>
            {delta92 == null ? '—' : `${delta92 >= 0 ? '+' : '−'}${Math.abs(delta92).toFixed(2)}`}
          </div>
        </div>
        <div>
          <div className="k">记录条数</div>
          <div className="kv num">{records.length}<small>次</small></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><span className="panel-title">92 / 95 号历史价（元/升）</span>
          <span className="panel-sub">来源：{data?.source || '—'}</span></div>
        {chart ? (
          <svg viewBox={`0 0 ${chart.w} ${chart.h}`} width="100%" height={chart.h}>
            {chart.ticks.map((value) => (
              <g key={value}>
                <line x1={chart.L} y1={chart.y(value)} x2={chart.w - chart.R} y2={chart.y(value)} stroke="var(--grid)" />
                <text x={chart.L - 8} y={chart.y(value) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--mut)">{value.toFixed(1)}</text>
              </g>
            ))}
            <path d={chart.line('p92')} fill="none" stroke="var(--acc)" strokeWidth="1.8" />
            <path d={chart.line('p95')} fill="none" stroke="#f97316" strokeWidth="1.8" />
            {chart.slice.map((record, index) => (
              <text key={record.effective_date} x={chart.x(index)} y={chart.h - 10} textAnchor="middle" fontSize="9" fill="var(--mut)">
                {index % Math.max(1, Math.floor(chart.slice.length / 8)) === 0 ? record.effective_date.slice(2) : ''}
              </text>
            ))}
          </svg>
        ) : <div className="empty">暂无足够的历史记录</div>}
        <div className="legend">
          <span style={{ color: 'var(--acc)' }}>— 92 号</span>
          <span style={{ color: '#f97316' }}>— 95 号</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><span className="panel-title">手动录入（有来源的调价记录）</span></div>
        <div className="manual-form">
          <input type="date" value={manual.effective_date} onChange={(e) => setManual({ ...manual, effective_date: e.target.value })} />
          <input placeholder="92 号" value={manual.p92} onChange={(e) => setManual({ ...manual, p92: e.target.value })} inputMode="decimal" />
          <input placeholder="95 号" value={manual.p95} onChange={(e) => setManual({ ...manual, p95: e.target.value })} inputMode="decimal" />
          <input placeholder="来源链接（可选）" value={manual.source_url} onChange={(e) => setManual({ ...manual, source_url: e.target.value })} />
          <button className="primary" disabled={busy || !manual.effective_date || !manual.p92 || !manual.p95} onClick={submitManual}>保存</button>
        </div>
      </section>
    </div>
  )
}