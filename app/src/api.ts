export type ModelItem = { id: number; name: string; followed: number | boolean; aliases?: string[] }

export type Group = { model_year: number | null; engine: string | null; count: number }

export type Observation = {
  id: number; price: number; observed_at: string; name: string | null
  model_year: number | null; engine: string | null; trim: string | null; region: string | null
}

export type ListingItem = {
  id: number; name: string; display_name?: string | null; trim?: string | null
  model_year?: number | null; engine?: string | null; price?: number | null; mileage?: number | null
  region?: string | null; posted: number; thumbnail?: string | null; image_count?: number
  mileage_text?: string | null
  condition?: string | null; year?: string | null; status?: string
  model_id?: number; favorite?: number | boolean; notes?: string | null
}

export type Analysis = {
  model_id: number | null; count: number; model_count: number; broad: boolean
  median: number | null; low: number | null; high: number | null; change: number | null
  insufficient: boolean; scope: string; labels: string[]; series: number[]; daily_counts: number[]
  observations: Observation[]; cohort: { model_year: number | null; engine: string | null } | null
  groups: Group[]; listings: ListingItem[]
}

export type ListingPage = { items: ListingItem[]; total: number; page: number; page_size: number }

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { 'X-Requested-With': 'CarWatch' } })
  if (!response.ok) {
    let detail = '请求失败'
    try { detail = (await response.json())?.detail ?? detail } catch { /* ignore */ }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export const api = {
  models: () => get<{ items: ModelItem[] }>('/api/models'),
  listings: (pageSize = 100, page = 1) => get<ListingPage>(`/api/listings?page_size=${pageSize}&page=${page}`),
  query: (opts: { q?: string; modelId?: number | null; favorites?: boolean; page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams()
    if (opts.q) query.set('q', opts.q)
    if (opts.modelId != null) query.set('model_id', String(opts.modelId))
    if (opts.favorites) query.set('favorites', 'true')
    query.set('page', String(opts.page ?? 1))
    query.set('page_size', String(opts.pageSize ?? 50))
    return get<ListingPage>(`/api/listings?${query.toString()}`)
  },
  detail: (id: number) => get<ListingDetail>(`/api/listings/${id}`),
  patch: async (id: number, body: Record<string, unknown>) => {
    const response = await fetch(`/api/listings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'CarWatch' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      let detail = '保存失败'
      try { detail = (await response.json())?.detail ?? detail } catch { /* ignore */ }
      throw new Error(detail)
    }
    return response.json() as Promise<ListingDetail>
  },
  fuel: (province: string) => get<FuelData>(`/api/fuel?province=${encodeURIComponent(province)}`),
  refreshFuel: (province: string) => send<FuelData>('/api/fuel/refresh', 'POST', { province }),
  manualFuel: (body: Record<string, unknown>) => send<FuelData>('/api/fuel/manual', 'POST', body),
  imports: () => get<{ items: Batch[] }>('/api/imports'),
  importBatch: (id: string) => get<Batch>(`/api/imports/${id}`),
  createImport: (body: Record<string, unknown>) => send<Batch>('/api/imports', 'POST', body),
  completeImport: (id: string) => send<Batch>(`/api/imports/${id}/complete`, 'POST', {}),
  retryImport: (id: string) => send<Batch>(`/api/imports/${id}/retry`, 'POST', {}),
  cancelImport: (id: string) => send<Batch>(`/api/imports/${id}/cancel`, 'POST', {}),
  merge: (targetId: number, sourceId: number) => send<ListingDetail>(`/api/listings/${targetId}/merge`, 'POST', { source_id: sourceId }),
  reviews: () => get<{ items: Review[]; total: number }>('/api/reviews'),
  confirmReview: (id: number, body: Record<string, unknown>) => send<unknown>(`/api/reviews/${id}/confirm`, 'POST', body),
  ignoreReview: (id: number) => send<unknown>(`/api/reviews/${id}/ignore`, 'POST', {}),
  analysis: (modelId: number, opts: { days?: number; modelYear?: number | null; engine?: string | null; scope?: string | null } = {}) => {
    const query = new URLSearchParams()
    query.set('days', String(opts.days ?? 30))
    if (opts.modelYear != null) query.set('model_year', String(opts.modelYear))
    if (opts.engine) query.set('engine', opts.engine)
    if (opts.scope) query.set('scope', opts.scope)
    return get<Analysis>(`/api/models/${modelId}/analysis?${query.toString()}`)
  },
}

export type ListingDetail = ListingItem & {
  model_id: number; raw: string; favorite: number | boolean; notes?: string | null; sale_state?: string
  quotes: { id: number; amount: number; as_of: number; is_confirmed: number; raw_price: string }[]
  images: { id: string; url: string; status: string }[]
  audit: { created_at: string; action: string; detail: string }[]
}


export type FuelRecord = { effective_date: string; p92: number; p95: number; source: string }
export type FuelData = {
  province: string; status: string; source: string; source_url: string; error: string | null
  records: FuelRecord[]; latest: { effective_date: string; p92: number; p95: number } | null
  provinces: string[]
}

export type BatchFile = { id: number; path: string; size: number; received: number }
export type Batch = {
  id: string; name: string; status: string; created_at: string; updated_at: string
  processed: number; total_messages: number; stats: Record<string, number>; warnings: string[]
  error: string | null; file_count: number; total_bytes: number; received_bytes: number
  files?: BatchFile[]
}

export type Review = {
  id: number; kind: string; raw: string; issues: string[]; listing_id: number | null
  candidate: Record<string, unknown>; source: string; posted: number
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'CarWatch' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = '请求失败'
    try { detail = (await response.json())?.detail ?? detail } catch { /* ignore */ }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export const thumbUrl = (id: string) => `/api/media/${id}?thumb=1`

export const chunkUpload = async (batchId: string, fileId: number, offset: number, chunk: Blob) => {
  const response = await fetch(`/api/imports/${batchId}/files/${fileId}?offset=${offset}`, {
    method: 'PUT',
    headers: { 'X-Requested-With': 'CarWatch' },
    body: chunk,
  })
  if (!response.ok) {
    let detail = '上传失败'
    try { detail = (await response.json())?.detail ?? detail } catch { /* ignore */ }
    throw new Error(detail)
  }
  return response.json() as Promise<{ received: number }>
}