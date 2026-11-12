import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { ListingDetail, ModelItem } from '../api'
import { mileageLabel, money, stampDate } from '../format'

type Props = { id: number | null; onClose: () => void; onChanged: () => void; initialEditing?: boolean }

type Form = {
  model_id: string; model_year: string; engine: string; trim: string
  year: string; price: string; mileage_text: string; region: string; condition: string
}

export default function ListingDrawer({ id, onClose, onChanged, initialEditing }: Props) {
  const [detail, setDetail] = useState<ListingDetail | null>(null)
  const [models, setModels] = useState<ModelItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeOptions, setMergeOptions] = useState<ListingDetail[] | []>([])
  const [mergeSource, setMergeSource] = useState('')

  useEffect(() => {
    api.models().then((data) => setModels(data.items)).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (id == null) { setDetail(null); setEditing(false); return }
    let alive = true
    setLoading(true)
    setError(null)
    setEditing(false)
    api.detail(id)
      .then((data) => {
        if (!alive) return
        setDetail(data); setNotes(data.notes ?? '')
        if (initialEditing) {
          setForm({
            model_id: String(data.model_id ?? ''),
            model_year: data.model_year ? String(data.model_year) : '',
            engine: data.engine ?? '',
            trim: data.trim ?? '',
            year: data.year ?? '',
            price: data.price != null ? String(data.price) : '',
            mileage_text: data.mileage_text ?? (data.mileage != null ? String(data.mileage) : ''),
            region: data.region ?? '',
            condition: data.condition ?? '',
          })
          setEditing(true)
        }
      })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : '加载失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const modelOptions = useMemo(() => [...models].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')), [models])

  if (id == null) return null

  const startEdit = () => {
    if (!detail) return
    setForm({
      model_id: String(detail.model_id ?? ''),
      model_year: detail.model_year ? String(detail.model_year) : '',
      engine: detail.engine ?? '',
      trim: detail.trim ?? '',
      year: detail.year ?? '',
      price: detail.price != null ? String(detail.price) : '',
      mileage_text: detail.mileage_text ?? (detail.mileage != null ? String(detail.mileage) : ''),
      region: detail.region ?? '',
      condition: detail.condition ?? '',
    })
    setError(null)
    setEditing(true)
  }

  const setField = (key: keyof Form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((prev) => (prev ? { ...prev, [key]: event.target.value } : prev))
  }

  const toggleFavorite = async () => {
    if (!detail) return
    const next = !Boolean(detail.favorite)
    setDetail({ ...detail, favorite: next })
    try {
      await api.patch(detail.id, { favorite: next })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
      setDetail({ ...detail, favorite: !next })
    }
  }

  const saveNotes = async () => {
    if (!detail) return
    setSaving(true)
    try {
      const updated = await api.patch(detail.id, { notes })
      setDetail({ ...detail, notes: updated.notes })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const openMerge = async () => {
    if (!detail) return
    try {
      const page = await api.query({ modelId: detail.model_id ?? null, pageSize: 100 })
      setMergeOptions(page.items.filter((item) => item.id !== detail.id) as unknown as ListingDetail[])
      setMergeSource('')
      setMergeOpen(true)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载可合并车源失败')
    }
  }

  const doMerge = async () => {
    if (!detail || !mergeSource) return
    setSaving(true)
    try {
      await api.merge(detail.id, Number(mergeSource))
      const fresh = await api.detail(detail.id)
      setDetail(fresh)
      setMergeOpen(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '合并失败')
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async () => {
    if (!detail || !form) return
    setSaving(true)
    setError(null)
    const body: Record<string, unknown> = {
      model_year: form.model_year.trim() === '' ? null : Number(form.model_year),
      engine: form.engine.trim(),
      trim: form.trim.trim(),
      year: form.year.trim(),
      region: form.region.trim(),
      condition: form.condition.trim(),
    }
    if (form.model_id && form.model_id !== String(detail.model_id ?? '')) body.model_id = Number(form.model_id)
    if (form.price.trim() !== '') body.price = Number(form.price)
    if (form.mileage_text.trim() !== '') body.mileage_text = form.mileage_text.trim()
    try {
      await api.patch(detail.id, body)
      const fresh = await api.detail(detail.id)
      setDetail(fresh)
      setNotes(fresh.notes ?? '')
      setEditing(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="车源详情">
        <header className="drawer-head">
          <div>
            <div className="drawer-title">{detail?.display_name ?? detail?.name ?? '加载中…'}</div>
            <div className="drawer-sub">
              #{id} · {detail ? `${detail.status === 'confirmed' ? '已确认' : detail.status} · ${stampDate(detail.posted)} 发布` : ''}
            </div>
          </div>
          <div className="drawer-actions">
            {detail && !editing && (
              <button className={`ghost${detail.favorite ? ' on' : ''}`} onClick={toggleFavorite}>
                {detail.favorite ? '★ 已收藏' : '☆ 收藏'}
              </button>
            )}
            {detail && !editing && <button className="ghost" onClick={startEdit}>编辑</button>}
            {detail && !editing && <button className="ghost" onClick={openMerge}>合并同车</button>}
            <button className="ghost" onClick={onClose}>关闭</button>
          </div>
        </header>

        <div className="drawer-body">
          {loading && <div className="empty">加载中…</div>}
          {error && <div className="banner error">{error}</div>}

          {detail && mergeOpen && (
            <section className="drawer-block">
              <div className="block-title">合并同车（把另一条发布并入本车，保留报价历史）</div>
              <div className="edit-grid">
                <label className="edit-row wide">
                  <span>选择要并入的车源</span>
                  <select value={mergeSource} onChange={(event) => setMergeSource(event.target.value)}>
                    <option value="">请选择…</option>
                    {mergeOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        #{item.id} · {item.display_name ?? item.name} · {item.price ?? '—'}万 · {item.posted ? new Date(item.posted * 1000).toLocaleDateString('zh-CN') : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="edit-actions">
                <button className="ghost" onClick={() => setMergeOpen(false)}>取消</button>
                <button className="primary" disabled={saving || !mergeSource} onClick={doMerge}>{saving ? '合并中…' : '确认合并'}</button>
              </div>
            </section>
          )}

          {detail && editing && form && (
            <section className="drawer-block">
              <div className="block-title">修正车源信息</div>
              <div className="edit-grid">
                <label className="edit-row wide">
                  <span>车型</span>
                  <select value={form.model_id} onChange={setField('model_id')}>
                    {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </select>
                </label>
                <label className="edit-row">
                  <span>款年</span>
                  <input value={form.model_year} onChange={setField('model_year')} inputMode="numeric" placeholder="2021" />
                </label>
                <label className="edit-row">
                  <span>排量</span>
                  <input value={form.engine} onChange={setField('engine')} placeholder="2.0T" />
                </label>
                <label className="edit-row wide">
                  <span>配置</span>
                  <input value={form.trim} onChange={setField('trim')} placeholder="四驱暗夜版" />
                </label>
                <label className="edit-row">
                  <span>上牌</span>
                  <input value={form.year} onChange={setField('year')} placeholder="2021-07" />
                </label>
                <label className="edit-row">
                  <span>报价（万）</span>
                  <input value={form.price} onChange={setField('price')} inputMode="decimal" placeholder="6.7" />
                </label>
                <label className="edit-row">
                  <span>里程</span>
                  <input value={form.mileage_text} onChange={setField('mileage_text')} placeholder="7.2 或 7万+" />
                </label>
                <label className="edit-row">
                  <span>地区</span>
                  <input value={form.region} onChange={setField('region')} placeholder="浙江温州" />
                </label>
                <label className="edit-row wide">
                  <span>车况</span>
                  <textarea value={form.condition} onChange={setField('condition')} rows={2} />
                </label>
              </div>
              <div className="edit-actions">
                <button className="ghost" onClick={() => setEditing(false)}>取消</button>
                <button className="primary" disabled={saving} onClick={saveEdit}>{saving ? '保存中…' : '保存修改'}</button>
              </div>
            </section>
          )}

          {detail && (
            <>
              <div className="gallery">
                {detail.images.slice(0, 9).map((image) => (
                  <button key={image.id} className="gallery-item" onClick={() => setZoom(image.url)}>
                    <img src={image.url} alt="" loading="lazy" />
                  </button>
                ))}
                {detail.images.length === 0 && <div className="gallery-empty">没有关联图片</div>}
              </div>

              <section className="drawer-block">
                <div className="block-title">报价</div>
                <div className="quote-line">
                  <span className="quote-big num">{money(detail.price)}<small>万元</small></span>
                  <span className="mut">{mileageLabel(detail)} · {detail.region || '地区未标'}</span>
                </div>
                {detail.quotes.length > 1 && (
                  <ul className="quote-list">
                    {detail.quotes.map((quote) => (
                      <li key={quote.id}>
                        <span className="num">{money(quote.amount)} 万</span>
                        <span className="mut">{new Date(quote.as_of * 1000).toLocaleDateString('zh-CN')} · {quote.is_confirmed ? '已确认' : '消息记录'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="drawer-block">
                <div className="block-title">原文</div>
                <pre className="raw-text">{detail.raw || '（未记录原文）'}</pre>
              </section>

              <section className="drawer-block">
                <div className="block-title">备注</div>
                <textarea
                  className="notes"
                  value={notes}
                  placeholder="记下这辆车的情况，比如车况疑点、卖家态度、约看车时间…"
                  onChange={(event) => setNotes(event.target.value)}
                />
                <div className="notes-actions">
                  <button className="primary" disabled={saving || notes === (detail.notes ?? '')} onClick={saveNotes}>
                    {saving ? '保存中…' : '保存备注'}
                  </button>
                </div>
              </section>

              <section className="drawer-block">
                <div className="block-title">修改记录</div>
                {detail.audit.length === 0 && <div className="mut small">暂无</div>}
                <ul className="audit-list">
                  {detail.audit.slice(0, 8).map((row, index) => (
                    <li key={index}>
                      <span>{row.action}</span>
                      <span className="mut small">{new Date(row.created_at).toLocaleString('zh-CN')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </aside>

      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" />
        </div>
      )}
    </>
  )
}