"""Loopback-only application API and explicitly bounded static files."""
from contextlib import asynccontextmanager, closing
import asyncio
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
import uuid
import zipfile

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .db import init_db,connect
from . import importer, service

ROOT = Path(__file__).resolve().parent.parent


def _backup(data_dir):
    with importer.UPLOAD_LOCK, connect(data_dir) as db:
        if db.execute("SELECT 1 FROM batches WHERE status IN ('uploading','queued','running') LIMIT 1").fetchone():
            raise importer.ImportProblem('导入或上传进行中，请完成后再备份',409)
        backup_id=uuid.uuid4().hex
        snapshot=Path(data_dir)/'backups'/f'{backup_id}.sqlite3'
        archive=Path(data_dir)/'backups'/f'{backup_id}.zip'
        try:
            with closing(sqlite3.connect(snapshot)) as destination:
                db.backup(destination)
            with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
                z.write(snapshot,'carwatch.sqlite3')
                for name in ('media','thumbs','batches'):
                    for path in (Path(data_dir)/name).rglob('*'):
                        if path.is_file() and not path.is_symlink():
                            z.write(path,path.relative_to(data_dir).as_posix())
                z.writestr('恢复说明.txt','关闭程序，把本压缩包解压到新的空data目录，再启动程序。备份含原始私人资料，请保存在自己的电脑。')
        except BaseException:
            archive.unlink(missing_ok=True)
            raise
        finally:
            snapshot.unlink(missing_ok=True)
    return FileResponse(archive,media_type='application/zip',filename='车价观察-本地备份.zip',background=BackgroundTask(archive.unlink,missing_ok=True))


def create_app(data_dir=None,run_worker=True):
    data_dir=Path(data_dir or ROOT/'data').resolve()
    init_db(data_dir)

    @asynccontextmanager
    async def lifespan(app):
        process=None
        log=None
        if run_worker:
            log=(data_dir/'worker.log').open('ab')
            process=subprocess.Popen([sys.executable,'-I',str(ROOT/'backend'/'worker.py'),str(data_dir)],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=log)
        app.state.worker=process
        try:
            yield
        finally:
            if process and process.poll() is None:
                process.terminate()
                await asyncio.to_thread(process.wait,10)
            if log: log.close()
    app=FastAPI(title='车价观察',version='1.0',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    app.state.data_dir=data_dir
    app.state.worker=None
    app.add_middleware(TrustedHostMiddleware,allowed_hosts=['127.0.0.1','localhost','[::1]'])

    @app.middleware('http')
    async def local_requests(request:Request,call_next):
        if request.method not in ('GET','HEAD','OPTIONS'):
            origin=request.headers.get('origin')
            if origin and origin != str(request.base_url).rstrip('/'):
                return JSONResponse({'detail':'仅允许本机页面的同源操作'},status_code=403)
            if request.headers.get('X-Requested-With')!='CarWatch':
                return JSONResponse({'detail':'缺少本机页面请求标识'},status_code=403)
            is_chunk=request.method=='PUT' and re.fullmatch(r'/api/imports/[a-f0-9]+/files/\d+',request.url.path)
            if not is_chunk and request.headers.get('content-type','').split(';')[0].strip()!='application/json':
                return JSONResponse({'detail':'该操作需要JSON请求'},status_code=415)
            limit=importer.CHUNK if is_chunk else 8*1024**2
            # Streamed cap also covers missing or dishonest Content-Length.
            body=bytearray()
            async for part in request.stream():
                body.extend(part)
                if len(body)>limit:
                    return JSONResponse({'detail':'请求超过允许大小'},status_code=413)
            request._body=bytes(body)
        response=await call_next(request)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        response.headers['Content-Security-Policy']="default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control']='no-store'
        elif request.url.path in ('/','') or request.url.path.startswith(('/web/','/static/')):
            response.headers['Cache-Control']='no-cache'
        return response

    @app.exception_handler(importer.ImportProblem)
    async def problem(request,exc):
        return JSONResponse({'detail':str(exc)},status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def invalid(request,exc):
        return JSONResponse({'detail':'请求字段或查询条件格式无效'},status_code=422)

    @app.get('/api/health')
    def health():
        p=app.state.worker
        return {'status':'ok','version':'1.0','worker':bool(p and p.poll() is None)}

    @app.get('/api/settings')
    def get_settings(): return service.settings(data_dir)
    @app.patch('/api/settings')
    def patch_settings(body:dict): return service.settings(data_dir,body)
    @app.get('/api/overview')
    def overview(days:int=30,model_id:int|None=None,model_year:int|None=None,engine:str|None=None,trim:str|None=None,mileage_min:float|None=None,mileage_max:float|None=None,region:str|None=None):
        return service.overview(data_dir,days,model_id,model_year,engine,trim,mileage_min,mileage_max,region)
    @app.get('/api/listings')
    def listings(q:str='',model_id:int|None=None,max_price:float|None=None,favorites:bool=False,page:int=1,page_size:int=25,status:str=''):
        return service.listings(data_dir,q,model_id,max_price,favorites,page,page_size,status)
    @app.get('/api/listings/{listing_id}')
    def detail(listing_id:int): return service.listing_detail(data_dir,listing_id)
    @app.patch('/api/listings/{listing_id}')
    def patch_listing(listing_id:int,body:dict): return service.patch_listing(data_dir,listing_id,body)
    @app.get('/api/compare')
    def compare(): return service.compare(data_dir)
    @app.post('/api/listings/{listing_id}/merge')
    def merge(listing_id:int,body:dict): return service.merge(data_dir,listing_id,body.get('source_id'))
    @app.post('/api/listings/{listing_id}/images/{media_id}/confirm')
    def confirm_image(listing_id:int,media_id:str,body:dict): return service.confirm_image(data_dir,listing_id,media_id,body.get('source_message_id'))
    @app.get('/api/models')
    def models(): return service.models(data_dir)
    @app.patch('/api/models/{model_id}')
    def patch_model(model_id:int,body:dict): return service.patch_model(data_dir,model_id,body)
    @app.post('/api/models/{model_id}/aliases')
    def alias(model_id:int,body:dict): return service.add_alias(data_dir,model_id,body)
    @app.get('/api/models/{model_id}/analysis')
    def analysis(model_id:int,days:int=30,model_year:int|None=None,engine:str|None=None,trim:str|None=None,mileage_min:float|None=None,mileage_max:float|None=None,region:str|None=None,scope:str|None=None):
        return service.analysis(data_dir,model_id,days,model_year,engine,trim,mileage_min,mileage_max,region,scope)
    @app.get('/api/imports')
    def imports(): return importer.list_batches(data_dir)
    @app.get('/api/imports/{batch_id}')
    def get_import(batch_id:str): return importer.get_batch(data_dir,batch_id)
    @app.post('/api/imports')
    def create_import(body:dict): return importer.create_upload(data_dir,body)
    @app.put('/api/imports/{batch_id}/files/{file_id}')
    async def chunk(batch_id:str,file_id:int,request:Request,offset:int=0):
        body=await request.body()
        return await asyncio.to_thread(importer.append_upload,data_dir,batch_id,file_id,offset,body)
    @app.post('/api/imports/{batch_id}/complete')
    def complete(batch_id:str,body:dict): return importer.finish_upload(data_dir,batch_id)
    @app.post('/api/imports/{batch_id}/retry')
    def retry(batch_id:str,body:dict): return importer.retry_batch(data_dir,batch_id)
    @app.post('/api/imports/{batch_id}/cancel')
    def cancel(batch_id:str,body:dict): return importer.cancel_batch(data_dir,batch_id)
    @app.get('/api/reviews')
    def reviews(): return service.reviews(data_dir)
    @app.post('/api/reviews/{review_id}/confirm')
    def confirm(review_id:int,body:dict): return service.confirm_review(data_dir,review_id,body)
    @app.post('/api/reviews/{review_id}/assign')
    def assign(review_id:int,body:dict): return service.assign_supplement(data_dir,review_id,body)
    @app.post('/api/reviews/{review_id}/ignore')
    def ignore(review_id:int,body:dict): return service.ignore_review(data_dir,review_id)
    @app.get('/api/fuel')
    def fuel(province:str='浙江'): return service.fuel(data_dir,province)
    @app.post('/api/fuel/refresh')
    def refresh(body:dict): return service.refresh_fuel(data_dir,body.get('province'))
    @app.post('/api/fuel/manual')
    def manual(body:dict): return service.manual_fuel(data_dir,body)
    @app.get('/api/backup')
    def backup(): return _backup(data_dir)
    @app.get('/api/media/{sha}')
    def media(sha:str,thumb:bool=False):
        if not re.fullmatch('[a-f0-9]{64}',sha): raise importer.ImportProblem('图片不存在',404)
        with connect(data_dir) as db:
            row=db.execute('SELECT * FROM media WHERE id=?',(sha,)).fetchone()
        if not row: raise importer.ImportProblem('图片不存在',404)
        path=data_dir/'thumbs'/f'{sha}.jpg' if thumb else data_dir/'media'/f"{sha}.{row['ext']}"
        if not path.is_file(): raise importer.ImportProblem('图片文件缺失，请重新导入附件',404)
        return FileResponse(path,media_type='image/jpeg' if thumb else row['mime'])

    @app.get('/')
    def home():
        from fastapi.responses import RedirectResponse
        if (ROOT/'web'/'v2'/'index.html').is_file():
            return RedirectResponse('/v2/',status_code=307)
        return FileResponse(ROOT/'web'/'index.html',media_type='text/html')

    @app.get('/legacy')
    def legacy_home(): return FileResponse(ROOT/'web'/'index.html',media_type='text/html')
    if (ROOT/'web'/'v2').exists():
        @app.get('/v2')
        def v2_index(): return FileResponse(ROOT/'web'/'v2'/'index.html',media_type='text/html')
        app.mount('/v2',StaticFiles(directory=ROOT/'web'/'v2',html=True),name='v2')
    if (ROOT/'web').exists(): app.mount('/web',StaticFiles(directory=ROOT/'web'),name='web')
    if (ROOT/'prototype').exists(): app.mount('/static',StaticFiles(directory=ROOT/'prototype'),name='static')
    return app
