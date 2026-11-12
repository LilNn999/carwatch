/* Pure presentation helpers. Imported content is escaped at every HTML boundary. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const icon = name => window.CarWatchIcons(name);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const fmt = (value, digits = 2) => finite(value) ? value.toFixed(digits) : '—';
  const count = value => finite(value) ? value.toLocaleString('zh-CN') : '—';
  const text = value => value === null || value === undefined || value === '' ? '未知' : String(value);
  const attrs = values => Object.entries(values).map(([k,v]) => v === false || v === null || v === undefined ? '' : v === true ? ` ${k}` : ` ${k}="${esc(v)}"`).join('');
  const button = (label, action, values = {}, kind = '') => `<button type="button" class="button ${kind}" data-action="${esc(action)}"${attrs(values)}>${label}</button>`;
  const tag = (label, kind = 'gray') => `<span class="tag ${kind}">${esc(label)}</span>`;
  const notice = (message, kind = '') => `<div class="notice ${kind}">${icon(kind === 'amber' || kind === 'error' ? 'alert' : 'shield')}<span class="grow">${esc(message)}</span></div>`;
  const option = (value, label, selected) => `<option value="${esc(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
  const array = value => Array.isArray(value) ? value : [];
  const validId = value => Number.isInteger(Number(value)) && Number(value) > 0;

  function date(value, withTime = false) {
    if (value === null || value === undefined || value === '') return '未知';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return Number.isFinite(Date.parse(`${value}T00:00:00+08:00`)) ? value : '未知';
    }
    let source = value;
    if (typeof value === 'number') source = value * 1000;
    else if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(String(value))) source = `${String(value).replace(' ', 'T')}+08:00`;
    const d = new Date(source);
    if (!Number.isFinite(d.getTime())) return '未知';
    const parts = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', ...(withTime ? {hour:'2-digit', minute:'2-digit', hourCycle:'h23'} : {})}).formatToParts(d);
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}${withTime ? ` ${p.hour}:${p.minute}` : ''}`;
  }
  const today = () => date(Date.now() / 1000);
  function safeURL(value) {
    if (!value) return '';
    try {
      const url = new URL(String(value));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }
  function imageURL(value) {
    if (!value) return '';
    try {
      const url = new URL(String(value), location.origin);
      return url.origin === location.origin && /^\/api\/media\/[a-f\d]{64}$/i.test(url.pathname) ? `${url.pathname}${url.searchParams.get('thumb') === '1' ? '?thumb=1' : ''}` : '';
    } catch { return ''; }
  }
  function sourceLink(url, label = '打开来源') {
    const safe = safeURL(url);
    return safe ? `<a class="inline-link fuel-source-url" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : `<span class="muted">来源链接：未知</span>`;
  }
  function heading(title, description, actions = '') {
    return `<div class="page-heading"><div><h1>${esc(title)}<span class="title-orbit"></span></h1><p>${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
  }
  function empty(title, description, action = '', compact = false) {
    return `<div class="empty-state${compact ? ' compact' : ''}">${icon('folder')}<h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
  }
  function error(message, action = 'reload') {
    return `<div class="error-state">${empty('资料未能读取', message, button(`${icon('refresh')}重新读取`, action, {}, 'small'))}</div>`;
  }
  function loading(message = '正在读取本机资料') {
    return empty(message, '读取完成后会显示真实资料。', '', true);
  }
  function status(item) {
    if (item.sale_state === 'sold') return tag('已售', 'gray');
    if (item.status === 'confirmed') return tag('已录入', 'blue');
    if (item.status === 'excluded') return tag('不计入行情', 'gray');
    return tag('待处理', 'amber');
  }
  function price(item) {
    if (item.status !== 'confirmed') return `<span class="price-text">${esc(item.price_text || (finite(item.price) ? fmt(item.price) : '报价未知'))}</span><small class="table-sub">${finite(item.price) ? `候选数字 ${fmt(item.price)} · ` : ''}候选 / 单位待确认</small>`;
    if (!finite(item.price)) return '<span class="unknown">暂无报价</span>';
    return `<span class="price-value">${fmt(item.price)}<small>万元</small></span>`;
  }
  function mileage(item) {
    const raw = String(item.mileage_text || '');
    if (/万[+\-左右]$/.test(raw)) return esc(raw);
    if (finite(item.mileage)) return `${fmt(item.mileage, 2)} 万公里`;
    return raw ? esc(raw) : '';
  }
  function thumbnail(item, large = false) {
    const url = imageURL(item.thumbnail);
    return url ? `<img class="${large ? 'compare-photo' : ''}" src="${esc(url)}" alt="${esc(text(item.name))}附件预览，关联状态见详情" loading="lazy">` : large ? '<img class="car-illustration" src="/static/assets/tech-car.svg" alt="车型示意图，非车源实拍">' : icon('car');
  }
  function modelOptions(models, selected, all = false) {
    return `${all ? option('', '全部车型', selected) : ''}${array(models).map(m => option(m.id, m.name, selected)).join('')}`;
  }
  function modelPicker(s, control = 'model') {
    return `<label class="select-wrap model-picker"><span class="sr-only">选择车型</span><select data-control="${control}" aria-label="选择车型">${modelOptions(s.models, s.modelId)}</select></label>`;
  }
  function rangeButtons(days) {
    return `<div class="segmented" aria-label="观察时间范围">${[7,30,90,365].map(n => `<button type="button" data-action="range" data-days="${n}" class="${Number(days) === n ? 'active' : ''}" aria-pressed="${Number(days) === n}">${n}天</button>`).join('')}</div>`;
  }
  function cohortChips(a) {
    const groups = array(a?.groups);
    if (!groups.length || a?.broad) return '';
    const active = a?.cohort || {};
    return `<div class="cohort-chips" role="group" aria-label="按款年和排量选择可比组">${groups.map((g,i)=>{
      const unknown = g.model_year === null || g.model_year === undefined || !g.engine;
      const on = !unknown && String(g.model_year) === String(active.model_year ?? '') && String(g.engine) === String(active.engine ?? '');
      return `<button type="button" class="cohort-chip${on ? ' active' : ''}" data-action="cohort-group" data-index="${i}" aria-pressed="${on}"${unknown ? ' disabled' : ''}>${esc(g.model_year ? `${g.model_year}款` : '款年未知')} / ${esc(g.engine || '排量未知')}<span>${count(g.count)}辆</span></button>`;
    }).join('')}</div>`;
  }
  function listingTable(items, s, compact = false) {
    if (!array(items).length) return empty('还没有符合条件的车源', '可调整筛选条件，或导入聊天记录；价格与里程会直接写入台账。', button('导入资料', 'navigate', {'data-target':'import'}, 'small'), true);
    const compared = new Set(array(s.compareItems).map(x => Number(x.id)));
    return `<div class="table-scroll"><table class="data-table"><thead><tr><th>车型 / 配置</th><th>上牌 / 里程</th><th>整车报价</th><th>状态 / 地区</th>${compact ? '' : '<th>来源 / 发布时间</th>'}<th>操作</th></tr></thead><tbody>${items.map(c => {
      const inCompare = compared.has(Number(c.id));
      return `<tr><td><div class="vehicle-cell"><span class="vehicle-thumb">${thumbnail(c)}</span><div><strong>${esc(text(c.name))}</strong><small>${esc([c.model_year ? `${c.model_year}款` : '款年未知', c.engine || '动力未知', c.trim || '配置未知'].join(' / '))}</small></div></div></td><td>${esc(text(c.year))}<span class="table-sub">${mileage(c)}</span></td><td class="price-cell ${c.status !== 'confirmed' ? 'pending-price' : ''}">${price(c)}</td><td>${status(c)}<small class="table-sub pre-wrap">${esc(text(c.region))}</small></td>${compact ? '' : `<td class="condition-cell">${esc(text(c.source))}<small class="table-sub">${esc(date(c.posted, true))}</small></td>`}<td><div class="row-actions"><button type="button" class="favorite-button ${c.favorite ? 'active' : ''}" data-action="favorite" data-id="${esc(c.id)}" aria-label="${c.favorite ? '取消收藏' : '收藏'} ${esc(text(c.name))}" aria-pressed="${Boolean(c.favorite)}">${icon('star')}</button>${button('详情', 'detail', {'data-id':c.id}, 'small')}${compact ? '' : button(inCompare ? '移出对比' : '加入对比', 'compare-toggle', {'data-id':c.id, disabled:!inCompare && compared.size >= 4}, `small ${inCompare ? 'soft' : ''}`)}</div></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  // Every chart config contains aligned labels and finite values only. No padding of history.
  function cleanChart(config) {
    const series = array(config.series);
    const rawCounts = array(config.counts);
    const hasCounts = rawCounts.length === array(config.labels).length;
    const pairs = array(config.labels).map((label, i) => ({label, count:hasCounts?rawCounts[i]:undefined, values:series.map(s => array(s.values)[i])})).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(String(p.label)) && Number.isFinite(Date.parse(`${p.label}T00:00:00+08:00`)) && p.values.length && p.values.every(finite));
    pairs.sort((a,b)=>String(a.label).localeCompare(String(b.label)));
    const labels = pairs.map(p => String(p.label));
    const points = array(config.points).filter(p => p && labels.includes(String(p.date)) && finite(Number(p.value)));
    return {...config, labels, counts:hasCounts?pairs.map(p => p.count):undefined, points, series:series.map((s,i) => ({...s, values:pairs.map(p => p.values[i])}))};
  }
  function chart(config, emptyMessage = '暂无可绘制的已确认观察值。') {
    const c = cleanChart(config);
    if (!c.labels.length || !c.series.length) return `<div class="chart-empty"><div><strong>暂无趋势数据</strong><p>${esc(emptyMessage)}</p></div></div>`;
    const sampleHeading = array(c.counts).length ? '<th>当日样本</th>' : '';
    const sampleCells = i => array(c.counts).length ? `<td>${count(c.counts[i])} 辆</td>` : '';
    return `<div class="chart-box" data-chart="${esc(JSON.stringify(c))}"></div><div class="chart-footer">${c.series.length > 1 ? `<div class="chart-legend">${c.series.map((s,i) => `<span><i class="legend-stroke ${(s.slot ?? i) === 1 ? 'secondary' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>` : `<span class="note-line">${esc(c.series[0].name)}</span>`}<span class="note-line">${c.labels.length === 1 ? '仅有 1 个观察日期，显示实测点' : '仅显示有效观察日期，不填补缺失值'} · 可用方向键查看</span></div><details class="chart-data"><summary>查看图表数据</summary><table><thead><tr><th>日期</th>${sampleHeading}${c.series.map(s => `<th>${esc(s.name)} / ${esc(c.unit || '万元')}</th>`).join('')}</tr></thead><tbody>${c.labels.map((l,i) => `<tr><td>${esc(l)}</td>${sampleCells(i)}${c.series.map(s => `<td>${fmt(s.values[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
  }
  function sufficient(a) { return a && finite(a.count) && a.count >= 5 && !a.insufficient && !a.broad; }
  function observationTable(rows, summary = '查看每辆车最近一次报价') {
    const list = array(rows);
    if (!list.length) return '';
    return `<details class="chart-data"><summary>${esc(summary)}</summary><table><thead><tr><th>观察日期</th><th>车型 / 配置</th><th>地区</th><th>报价 / 万元</th></tr></thead><tbody>${list.map(p=>`<tr><td>${esc(p.observed_at)}</td><td>${esc([p.model_year?`${p.model_year}款`:'',p.engine,p.trim].filter(Boolean).join(' / ')||p.name||`车源 #${p.id}`)}</td><td>${esc(p.region||'未知')}</td><td>${fmt(p.price)}</td></tr>`).join('')}</tbody></table></details>`;
  }
  function observationChart(a) {
    const rows = array(a?.observations).filter(o => finite(o.price) && /^\d{4}-\d{2}-\d{2}$/.test(String(o.observed_at))).sort((x,y) => String(x.observed_at).localeCompare(String(y.observed_at)) || Number(x.id)-Number(y.id));
    if (!rows.length) return `<div class="chart-empty"><div><strong>没有可展示的实测报价</strong><p>当前范围内没有已确认报价；可在车源台账补充或修正报价。</p></div></div>`;
    const width=720,height=260,left=54,right=28,top=26,bottom=44;
    const plotW=width-left-right,plotH=height-top-bottom;
    const prices=rows.map(o=>o.price),min=Math.min(...prices),max=Math.max(...prices);
    const spread=Math.max(.1,max-min),rough=spread/3.5,power=10**Math.floor(Math.log10(rough));
    const tick=[1,2,2.5,5,10].map(n=>n*power).find(n=>n>=rough)||power*10;
    const low=Math.floor((min-spread*.15)/tick)*tick,high=Math.ceil((max+spread*.15)/tick)*tick;
    const dates=[...new Set(rows.map(o=>o.observed_at))].sort();
    const times=dates.map(d=>Date.parse(`${d}T00:00:00+08:00`));
    const pad=36;const baseX=d=>dates.length===1?left+plotW/2:left+pad+(Date.parse(`${d}T00:00:00+08:00`)-times[0])/(times.at(-1)-times[0])*(plotW-pad*2);
    const y=v=>top+(high-v)/(high-low)*plotH;
    const byDate={};rows.forEach(o=>{(byDate[o.observed_at]??=[]).push(o)});
    const points=[];Object.values(byDate).forEach(list=>list.forEach((o,i)=>{const offset=(i-(list.length-1)/2)*18;points.push({...o,x:Math.max(left+9,Math.min(width-right-9,baseX(o.observed_at)+offset)),y:y(o.price)})}));
    const lowPoint=points.reduce((a,b)=>b.price<a.price?b:a,points[0]);
    const highPoint=points.reduce((a,b)=>b.price>a.price?b:a,points[0]);
    let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="同车型全部 ${rows.length} 辆实测报价，单位万元；仅展示已记录报价，不做可比估值"><text x="${left}" y="14" class="chart-axis-label">万元</text>`;
    for(let n=low;n<=high+tick*.001;n+=tick) svg+=`<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${y(n)}" y2="${y(n)}"/><text class="chart-axis-label" x="${left-10}" y="${y(n)+4}" text-anchor="end">${n.toFixed(tick<.1?2:1)}</text>`;
    dates.forEach(d=>{svg+=`<text class="chart-axis-label" x="${baseX(d)}" y="${height-14}" text-anchor="middle">${esc(d)}</text>`});
    points.forEach(p=>{
      const label=[p.name,p.trim,p.region].filter(Boolean).join(' / ')||`车源 #${p.id}`;
      svg+=`<circle class="chart-point observation-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="var(--series-1)" tabindex="0" role="img" aria-label="${esc(`${p.observed_at}，${fmt(p.price)} 万元，${label}`)}"><title>${esc(`${p.observed_at} · ${fmt(p.price)} 万元 · ${label}`)}</title></circle>`;
      if(p===lowPoint||p===highPoint) svg+=`<text class="chart-end-label" x="${p.x.toFixed(1)}" y="${(p.y-11).toFixed(1)}" text-anchor="middle">${fmt(p.price)}</text>`;
    });
    svg+='</svg>';
    const table=observationTable(points,'查看实测报价数据');
    return `<div class="chart-box observation-chart">${svg}</div><div class="chart-footer"><span class="note-line">每点为一辆车的最近一次已确认报价</span><span class="note-line">同车型款年或动力不一致，仅浏览，不构成可比组估值</span></div>${table}`;
  }
  function analysisChart(a) {
    if (a?.broad) return `<div class="broad-callout"><strong>已放宽到同车型全部 ${count(a?.count)} 辆</strong><p>款年或动力不一致，不计算中位数或区间；每个点是一辆车的最近一次已确认报价。</p></div>${observationChart(a)}`;
    const labels = array(a?.labels), series = array(a?.series);
    if (!a?.count || !labels.length || !series.some(v => finite(v))) {
      const other = Math.max(0,(Number(a?.model_count)||0)-(Number(a?.count)||0));
      return `<div class="chart-empty"><div><strong>当前范围没有已确认报价</strong><p>${other>0?`当前分组 0 辆；同车型另有 ${count(other)} 辆在其他款年或排量组，可选择其他分组。`:'可在车源台账补充或修正报价，或调整观察范围。'}</p></div></div>`;
    }
    const enough = sufficient(a);
    const thinDays = array(a?.daily_counts).some(n => Number(n) < 5);
    const note = enough
      ? `折线为每个观察日的实测报价中位数${thinDays?'；部分观察日少于 5 辆，仅用于观察价格变化，不构成行情估值':''}。点为每辆车最近一次已确认报价。`
      : `同组独立车源 ${count(a?.count)} 辆，不足 5 辆；以下仅展示实测报价走势，不提供中位数区间或高低价判断。`;
    return `<p class="scope-note">${esc(note)}</p>${chart({
      title:'同组实测报价走势',
      labels,
      counts:array(a?.daily_counts),
      series:[{name:'当日实测中位数', values:series}],
      points:array(a?.observations).map(o => ({date:o.observed_at, value:o.price, label:[o.name,o.trim,o.region].filter(Boolean).join(' / ') || `车源 #${o.id}`})),
      unit:'万元'
    }, '当前范围内没有有效观察值；可查看车源或明确调整分析条件。')}${observationTable(a?.observations)}`;
  }
  function analysisMetrics(a) {
    if (a?.broad) return `<div class="trend-metrics"><span>同车型实测车源<b>${count(a?.count)}<small>辆</small></b></span><span>款年/动力组<b>${count(array(a?.groups).length)}<small>组</small></b></span><span>可比估值<b class="plain-value">不提供<small>条件不一致</small></b></span></div>`;
    const ok = sufficient(a);
    const change = finite(a?.change);
    return `<div class="trend-metrics"><span>同组报价区间<b class="${ok ? '' : 'insufficient'}">${ok && finite(a.low) && finite(a.high) ? `${fmt(a.low)}–${fmt(a.high)}<small>万元</small>` : '样本不足 / 不估值'}</b></span><span>同组独立样本<b>${count(a?.count)}<small>辆</small></b></span><span>报价变化<b class="plain-value">${change ? `${a.change > 0 ? '+' : ''}${fmt(a.change)}%` : '暂无多日观察'}<small>${ok ? '同口径观察' : '实测中位数变化'}</small></b></span></div>`;
  }
  function overview(data, s) {
    const a = data.analysis, m = data.selected_model;
    const metrics = [
      ['当前车源', data.counts?.listings, '辆', '含已录入车源', '', 'car'],
      ['车型档案', data.counts?.models, '款', `已关注 ${array(data.models).filter(x => x.followed).length} 款`, 'violet', 'layers'],
      [`近${s.days}天新增`, data.counts?.new_listings, '辆', '按来源消息时间统计', 'cyan', 'upload'],
      ['待处理记录', data.counts?.pending, '条', '仅历史遗留；新导入直接入台账', 'amber', 'edit']
    ];
    const watch = array(data.models).filter(x => x.followed);
    const fuel = data.fuel;
    return heading('行情总览', '关注报价变化，把每一辆候选车看清楚。', `<span class="date-label">${today()}</span>${button(`${icon('upload')}导入聊天记录`, 'navigate', {'data-target':'import'}, 'primary')}`) +
      `<section class="metrics">${metrics.map(([label,v,unit,note,kind,shape]) => `<div class="metric ${kind}"><div class="metric-icon">${icon(shape)}</div><div><span>${esc(label)}</span><strong>${count(v)}<small>${esc(unit)}</small></strong><p>${esc(note)}</p></div></div>`).join('')}</section>
      <div class="dashboard-main"><section class="vehicle-spotlight"><div class="spotlight-top"><span class="spotlight-icon">${icon('car')}</span><span>当前分析车型</span>${tag(`${count(a?.count)} 辆同组样本`, 'blue')}</div><h2>${esc(m?.name || '从导入开始')}</h2><p class="pre-wrap">${esc(a?.scope || (m ? '分析口径未知' : '导入记录并完成校对后建立车型档案'))}</p><div class="spotlight-price ${sufficient(a) && finite(a.median) ? '' : 'insufficient'}">${sufficient(a) && finite(a.median) ? `${fmt(a.median)}<small>万元</small>` : m ? '样本不足，暂不估值' : '尚无车型资料'}</div><div class="spotlight-caption">${m ? '同组独立车源的卖方报价中位数' : '真实资料将显示在这里'}</div><div class="car-stage"><div class="car-halo"></div><img src="/static/assets/tech-car.svg" alt="车辆示意图，非车源实拍"></div><div class="spotlight-bottom"><span>${button(m ? '打开车型档案' : '导入资料', m ? 'model-detail' : 'navigate', m ? {'data-id':m.id} : {'data-target':'import'}, 'ghost small')}</span><small>车型示意图，非车源实拍</small></div></section>
      <section class="panel trend-panel"><div class="panel-heading"><div><h2>报价趋势</h2><p>同款年、同排量；点为每车最近报价，线为当日实测中位数</p></div><div class="filters">${array(s.models).length ? modelPicker(s) : ''}${rangeButtons(s.days)}</div></div>${cohortChips(a)}${analysisChart(a)}${analysisMetrics(a)}<div class="scope-note pre-wrap">分析口径：${esc(text(a?.scope))}</div></section></div>
      <div class="dashboard-bottom"><section class="panel recent-panel"><div class="table-title"><div><h2>最新车源</h2><p>价格与里程已直接入台账，打开详情可修正</p></div>${button('全部车源', 'navigate', {'data-target':'listings'}, 'small')}</div>${listingTable(array(data.recent), s, true)}</section><section class="panel watch-panel"><div class="panel-heading"><h2>我的关注</h2>${button(icon('plus'), 'navigate', {'data-target':'models', 'aria-label':'管理关注车型'}, 'icon-button')}</div>${watch.length ? watch.slice(0,6).map(x => `<button type="button" class="watch-model" data-action="model-detail" data-id="${esc(x.id)}"><span class="model-bubble">${icon('car')}</span><span><strong>${esc(x.name)}</strong><small>${count(x.count)} 辆车源 · 进入档案看同组行情</small></span></button>`).join('') : '<p class="no-data-inline">还没有关注车型，可在车型档案中添加关注。</p>'}<div class="fuel-mini"><div class="fuel-mini-icon">${icon('fuel')}</div><div><span>${esc(fuel?.province || s.settings?.province || '省份未知')}油价 <small>${fuel ? esc(fuel.source === '手工记录' ? '手工记录' : ({ok:'已获取',cached:'本机缓存',empty:'暂无记录'})[fuel.status] || '状态未知') : '暂无记录'}</small></span><p><b>92<small>号</small> ${fmt(fuel?.latest?.p92)}</b><b>95<small>号</small> ${fmt(fuel?.latest?.p95)}</b></p><small class="note-line">元/升 · ${esc(date(fuel?.latest?.effective_date))}</small></div></div></section></div><p class="note-line section-gap">上次导入：${esc(date(data.last_import, true))}。价格按万元、里程按万公里直接入台账；修正可在车源详情完成。</p>`;
  }
  function listings(result, s) {
    const f = s.filters;
    const pages = Math.max(1, Math.ceil(result.total / result.page_size));
    return heading('车源台账', '按来源保留每一辆车；价格与里程已直接填入，可在详情中修正。', button(`${icon('upload')}导入资料`, 'navigate', {'data-target':'import'}, 'primary')) +
      `<section class="panel section-gap"><form class="listing-filter-form" data-form="listing-filters"><label class="select-wrap">${icon('search')}<input type="search" name="q" value="${esc(f.q)}" placeholder="车型、原文关键词" aria-label="搜索车源"></label><label class="select-wrap"><select name="model_id" aria-label="按车型筛选">${modelOptions(s.models, f.model_id, true)}</select></label><label class="select-wrap price-filter">最高报价<input name="max_price" type="number" min="0" step="0.01" value="${esc(f.max_price)}" aria-label="最高报价，万元">万元</label><label class="select-wrap"><select name="status" aria-label="信息状态">${option('', '全部状态', f.status)}${option('confirmed','已录入',f.status)}${option('pending','待处理',f.status)}${option('excluded','不计入行情',f.status)}</select></label><label class="checkbox-line"><input type="checkbox" name="favorites"${f.favorites ? ' checked' : ''}>只看收藏</label><button class="button primary small" type="submit">筛选</button>${button('清除条件','reset-filters',{},'small')}</form></section>
      <section class="panel recent-panel"><div class="table-title"><div><h2>车源记录 <span class="tag gray">${count(result.total)} 辆</span></h2><p>报价单位万元，里程单位万公里；点击详情可修正。</p></div><span class="note-line">对比最多 4 辆 · 已选 ${s.compareItems===null?'未知':array(s.compareItems).length}</span></div>${listingTable(result.items,s)}<div class="table-bottom"><span>第 ${count(result.page)} / ${count(pages)} 页 · 共 ${count(result.total)} 辆</span><div class="pagination"><label>每页 <select data-control="page-size" aria-label="每页条数">${[25,50,100].map(n => option(n,n,result.page_size)).join('')}</select></label>${button('上一页','listing-page',{'data-page':result.page-1,disabled:result.page<=1},'small')}${button('下一页','listing-page',{'data-page':result.page+1,disabled:result.page>=pages},'small')}</div></div></section><div class="notice section-gap listing-footer-note">${icon('shield')}<span>不同年份、里程或来源的同款车默认分别保留；确认同一辆车后，可在详情中选择目标并合并报价历史。</span></div>`;
  }
  function cohortForm(a, s) {
    const f = s.cohort;
    const groups = array(a?.groups);
    const years = [...new Set(groups.map(g => g.model_year).filter(x => x !== null && x !== undefined))];
    const engines = [...new Set(groups.map(g => g.engine).filter(Boolean))];
    const trims = [...new Set(array(a?.listings).map(x => x.trim).filter(Boolean))];
    return `<form class="cohort-form panel section-gap" data-form="cohort"><label class="form-field">观察范围<select name="days">${[7,30,90,365].map(n => option(n,`${n}天`,s.days)).join('')}</select></label><label class="form-field">款年<input type="number" min="1900" max="2100" name="model_year" value="${esc(f.model_year)}" list="cohort-years" placeholder="默认可比组"><datalist id="cohort-years">${years.map(n => option(n,n,'')).join('')}</datalist></label><label class="form-field">动力<input name="engine" value="${esc(f.engine)}" list="cohort-engines" placeholder="默认可比组"><datalist id="cohort-engines">${engines.map(n => option(n,n,'')).join('')}</datalist></label><label class="form-field">原文配置（可选）<input name="trim" value="${esc(f.trim)}" list="cohort-trims" placeholder="不限"><datalist id="cohort-trims">${trims.map(n => option(n,n,'')).join('')}</datalist></label><label class="form-field small">里程下限 / 万公里<input type="number" min="0" step="0.1" name="mileage_min" value="${esc(f.mileage_min)}"></label><label class="form-field small">里程上限 / 万公里<input type="number" min="0" step="0.1" name="mileage_max" value="${esc(f.mileage_max)}"></label><label class="form-field region">地区<input name="region" value="${esc(f.region)}" placeholder="不限地区"></label><button class="button primary small" type="submit">应用条件</button>${button('恢复默认组','reset-cohort',{},'small')}</form>`;
  }
  function models(m, a, s) {
    if (!m) return heading('车型档案','归整真实车型与别名，保留清楚的比较口径。') + `<section class="panel">${empty('尚无车型档案','导入聊天记录并确认车型名称后，会在这里建立档案。',button('导入聊天记录','navigate',{'data-target':'import'},'primary'))}</section>`;
    return heading('车型档案','把车型、配置与报价证据放在一起看。', `${modelPicker(s)}${button(`${icon('star')}${m.followed ? '取消关注' : '关注车型'}`,'follow',{'data-id':m.id},m.followed ? 'soft' : '')}${button(`${icon('edit')}重命名`,'rename-model',{'data-id':m.id})}`) +
      `<section class="model-heading"><div class="model-identity"><img class="car-illustration" src="/static/assets/tech-car.svg" alt="车型示意图，非实拍"><div><h2>${esc(m.name)}</h2><p class="pre-wrap">${esc(text(a?.scope))}</p><div class="model-heading-tags">${tag(`${count(a?.model_count ?? m.count)} 辆车源`,'blue')}${a?.broad?tag('同车型全览','gray'):tag(`${count(a?.count)} 辆当前组`,'gray')}${tag(m.followed ? '已关注' : '未关注','gray')}${tag('卖方报价，非成交价','gray')}</div></div></div><div class="model-heading-meta">${a?.broad ? '同车型全览<span class="unknown">不提供可比中位数</span>' : `当前可比组中位数${sufficient(a) && finite(a.median) ? `<strong>${fmt(a.median)}<span class="unit">万元</span></strong>` : '<span class="unknown">样本不足，暂不估值</span>'}`}</div></section>
      ${cohortForm(a,s)}<div class="model-analysis-grid"><section class="panel trend-panel"><div class="panel-heading"><div><h2>${a?.broad?'同车型实测报价':'同组报价趋势'}</h2><p>${a?.broad?'款年或动力不一致，仅浏览，不做可比估值':'每日实测报价中位数，不补造缺失日期'}</p></div><div class="row">${a?.broad?button('返回默认可比组','reset-cohort',{},'small'):''}${tag(a?.broad?`${count(a?.count)} 辆实测`:`${count(a?.count)} 辆同组样本`, a?.broad?'amber':sufficient(a) ? 'blue' : 'amber')}</div></div>${a?.broad?'':cohortChips(a)}${analysisChart(a)}${analysisMetrics(a)}<div class="scope-note pre-wrap">生效口径：${esc(text(a?.scope))}</div></section><aside class="panel insight-panel"><h3>${icon('shield')}样本与分组</h3><p class="insight-lead">${a?.broad ? '当前为同车型全部报价，仅用于浏览；款年或动力不同，不构成可比组估值。' : sufficient(a) ? '参考当前可比组的卖方报价。车况与来源仍需逐辆核验。' : '同组不足 5 辆，不提供高低价判断；可放宽到同车型全部查看实测报价。'}</p><div class="insight-rule"></div><p class="text-note">同款年、同排量归为一组；原文配置可作为附加筛选。使用图表上方的分组按钮切换。</p>${!a?.broad && ((a?.model_count||0)>(a?.count||0)||array(a?.groups).length>1) ? `<button type="button" class="button small group-all-button" data-action="cohort-all" data-id="${esc(m.id)}">查看同车型全部 ${count(a?.model_count)} 辆实测报价</button>` : ''}${!a?.broad && !array(a?.groups).length ? '<p class="note-line">还没有可比组。</p>' : ''}</aside></div>
      <section class="panel alias-panel"><h2>车型别名</h2><p class="text-note">仅把同一车系的名称写法归到本档案，不表示它们是同一辆车。冲突别名会由系统拒绝。</p><div class="alias-list">${array(m.aliases).length ? m.aliases.map(x => `<div><span>${esc(x.raw)}</span>${tag('已保存','blue')}</div>`).join('') : '<p class="note-line">还没有已保存的别名。</p>'}</div><form class="alias-form" data-form="alias" data-id="${esc(m.id)}"><label class="form-field">原文别名<input name="raw" required maxlength="200" placeholder="填写已核对的车型名称写法"></label><label class="form-field scope">生效范围<input name="scope" value="*" placeholder="* 表示全局"></label><button class="button small" type="submit">保存别名</button></form><div class="form-error" id="alias-error" role="alert"></div></section>
      <section class="panel recent-panel section-gap"><div class="table-title"><div><h2>当前同组车源</h2><p>与上方分析使用同一组筛选条件</p></div></div>${listingTable(array(a?.listings),s)}</section>`;
  }
  function budgetDifference(item, budget) {
    if (!finite(budget) || budget <= 0) return '未设置预算';
    if (item.status !== 'confirmed' || !finite(item.price)) return '候选报价，暂不比较预算';
    const d = budget - item.price;
    return d >= 0 ? `预算余量 ${fmt(d)} 万元` : `超出预算 ${fmt(-d)} 万元`;
  }
  function compare(result, s) {
    const items = array(result.items), budget = s.settings?.budget ?? result.budget;
    const rows = [
      ['整车报价', x => `<div class="compare-price ${x.status !== 'confirmed' ? 'pending-price' : ''}">${price(x)}</div>`, x => `${x.status}/${x.price}/${x.price_text}`],
      ['预算差额', x => `<span class="budget-difference">${esc(budgetDifference(x,budget))}</span>`, x => budgetDifference(x,budget)],
      ['款年 / 动力', x => esc(`${text(x.model_year)} / ${text(x.engine)}`), x => `${x.model_year}/${x.engine}`],
      ['原文配置', x => esc(text(x.trim)), x => x.trim],
      ['上牌时间', x => esc(text(x.year)), x => x.year],
      ['行驶里程', x => mileage(x), x => `${x.mileage}/${x.mileage_text}/${x.status}`],
      ['所在地', x => esc(text(x.region)), x => x.region],
      ['车况原文', x => esc(text(x.condition)), x => x.condition],
      ['录入 / 售卖状态', x => `${status(x)} ${tag(x.sale_state === 'sold' ? '已售' : '售卖状态未知','gray')}`, x => `${x.status}/${x.sale_state}`],
      ['来源 / 发布', x => `${esc(text(x.source))}<small class="table-sub">${esc(date(x.posted,true))}</small>`, x => `${x.source}/${x.posted}`]
    ];
    const bodyRows = rows.filter(([, , key]) => !s.onlyDifferences || new Set(items.map(x => text(key(x)))).size > 1);
    return heading('购车对比','最多选择 4 辆，结合预算和自己的核验记录作决定。',button('选择车源','navigate',{'data-target':'listings'},'primary')) +
      `<section class="panel budget-bar"><div class="budget-label">购车预算<strong>${finite(budget) && budget > 0 ? fmt(budget) : '未设置'}<span class="unit">${finite(budget) && budget > 0 ? '万元' : ''}</span></strong></div><form class="budget-form" data-form="budget"><label class="form-field">预算 / 万元<input class="text-input" name="budget" type="number" min="0" step="0.01" required value="${finite(budget) ? esc(budget) : ''}" aria-label="购车预算，万元"></label><button type="submit" class="button small">保存预算</button></form><p class="budget-note">预算只比较已确认整车报价。<br>税费、整备与保险需另行核算。</p></section>
      <div class="compare-controls"><span class="small-text">已选 ${items.length} / 4 辆</span><label class="checkbox-line"><input type="checkbox" data-control="differences"${s.onlyDifferences ? ' checked' : ''}>只看差异字段</label></div>
      <section class="panel recent-panel">${items.length ? `<div class="table-scroll"><table class="compare-table"><thead><tr><th>候选车源</th>${items.map(x => `<td class="compare-car-cell"><div class="compare-remove">${button(icon('close'),'compare-toggle',{'data-id':x.id,'aria-label':`移出对比 ${text(x.name)}`},'icon-button')}</div>${thumbnail(x,true)}<h3>${esc(text(x.name))}</h3><p>${esc(text(x.trim))}</p>${button('查看来源与详情','detail',{'data-id':x.id},'ghost small')}</td>`).join('')}</tr></thead><tbody>${bodyRows.map(([label,render]) => `<tr><th>${esc(label)}</th>${items.map(x => `<td>${render(x)}</td>`).join('')}</tr>`).join('')}${!bodyRows.length ? `<tr><th>差异字段</th><td colspan="${items.length}">当前所选字段没有差异，取消勾选可查看全部。</td></tr>` : ''}<tr><th>我的核验备注</th>${items.map(x => `<td><form data-form="compare-note" data-id="${esc(x.id)}"><textarea class="note-editor" name="notes" maxlength="2000" aria-label="${esc(text(x.name))}核验备注" placeholder="车况疑问、待询问事项…">${esc(x.notes || '')}</textarea><button type="submit" class="button small">保存备注</button><div class="form-error" role="alert"></div></form></td>`).join('')}</tr></tbody></table></div>` : empty('还没有加入对比的车源','在车源库中选择最多 4 辆车，选择结果会保存在本机。',button('去选择车源','navigate',{'data-target':'listings'},'primary'))}<div class="compare-bottom">${notice('车况、照片关联与价格单位需要核验。样本不足 5 辆时，不据此判断低价或高价。')}</div></section>`;
  }
  function fuelCharts(f) {
    const records = array(f.records).slice().sort((a,b) => String(a.effective_date).localeCompare(String(b.effective_date)));
    if (!records.length) return chart({labels:[],series:[]},'尚无本省油价记录。手动获取公开油价，或填写可核验的手工记录。');
    if (records.every(r => finite(r.p92) && finite(r.p95))) return chart({title:`${f.province}92号与95号油价历史`,labels:records.map(r=>r.effective_date),series:[{name:'92号',values:records.map(r=>r.p92),slot:0},{name:'95号',values:records.map(r=>r.p95),slot:1}],step:true,unit:'元/升'});
    return [92,95].map((grade,i) => `<div class="chart-subtitle">${grade}号汽油</div>${chart({title:`${grade}号汽油历史`,labels:records.map(r=>r.effective_date),series:[{name:`${grade}号`,values:records.map(r=>r[`p${grade}`]),slot:i}],step:true,unit:'元/升'},`没有 ${grade} 号有效记录。`)}`).join('');
  }
  function fuel(f, s) {
    const latest = f.latest;
    const statusText = f.source === '手工记录' ? '最新记录为手工录入' : ({ok:'公开来源已获取',cached:'正在使用本机缓存',empty:'暂无油价记录'})[f.status] || '状态未知';
    const provinces = [...new Set([...array(f.provinces),f.province,s.settings?.province].filter(Boolean))];
    return heading('油价走势','只记录 92 / 95 号汽油，保留生效日期与公开来源。',`<label class="select-wrap"><select data-control="province" aria-label="选择油价省份">${provinces.map(p=>option(p,p,f.province)).join('')}</select></label>${button(`${icon('refresh')}获取最新油价`,'fuel-refresh',{},'primary')}${button('手工记录','fuel-manual')}`) +
      `<div class="fuel-status">${notice(`${statusText}${f.error ? `\n获取提示：${f.error}` : ''}${f.status === 'empty' ? '\n点击“获取最新油价”，或根据公开来源手工记录。' : ''}`,f.error || f.status !== 'ok' ? 'amber' : '')}</div>
      <div class="fuel-cards">${[92,95].map((g,i) => `<section class="panel fuel-price-card"><span class="fuel-watermark">${icon('fuel')}</span><div class="fuel-grade ${i ? 'orange' : ''}">${g}号汽油 ${tag(latest ? '本机已记录' : '暂无记录','gray')}</div><div class="fuel-price-number">${finite(latest?.[`p${g}`]) ? fmt(latest[`p${g}`]) : '<span class="unknown">未知</span>'}<span class="unit">元/升</span></div><p class="panel-note fuel-card-date">生效日期：${esc(date(latest?.effective_date))}</p></section>`).join('')}<aside class="adjustment-note"><h3>本次记录来源</h3><p class="pre-wrap">${esc(text(f.source))}</p>${sourceLink(f.source_url,'查看公开来源')}<p class="panel-note">启动本机工作台时会尝试更新过期缓存，也可点击按钮手动获取最新油价。</p></aside></div>
      <div class="fuel-grid"><section class="panel"><div class="panel-heading"><div><h2>${esc(f.province)}油价历史</h2><p>阶梯线表示已记录的生效价，未记录的日期不补造数值</p></div></div>${fuelCharts(f)}</section><aside class="panel fuel-side"><h3>来源与核验</h3><dl><dt>省份</dt><dd>${esc(text(f.province))}</dd><dt>记录状态</dt><dd>${esc(statusText)}</dd><dt>来源名称</dt><dd>${esc(text(f.source))}</dd><dt>获取时间 / 中国时间</dt><dd>${esc(date(f.fetched_at,true))}</dd><dt>核验时间 / 中国时间</dt><dd>${esc(date(f.verified_at,true))}</dd><dt>公开来源</dt><dd>${sourceLink(f.source_url)}</dd></dl>${notice('获取失败时保留已有缓存，并显示错误。手工记录会明确标注来源。')}</aside></div>
      <section class="panel recent-panel fuel-history"><div class="table-title"><div><h2>历史记录</h2><p>只显示本机真实保存的记录，价格单位元/升</p></div>${button('手工记录','fuel-manual',{},'small')}</div>${array(f.records).length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>生效日期</th><th>92号 / 元每升</th><th>95号 / 元每升</th><th>来源</th></tr></thead><tbody>${f.records.slice().sort((a,b)=>String(b.effective_date).localeCompare(String(a.effective_date))).map(r=>`<tr><td>${esc(date(r.effective_date))}</td><td>${fmt(r.p92)}</td><td>${fmt(r.p95)}</td><td>${r.source === '手工记录' ? tag('手工记录','gray') : tag('公开来源','blue')}</td></tr>`).join('')}</tbody></table></div>` : empty('暂无历史记录','获取或手工记录第一条真实油价后，在这里查看。','',true)}</section>`;
  }

  function bytes(value) {
    if (!finite(value)) return '未知';
    if (value >= 1024**3) return `${(value/1024**3).toFixed(2)} GB`;
    if (value >= 1024**2) return `${(value/1024**2).toFixed(1)} MB`;
    if (value >= 1024) return `${(value/1024).toFixed(1)} KB`;
    return `${value} B`;
  }
  const batchStatus = {uploading:'等待上传',queued:'等待处理',running:'正在处理',done:'处理完成',error:'处理失败'};
  function batches(s) {
    if (s.batchError && !s.batches) return error(s.batchError,'refresh-imports');
    const list = array(s.batches);
    if (!list.length) return empty('还没有导入批次','选择导出文件夹或 ZIP，清单和进度会保存在本机。','',true);
    return `${s.batchError ? notice(s.batchError,'amber') : ''}${list.map(b => {
      const active = s.activeUpload?.id === b.id;
      const total = b.total_bytes;
      const percent = finite(total) && total > 0 && finite(b.received_bytes) ? Math.min(100,Math.max(0,b.received_bytes/total*100)) : 0;
      const processing = ['queued','running'].includes(b.status);
      const processPercent = finite(b.total_messages) && b.total_messages > 0 && finite(b.processed) ? Math.min(100,Math.max(0,b.processed/b.total_messages*100)) : null;
      return `<article class="batch-card"><div class="batch-filename">${icon('folder')}<span class="grow pre-wrap">${esc(b.name)}<small class="table-sub">${esc(date(b.created_at,true))} · ${count(b.file_count)} 个文件</small></span>${tag(active ? '正在上传' : batchStatus[b.status] || '状态未知',b.status === 'error' ? 'amber' : processing || active ? 'blue' : 'gray')}</div><div class="batch-progress" role="progressbar" aria-label="${esc(b.name)}上传进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent.toFixed(1)}"><span style="width:${percent.toFixed(1)}%"></span></div><div class="row note-line"><span>已传 ${bytes(b.received_bytes)} / ${bytes(total)}</span><span class="push">${percent.toFixed(1)}%</span></div>${processing ? `<p class="note-line">处理消息 ${count(b.processed)} / ${count(b.total_messages)}${processPercent === null ? '（总数尚未确定）' : ` · ${processPercent.toFixed(1)}%`}</p>` : ''}${b.error ? `<p class="error-text">${esc(b.error)}</p>` : ''}${s.uploadErrors?.[b.id] ? `<p class="upload-status">${esc(s.uploadErrors[b.id])}</p>` : ''}<div class="batch-stats">${[['messages','消息'],['duplicates','重复'],['candidates','候选'],['media','附件'],['missing','缺失附件']].map(([key,label])=>`<div><strong>${count(b.stats?.[key])}</strong><small>${label}</small></div>`).join('')}</div>${array(b.warnings).length ? `<details><summary>${b.warnings.length} 条处理提示</summary><ul class="warning-list">${b.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}<div class="batch-actions">${b.status === 'uploading' && !active ? `${button('重选文件夹续传','resume-folder',{'data-id':b.id,disabled:Boolean(s.activeUpload)},'small')}${button('重选 ZIP 续传','resume-zip',{'data-id':b.id,disabled:Boolean(s.activeUpload)},'small')}${finite(total) && b.received_bytes === total ? button('提交后台处理','complete-batch',{'data-id':b.id,disabled:Boolean(s.activeUpload)},'small primary') : ''}${button('取消未完成上传','cancel-batch',{'data-id':b.id},'ghost small')}` : ''}${active ? button('暂停上传','pause-upload',{},'small') : ''}${b.status === 'error' ? button('重试此批次','retry-batch',{'data-id':b.id},'small') : ''}${button('查看上传清单','batch-manifest',{'data-id':b.id},'ghost small')}</div></article>`;
    }).join('')}`;
  }
  function ocrNote(settings) {
    if (!settings) return '识别能力尚未读取，无法确认本机 OCR 状态。';
    return `本机 OCR：${settings.ocr_available === true ? '可用' : settings.ocr_available === false ? '未启用' : '未知'}。${settings.ocr_note || '文字规则提取与台账修正；图片可作为证据查看。'}`;
  }
  function importPage(s) {
    const files = array(s.selectedFiles);
    return heading('导入记录','聊天记录只在本机解析；价格按万元、里程按万公里直接入库。',`${button(`${icon('refresh')}刷新批次`,'refresh-imports')}${button('重试失败批次','retry-errors',{disabled:!array(s.batches).some(b=>b.status==='error')},'small')}`) +
      `<div class="stepper panel"><div class="step active"><span class="step-index">1</span>选择资料</div><div class="step"><span class="step-index">2</span>分块上传与后台处理</div><div class="step"><span class="step-index">3</span>写入台账</div></div>
      <div class="import-grid"><section class="panel"><div class="panel-heading"><div><h2>导入聊天记录</h2><p>支持 stories-in-wx 导出 JSON 与 media，或其 ZIP</p></div></div><div class="upload-zone"><span class="upload-symbol">${icon('upload')}</span><h3>选择完整导出文件夹或 ZIP</h3><p>原目录只读，逐文件顺序上传，每块不超过 2 MB。</p><div class="upload-actions">${button(`${icon('folder')}选择文件夹`,'choose-folder',{disabled:Boolean(s.activeUpload)},'primary')}${button('选择 ZIP','choose-zip',{disabled:Boolean(s.activeUpload)})}</div><p class="selected-file" id="selection-summary">${files.length ? `已选 ${count(files.length)} 个文件 · ${bytes(files.reduce((sum,f)=>sum+f.size,0))}` : '尚未选择文件'}</p></div><form id="new-import-form" data-form="new-import"><div class="upload-fields"><div class="form-grid"><label class="form-field">批次名称<input name="name" id="import-name" maxlength="200" value="${esc(s.selectedName || '')}" placeholder="可使用导出文件夹名称"></label><label class="form-field">平台 / 导出账户标识<input name="namespace" id="import-namespace" maxlength="200" value="${esc(s.namespace || '')}" placeholder="同一导出账户保持一致"></label></div><p class="note-line">不同导出账户使用不同标识；同一账户重复导入时保持一致，以便正确去重。</p></div><div class="upload-start"><span class="grow note-line" id="upload-message">${esc(s.selectionMessage || '')}</span><button id="start-upload" class="button primary" type="submit"${!files.length || s.activeUpload ? ' disabled' : ''}>开始上传并处理</button></div><div class="form-error" role="alert"></div></form><div class="capability-note">${esc(ocrNote(s.settings))}</div><p class="import-help">清单与已收到字节保存在本机数据库。刷新或中断后，在对应批次重选相同文件（路径与大小一致）即可续传。单 ZIP ≤512 MB，JSON ≤64 MB，图片 ≤32 MB，总量 ≤2 GB，最多 20,000 文件。</p></section>
      <section class="panel"><div class="panel-heading"><div><h2>导入批次</h2><p>仅等待处理、正在处理的批次自动更新</p></div>${tag(`${s.batches===null?'未知':count(s.batches.length)} 个批次`,'gray')}</div><div id="batch-list" class="batch-list">${batches(s)}</div></section></div>
      ${s.reviewTotal ? `<section class="panel section-gap"><div class="review-toolbar"><div class="grow"><h2>人工校对 <span id="review-total" class="tag amber">${s.reviewTotal === null ? '未知' : count(s.reviewTotal)} 条待处理</span></h2><p class="note-line">原文与候选并排保留，单位与关联需明确确认。</p></div><input class="text-input" type="search" id="review-search" placeholder="在待校对原文中查找" aria-label="搜索待校对记录" value="${esc(s.reviewQuery || '')}">${button('刷新校对','refresh-reviews',{},'small')}</div><div id="review-workspace">${reviewWorkspace(s)}</div></section>` : ''}`;
  }
  function orderedReviews(s) {
    const q = String(s.reviewQuery || '').toLocaleLowerCase();
    return array(s.reviews).filter(r => !q || `${r.raw || ''} ${r.candidate?.name || ''} ${r.source || ''}`.toLocaleLowerCase().includes(q)).sort((a,b)=>Number(s.deferred.has(String(a.id)))-Number(s.deferred.has(String(b.id))));
  }
  function reviewWorkspace(s) {
    if (s.reviewError) return error(s.reviewError,'refresh-reviews');
    if (!s.reviews) return loading('正在读取待处理记录');
    const ordered = orderedReviews(s);
    if (!ordered.length) return empty(s.reviewQuery ? '没有匹配的待处理记录' : '没有待处理记录',s.reviewQuery ? '调整原文搜索条件。' : '价格与里程已直接写入台账；如有出入，请在车源详情中修正。','',true);
    const active = ordered.find(x=>String(x.id)===String(s.activeReviewId)) || ordered[0];
    const visible = ordered.slice(0,s.reviewLimit || 50);
    if (!visible.some(x=>x.id===active.id)) visible.push(active);
    return `<div class="review-grid"><aside class="review-list" aria-label="待处理记录">${visible.map((r,i)=>`<button type="button" class="${r.id===active.id?'active':''}" data-action="select-review" data-id="${esc(r.id)}" aria-pressed="${r.id===active.id}"><span class="review-index">${i+1}</span><span class="grow"><strong>${esc(r.candidate?.name || (r.kind==='supplement'?'待挂接补充':'车型名称待确认'))}</strong><small>${r.kind==='supplement'?'补充消息':'车源信息'} · ${esc(date(r.posted))}</small>${s.deferred.has(String(r.id))?'<small class="review-deferred">已暂缓，仍待处理</small>':''}</span></button>`).join('')}${ordered.length > (s.reviewLimit||50) ? button(`显示更多（共 ${ordered.length} 条）`,'more-reviews',{},'load-more') : ''}</aside><div class="review-content" id="review-content">${review(active,s)}</div></div>`;
  }
  function field(label, name, value, type = 'text', extra = '') {
    return `<label class="form-field">${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value ?? '')}" ${extra}></label>`;
  }
  function review(r, s) {
    const c = r.candidate || {};
    const approximate = /约|左右|多|几|不到|近|余|出头/.test(c.mileage_text || '');
    const units = (name, value, values) => `<select name="${name}" aria-label="${name==='price_unit'?'价格':'里程'}单位">${option('','确认单位',value)}${values.map(u=>option(u,u,value)).join('')}</select>`;
    return `<div class="review-compare"><div class="review-original"><div class="review-caption"><span>原始消息</span>${tag(r.kind==='supplement'?'补充消息':'规则候选','amber')}</div><p class="source-meta">来源：${esc(text(r.source))}\n中国时间：${esc(date(r.posted,true))}</p><pre class="source-message">${esc(text(r.raw))}</pre><div class="issues">${array(r.issues).map(x=>tag(x,'amber')).join('')}</div><p class="note-line">候选内容尚未核实；原文中的数字不等于已确认的整车报价。</p>${r.listing_id ? button('查看相关车源','detail',{'data-id':r.listing_id},'ghost small') : ''}</div><div><div class="review-caption"><span>${r.kind==='supplement'?'明确挂接到现有车源':'人工确认字段'}</span>${tag('候选 / 单位待确认','amber')}</div>${r.kind==='supplement' ? `${notice('这是一条未明确归属的补充消息。选择同一辆车后确认，原文会被保留。','amber')}<form class="target-search" data-form="target-search" data-mode="assign" data-review-id="${esc(r.id)}"><input class="text-input" type="search" name="q" placeholder="搜索已有车型、原文关键词" aria-label="查找补充消息目标"><button class="button small" type="submit">查找</button></form><form class="assignment-form" data-form="assign" data-id="${esc(r.id)}"><label class="form-field">明确选择已有车源<select name="listing_id" id="assignment-target" required>${targetOptions(s.assignTargets || [],'请选择同一辆车')}</select></label><p class="note-line" id="assignment-target-info">${s.assignTargets ? `当前显示 ${s.assignTargets.length} 个结果，可输入关键词缩小范围。` : '先查找已有车源，再确认挂接。'}</p><div class="form-grid">${field('补充里程数值','mileage',finite(c.mileage)?c.mileage:'','number',`min="0" step="0.01" data-mileage-input ${approximate?'disabled':''}`)}<label class="form-field">里程单位${units('mileage_unit',c.mileage_unit,['万公里','公里'])}</label></div><p class="note-line pre-wrap">里程原文：${esc(text(c.mileage_text))}</p><label class="checkbox-line"><input type="checkbox" name="approximate" data-control="approximate"${approximate?' checked':''}>保留近似里程原文，不记为精确数值</label><label class="checkbox-line"><input type="checkbox" name="same_car" required>确认此补充属于选中的同一辆车</label><div class="review-actions"><div>${button('暂缓','defer-review',{'data-id':r.id},'small')}${button('忽略','ignore-review',{'data-id':r.id},'small')}</div><button class="button primary small" type="submit">确认挂接</button></div><div class="form-error" role="alert"></div></form>` : `<form data-form="confirm-review" data-id="${esc(r.id)}"><div class="form-grid">${field('车型名称','name',c.name,'text','required maxlength="200"')}${field('款年','model_year',c.model_year,'number','min="1900" max="2100" step="1"')}${field('动力','engine',c.engine,'text','maxlength="100"')}${field('原文配置','trim',c.trim,'text','maxlength="300"')}${field('上牌年月','year',c.year,'text','placeholder="如 2020-06，未知可留空" maxlength="40"')}${field('地区','region',c.region,'text','maxlength="100"')}<label class="form-field wide">整车报价（候选数字，请确认单位）<span class="input-unit"><input name="price" type="number" min="0.000001" step="any" value="${finite(c.price)?esc(c.price):''}" aria-label="整车报价候选数字">${units('price_unit',c.price_unit,['万元','元'])}</span><small class="pre-wrap">报价原文：${esc(text(c.price_text))}。留空不会生成已确认报价。</small></label><label class="form-field wide">行驶里程（近似表达保留原文）<span class="input-unit"><input name="mileage" type="number" min="0" step="any" data-mileage-input value="${finite(c.mileage)?esc(c.mileage):''}"${approximate?' disabled':''} aria-label="行驶里程候选数字">${units('mileage_unit',c.mileage_unit,['万公里','公里'])}</span><small class="pre-wrap">里程原文：${esc(text(c.mileage_text))}</small></label><label class="form-field wide">车况原文<textarea name="condition" maxlength="2000">${esc(c.condition||'')}</textarea></label></div><label class="checkbox-line"><input type="checkbox" name="approximate_mileage" data-control="approximate"${approximate?' checked':''}>保留近似里程原文，不记为精确数值</label><label class="checkbox-line"><input type="checkbox" name="remember_units">记住同来源的单位习惯（不跨来源推断）</label><div class="review-actions"><div class="row">${button('暂缓','defer-review',{'data-id':r.id},'small')}${button('忽略','ignore-review',{'data-id':r.id},'small')}</div><button class="button primary small" type="submit">确认并保存</button></div><div class="form-error" role="alert"></div></form>`}<p class="note-line compare-note">“暂缓”仅在本浏览器将此条后置，不改变待校对状态。</p></div></div>`;
  }
  function targetOptions(items, placeholder = '请选择目标车源', sourceId = null) {
    return option('',placeholder,'') + array(items).filter(x=>Number(x.id)!==Number(sourceId)).map(x=>option(x.id,`#${x.id} ${text(x.name)} / ${text(x.year)} / ${text(x.region)} / ${x.status==='confirmed'?(finite(x.price)?`${fmt(x.price)}万元`:'暂无报价'):'待处理'}`,'')).join('');
  }
  function drawer(c, s) {
    const compared = array(s.compareItems).some(x=>Number(x.id)===Number(c.id));
    return `<div class="drawer-heading"><div><h2>车源详情 #${esc(c.id)}</h2><span class="note-line">来源、报价与变更记录</span></div>${button(icon('close'),'close-drawer',{'aria-label':'关闭车源详情'},'icon-button')}</div><div class="drawer-car"><div class="row wrap">${status(c)}${tag(c.sale_state==='sold'?'已售':'售卖状态未知','gray')}</div><h2>${esc(text(c.name))}</h2><p class="pre-wrap">${esc([text(c.model_year),text(c.engine),text(c.trim)].join(' / '))}</p><div class="drawer-price ${c.status!=='confirmed'?'pending-price':''}">${price(c)}</div><p class="drawer-price-note">卖方报价，非成交价。待校对的数字不作为估值依据。</p></div><dl class="drawer-fields">${[['上牌',esc(text(c.year))],['行驶里程',mileage(c)],['所在地',esc(text(c.region))],['发布时间 / 中国时间',esc(date(c.posted,true))],['车况原文',esc(text(c.condition))],['所属车型',esc(text(s.models?.find(x=>Number(x.id)===Number(c.model_id))?.name))]].map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl><div class="drawer-footer">${button(`${icon('star')}${c.favorite?'取消收藏':'收藏'}`,'favorite',{'data-id':c.id},c.favorite?'soft':'')}${button(compared?'移出对比':'加入对比','compare-toggle',{'data-id':c.id,disabled:!compared&&array(s.compareItems).length>=4},compared?'soft':'')}${button('确认同车合并','merge-dialog',{'data-id':c.id,disabled:!validId(c.model_id)},'danger')}</div>
      <section class="drawer-section"><h3>${icon('note')}我的核验备注</h3><form class="drawer-note-form" data-form="listing-note" data-id="${esc(c.id)}"><textarea class="note-editor" name="notes" maxlength="2000" aria-label="车源核验备注" placeholder="填写车况疑问、联系记录与待办，最多2000字">${esc(c.notes||'')}</textarea><label class="form-field">售卖状态<select name="sale_state">${option('unknown','未知',c.sale_state)}${option('sold','已售',c.sale_state)}</select></label><div class="form-actions"><button type="submit" class="button primary small">保存备注与状态</button></div><div class="form-error" role="alert"></div></form></section>
      ${c.status==='confirmed'?`<section class="drawer-section"><details><summary>修正台账信息</summary><p class="note-line">原始消息保持不变；保存后写入变更记录，并同步修正当前报价。</p><form data-form="listing-correct" data-id="${esc(c.id)}"><div class="form-grid"><label class="form-field">所属车型<select name="model_id" required>${modelOptions(s.models,c.model_id)}</select></label>${field('款年','model_year',c.model_year,'number','min="1980" max="2100" step="1"')}${field('动力','engine',c.engine,'text','maxlength="50"')}${field('原文配置','trim',c.trim,'text','maxlength="200"')}${field('上牌年月','year',c.year,'text','maxlength="30"')}${field('地区','region',c.region,'text','maxlength="100"')}${field('当前报价 / 万元','price',finite(c.price)?c.price:'','number','min="0.01" step="0.01" required')}${field('行驶里程 / 万公里（可写 7万+）','mileage_text',c.mileage_text||(finite(c.mileage)?c.mileage:''),'text','maxlength="50" placeholder="如 7.2、7万+；缺失可留空"')}<label class="form-field wide">车况<textarea name="condition" maxlength="2000">${esc(c.condition||'')}</textarea></label></div><div class="form-actions"><button class="button primary small" type="submit">保存修正</button></div><div class="form-error" role="alert"></div></form></details></section>`:''}
      <section class="drawer-section"><h3>源消息与原文</h3><p class="note-line pre-wrap">来源：${esc(text(c.source))}\n消息编号：${esc(text(c.source_message_id))}</p><pre class="source-message">${esc(text(c.raw))}</pre>${array(c.issues).length?`<div class="issues">${c.issues.map(x=>tag(x,'amber')).join('')}</div>`:''}</section>
      <section class="drawer-section"><h3>报价时间线</h3>${array(c.quotes).length?`<table class="data-table"><thead><tr><th>来源时间</th><th>报价</th><th>状态</th></tr></thead><tbody>${c.quotes.map(q=>`<tr><td>${esc(date(q.as_of,true))}</td><td>${q.is_confirmed&&finite(q.amount)?`${fmt(q.amount)} 万元`:`${esc(text(q.raw_price))}${finite(q.amount)?`<br>候选数字 ${fmt(q.amount)}`:''}`}</td><td>${tag(q.is_confirmed?'已确认整车报价':'候选 / 单位待确认',q.is_confirmed?'blue':'amber')}</td></tr>`).join('')}</tbody></table>`:'<p class="note-line">还没有报价事件，不生成历史。</p>'}</section>
      <section class="drawer-section"><h3>图片证据 · ${count(c.image_count)} 张</h3><p class="note-line section-gap">上下文图片仅为关联候选。核对源消息后，再明确确认属于此车。</p>${array(c.images).length?`<div class="evidence-grid">${c.images.map(img=>{const url=imageURL(img.url),confirmed=img.status==='confirmed';return `<figure class="evidence-card ${confirmed?'':'pending'}">${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="车源附件，${confirmed?'已确认关联':'待确认关联候选'}" loading="lazy"></a>`:'<div class="image-unavailable">图片地址不可用</div>'}<figcaption>${tag(confirmed?'已确认关联':'待确认关联候选',confirmed?'blue':'amber')}<p class="note-line">源消息 #${esc(text(img.source_message_id))}</p>${!confirmed?button('确认属于此车','confirm-image',{'data-id':c.id,'data-media-id':img.id,'data-source-message-id':img.source_message_id,disabled:!validId(img.source_message_id)},'small'):''}</figcaption></figure>`;}).join('')}</div>`:'<p class="note-line">没有可查看的图片附件。</p>'}</section>
      ${c.cohort?`<section class="drawer-section"><h3>同组行情口径</h3><p class="note-line pre-wrap">${esc(text(c.cohort.scope))}</p>${sufficient(c.cohort)&&finite(c.cohort.median)?`<p class="note-line">${count(c.cohort.count)} 辆同组独立车源 · 中位数 ${fmt(c.cohort.median)} 万元</p>`:'<p class="note-line">样本不足 5 辆，暂不估值。</p>'}</section>`:''}
      <section class="drawer-section"><details><summary>变更记录</summary>${array(c.audit).length?`<ol class="audit-list">${c.audit.map(a=>`<li>${esc(date(a.created_at,true))} ${esc(text(a.action))}\n${esc(typeof a.detail==='object'?JSON.stringify(a.detail):text(a.detail))}</li>`).join('')}</ol>`:'<p class="note-line">暂无变更记录。</p>'}</details></section>`;
  }
  function modalHeading(title) { return `<div class="modal-heading"><h2 id="modal-title">${esc(title)}</h2>${button(icon('close'),'close-modal',{'aria-label':'关闭对话框'},'icon-button')}</div>`; }
  function settings(s) {
    const v=s.settings;
    return modalHeading('工作台设置') + (v ? `<form data-form="settings"><div class="form-grid">${field('默认油价省份','province',v.province,'text','required maxlength="20"')}${field('购车预算 / 万元','budget',v.budget,'number','required min="0" step="0.01"')}</div><p class="modal-note">预算填 0 表示暂不设置。省份与预算保存在本机；启动时尝试更新过期油价缓存，也可手动获取。</p><div class="capability-note">${esc(ocrNote(v))}</div><div class="form-error" role="alert"></div><div class="form-actions">${button('取消','close-modal',{},'small')}<button class="button primary" type="submit">保存设置</button></div></form>` : `${notice(s.settingsError||'设置读取失败，请重试。','amber')}${button('重新读取设置','retry-settings',{},'small')}`) + `<p class="modal-note">完整备份包含数据库、原始批次与附件；导入活动期间需先等待批次结束。</p>${button(`${icon('download')}下载完整备份`,'backup',{},'small')}`;
  }
  function merge(c) {
    return modalHeading('明确确认同一辆车') + `<div class="merge-source">即将移入的车源 #${esc(c.id)}\n${esc(text(c.name))} / ${esc(text(c.year))} / ${esc(text(c.region))}</div>${notice('合并后，此条车源的报价时间线和图片会移入目标车源，本条不再单独计数。只有确认是同一辆车时才执行；此操作不能在界面中撤销。','amber')}<p class="modal-note">仅列出同一车型的目标候选。请结合上牌、里程和原文核验，不能只凭同款车型合并。</p><form class="target-search" data-form="target-search" data-mode="merge" data-source-id="${esc(c.id)}"><input class="text-input" name="q" type="search" placeholder="输入原文或车源关键词缩小目标范围" aria-label="查找合并目标"><button class="button small" type="submit">查找目标</button></form><form data-form="merge" data-source-id="${esc(c.id)}"><label class="form-field">保留的目标车源<select id="merge-target" name="target_id" required>${targetOptions([],'正在读取同车型车源')}</select></label><p class="note-line" id="merge-target-info">正在读取目标候选。</p><label class="checkbox-line"><input type="checkbox" name="same_car" required>我已核对原文，确认是同一辆车，并同意将本条并入所选目标。</label><div class="form-error" role="alert"></div><div class="form-actions">${button('取消','close-modal',{},'small')}<button class="button danger-confirm" type="submit">确认合并到目标车源</button></div></form>`;
  }
  function rename(m) {
    return modalHeading('重命名车型档案') + `<form data-form="rename" data-id="${esc(m.id)}">${field('车型名称','name',m.name,'text','required maxlength="200"')}<p class="modal-note">仅修改车型显示名称，车源与原始消息继续保留。</p><div class="form-error" role="alert"></div><div class="form-actions">${button('取消','close-modal',{},'small')}<button class="button primary" type="submit">保存名称</button></div></form>`;
  }
  function manualFuel(province) {
    return modalHeading('手工记录油价') + `<form data-form="fuel-manual"><div class="form-grid">${field('省份','province',province,'text','required maxlength="20"')}${field('生效日期 / 中国本地日期','effective_date',today(),'date',`required max="${today()}"`)}${field('92号 / 元每升','p92','','number','required min="0.01" step="0.01"')}${field('95号 / 元每升','p95','','number','required min="0.01" step="0.01"')}<label class="form-field wide">公开来源链接（可选）<input type="url" name="source_url" placeholder="https://…"></label></div><p class="modal-note">请按公开来源填写真实生效价。此条会标注为“手工记录”，不会冒充自动获取结果。</p><div class="form-error" role="alert"></div><div class="form-actions">${button('取消','close-modal',{},'small')}<button class="button primary" type="submit">保存手工记录</button></div></form>`;
  }

  function mountCharts(root = document) {
    root.querySelectorAll('[data-chart]').forEach(container => {
      let c;
      try { c = cleanChart(JSON.parse(container.dataset.chart)); } catch { container.textContent='图表资料格式无效，请重新读取。'; return; }
      if (!c.labels.length || !c.series.length) { container.textContent='没有有效观察值。'; return; }
      const width=Math.max(400,Math.min(1000,container.clientWidth-40)), height=260;
      const left=52,right=120,top=24,bottom=39, plotWidth=width-left-right;
      const values=c.series.flatMap(s=>s.values).concat(array(c.points).map(p=>Number(p.value))), min=Math.min(...values),max=Math.max(...values);
      const spread=Math.max(.1,max-min), rough=spread/3.5, power=10**Math.floor(Math.log10(rough));
      const tick=[1,2,2.5,5,10].map(n=>n*power).find(n=>n>=rough);
      const low=Math.floor((min-spread*.15)/tick)*tick, high=Math.ceil((max+spread*.15)/tick)*tick;
      const times=c.labels.map(l=>Date.parse(`${l}T00:00:00+08:00`));
      const timed=times.every(Number.isFinite)&&times.at(-1)>times[0];
      const x=i=>c.labels.length===1?left+plotWidth/2:left+(timed?(times[i]-times[0])/(times.at(-1)-times[0]):i/(c.labels.length-1))*plotWidth;
      const y=v=>top+(high-v)/(high-low)*(height-top-bottom);
      const colors=['var(--series-1)','var(--series-2)'];
      let svg=`<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(c.title||'历史趋势')}，单位${esc(c.unit||'万元')}。仅使用已记录数据"><text x="${left}" y="12" class="chart-axis-label">${esc(c.unit||'万元')}</text>`;
      for(let n=low;n<=high+tick*.001;n+=tick) svg+=`<line class="chart-grid" x1="${left}" x2="${width-right+4}" y1="${y(n)}" y2="${y(n)}"/><text class="chart-axis-label" x="${left-10}" y="${y(n)+4}" text-anchor="end">${n.toFixed(tick<.1?2:1)}</text>`;
      const stride=Math.max(1,Math.ceil(c.labels.length/5));
      c.labels.forEach((label,i)=>{ if(i%stride===0||i===c.labels.length-1) svg+=`<text class="chart-axis-label" x="${x(i)}" y="${height-12}" text-anchor="middle">${esc(label)}</text>`; });
      const ends=c.series.map((s,i)=>({i,py:y(s.values.at(-1))})).sort((a,b)=>a.py-b.py);
      for(let i=1;i<ends.length;i++) if(ends[i].py-ends[i-1].py<18) ends[i].py=ends[i-1].py+18;
      c.series.forEach((s,si)=>{
        const slot=s.slot??si,color=colors[slot===1?1:0],coords=s.values.map((v,i)=>[x(i),y(v)]);
        let path=`M${coords[0].join(',')}`;
        for(let i=1;i<coords.length;i++) path+=c.step?`H${coords[i][0]}V${coords[i][1]}`:`L${coords[i].join(',')}`;
        const last=coords.at(-1),labelY=ends.find(e=>e.i===si).py;
        svg+=`<path d="${path}" stroke="${color}" class="chart-series ${slot===1?'secondary':'first'}"/><circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="${color}" class="chart-point"/><text x="${last[0]+11}" y="${labelY+4}" class="chart-end-label">${c.series.length>1?`${esc(s.name)} `:''}${fmt(s.values.at(-1))}</text>`;
      });
      const byDate={};
      array(c.points).forEach(p=>{(byDate[p.date]??=[]).push(p)});
      Object.entries(byDate).forEach(([date,list])=>{
        const index=c.labels.indexOf(date);if(index<0)return;
        const raw=list.map((p,j)=>x(index)+(j-(list.length-1)/2)*13);
        const min=Math.min(...raw),max=Math.max(...raw);
        let shift=0;
        if(min<left+9)shift=left+9-min;
        if(max+shift>width-right-9)shift=width-right-9-max;
        list.forEach((p,j)=>{
          const cx=raw[j]+shift,cy=y(Number(p.value));
          const label=`${date}，${fmt(p.value)} ${c.unit||'万元'}${p.label?`，${p.label}`:''}`;
          svg+=`<circle class="chart-point observation-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" fill="var(--series-1)" tabindex="0" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title></circle>`;
        });
      });
      svg+=`<line class="chart-crosshair" y1="${top}" y2="${height-bottom}" x1="${left}" x2="${left}" style="display:none"/>`;
      c.labels.forEach((l,i)=>{
        const from=i===0?left-10:(x(i-1)+x(i))/2,to=i===c.labels.length-1?width-right+10:(x(i)+x(i+1))/2;
        svg+=`<rect class="chart-hit" data-index="${i}" x="${from}" y="${top}" width="${Math.max(1,to-from)}" height="${height-top-bottom}" tabindex="0" role="button" aria-label="${esc(`${l}，${c.series.map(s=>`${s.name} ${fmt(s.values[i])} ${c.unit||'万元'}`).join('，')}`)}"/>`;
      });
      container.innerHTML=svg+'</svg>';
      const tooltip=document.createElement('div');tooltip.className='chart-tooltip';tooltip.hidden=true;container.append(tooltip);
      const cross=container.querySelector('.chart-crosshair'),zones=[...container.querySelectorAll('.chart-hit')];
      const show=i=>{
        tooltip.replaceChildren();const d=document.createElement('span');d.className='tooltip-date';d.textContent=`${c.labels[i]}${array(c.counts).length?` · 当日 ${count(c.counts[i])} 辆`:''}`;tooltip.append(d);
        c.series.forEach((s,si)=>{const row=document.createElement('div'),key=document.createElement('i'),name=document.createElement('span'),value=document.createElement('strong');row.className='tooltip-row';key.className='tooltip-key';key.style.background=colors[(s.slot??si)===1?1:0];name.textContent=s.name;value.textContent=`${fmt(s.values[i])} ${c.unit||'万元'}`;row.append(key,name,value);tooltip.append(row);});
        tooltip.hidden=false;tooltip.style.left=`${Math.max(2,Math.min(65,x(i)/width*100-8))}%`;cross.setAttribute('x1',x(i));cross.setAttribute('x2',x(i));cross.style.display='';
      };
      const hide=()=>{tooltip.hidden=true;cross.style.display='none';};
      zones.forEach((zone,i)=>{zone.addEventListener('pointerenter',()=>show(i));zone.addEventListener('focus',()=>show(i));zone.addEventListener('blur',hide);zone.addEventListener('keydown',e=>{let next=i;if(e.key==='ArrowRight')next=Math.min(zones.length-1,i+1);else if(e.key==='ArrowLeft')next=Math.max(0,i-1);else if(e.key==='Home')next=0;else if(e.key==='End')next=zones.length-1;else return;e.preventDefault();zones[next].focus();});});
      container.addEventListener('pointerleave',hide);
    });
  }

  window.CarWatchUI={esc,icon,finite,fmt,count,text,date,today,bytes,button,tag,notice,option,array,imageURL,safeURL,sourceLink,heading,empty,error,loading,overview,listings,models,compare,fuel,importPage,batches,reviewWorkspace,orderedReviews,drawer,settings,merge,rename,manualFuel,targetOptions,mountCharts,cleanChart,sufficient,ocrNote,modalHeading};
})();
