import { useEffect, useRef, useState } from 'react'
import { api, chunkUpload } from '../api'
import type { Batch, Review } from '../api'

const CHUNK = 2 * 1024 * 1024
const ACTIVE = new Set(['uploading', 'queued', 'running'])

const relPath = (file: File) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name

const statusText: Record<string, string> = {
  uploading: '上传中', queued: '排队中', running: '解析中', done: '已完成', error: '失败',
}

export default function ImportPage() {
  const dirRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const [imported, pending] = await Promise.all([api.imports(), api.reviews()])
      setBatches(imported.items)
      setReviews(pending.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!batches.some((batch) => ACTIVE.has(batch.status))) return
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [batches])

  const upload = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    setError(null)
    try {
      const manifest = files.map((file) => ({ path: relPath(file), size: file.size }))
      const name = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : files[0].name
      const batch = await api.createImport({ name, files: manifest })
      const byPath = new Map((batch.files ?? []).map((item) => [item.path, item]))
      const total = manifest.reduce((sum, item) => sum + item.size, 0)
      let done = 0
      for (const [index, file] of files.entries()) {
        const target = byPath.get(relPath(file))
        if (!target) continue
        let offset = target.received
        while (offset < file.size) {
          const chunk = file.slice(offset, Math.min(offset + CHUNK, file.size))
          const result = await chunkUpload(batch.id, target.id, offset, chunk)
          done += result.received - offset
          offset = result.received
          setProgress({ label: `${index + 1}/${files.length} ${file.name} · ${Math.min(99, Math.round(done / total * 100))}%`, pct: Math.min(99, Math.round(done / total * 100)) })
        }
      }
      await api.completeImport(batch.id)
      setProgress({ label: '上传完成，等待解析…', pct: 100 })
      await load()
      // 等后台解析结束
      for (let i = 0; i < 120; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const current = await api.importBatch(batch.id)
        setBatches((prev) => [current, ...prev.filter((item) => item.id !== current.id)])
        if (!ACTIVE.has(current.status)) {
          if (current.status === 'error') setError(current.error ?? '解析失败')
          break
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setProgress(null)
      setBusy(false)
      await load()
    }
  }

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    void upload(files)
  }

  const act = async (batch: Batch, kind: 'retry' | 'cancel') => {
    setBusy(true)
    try {
      if (kind === 'retry') await api.retryImport(batch.id)
      else await api.cancelImport(batch.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally { setBusy(false) }
  }

  const review = async (item: Review, kind: 'confirm' | 'ignore') => {
    setBusy(true)
    try {
      if (kind === 'ignore') await api.ignoreReview(item.id)
      else {
        const approximate = /万\+|万-|左右/.test(String(item.candidate.mileage_text ?? ''))
        await api.confirmReview(item.id, { approximate_mileage: approximate, remember_units: false })
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理失败')
    } finally { setBusy(false) }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>导入</h1>
        <span className="sub">微信群导出（文件夹或 ZIP），2MB 分块续传</span>
      </div>

      {error && <div className="banner error">{error}</div>}

      <section className="panel">
        <div className="panel-head"><span className="panel-title">选择资料</span></div>
        <div className="upload-zone">
          <button className="primary" disabled={busy} onClick={() => dirRef.current?.click()}>选择文件夹</button>
          <button className="ghost" disabled={busy} onClick={() => zipRef.current?.click()}>选择 ZIP</button>
          <span className="mut small">文件夹需保留主 JSON 与 media 的相对位置</span>
          <input ref={dirRef} type="file" multiple hidden onChange={onPick} {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)} />
          <input ref={zipRef} type="file" accept=".zip" hidden onChange={onPick} />
        </div>
        {progress && (
          <div className="progress">
            <div className="progress-bar"><i style={{ width: `${progress.pct}%` }} /></div>
            <span className="mut small">{progress.label}</span>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">导入批次</span>
          <span className="panel-sub">{batches.length} 个</span>
        </div>
        {batches.length === 0 && <div className="empty">还没有导入过资料</div>}
        {batches.length > 0 && (
          <table className="listings">
            <thead><tr><th>名称</th><th style={{ width: 90 }}>状态</th><th style={{ width: 150 }}>解析进度</th><th>统计</th><th style={{ width: 96 }}>时间</th><th style={{ width: 110 }} /></tr></thead>
            <tbody>
              {batches.map((batch) => {
                const stats = Object.entries(batch.stats ?? {}).filter(([, value]) => Number(value) > 0).slice(0, 4)
                return (
                  <tr key={batch.id}>
                    <td>
                      <div className="row-title">{batch.name}</div>
                      <div className="row-meta">{batch.file_count} 个文件 · {(batch.total_bytes / 1048576).toFixed(1)} MB</div>
                    </td>
                    <td><span className={`tag ${batch.status === 'error' ? 'tag-bad' : batch.status === 'done' ? 'tag-ok' : ''}`}>{statusText[batch.status] ?? batch.status}</span></td>
                    <td className="mut num">{batch.processed}/{batch.total_messages || '—'}</td>
                    <td className="mut small">{stats.map(([key, value]) => `${key} ${value}`).join(' · ') || '—'}</td>
                    <td className="mut num">{new Date(batch.created_at).toLocaleDateString('zh-CN')}</td>
                    <td>
                      {batch.status === 'error' && <button className="ghost" disabled={busy} onClick={() => act(batch, 'retry')}>重试</button>}
                      {ACTIVE.has(batch.status) && <button className="ghost" disabled={busy} onClick={() => act(batch, 'cancel')}>取消</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {batches.some((batch) => batch.status === 'error') && (
          <div className="mut small" style={{ padding: '6px 8px' }}>
            {batches.filter((batch) => batch.status === 'error').map((batch) => `${batch.name}: ${batch.error ?? '失败'}`).join('；')}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">待校对</span>
          <span className="panel-sub">{reviews.length} 条</span>
        </div>
        {reviews.length === 0 && <div className="empty">没有待校对的项目</div>}
        {reviews.slice(0, 20).map((item) => (
          <div className="review-item" key={item.id}>
            <div className="review-main">
              <div className="row-title">{String(item.candidate.name ?? '待确认车系')}</div>
              <div className="row-meta">{[item.candidate.model_year, item.candidate.engine, item.candidate.trim].filter(Boolean).join(' · ') || '字段不全'}</div>
              <div className="mut small review-raw">{(item.raw || '').slice(0, 120)}</div>
              {item.issues.length > 0 && <div className="tag tag-warn">{item.issues.join('、')}</div>}
            </div>
            <div className="review-actions">
              <button className="ghost" disabled={busy} onClick={() => review(item, 'ignore')}>忽略</button>
              {item.kind === 'listing' && item.candidate.price != null && (
                <button className="primary" disabled={busy} onClick={() => review(item, 'confirm')}>确认</button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
