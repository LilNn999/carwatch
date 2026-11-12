/* Local production app: API orchestration, persistent actions and resumable uploads. */
(() => {
  'use strict';
  const U = window.CarWatchUI;
  const CHUNK_SIZE = 2 * 1024 * 1024;
  const ROUTES = ['overview','listings','models','compare','fuel','import'];
  const $ = selector => document.querySelector(selector);
  const page = $('#page'), drawer = $('#detail-drawer'), modal = $('#modal');
  function readStore(key, fallback) {
    try { const value=localStorage.getItem(`carwatch.${key}`); return value===null?fallback:JSON.parse(value); }
    catch { return fallback; }
  }
  function saveStore(key, value) {
    try { localStorage.setItem(`carwatch.${key}`,JSON.stringify(value)); return true; }
    catch { return false; }
  }
  const savedDays=readStore('days',30), savedModel=readStore('model',null);
  const deferredIds=readStore('deferred',[]);
  const savedFilters=readStore('filters',{}), savedCohort=readStore('cohort',{});
  const filterPrefs=savedFilters&&typeof savedFilters==='object'?savedFilters:{};
  const cohortPrefs=savedCohort&&typeof savedCohort==='object'?savedCohort:{};
  const cohortState=Object.fromEntries(['model_year','engine','trim','mileage_min','mileage_max','region'].map(k=>[k,typeof cohortPrefs[k]==='string'||typeof cohortPrefs[k]==='number'?String(cohortPrefs[k]):'']));
  if((cohortState.model_year&&!cohortState.engine)||(!cohortState.model_year&&cohortState.engine)){cohortState.model_year='';cohortState.engine='';}
  const state = {
    route:'overview', settings:null, settingsError:'', models:[], modelsError:'', compareItems:null, compareError:'',
    days:[7,30,90,365].includes(savedDays)?savedDays:30, modelId:Number.isInteger(savedModel)&&savedModel>0?savedModel:null,
    cohort:cohortState, cohortScope:'', analysis:null,
    filters:{q:typeof filterPrefs.q==='string'?filterPrefs.q:'',model_id:typeof filterPrefs.model_id==='string'?filterPrefs.model_id:'',max_price:typeof filterPrefs.max_price==='string'?filterPrefs.max_price:'',favorites:filterPrefs.favorites===true,status:['pending','confirmed','excluded'].includes(filterPrefs.status)?filterPrefs.status:'',page:Number.isInteger(filterPrefs.page)&&filterPrefs.page>0?filterPrefs.page:1,page_size:[25,50,100].includes(filterPrefs.page_size)?filterPrefs.page_size:25},
    onlyDifferences:readStore('differences',false)===true, fuel:null, fuelProvince:'', batches:null, batchError:'', reviews:null, reviewTotal:null,
    reviewError:'', activeReviewId:null, reviewQuery:'', reviewLimit:50,
    deferred:new Set(Array.isArray(deferredIds)?deferredIds.map(String):[]), assignTargets:null,
    selectedFiles:[], selectedName:'', namespace:String(readStore('namespace','')||''), selectionMessage:'', selectionTarget:null,
    activeUpload:null, uploadErrors:{}, detail:null, detailId:null, modalKind:'', mergeSource:null,
    targets:{}, listings:new Map(), health:null
  };
  let routeVersion=0, detailVersion=0, pollTimer=null, polling=false, toastTimer=null, lastBatchPaint=0;

  class ApiError extends Error {
    constructor(message,status=0) { super(message); this.name='ApiError'; this.status=status; }
  }
  async function api(path, {method='GET', data, raw=false, response='json', timeout=45000}={}) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeout);
    const headers={Accept:response==='blob'?'application/zip':'application/json'};
    const mutation=['POST','PATCH','PUT','DELETE'].includes(method);
    if (mutation) {
      headers['X-Requested-With']='CarWatch';
      headers['Content-Type']=raw?'application/octet-stream':'application/json';
    }
    try {
      const result=await fetch(`/api${path}`,{method,headers,credentials:'same-origin',cache:'no-store',signal:controller.signal,...(mutation?{body:raw?data:JSON.stringify(data??{})}:{})});
      if (!result.ok) {
        let message=`请求失败（${result.status}）`;
        try { const body=await result.json(); if(typeof body.detail==='string')message=body.detail; }
        catch { /* Non-JSON error responses still retain their HTTP status. */ }
        throw new ApiError(message,result.status);
      }
      return response==='blob'?await result.blob():result.status===204?null:await result.json();
    } catch (e) {
      if(e instanceof ApiError) throw e;
      if(e.name==='AbortError') throw new ApiError('本机请求超时。已上传字节会保留，可重新读取后继续。');
      throw new ApiError(`无法读取本机服务：${e.message||'连接中断'}`);
    } finally { clearTimeout(timer); }
  }
  function query(values) {
    const params=new URLSearchParams();
    for(const [k,v] of Object.entries(values)) if(v!==''&&v!==null&&v!==undefined)params.set(k,String(v));
    const s=params.toString();return s?`?${s}`:'';
  }
  function toast(message,error=false) {
    clearTimeout(toastTimer); const el=$('#toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;
    toastTimer=setTimeout(()=>{el.hidden=true;},error?7500:4500);
  }
  function formError(form,message) {
    const el=form?.querySelector('.form-error') || (form?.dataset.form==='alias'?$('#alias-error'):null);
    if(el)el.textContent=message;else toast(message,true);
  }
  function cacheListings(items) {
    for(const x of U.array(items)) if(x?.id!==undefined)state.listings.set(Number(x.id),x);
  }
  function setCompare(result) {
    state.compareItems=U.array(result.items);state.compareError='';cacheListings(state.compareItems);updateNavigation();
  }
  function updateNavigation() {
    document.querySelectorAll('#navigation [data-page]').forEach(a=>{
      const active=a.dataset.page===state.route;a.classList.toggle('active',active);
      if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
    });
    $('#compare-count').textContent=state.compareItems===null?'—':String(state.compareItems.length);
    const processing=U.array(state.batches).filter(b=>['queued','running'].includes(b.status)).length;
    const badge=$('#import-active');badge.hidden=!processing&&!state.activeUpload;badge.textContent=state.activeUpload?'上传中':`${processing} 处理中`;
    if(state.health){
      $('#connection-status').classList.remove('offline');$('#connection-status span').textContent=state.health.worker?'本机工作区已连接':'已连接 · 后台未启动';
      $('#footer-status').textContent=`本机资料 · ${state.health.version?`v${state.health.version}`:'PC 桌面版'}`;
    }
  }
  function paint(html) { page.innerHTML=html;U.mountCharts(page); }
  function selectedModel() {
    return state.models.find(m=>Number(m.id)===Number(state.modelId)) || state.models.find(m=>m.followed) || state.models[0] || null;
  }
  function adoptModel(m) {
    if(!m)return;state.modelId=Number(m.id);saveStore('model',state.modelId);
  }
  async function refreshShared({models=true,settings=false}={}) {
    const work=[['compare',api('/compare')]];
    if(models)work.push(['models',api('/models')]);
    if(settings)work.push(['settings',api('/settings')]);
    const results=await Promise.allSettled(work.map(([,promise])=>promise));
    results.forEach((r,i)=>{
      const type=work[i][0];
      if(r.status==='fulfilled'){
        if(type==='compare')setCompare(r.value);
        if(type==='models'){state.models=U.array(r.value.items);state.modelsError='';}
        if(type==='settings'){state.settings=r.value;state.settingsError='';}
      }else{
        if(type==='compare')state.compareError=r.reason.message;
        if(type==='models')state.modelsError=r.reason.message;
        if(type==='settings')state.settingsError=r.reason.message;
      }
    });
  }
  async function loadPage() {
    saveStore('filters',state.filters);saveStore('cohort',state.cohort);saveStore('differences',state.onlyDifferences);
    const version=++routeVersion,route=state.route;updateNavigation();page.setAttribute('aria-busy','true');
    try {
      let html;
      if(route==='overview') {
        const data=await api(`/overview${query({days:state.days,model_id:state.modelId,...state.cohort})}`);
        if(version!==routeVersion)return;
        if(Array.isArray(data.models)){state.models=data.models;state.modelsError='';}
        state.analysis=data.analysis;adoptModel(data.selected_model);cacheListings(data.recent);html=U.overview(data,state);
      } else if(route==='listings') {
        let data=await api(`/listings${query(state.filters)}`);
        const last=Math.max(1,Math.ceil(data.total/data.page_size));
        if(data.page>last){state.filters.page=last;saveStore('filters',state.filters);data=await api(`/listings${query(state.filters)}`);}
        if(version!==routeVersion)return;cacheListings(data.items);html=U.listings(data,state);
      } else if(route==='models') {
        const result=await api('/models');
        if(version!==routeVersion)return;state.models=U.array(result.items);state.modelsError='';
        const model=selectedModel();adoptModel(model);
        let analysis=null;
        if(model)analysis=await api(`/models/${model.id}/analysis${query({days:state.days,...state.cohort,scope:state.cohortScope})}`);
        if(version!==routeVersion)return;state.analysis=analysis;cacheListings(analysis?.listings);html=U.models(model,analysis,state);
      } else if(route==='compare') {
        const result=await api('/compare');
        if(version!==routeVersion)return;setCompare(result);html=U.compare(result,state);
      } else if(route==='fuel') {
        const data=await api(`/fuel${query({province:state.fuelProvince||state.settings?.province||''})}`);
        if(version!==routeVersion)return;state.fuel=data;state.fuelProvince=data.province;html=U.fuel(data,state);
      } else {
        await Promise.all([fetchBatches(),fetchReviews()]);
        if(version!==routeVersion)return;html=U.importPage(state);
      }
      if(version!==routeVersion)return;
      paint(html);document.title=`${({overview:'行情总览',listings:'车源台账',models:'车型档案',compare:'购车对比',fuel:'油价走势',import:'导入记录'})[route]} · 车价观察`;
      if(route==='import'){
        ensureAssignmentTargets();schedulePoll();
      }
    }catch(e){
      if(version===routeVersion){
        const fuelActions=route==='fuel'?U.heading('油价走势','油价资料尚未读取，可重试或根据公开来源手工记录。',U.button('手工记录','fuel-manual')):'';
        paint(fuelActions+U.error(e.message));
      }
    }
    finally{if(version===routeVersion)page.removeAttribute('aria-busy');}
  }
  function navigate(route) {
    if(!ROUTES.includes(route))return;
    if(state.route===route){loadPage();return;}
    location.hash=route;
  }
  function hashChanged() {
    const hash=location.hash.slice(1).split('?')[0];
    if(hash==='page'){page.focus();return;}
    state.route=ROUTES.includes(hash)?hash:'overview';
    if(!ROUTES.includes(hash))history.replaceState(null,'',`${location.pathname}${location.search}#overview`);
    if(drawer.open)drawer.close();if(modal.open)modal.close();
    window.scrollTo({top:0});loadPage();
  }

  async function openDrawer(id,{refresh=false}={}) {
    id=Number(id);if(!Number.isInteger(id)||id<=0)return;
    const version=++detailVersion;state.detailId=id;
    if(!refresh){drawer.innerHTML=`<div class="drawer-heading"><h2>车源详情</h2>${U.button(U.icon('close'),'close-drawer',{'aria-label':'关闭详情'},'icon-button')}</div>${U.loading()}`;if(!drawer.open)drawer.showModal();drawer.scrollTop=0;}
    try{
      const data=await api(`/listings/${id}`);
      if(version!==detailVersion||!drawer.open||state.detailId!==id)return;
      state.detail=data;cacheListings([data]);const scroll=drawer.scrollTop;drawer.innerHTML=U.drawer(data,state);if(refresh)drawer.scrollTop=scroll;
    }catch(e){if(version===detailVersion&&drawer.open)drawer.innerHTML=`<div class="drawer-heading"><h2>车源详情</h2>${U.button(U.icon('close'),'close-drawer',{'aria-label':'关闭详情'},'icon-button')}</div>${U.error(e.message,'retry-detail')}`;}
  }
  async function afterListingChange(id,{refreshPage=true,refreshDrawer=true}={}) {
    await refreshShared({models:false});
    if(refreshPage&&state.route!=='import')await loadPage();
    if(refreshDrawer&&drawer.open&&state.detailId===Number(id))await openDrawer(id,{refresh:true});
  }
  function showModal(html,kind,wide=false) {
    state.modalKind=kind;modal.classList.toggle('wide',wide);$('#modal-content').innerHTML=html;
    if(!modal.open)modal.showModal();modal.scrollTop=0;
  }
  async function showSettings() {
    if(!state.settings){
      try{state.settings=await api('/settings');state.settingsError='';}catch(e){state.settingsError=e.message;}
    }
    showModal(U.settings(state),'settings');
  }
  async function loadTargets(mode,q='',pageNumber=1,reviewId=null) {
    const source=mode==='merge'?state.mergeSource:null;
    if(mode==='merge'&&!source)return;
    const context={q,page:pageNumber,reviewId,sourceId:source?.id};state.targets[mode]=context;
    const data=await api(`/listings${query({q,page:pageNumber,page_size:100,...(source?{model_id:source.model_id}:{})})}`);
    if(state.targets[mode]!==context)return;
    const items=U.array(data.items).filter(x=>!source||Number(x.id)!==Number(source.id)&&Number(x.model_id)===Number(source.model_id));
    cacheListings(items);context.items=items;context.total=data.total;context.pages=Math.max(1,Math.ceil(data.total/data.page_size));
    if(mode==='assign'){
      if(String(state.activeReviewId)!==String(reviewId)||state.route!=='import')return;state.assignTargets=items;
    }else if(!modal.open||state.modalKind!=='merge')return;
    const target=$(mode==='merge'?'#merge-target':'#assignment-target'),info=$(mode==='merge'?'#merge-target-info':'#assignment-target-info');
    if(!target)return;
    target.innerHTML=U.targetOptions(items,items.length?'请选择明确属于同一辆车的目标':'无匹配目标，请调整搜索');
    if(info)info.innerHTML=`第 ${U.count(pageNumber)} / ${U.count(context.pages)} 页 · 共 ${U.count(data.total)} 个搜索结果。${context.pages>1?`${U.button('上一组','target-page',{'data-mode':mode,'data-page':pageNumber-1,disabled:pageNumber<=1},'ghost small')} ${U.button('下一组','target-page',{'data-mode':mode,'data-page':pageNumber+1,disabled:pageNumber>=context.pages},'ghost small')}`:' 请核对车源编号与原文。'}`;
  }
  async function showMerge(id) {
    const c=state.detail?.id===Number(id)?state.detail:await api(`/listings/${Number(id)}`);
    if(!c.model_id)throw new ApiError('需先校对所属车型，再选择同车合并目标。');
    state.mergeSource=c;showModal(U.merge(c),'merge',true);
    try{await loadTargets('merge');}catch(e){const info=$('#merge-target-info');if(info)info.textContent=e.message;}
  }

  function renderBatches(force=false) {
    const el=$('#batch-list');if(!el||state.route!=='import')return;
    const now=performance.now();if(!force&&now-lastBatchPaint<150)return;lastBatchPaint=now;
    el.innerHTML=U.batches(state);updateNavigation();
  }
  function renderReviews() {
    const el=$('#review-workspace');if(!el||state.route!=='import')return;
    el.innerHTML=U.reviewWorkspace(state);const total=$('#review-total');if(total)total.textContent=`${state.reviewTotal===null?'未知':U.count(state.reviewTotal)} 条待处理`;
    ensureAssignmentTargets();
  }
  async function fetchBatches() {
    try{const data=await api('/imports');state.batches=U.array(data.items);state.batchError='';}
    catch(e){state.batchError=e.message;}
    updateNavigation();
  }
  async function fetchReviews() {
    try{
      const data=await api('/reviews');state.reviews=U.array(data.items);state.reviewTotal=data.total;state.reviewError='';
      if(!state.reviews.some(r=>String(r.id)===String(state.activeReviewId)))state.activeReviewId=U.orderedReviews(state)[0]?.id??null;
      const ids=new Set(state.reviews.map(r=>String(r.id)));state.deferred=new Set([...state.deferred].filter(id=>ids.has(id)));saveStore('deferred',[...state.deferred]);
    }catch(e){state.reviewError=e.message;}
  }
  function ensureAssignmentTargets() {
    const active=U.array(state.reviews).find(r=>String(r.id)===String(state.activeReviewId));
    if(state.route==='import'&&active?.kind==='supplement'&&state.targets.assign?.reviewId!==active.id){
      state.assignTargets=null;
      loadTargets('assign','',1,active.id).catch(e=>{const info=$('#assignment-target-info');if(info&&String(state.activeReviewId)===String(active.id))info.textContent=e.message;});
    }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);pollTimer=null;
    if(!U.array(state.batches).some(b=>['queued','running'].includes(b.status)))return;
    pollTimer=setTimeout(pollBatches,2500);
  }
  async function pollBatches() {
    if(polling)return;
    if(!U.array(state.batches).some(b=>['queued','running'].includes(b.status)))return;
    if(document.hidden){schedulePoll();return;}
    polling=true;
    const activeIds=new Set(U.array(state.batches).filter(b=>['queued','running'].includes(b.status)).map(b=>b.id));
    try{
      await fetchBatches();renderBatches(true);
      const completed=U.array(state.batches).some(b=>activeIds.has(b.id)&&['done','error'].includes(b.status));
      if(completed){
        await refreshShared();
        if(state.route==='import'){
          await fetchReviews();
          // Do not replace an active review form while the user is typing.
          const active=U.array(state.reviews).find(r=>String(r.id)===String(state.activeReviewId));
          const formActive=$('#review-content')?.contains(document.activeElement);
          if(!formActive&&!active)renderReviews();
          const total=$('#review-total');if(total)total.textContent=`${U.count(state.reviewTotal)} 条待处理`;
          if(!$('#review-content'))renderReviews();
        }
        toast('导入批次状态已更新，可刷新校对查看新增候选。');
      }
    }finally{polling=false;schedulePoll();}
  }
  function upsertBatch(batch) {
    if(!state.batches)state.batches=[];
    const index=state.batches.findIndex(b=>b.id===batch.id);
    if(index<0)state.batches.unshift(batch);else state.batches[index]={...state.batches[index],...batch};
    updateNavigation();
  }
  function chooseFiles(zip=false,resumeId=null) {
    if(state.activeUpload){toast('请等待当前上传完成或先暂停。');return;}
    state.selectionTarget=resumeId;const input=$(zip?'#zip-input':'#folder-input');input.value='';input.click();
  }
  function manifest(files) {
    if(!files.length)throw new ApiError('尚未选择文件。');
    if(files.length>20000)throw new ApiError('最多可选择 20,000 个文件，请拆分导出批次。');
    let total=0;const seen=new Set();
    const items=files.map(file=>{
      const path=(file.webkitRelativePath||file.name).replace(/\\/g,'/');
      if(seen.has(path))throw new ApiError(`文件路径重复：${path}`);seen.add(path);
      if(!Number.isSafeInteger(file.size)||file.size<0)throw new ApiError(`无法读取文件大小：${path}`);
      total+=file.size;
      const ext=path.split('.').at(-1).toLowerCase();
      if(ext==='zip'&&file.size>512*1024**2)throw new ApiError(`ZIP 超过 512 MB：${path}`);
      if(ext==='json'&&file.size>64*1024**2)throw new ApiError(`JSON 超过 64 MB：${path}`);
      if(['jpg','jpeg','png','gif','webp','bmp','tif','tiff'].includes(ext)&&file.size>32*1024**2)throw new ApiError(`图片超过 32 MB：${path}`);
      return {path,size:file.size};
    });
    if(total>2*1024**3)throw new ApiError('本批次超过 2 GB，请拆分后导入。');
    return items;
  }
  function rememberManifest(batch) {
    // The authoritative manifest is persisted by /imports in SQLite. This is a local shortcut.
    if(!saveStore('upload-manifest',{id:batch.id,name:batch.name,files:U.array(batch.files).map(f=>({path:f.path,size:f.size}))}))saveStore('upload-manifest',{id:batch.id,name:batch.name});
  }
  async function handleSelection(input) {
    const files=[...input.files],target=state.selectionTarget;state.selectionTarget=null;
    if(!files.length)return;
    try{
      manifest(files);
      if(input.id==='zip-input'&&(files.length!==1||!files[0].name.toLowerCase().endsWith('.zip')))throw new ApiError('请选择单个 .zip 文件。');
      if(target){
        const batch=await api(`/imports/${encodeURIComponent(target)}`);rememberManifest(batch);upsertBatch(batch);await uploadBatch(batch,files);return;
      }
      state.selectedFiles=files;state.selectedName=(files[0].webkitRelativePath||files[0].name).split('/')[0];state.selectionMessage='已选择资料，核对账户标识后开始上传。';
      const summary=$('#selection-summary');if(summary)summary.textContent=`已选 ${files.length.toLocaleString('zh-CN')} 个文件 · ${U.bytes(files.reduce((n,f)=>n+f.size,0))}`;
      const name=$('#import-name');if(name&&!name.value)name.value=state.selectedName;
      const message=$('#upload-message');if(message)message.textContent=state.selectionMessage;
      const start=$('#start-upload');if(start)start.disabled=false;
    }catch(e){toast(e.message,true);}
  }
  async function uploadBatch(initial,files) {
    if(state.activeUpload)throw new ApiError('已有上传任务正在进行。');
    const task={id:initial.id,pause:false};state.activeUpload=task;delete state.uploadErrors[initial.id];updateNavigation();renderBatches(true);
    const start=$('#start-upload');if(start)start.disabled=true;
    let success=false;
    try{
      const batch=await api(`/imports/${encodeURIComponent(initial.id)}`);
      if(batch.status!=='uploading')throw new ApiError('此批次已进入后台处理，不需要再次上传。');
      if(!Array.isArray(batch.files))throw new ApiError('批次清单不可用，请刷新后重试。');
      const items=manifest(files),selected=new Map(items.map((f,i)=>[f.path,files[i]]));
      if(batch.files.length!==selected.size)throw new ApiError('重选的文件数量与原批次不一致，请选择原完整文件夹或相同 ZIP。');
      for(const spec of batch.files)if(!selected.has(spec.path)||selected.get(spec.path).size!==spec.size)throw new ApiError(`文件与持久化清单不匹配：${spec.path}。必须保持路径与大小一致。`);
      upsertBatch(batch);rememberManifest(batch);
      let received=batch.files.reduce((n,f)=>n+f.received,0);
      for(const spec of batch.files){
        const file=selected.get(spec.path);let offset=spec.received,conflicts=0;
        if(!Number.isSafeInteger(offset)||offset<0||offset>file.size)throw new ApiError(`服务器接收进度无效：${spec.path}`);
        while(offset<file.size){
          if(task.pause)throw new ApiError('上传已暂停。重选相同文件可从已收到字节继续。',499);
          const end=Math.min(file.size,offset+CHUNK_SIZE);
          let result;
          try{result=await api(`/imports/${encodeURIComponent(batch.id)}/files/${encodeURIComponent(spec.id)}${query({offset})}`,{method:'PUT',raw:true,data:file.slice(offset,end),timeout:120000});}
          catch(e){
            if(e.status===409&&conflicts++<1){
              const latest=await api(`/imports/${encodeURIComponent(batch.id)}`),current=U.array(latest.files).find(f=>f.id===spec.id);
              if(!current||!Number.isSafeInteger(current.received)||current.received<0||current.received>file.size)throw e;
              received+=current.received-offset;offset=current.received;spec.received=offset;upsertBatch(latest);renderBatches();continue;
            }
            throw e;
          }
          if(!Number.isSafeInteger(result.received)||result.received!==end)throw new ApiError('服务器返回的上传长度不一致。请重新读取本批次后续传。');
          received+=result.received-offset;offset=result.received;spec.received=offset;
          upsertBatch({id:batch.id,received_bytes:received});renderBatches();
        }
      }
      if(task.pause)throw new ApiError('文件已传完，后台处理尚未提交。可在批次点击“提交后台处理”。',499);
      const completed=await api(`/imports/${encodeURIComponent(batch.id)}/complete`,{method:'POST',data:{}});upsertBatch(completed);success=true;
      state.selectedFiles=[];state.selectedName='';state.selectionMessage='文件已上传，后台正在处理；可继续校对其他记录。';toast('上传已完成，批次已交给本机后台处理。');
    }catch(e){
      state.uploadErrors[initial.id]=e.status===499?e.message:`${e.message}\n已收到字节保留在本机。重选相同文件后可继续上传。`;
      toast(state.uploadErrors[initial.id],e.status!==499);
    }finally{
      state.activeUpload=null;renderBatches(true);updateNavigation();schedulePoll();
      const startButton=$('#start-upload');if(startButton)startButton.disabled=!state.selectedFiles.length;
      if(success){const summary=$('#selection-summary');if(summary)summary.textContent='上传完成，可以选择下一批资料。';const name=$('#import-name');if(name)name.value='';}
      const message=$('#upload-message');if(message)message.textContent=state.selectionMessage;
    }
    return success;
  }
  async function retryBatch(id) {
    const result=await api(`/imports/${encodeURIComponent(id)}/retry`,{method:'POST',data:{}});upsertBatch(result);delete state.uploadErrors[id];renderBatches(true);schedulePoll();
  }
  async function showManifest(id) {
    const batch=await api(`/imports/${encodeURIComponent(id)}`);rememberManifest(batch);
    showModal(`${U.modalHeading('持久化上传清单')}<p class="pre-wrap">${U.esc(batch.name)} · ${U.count(batch.file_count)} 个文件 · ${U.bytes(batch.total_bytes)}</p><p class="note-line">清单保存在本机数据库。续传必须重选路径、大小都相同的文件；只上传尚未接收的字节。</p><ol class="manifest-list">${U.array(batch.files).map(f=>`<li>${U.esc(f.path)}<br>${U.bytes(f.received)} / ${U.bytes(f.size)}</li>`).join('')}</ol><div class="form-actions">${U.button('关闭','close-modal',{},'small')}</div>`,'manifest',true);
  }
  async function backup(button) {
    if(button)button.disabled=true;toast('正在准备本机完整备份。');
    const blob=await api('/backup',{response:'blob',timeout:180000});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`车价观察备份-${U.today()}.zip`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('备份下载已交给浏览器。请在下载目录中确认 ZIP 文件。');
  }

  async function action(el) {
    const {action:kind,id}=el.dataset;
    switch(kind){
      case 'navigate':navigate(el.dataset.target);break;
      case 'reload':await refreshShared({settings:true});await loadPage();break;
      case 'settings':case 'retry-settings':await showSettings();break;
      case 'close-modal':modal.close();break;
      case 'close-drawer':drawer.close();break;
      case 'detail':await openDrawer(id);break;
      case 'retry-detail':await openDrawer(state.detailId);break;
      case 'backup':await backup(el);break;
      case 'favorite':{
        const current=state.listings.get(Number(id))||await api(`/listings/${id}`);
        const result=await api(`/listings/${id}`,{method:'PATCH',data:{favorite:!current.favorite}});cacheListings([result]);await afterListingChange(id);toast(result.favorite?'已收藏车源。':'已取消收藏。');break;
      }
      case 'compare-toggle':{
        if(state.compareItems===null)setCompare(await api('/compare'));
        const included=state.compareItems.some(x=>Number(x.id)===Number(id));
        if(!included&&state.compareItems.length>=4)throw new ApiError('最多同时对比 4 辆，请先移出一辆。');
        const result=await api(`/listings/${id}`,{method:'PATCH',data:{in_compare:!included}});cacheListings([result]);await afterListingChange(id);toast(included?'已移出对比。':'已加入对比，选择结果已保存在本机。');break;
      }
      case 'model-detail':state.modelId=Number(id);saveStore('model',state.modelId);state.cohort={model_year:'',engine:'',trim:'',mileage_min:'',mileage_max:'',region:''};state.cohortScope='';navigate('models');break;
      case 'follow':{
        const m=state.models.find(x=>Number(x.id)===Number(id));if(!m)throw new ApiError('车型已变化，请重新读取。');
        await api(`/models/${id}`,{method:'PATCH',data:{followed:!m.followed}});await refreshShared();await loadPage();toast(m.followed?'已取消关注。':'已关注车型。');break;
      }
      case 'rename-model':{const m=state.models.find(x=>Number(x.id)===Number(id));if(m)showModal(U.rename(m),'rename');break;}
      case 'range':state.days=Number(el.dataset.days);saveStore('days',state.days);await loadPage();break;
      case 'reset-filters':state.filters={q:'',model_id:'',max_price:'',favorites:false,status:'',page:1,page_size:state.filters.page_size};await loadPage();break;
      case 'listing-page':state.filters.page=Math.max(1,Number(el.dataset.page));await loadPage();break;
      case 'reset-cohort':state.cohort={model_year:'',engine:'',trim:'',mileage_min:'',mileage_max:'',region:''};state.cohortScope='';await loadPage();break;
      case 'cohort-group':{
        const g=U.array(state.analysis?.groups)[Number(el.dataset.index)];if(!g)return;
        state.cohort={...state.cohort,model_year:g.model_year===null||g.model_year===undefined?'':String(g.model_year),engine:g.engine||'',trim:''};state.cohortScope='';await loadPage();
        if(g.model_year===null||!g.engine)toast('含未知字段的组以上方实际生效口径为准；未知条件不会自动扩大为全车型估值。');break;
      }
      case 'cohort-all':{
        const target=Number(el.dataset.id)||Number(state.analysis?.model_id)||state.modelId;
        if(target){state.modelId=target;saveStore('model',target);}
        state.cohortScope='model';
        state.cohort={model_year:'',engine:'',trim:'',mileage_min:'',mileage_max:'',region:''};
        if(state.route!=='models')navigate('models');else await loadPage();
        break;
      }
      case 'merge-dialog':await showMerge(id);break;
      case 'target-page':{const mode=el.dataset.mode,t=state.targets[mode];if(t)await loadTargets(mode,t.q,Number(el.dataset.page),t.reviewId);break;}
      case 'confirm-image':{
        await api(`/listings/${id}/images/${encodeURIComponent(el.dataset.mediaId)}/confirm`,{method:'POST',data:{source_message_id:Number(el.dataset.sourceMessageId)}});
        if(drawer.open&&state.detailId===Number(id))await openDrawer(id,{refresh:true});toast('图片与此车的关联已确认。');break;
      }
      case 'fuel-refresh':{
        const province=state.fuelProvince||state.settings?.province;if(!province)throw new ApiError('请先在设置中填写省份。');
        const result=await api('/fuel/refresh',{method:'POST',data:{province},timeout:120000});state.fuel=result;
        if(state.route==='fuel'){paint(U.fuel(result,state));}
        toast(result.error?`获取提示：${result.error}`:result.status==='ok'?'已获取并保存公开油价。':'没有获取到可用油价记录。',Boolean(result.error));break;
      }
      case 'fuel-manual':showModal(U.manualFuel(state.fuelProvince||state.settings?.province||''),'fuel-manual');break;
      case 'choose-folder':chooseFiles(false);break;
      case 'choose-zip':chooseFiles(true);break;
      case 'resume-folder':chooseFiles(false,id);break;
      case 'resume-zip':chooseFiles(true,id);break;
      case 'pause-upload':if(state.activeUpload){state.activeUpload.pause=true;toast('当前分块接收完毕后暂停，已收到的字节会保留。');}break;
      case 'refresh-imports':await fetchBatches();renderBatches(true);schedulePoll();break;
      case 'complete-batch':{const b=await api(`/imports/${encodeURIComponent(id)}/complete`,{method:'POST',data:{}});upsertBatch(b);renderBatches(true);schedulePoll();toast('批次已提交本机后台处理。');break;}
      case 'retry-batch':await retryBatch(id);toast('已提交批次重试。');break;
      case 'cancel-batch':{const b=await api(`/imports/${encodeURIComponent(id)}/cancel`,{method:'POST',data:{}});upsertBatch(b);renderBatches(true);toast('已取消未完成上传，可重新续传或直接备份。');break;}
      case 'retry-errors':{
        const ids=U.array(state.batches).filter(b=>b.status==='error').map(b=>b.id),errors=[];let done=0;
        for(const batchId of ids){try{await retryBatch(batchId);done++;}catch(e){errors.push(`${batchId}：${e.message}`);}}
        toast(`已提交 ${done} 个批次重试。${errors.length?`\n${errors.join('\n')}`:''}`,errors.length>0);break;
      }
      case 'batch-manifest':await showManifest(id);break;
      case 'refresh-reviews':await fetchReviews();renderReviews();break;
      case 'select-review':state.activeReviewId=Number(id);state.assignTargets=null;delete state.targets.assign;renderReviews();break;
      case 'more-reviews':state.reviewLimit+=50;renderReviews();break;
      case 'defer-review':{
        state.deferred.add(String(id));saveStore('deferred',[...state.deferred]);
        const next=U.orderedReviews(state).find(r=>String(r.id)!==String(id)&&!state.deferred.has(String(r.id)))||U.orderedReviews(state).find(r=>String(r.id)!==String(id));
        state.activeReviewId=next?.id??Number(id);state.assignTargets=null;delete state.targets.assign;renderReviews();toast('已暂缓，此条仍保留在待校对列表。');break;
      }
      case 'ignore-review':await api(`/reviews/${id}/ignore`,{method:'POST',data:{}});await fetchReviews();renderReviews();await refreshShared();toast('已忽略此候选，原始消息仍保留。');break;
    }
  }

  function numberValue(fd,name,{min=0,required=false,integer=false}={}) {
    const raw=String(fd.get(name)??'').trim();
    if(!raw){if(required)throw new ApiError('请填写必要的数值。');return null;}
    const value=Number(raw);
    if(!Number.isFinite(value)||value<min||integer&&!Number.isInteger(value))throw new ApiError('数值无效，请核对价格、里程或年份。');
    return value;
  }
  async function submit(form) {
    const fd=new FormData(form),kind=form.dataset.form,id=form.dataset.id;
    if(kind==='listing-filters'){
      state.filters={...state.filters,q:String(fd.get('q')||'').trim(),model_id:String(fd.get('model_id')||''),max_price:String(fd.get('max_price')||''),status:String(fd.get('status')||''),favorites:fd.has('favorites'),page:1};await loadPage();return;
    }
    if(kind==='cohort'){
      const min=numberValue(fd,'mileage_min'),max=numberValue(fd,'mileage_max');if(min!==null&&max!==null&&min>max)throw new ApiError('里程下限不能大于上限。');
      state.days=Number(fd.get('days'));saveStore('days',state.days);
      state.cohort=Object.fromEntries(['model_year','engine','trim','mileage_min','mileage_max','region'].map(k=>[k,String(fd.get(k)||'').trim()]));state.cohortScope='';await loadPage();return;
    }
    if(kind==='settings'||kind==='budget'){
      const budget=numberValue(fd,'budget',{required:true});
      const payload={budget};if(kind==='settings'){payload.province=String(fd.get('province')||'').trim();if(!payload.province)throw new ApiError('请填写省份。');}
      state.settings=await api('/settings',{method:'PATCH',data:payload});state.settingsError='';
      if(kind==='settings'){state.fuelProvince=state.settings.province;modal.close();}
      await loadPage();toast('设置已保存在本机。');return;
    }
    if(kind==='listing-note'||kind==='compare-note'){
      const notes=String(fd.get('notes')||'');if(notes.length>2000)throw new ApiError('备注不能超过 2000 字。');
      const payload={notes};if(kind==='listing-note')payload.sale_state=String(fd.get('sale_state')||'unknown');
      const result=await api(`/listings/${id}`,{method:'PATCH',data:payload});cacheListings([result]);
      if(state.detailId===Number(id)&&state.detail)state.detail={...state.detail,...result};
      if(kind==='compare-note'&&state.compareItems)state.compareItems=state.compareItems.map(x=>Number(x.id)===Number(id)?{...x,...result}:x);
      if(kind==='listing-note')await afterListingChange(id);
      toast('备注已保存在本机。');return;
    }
    if(kind==='listing-correct'){
      const payload={model_id:numberValue(fd,'model_id',{required:true,min:1,integer:true}),
        model_year:numberValue(fd,'model_year',{min:1980,integer:true}),
        price:numberValue(fd,'price',{required:true,min:0.000001}),
        mileage_text:String(fd.get('mileage_text')||'').trim(),
        engine:String(fd.get('engine')||'').trim(),trim:String(fd.get('trim')||'').trim(),
        year:String(fd.get('year')||'').trim(),region:String(fd.get('region')||'').trim(),
        condition:String(fd.get('condition')||'').trim()};
      const result=await api(`/listings/${id}`,{method:'PATCH',data:payload});cacheListings([result]);
      await afterListingChange(id);toast('已保存修正，变更记录已保留。');return;
    }
    if(kind==='rename'){
      const name=String(fd.get('name')||'').trim();if(!name)throw new ApiError('车型名称不能为空。');
      await api(`/models/${id}`,{method:'PATCH',data:{name}});modal.close();await refreshShared();await loadPage();toast('车型名称已保存。');return;
    }
    if(kind==='alias'){
      const raw=String(fd.get('raw')||'').trim(),scope=String(fd.get('scope')||'*').trim()||'*';if(!raw)throw new ApiError('请输入已核对的别名。');
      await api(`/models/${id}/aliases`,{method:'POST',data:{raw,scope}});await refreshShared();await loadPage();toast('车型别名已保存。');return;
    }
    if(kind==='target-search'){
      const mode=form.dataset.mode;await loadTargets(mode,String(fd.get('q')||'').trim(),1,form.dataset.reviewId?Number(form.dataset.reviewId):null);return;
    }
    if(kind==='merge'){
      const sourceId=Number(form.dataset.sourceId),target=numberValue(fd,'target_id',{required:true,min:1,integer:true});
      if(!fd.has('same_car'))throw new ApiError('需要明确确认是同一辆车。');
      if(target===sourceId||!U.array(state.targets.merge?.items).some(x=>Number(x.id)===target))throw new ApiError('请从已读取的同车型目标中明确选择车源。');
      const result=await api(`/listings/${target}/merge`,{method:'POST',data:{source_id:sourceId}});cacheListings([result]);modal.close();await refreshShared();await loadPage();await openDrawer(target);toast('同车合并已完成，报价历史与图片已保留到目标车源。');return;
    }
    if(kind==='fuel-manual'){
      const province=String(fd.get('province')||'').trim(),effective_date=String(fd.get('effective_date')||''),p92=numberValue(fd,'p92',{required:true,min:.000001}),p95=numberValue(fd,'p95',{required:true,min:.000001});
      const source_url=String(fd.get('source_url')||'').trim();if(source_url&&!U.safeURL(source_url))throw new ApiError('来源链接须为 http 或 https 网址。');
      const result=await api('/fuel/manual',{method:'POST',data:{province,effective_date,p92,p95,...(source_url?{source_url}:{})}});state.fuel=result;state.fuelProvince=result.province;modal.close();
      if(state.route==='fuel')paint(U.fuel(result,state));toast('手工油价记录已保存，并标注为手工来源。');return;
    }
    if(kind==='new-import'){
      if(state.activeUpload)throw new ApiError('请先等待或暂停当前上传。');
      const files=state.selectedFiles.slice(),list=manifest(files),name=String(fd.get('name')||'').trim()||state.selectedName||'聊天记录导入',namespace=String(fd.get('namespace')||'').trim();
      state.namespace=namespace;saveStore('namespace',namespace);
      const batch=await api('/imports',{method:'POST',data:{name,files:list,...(namespace?{namespace}:{})}});upsertBatch(batch);rememberManifest(batch);
      state.selectedFiles=[];state.selectedName='';renderBatches(true);await uploadBatch(batch,files);return;
    }
    if(kind==='confirm-review'){
      const name=String(fd.get('name')||'').trim();if(!name)throw new ApiError('请确认车型名称。');
      const price=numberValue(fd,'price',{min:.0000001}),approximate_mileage=fd.has('approximate_mileage'),mileage=approximate_mileage?null:numberValue(fd,'mileage');
      const price_unit=String(fd.get('price_unit')||''),mileage_unit=String(fd.get('mileage_unit')||'');
      if(price!==null&&!['万元','元'].includes(price_unit))throw new ApiError('请明确确认价格单位：万元或元。');
      if(mileage!==null&&!['万公里','公里'].includes(mileage_unit))throw new ApiError('请明确确认里程单位：万公里或公里。');
      const payload={name,model_year:numberValue(fd,'model_year',{min:1900,integer:true}),engine:String(fd.get('engine')||'').trim(),trim:String(fd.get('trim')||'').trim(),year:String(fd.get('year')||'').trim(),price,price_unit:price_unit||null,mileage,mileage_unit:mileage_unit||null,region:String(fd.get('region')||'').trim(),condition:String(fd.get('condition')||''),remember_units:fd.has('remember_units'),approximate_mileage};
      await api(`/reviews/${id}/confirm`,{method:'POST',data:payload});await fetchReviews();state.assignTargets=null;delete state.targets.assign;renderReviews();await refreshShared();toast(price===null?'校对已保存；未填写报价，不生成已确认报价。':'已保存校对与明确单位的报价。');return;
    }
    if(kind==='assign'){
      const listing_id=numberValue(fd,'listing_id',{required:true,min:1,integer:true}),approximate=fd.has('approximate'),mileage=approximate?null:numberValue(fd,'mileage'),mileage_unit=String(fd.get('mileage_unit')||'');
      if(!fd.has('same_car'))throw new ApiError('请明确确认此补充属于所选车辆。');
      if(!U.array(state.targets.assign?.items).some(x=>Number(x.id)===listing_id))throw new ApiError('请从查找结果中选择一辆已有车源。');
      if(mileage!==null&&!['万公里','公里'].includes(mileage_unit))throw new ApiError('请明确确认里程单位。');
      await api(`/reviews/${id}/assign`,{method:'POST',data:{listing_id,mileage,mileage_unit:mileage_unit||null,approximate}});await fetchReviews();state.assignTargets=null;delete state.targets.assign;renderReviews();await refreshShared();toast('补充已挂接到所选车源，原文已保留。');return;
    }
  }

  document.addEventListener('click',event=>{
    if(event.target.closest('.skip-link')){event.preventDefault();page.focus();return;}
    const el=event.target.closest('[data-action]');if(!el||el.disabled||el.dataset.busy)return;
    event.preventDefault();el.dataset.busy='true';const wasDisabled=el.disabled;el.disabled=true;
    Promise.resolve(action(el)).catch(e=>toast(e.message||String(e),true)).finally(()=>{delete el.dataset.busy;if(el.isConnected)el.disabled=wasDisabled;});
  });
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(form.id==='global-search-form'){
      event.preventDefault();state.filters={...state.filters,q:$('#global-search').value.trim(),page:1};navigate('listings');return;
    }
    if(!form.dataset.form)return;event.preventDefault();if(form.dataset.busy)return;
    const error=form.querySelector('.form-error');if(error)error.textContent='';const alias=$('#alias-error');if(form.dataset.form==='alias'&&alias)alias.textContent='';
    if(!form.reportValidity())return;
    form.dataset.busy='true';const buttons=[...form.querySelectorAll('button[type=submit]')];buttons.forEach(b=>b.disabled=true);
    Promise.resolve(submit(form)).catch(e=>formError(form,e.message||String(e))).finally(()=>{delete form.dataset.busy;buttons.forEach(b=>{if(b.isConnected)b.disabled=b.id==='start-upload'?!state.selectedFiles.length:false;});});
  });
  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.id==='folder-input'||el.id==='zip-input'){handleSelection(el);return;}
    const control=el.dataset.control;if(!control)return;
    (async()=>{
      if(control==='model'){
        state.modelId=Number(el.value);saveStore('model',state.modelId);state.cohort={model_year:'',engine:'',trim:'',mileage_min:'',mileage_max:'',region:''};state.cohortScope='';await loadPage();
      }else if(control==='page-size'){state.filters.page_size=Number(el.value);state.filters.page=1;await loadPage();}
      else if(control==='differences'){state.onlyDifferences=el.checked;await loadPage();}
      else if(control==='province'){
        const province=el.value;state.settings=await api('/settings',{method:'PATCH',data:{province}});state.settingsError='';state.fuelProvince=province;await loadPage();
      }else if(control==='approximate'){
        const input=el.closest('form')?.querySelector('[data-mileage-input]');if(input)input.disabled=el.checked;
      }
    })().catch(e=>toast(e.message,true));
  });
  let reviewSearchTimer=null;
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.id==='review-search'){
      state.reviewQuery=el.value;clearTimeout(reviewSearchTimer);reviewSearchTimer=setTimeout(()=>{state.reviewLimit=50;const first=U.orderedReviews(state)[0];state.activeReviewId=first?.id??null;state.assignTargets=null;delete state.targets.assign;renderReviews();},220);
    }
    if(el.id==='import-name')state.selectedName=el.value;
    if(el.id==='import-namespace'){state.namespace=el.value;saveStore('namespace',el.value);}
  });
  document.addEventListener('error',event=>{
    const img=event.target;if(img?.tagName!=='IMG'||!img.closest('.evidence-card,.vehicle-thumb,.compare-car-cell'))return;
    const replacement=document.createElement('span');replacement.className='image-unavailable';replacement.textContent='图片暂不可用';img.replaceWith(replacement);
  },true);
  drawer.addEventListener('close',()=>{detailVersion++;state.detail=null;state.detailId=null;});
  modal.addEventListener('close',()=>{state.modalKind='';state.mergeSource=null;delete state.targets.merge;});
  for(const dialog of [drawer,modal])dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
  });
  window.addEventListener('hashchange',hashChanged);
  window.addEventListener('beforeunload',event=>{if(state.activeUpload){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedulePoll();});
  let resizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>U.mountCharts(page),160);});

  async function boot() {
    document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=U.icon(el.dataset.icon);});
    const results=await Promise.allSettled([api('/settings'),api('/models'),api('/compare'),api('/health')]);
    if(results[0].status==='fulfilled'){state.settings=results[0].value;state.fuelProvince=state.settings.province;}
    else state.settingsError=results[0].reason.message;
    if(results[1].status==='fulfilled')state.models=U.array(results[1].value.items);else state.modelsError=results[1].reason.message;
    if(results[2].status==='fulfilled')setCompare(results[2].value);else state.compareError=results[2].reason.message;
    if(results[3].status==='fulfilled')state.health=results[3].value;
    else{$('#connection-status').classList.add('offline');$('#connection-status span').textContent='本机服务未连接';}
    hashChanged();
    // Processing continues across page changes, but uploads and terminal batches are never polled.
    if(state.route!=='import'){await fetchBatches();schedulePoll();}
  }
  boot().catch(e=>{paint(U.error(e.message));$('#connection-status').classList.add('offline');$('#connection-status span').textContent='本机服务未连接';});
})();
