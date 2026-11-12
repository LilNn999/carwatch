import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { ListingItem, ModelItem } from '../api'
import ListingDrawer from '../components/ListingDrawer'
import { mileageLabel, money, stampDate } from '../format'

const PAGE_SIZE = 50

export default function LedgerPage() {
  const [models, setModels] = useState<ModelItem[]>([])
  const [rows, setRows] = useState<ListingItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const initialQuery = new URLSearchParams(window.location.search).get('q') ?? ''
  const [q, setQ] = useState(initialQuery)
  const [search, setSearch] = useState(initialQuery)
  const [modelId, setModelId] = useState<number | null>(null)
  const [favorites, setFavorites] = useState(false)
  const [view, setView] = useState<'table' | 'wall'>('table')
  const [openId, setOpenId] = useState<number | null>(() => {
    const value = new URLSearchParams(window.location.search).get('listing')
    return value ? Number(value) : null
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.models().then((data) => setModels(data.items)).catch(() => undefined)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(q.trim()); setPage(1) }, 250)
    return () => clearTimeout(timer)
  }, [q])

  const reload = () => {
    setLoading(true)
    api.query({ q: search, modelId, favorites, page, pageSize: PAGE_SIZE })
      .then((data) => { setRows(data.items); setTotal(data.total); setError(null) })
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }

  useEffect(reload, [search, modelId, favorites, page])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const groups = useMemo(() => {
    const map = new Map<string, { id: number; series: string }[]>()
    for (const model of models) {
      const [brand, ...rest] = model.name.split(' ')
      const series = rest.join(' ') || model.name
      const key = rest.length ? brand : '其他'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ id: model.id, series })
    }
    return [...map.entries()]
      .sort((a, b) => {
        const latinA = /^[A-Za-z]/.test(a[0])
        const latinB = /^[A-Za-z]/.test(b[0])
        if (latinA !== latinB) return latinA ? -1 : 1
        return a[0].localeCompare(b[0], 'zh-CN')
      })
      .map(([brand, items]) => [brand, [...items].sort((a, b) => a.series.localeCompare(b.series, 'zh-CN'))] as const)
  }, [models])
  const heading = useMemo(() => {
    const parts = [`${total} 条车源`]
    if (search) parts.push(`搜索「${search}」`)
    if (modelId) parts.push(models.find((model) => model.id === modelId)?.name ?? '')
    if (favorites) parts.push('只看收藏')
    return parts.join(' · ')
  }, [total, search, modelId, favorites, models])

  return (
    <div className="ledger">
      <header className="ledger-head">
        <div>
          <h1>车源台账</h1>
          <div className="sub">{heading}</div>
        </div>
        <div className="ledger-tools">
          <div className="view-toggle">
            <button className={`chip${view === 'table' ? ' on' : ''}`} onClick={() => setView('table')}>表格</button>
            <button className={`chip${view === 'wall' ? ' on' : ''}`} onClick={() => setView('wall')}>图片墙</button>
          </div>
        </div>
      </header>

      <div className="filters">
        <input
          className="search"
          placeholder="搜索车型、配置、地区、车况…"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <select
          className="select"
          value={modelId ?? ''}
          onChange={(event) => { setModelId(event.target.value ? Number(event.target.value) : null); setPage(1) }}
        >
          <option value="">全部车型</option>
          {groups.map(([brand, items]) => (
            <optgroup key={brand} label={brand}>
              {items.map((item) => <option key={item.id} value={item.id}>{item.series}</option>)}
            </optgroup>
          ))}
        </select>
        <button className={`chip${favorites ? ' on' : ''}`} onClick={() => { setFavorites(!favorites); setPage(1) }}>
          ★ 只看收藏
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {view === 'table' ? (
        <div className="panel ledger-panel">
          <table className="listings ledger-table">
            <thead>
              <tr>
                <th style={{ width: 52 }} />
                <th>车源</th>
                <th style={{ width: 92 }}>报价</th>
                <th style={{ width: 104 }}>里程</th>
                <th style={{ width: 116 }}>地区</th>
                <th style={{ width: 68 }}>发布</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onClick={() => setOpenId(row.id)} className="clickable">
                  <td>
                    {row.thumbnail ? <img className="row-thumb" src={row.thumbnail} alt="" loading="lazy" /> : <div className="row-thumb row-thumb-empty" />}
                  </td>
                  <td>
                    <div className="row-title">{row.display_name ?? `${row.name} ${row.trim ?? ''}`}</div>
                    <div className="row-meta">{row.year ? `上牌 ${row.year}` : '上牌未标'}{row.condition ? ` · ${row.condition.slice(0, 20)}` : ''}</div>
                  </td>
                  <td className="num row-price">
                    {row.price == null ? <span className="mut small">未标价</span> : <>{money(row.price)}<span className="row-unit">万</span></>}
                  </td>
                  <td className="num mut">{mileageLabel(row)}</td>
                  <td className="mut">{row.region || '—'}</td>
                  <td className="mut num">{stampDate(row.posted)}</td>
                  <td className="mut">{row.favorite ? '★' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <div className="empty">没有符合条件的车源</div>}
        </div>
      ) : (
        <div className="wall">
          {rows.map((row) => (
            <button key={row.id} className="wall-card" onClick={() => setOpenId(row.id)}>
              {row.thumbnail ? <img src={row.thumbnail} alt="" loading="lazy" /> : <div className="wall-empty" />}
              <div className="wall-body">
                <div className="wall-title">{row.display_name ?? row.name}</div>
                <div className="wall-price num">{row.price == null ? <span className="mut small">未标价</span> : <>{money(row.price)}<span>万</span></>}</div>
                <div className="wall-meta">{money(row.mileage)} 万公里 · {row.region || '地区未标'}</div>
              </div>
            </button>
          ))}
          {!loading && rows.length === 0 && <div className="empty">没有符合条件的车源</div>}
        </div>
      )}

      <div className="pager">
        <button className="chip" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span className="mut small">{page} / {pages}</span>
        <button className="chip" disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</button>
      </div>

      <ListingDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={reload}
        initialEditing={new URLSearchParams(window.location.search).get('edit') === '1'}
      />
    </div>
  )
}