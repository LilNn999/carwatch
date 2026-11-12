import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { Analysis, ListingItem, ModelItem } from '../api'
import Rail, { type RailItem } from '../components/Rail'
import TrendChart from '../components/TrendChart'
import ListingsTable from '../components/ListingsTable'
import { deltaClass, deltaText, price } from '../format'

const DAY_OPTIONS = [
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
  { label: '全部', days: 3650 },
]

const RAIL_LIMIT = 10

export default function TrendPage() {
  const [watchList, setWatchList] = useState<ModelItem[]>([])
  const [totals, setTotals] = useState<Map<number, number>>(new Map())
  const [rail, setRail] = useState<RailItem[]>([])
  const [railLoading, setRailLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [days, setDays] = useState(30)
  const [view, setView] = useState<{ mode: 'auto' | 'all' } | { mode: 'cohort'; model_year: number | null; engine: string | null }>({ mode: 'auto' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [models, first] = await Promise.all([api.models(), api.listings(100)])
        if (!alive) return
        const pages = Math.max(1, Math.ceil(first.total / 100))
        const rest = pages > 1
          ? await Promise.all(Array.from({ length: pages - 1 }, (_, index) => api.listings(100, index + 2)))
          : []
        const allItems = [first, ...rest].flatMap((page) => page.items)
        const counts = new Map<number, number>()
        for (const item of allItems) {
          const id = (item as ListingItem & { model_id?: number }).model_id
          if (id != null) counts.set(id, (counts.get(id) ?? 0) + 1)
        }
        const top = [...models.items]
          .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
          .slice(0, RAIL_LIMIT)
        setWatchList(top)
        setTotals(counts)
        setSelectedId(top[0]?.id ?? null)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '加载失败')
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!watchList.length) return
    let alive = true
    setRailLoading(true)
    ;(async () => {
      const results = await Promise.all(watchList.map(async (model) => {
        try {
          const data = await api.analysis(model.id, { days })
          return {
            model,
            count: totals.get(model.id) ?? data.count,
            latest: data.series.length ? data.series[data.series.length - 1] : null,
            change: data.change,
            series: data.series,
          } satisfies RailItem
        } catch {
          return { model, count: 0, latest: null, change: null, series: [] } satisfies RailItem
        }
      }))
      if (alive) { setRail(results); setRailLoading(false) }
    })()
    return () => { alive = false }
  }, [watchList, days, totals])

  useEffect(() => {
    if (selectedId == null) return
    let alive = true
    ;(async () => {
      try {
        const data = await api.analysis(selectedId, {
          days,
          modelYear: view.mode === 'cohort' ? view.model_year : null,
          engine: view.mode === 'cohort' ? view.engine : null,
          scope: view.mode === 'all' ? 'model' : null,
        })
        if (alive) { setAnalysis(data); setError(null) }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '加载失败')
      }
    })()
    return () => { alive = false }
  }, [selectedId, days, view])

  const listingsById = useMemo(() => {
    const map = new Map<number, ListingItem>()
    analysis?.listings.forEach((item) => map.set(item.id, item))
    return map
  }, [analysis])

  const rows = useMemo(
    () => [...(analysis?.listings ?? [])].sort((a, b) => b.posted - a.posted),
    [analysis],
  )

  const selected = watchList.find((model) => model.id === selectedId) ?? null
  const groups = (analysis?.groups ?? []).slice(0, 6)

  const pickModel = (id: number) => {
    setSelectedId(id)
    setView({ mode: 'auto' })
    setAnalysis(null)
  }

  return (
    <div className="workspace">
      <Rail items={rail} selectedId={selectedId} onSelect={pickModel} loading={railLoading} />

      <main className="main">
        {error && <div className="banner error">{error}</div>}

        <div className="page-head">
          <h1>{selected?.name ?? '—'}</h1>
          <span className="sub">
            {analysis
              ? `收录 ${totals.get(selectedId ?? -1) ?? analysis.model_count} 条 · 窗口内 ${analysis.count} 条有报价`
              : '加载中…'}
          </span>
          <div className="days">
            {DAY_OPTIONS.map((option) => (
              <button
                key={option.days}
                className={`chip${days === option.days ? ' on' : ''}`}
                onClick={() => { setDays(option.days); setView({ mode: 'auto' }) }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <section className="kpis">
          <div>
            <div className="k">报价中位（P50）</div>
            <div className="kv num">{price(analysis?.median)}<small>万元</small></div>
          </div>
          <div>
            <div className="k">区间变化</div>
            <div className={`kv num ${deltaClass(analysis?.change)}`}>{deltaText(analysis?.change)}</div>
          </div>
          <div>
            <div className="k">窗口内有报价</div>
            <div className="kv num">{analysis?.count ?? '—'}<small>辆</small></div>
          </div>
          <div>
            <div className="k">报价区间</div>
            <div className="kv num">
              {analysis?.low != null && analysis?.high != null
                ? <>{price(analysis.low)}–{price(analysis.high)}<small>万</small></>
                : <span className="mut">样本不足</span>}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">报价走势</span>
            <div className="cohorts">
              <button className={`chip${view.mode === 'all' ? ' on' : ''}`} onClick={() => setView({ mode: 'all' })}>全部车型</button>
              {groups.map((group) => {
                const active = view.mode === 'cohort'
                  ? view.model_year === group.model_year && view.engine === group.engine
                  : view.mode === 'auto' && analysis?.cohort?.model_year === group.model_year && analysis?.cohort?.engine === group.engine
                return (
                  <button
                    key={`${group.model_year}-${group.engine}`}
                    className={`chip${active ? ' on' : ''}`}
                    onClick={() => setView({ mode: 'cohort', model_year: group.model_year, engine: group.engine })}
                  >
                    {group.model_year ?? '—'}款 · {group.engine ?? '—'} <span className="chip-n">{group.count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {analysis
            ? <TrendChart analysis={analysis} listings={listingsById} />
            : <div className="chart-skeleton">正在加载走势…</div>}

          <div className="legend">
            <span className="legend-note">折线＝每日中位报价　圆点＝单辆车源　底部细柱＝当日样本数</span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">该车系车源</span>
            <span className="panel-sub">{rows.length} 条 · 按发布时间</span>
          </div>
          <ListingsTable rows={rows} />
        </section>
      </main>
    </div>
  )
}