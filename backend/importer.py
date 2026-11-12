"""Persistent chunk uploads and conservative stories-in-wx import jobs."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import threading
import uuid
import warnings
import zipfile

from PIL import Image, UnidentifiedImageError
from .db import connect, dumps, stamp
from .extract import engine_displacement,extract_candidates,normalize,compose_display_name

CHUNK = 2 * 1024**2
MAX_FILES = 20000
MAX_BATCH = 2 * 1024**3
MAX_JSON = 64 * 1024**2
MAX_MEDIA = 32 * 1024**2
MAX_ZIP = 512 * 1024**2
UPLOAD_LOCK = threading.RLock()
IMAGE_TYPES = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'}
CONTEXT_QUERY = ('SELECT l.id,abs(m.created_at-?) distance FROM listings l JOIN messages m ON m.id=l.source_message_id '
                 'WHERE m.namespace=? AND m.session=? AND m.sender=? AND m.created_at BETWEEN ? AND ? AND l.merged_into IS NULL '
                 'ORDER BY distance,l.id LIMIT 2')


class ImportProblem(ValueError):
    def __init__(self, detail, status=400):
        super().__init__(detail)
        self.status = status


def safe_path(value):
    if not isinstance(value, str) or not value or len(value) > 700:
        raise ImportProblem('文件相对路径无效')
    value = value.replace('\\', '/')
    parts = value.split('/')
    if any(not p or p in ('.', '..') or ':' in p or '\x00' in p for p in parts):
        raise ImportProblem('文件路径必须在本批次内，不能含绝对路径或上级目录')
    return '/'.join(parts)


def size_limit(path):
    ext = PurePosixPath(path).suffix.lower()
    return MAX_ZIP if ext == '.zip' else MAX_JSON if ext == '.json' else MAX_MEDIA


def _batch(db, batch_id, files=False):
    row = db.execute('SELECT * FROM batches WHERE id=?', (batch_id,)).fetchone()
    if not row:
        raise ImportProblem('导入批次不存在', 404)
    result = dict(row)
    result['stats'] = dict.fromkeys(('messages','duplicates','candidates','media','missing'), 0) | json.loads(row['stats'])
    result['warnings'] = json.loads(row['warnings'])
    manifest = [dict(r) for r in db.execute('SELECT id,path,size,received FROM upload_files WHERE batch_id=? ORDER BY id',(batch_id,))]
    result.update(file_count=len(manifest), total_bytes=sum(f['size'] for f in manifest), received_bytes=sum(f['received'] for f in manifest))
    if files:
        result['files'] = manifest
    return result


def get_batch(data_dir, batch_id):
    with UPLOAD_LOCK, connect(data_dir) as db:
        return _batch(db, batch_id, True)


def list_batches(data_dir):
    with connect(data_dir) as db:
        return {'items':[_batch(db,r['id']) for r in db.execute('SELECT id FROM batches ORDER BY created_at DESC LIMIT 100')]}


def create_upload(data_dir, manifest):
    files = manifest.get('files')
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        raise ImportProblem('请选择1至20000个文件')
    validated = []
    seen = set()
    for f in files:
        path = safe_path(f.get('path'))
        size = f.get('size')
        if type(size) is not int or not 0 <= size <= size_limit(path):
            raise ImportProblem(f'文件大小超出限制：{path}')
        if path.casefold() in seen:
            raise ImportProblem('批次包含重复文件路径')
        seen.add(path.casefold())
        validated.append((path,size))
    if sum(s for _,s in validated) > MAX_BATCH:
        raise ImportProblem('单批次不能超过2GB')
    if any(p.lower().endswith('.zip') for p,_ in validated) and len(validated) != 1:
        raise ImportProblem('ZIP请单独上传，不能与其他文件混合')
    namespace = str(manifest.get('namespace') or '').strip()
    if len(namespace) > 200:
        raise ImportProblem('命名空间最多200字')
    batch_id = uuid.uuid4().hex
    with UPLOAD_LOCK, connect(data_dir) as db:
        (Path(data_dir)/'batches'/batch_id/'upload').mkdir(parents=True)
        db.execute('INSERT INTO batches(id,name,namespace,created_at,updated_at) VALUES(?,?,?,?,?)',
                   (batch_id,str(manifest.get('name') or '聊天记录导入')[:200],namespace,stamp(),stamp()))
        db.executemany('INSERT INTO upload_files(batch_id,path,size) VALUES(?,?,?)',[(batch_id,p,s) for p,s in validated])
        return _batch(db,batch_id,True)


def append_upload(data_dir,batch_id,file_id,offset,body):
    if len(body) > CHUNK:
        raise ImportProblem('每块不能超过2MB',413)
    with UPLOAD_LOCK, connect(data_dir) as db:
        batch = _batch(db,batch_id)
        if batch['status'] != 'uploading':
            raise ImportProblem('该批次已结束上传',409)
        row = db.execute('SELECT * FROM upload_files WHERE id=? AND batch_id=?',(file_id,batch_id)).fetchone()
        if not row:
            raise ImportProblem('上传文件不存在',404)
        if offset != row['received']:
            raise ImportProblem('上传偏移不一致，请重新读取批次进度后续传',409)
        if offset < 0 or offset + len(body) > row['size']:
            raise ImportProblem('上传内容超过声明大小',413)
        path = Path(data_dir)/'batches'/batch_id/'upload'/str(file_id)
        # Disk may contain an uncommitted last chunk after a crash. Truncate it.
        with path.open('r+b' if path.exists() else 'w+b') as output:
            output.seek(0,2)
            if output.tell() < offset:
                raise ImportProblem('上传暂存文件缺失，请重新建立批次',409)
            output.truncate(offset)
            output.seek(offset)
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        received = offset + len(body)
        db.execute('UPDATE upload_files SET received=? WHERE id=?',(received,file_id))
        db.execute('UPDATE batches SET updated_at=? WHERE id=?',(stamp(),batch_id))
        return {'received':received}


def finish_upload(data_dir,batch_id):
    with UPLOAD_LOCK, connect(data_dir) as db:
        batch = _batch(db,batch_id,True)
        if batch['status'] == 'queued':
            return batch
        if batch['status'] != 'uploading' or any(f['received'] != f['size'] for f in batch['files']):
            raise ImportProblem('文件尚未全部上传',409)
        db.execute("UPDATE batches SET status='queued',updated_at=? WHERE id=?",(stamp(),batch_id))
        return _batch(db,batch_id,True)


def retry_batch(data_dir,batch_id):
    with UPLOAD_LOCK, connect(data_dir) as db:
        batch = _batch(db,batch_id)
        if batch['status'] != 'error':
            raise ImportProblem('仅失败或中断的处理批次可以重试',409)
        db.execute("UPDATE batches SET status='queued',error=NULL,updated_at=? WHERE id=?",(stamp(),batch_id))
        return _batch(db,batch_id,True)


def cancel_batch(data_dir,batch_id):
    with UPLOAD_LOCK, connect(data_dir) as db:
        batch = _batch(db,batch_id)
        if batch['status'] not in ('uploading','queued','error'):
            raise ImportProblem('正在处理的批次不能取消，请等待处理结束',409)
        db.execute("UPDATE batches SET status='error',error=?,updated_at=? WHERE id=?",
                   ('已取消未完成上传；可重新选择相同文件续传，或直接备份当前资料。',stamp(),batch_id))
        return _batch(db,batch_id,True)


def _sources(data_dir,batch):
    folder = Path(data_dir)/'batches'/batch['id']
    files = batch['files']
    if len(files) != 1 or not files[0]['path'].lower().endswith('.zip'):
        return {f['path']:folder/'upload'/str(f['id']) for f in files}
    output = folder/'expanded'
    # Never extract original names to disk: numbered blobs remain data only.
    output.mkdir(exist_ok=True)
    result = {}
    with zipfile.ZipFile(folder/'upload'/str(files[0]['id'])) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_FILES:
            raise ImportProblem('ZIP内文件数量超出20000限制')
        total = 0
        seen = set()
        entries = []
        for item in infos:
            path = safe_path(item.filename.rstrip('/'))
            if item.is_dir():
                continue
            if path.casefold() in seen:
                raise ImportProblem('ZIP含重复文件路径')
            seen.add(path.casefold())
            mode = item.external_attr >> 16
            if stat.S_ISLNK(mode) or item.flag_bits & 1:
                raise ImportProblem('不支持ZIP中的符号链接或加密文件')
            if path.lower().endswith('.zip'):
                raise ImportProblem('不支持嵌套ZIP')
            total += item.file_size
            if item.file_size > size_limit(path) or total > MAX_BATCH or item.file_size/max(item.compress_size,1) > 200:
                raise ImportProblem('ZIP展开体积或压缩比超过限制')
            entries.append((item,path))
        for index,(item,path) in enumerate(entries):
            target = output/str(index)
            count = 0
            with archive.open(item) as source, target.open('wb') as destination:
                while chunk := source.read(CHUNK):
                    count += len(chunk)
                    if count > item.file_size or count > size_limit(path):
                        raise ImportProblem('ZIP实际大小超过声明限制')
                    destination.write(chunk)
            result[path] = target
    return result


def _json(path):
    if path.stat().st_size > MAX_JSON:
        raise ImportProblem('JSON文件大于64MB')
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'),parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise ImportProblem('JSON格式无效或编码不支持，请使用UTF-8原始导出') from exc


def _identity(doc, namespace):
    session = doc.get('session')
    if not isinstance(session,dict) or not session.get('wxid'):
        raise ImportProblem('JSON缺少session.wxid群标识')
    account = namespace or session.get('ownerId')
    if not account:
        raise ImportProblem('导出缺少账号标识，请填写固定命名空间后重新导入')
    return dumps([str(session.get('platform') or 'wechat'),str(account)]), str(session['wxid'])


def _save_image(data_dir,path,db):
    if path.stat().st_size > MAX_MEDIA:
        raise ImportProblem('图片超过32MB')
    body = path.read_bytes()
    sha = hashlib.sha256(body).hexdigest()
    if db.execute('SELECT 1 FROM media WHERE id=?',(sha,)).fetchone():
        return sha
    with warnings.catch_warnings():
        warnings.simplefilter('error',Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(body)) as img:
            if img.format not in ('JPEG','PNG','WEBP','GIF','BMP'):
                raise ImportProblem('图片格式不受支持')
            if img.width*img.height > 25_000_000:
                raise ImportProblem('图片像素过大')
            width,height = img.size
            img.verify()
        ext = {'JPEG':'jpg','PNG':'png','WEBP':'webp','GIF':'gif','BMP':'bmp'}[img.format]
        (Path(data_dir)/'media'/f'{sha}.{ext}').write_bytes(body)
        with Image.open(io.BytesIO(body)) as img:
            img.seek(0)
            img.thumbnail((640,480))
            img.convert('RGB').save(Path(data_dir)/'thumbs'/f'{sha}.jpg',quality=82)
    db.execute('INSERT INTO media VALUES(?,?,?,?,?,?)',(sha,ext,'image/'+('jpeg' if ext=='jpg' else ext),len(body),width,height))
    return sha


def _canonical(candidate,key):
    value = candidate.get(key)
    unit = candidate.get(key+'_unit')
    if value is None or unit is None:
        return None
    return value/10000 if unit in ('元','公里') else value


def _vehicle_fingerprint(item, price, mileage):
    return (item.get('model_year'), engine_displacement(item.get('engine')),
            round(price,4) if price is not None else None,
            round(mileage,4) if mileage is not None else None,
            str(item.get('year') or '').strip(), normalize(item.get('region') or ''))


def _session_fingerprint_index(db,namespace,session):
    rows = db.execute("SELECT l.id,l.model_id,l.model_year,l.engine,l.price,l.mileage,l.year,l.region "
                      "FROM listings l JOIN messages m ON m.id=l.source_message_id "
                      "WHERE l.merged_into IS NULL AND l.sale_state!='sold' "
                      "AND m.namespace=? AND m.session=?",(namespace,session)).fetchall()
    index = {}
    for row in rows:
        item = dict(row)
        index[(item['model_id'],_vehicle_fingerprint(item,item['price'],item['mileage']))] = item['id']
    return index


def _candidates(db,message_id,batch_id,text,posted,namespace,session,duplicate_index):
    scope = dumps([namespace,session])
    aliases = [dict(a) for a in db.execute("SELECT a.raw,m.name FROM aliases a JOIN models m ON m.id=a.model_id WHERE a.scope IN (?,'*') ORDER BY CASE WHEN a.scope=? THEN 0 ELSE 1 END",(scope,scope))]
    alias_names = {normalize(a['raw']):a['name'] for a in aliases}
    values = extract_candidates(text,aliases)
    skipped = 0
    for segment,c in enumerate(values):
        listing_id = None
        if c['kind'] == 'listing':
            c['name'] = alias_names.get(normalize(c['name']), c['name'])
            # 只凭“提到车名”不能建车型：既没有车价/里程，也没有款年，多半是群友闲聊或补充说明。
            known_model = db.execute('SELECT 1 FROM models WHERE name=?',(c['name'],)).fetchone()
            if not known_model and not (_canonical(c,'price') or _canonical(c,'mileage') or c.get('model_year')):
                db.execute('INSERT INTO candidates(batch_id,message_id,segment,kind,state,data,listing_id) VALUES(?,?,?,?,?,?,NULL)',
                           (batch_id,message_id,segment,c['kind'],'ignored',dumps(c)))
                continue
            db.execute('INSERT OR IGNORE INTO models(name) VALUES(?)',(c['name'],))
            model_id = db.execute('SELECT id FROM models WHERE name=?',(c['name'],)).fetchone()[0]
            c['model_id'] = model_id
            # Prices and mileage are filled from the rules in 万元 / 万公里.
            # Anything the rules miss is corrected later in the listing ledger.
            price = _canonical(c,'price')
            mileage = _canonical(c,'mileage')
            fingerprint = (model_id,_vehicle_fingerprint(c,price,mileage))
            duplicate_id = duplicate_index.get(fingerprint)
            if duplicate_id:
                skipped += 1
                listing_id = duplicate_id
                state = 'ignored'
            else:
                cursor = db.execute('INSERT INTO listings(model_id,display_name,trim,model_year,engine,year,price,mileage,price_text,mileage_text,region,condition,status,posted,source_message_id,segment) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (model_id,compose_display_name(c['name'],c.get('model_year'),c.get('engine',''),c.get('trim','')),c.get('trim',''),c.get('model_year'),c.get('engine',''),c.get('year',''),price,mileage,c.get('price_text',''),c.get('mileage_text',''),c.get('region',''),c.get('condition',''),'confirmed',posted,message_id,segment))
                listing_id = cursor.lastrowid
                duplicate_index[fingerprint] = listing_id
                db.execute('INSERT INTO quotes(listing_id,source_message_id,segment,amount,as_of,is_confirmed,raw_price) VALUES(?,?,?,?,?,?,?)',
                           (listing_id,message_id,segment,price,posted,int(price is not None),c.get('price_text','')))
                state = 'confirmed'
        else:
            state = 'ignored'
        db.execute('INSERT INTO candidates(batch_id,message_id,segment,kind,state,data,listing_id) VALUES(?,?,?,?,?,?,?)',
                   (batch_id,message_id,segment,c['kind'],state,dumps(c),listing_id))
    return len(values), skipped

def _link_context(db,namespace,session):
    images = db.execute("SELECT id,created_at,sender,media_id FROM messages WHERE namespace=? AND session=? AND media_id IS NOT NULL",(namespace,session)).fetchall()
    for image in images:
        nearby = db.execute(CONTEXT_QUERY,(image['created_at'],namespace,session,image['sender'],image['created_at']-300,image['created_at']+300)).fetchall()
        if nearby and (len(nearby)==1 or nearby[0]['distance'] < nearby[1]['distance']):
            db.execute("INSERT OR IGNORE INTO listing_images VALUES(?,?,?,'pending')",(nearby[0]['id'],image['media_id'],image['id']))


def run_batch(data_dir,batch_id):
    with connect(data_dir) as db:
        db.execute('BEGIN IMMEDIATE')
        batch = _batch(db,batch_id,True)
        if batch['status'] != 'queued':
            return batch
        db.execute("UPDATE batches SET status='running',error=NULL,processed=0,updated_at=? WHERE id=?",(stamp(),batch_id))
    stats = dict.fromkeys(('messages','duplicates','candidates','media','missing'),0)
    notices = []
    processed = 0
    def notice(value):
        if value not in notices and len(notices)<40: notices.append(value)

    def add_candidates(result):
        found, skipped = result
        stats['candidates'] += found
        if skipped:
            stats['duplicates'] += skipped
            notice(f'已忽略 {skipped} 辆与台账中已有车源重复的车辆')
    try:
        sources = _sources(data_dir,batch)
        docs = []
        total = 0
        for name,path in sources.items():
            if not name.lower().endswith('.json'):
                continue
            doc = _json(path)
            if not isinstance(doc,dict) or 'messages' not in doc:
                continue
            if not isinstance(doc['messages'],list):
                raise ImportProblem('JSON messages必须是数组')
            _identity(doc,batch['namespace'])
            docs.append(name)
            total += len(doc['messages'])
            if total > 200000:
                raise ImportProblem('单批次消息超过20万条，请拆分导出')
        if not docs:
            raise ImportProblem('未找到包含session/messages的微信导出JSON')
        with connect(data_dir) as db:
            db.execute('UPDATE batches SET total_messages=? WHERE id=?',(total,batch_id))
        for name in docs:
            doc = _json(sources[name])
            namespace,session = _identity(doc,batch['namespace'])
            scope = dumps([namespace,session])
            label = str(doc['session'].get('displayName') or doc['session'].get('nickname') or session)
            with connect(data_dir) as db:
                duplicate_index = _session_fingerprint_index(db,namespace,session)
            for message in doc['messages']:
                if not isinstance(message,dict):
                    raise ImportProblem('JSON消息结构无效')
                pid = message.get('platformMessageId')
                if not isinstance(pid,(str,int)) or isinstance(pid,bool) or not str(pid):
                    raise ImportProblem('消息缺少稳定platformMessageId，请重新导出原始JSON')
                posted = message.get('createTime')
                if type(posted) is not int or not 0 < posted < 4102444800:
                    raise ImportProblem('消息createTime不是有效UNIX秒时间戳')
                raw = dumps(message)
                if len(raw) > CHUNK:
                    raise ImportProblem('单条消息过大，请拆分导出')
                text = str(message.get('content') or message.get('rawContent') or '')
                kind = str(message.get('localType',''))
                with connect(data_dir) as db:
                    db.execute('BEGIN IMMEDIATE')
                    existing = db.execute('SELECT id,media_id FROM messages WHERE namespace=? AND session=? AND platform_id=?',(namespace,session,str(pid))).fetchone()
                    if not existing and kind == '1':
                        existing = db.execute("SELECT id,media_id FROM messages WHERE namespace=? AND session=? AND kind='1' AND created_at=? AND text=? ORDER BY id LIMIT 1",(namespace,session,posted,text)).fetchone()
                    media_id = None
                    media_ref = message.get('mediaFile')
                    if kind == '3' and media_ref:
                        media_ref = media_ref.get('path') if isinstance(media_ref,dict) else media_ref
                        ref = safe_path(str(PurePosixPath(name).parent / safe_path(media_ref)))
                        if ref in sources:
                            try:
                                media_id = _save_image(data_dir,sources[ref],db)
                            except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError,Image.DecompressionBombWarning) as exc:
                                stats['missing'] += 1
                                notice('部分图片无法读取或超过限制，原始文件仍保留于批次中')
                        else:
                            stats['missing'] += 1
                            notice('部分图片未在上传文件中找到，请补齐导出media目录后重导')
                    elif kind in ('3','43','62'):
                        stats['missing'] += 1
                        notice('部分图片或视频附件未导出，视频暂不参与识别')
                    if media_id:
                        stats['media'] += 1
                    if existing:
                        stats['duplicates'] += 1
                        if media_id and not existing['media_id']:
                            db.execute('UPDATE messages SET media_id=? WHERE id=?',(media_id,existing['id']))
                        # A re-import rebuilds records the user removed from the ledger.
                        # Messages that still have a candidate stay untouched, so an
                        # ordinary repeat import remains idempotent.
                        if kind == '1' and not db.execute('SELECT 1 FROM candidates WHERE message_id=? LIMIT 1',(existing['id'],)).fetchone():
                            add_candidates(_candidates(db,existing['id'],batch_id,text,posted,namespace,session,duplicate_index))
                    else:
                        cursor = db.execute('INSERT INTO messages(namespace,session,platform_id,created_at,sender,kind,text,raw_json,media_id,source,batch_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                                   (namespace,session,str(pid),posted,str(message.get('senderUsername') or ''),kind,text,raw,media_id,label,batch_id))
                        stats['messages'] += 1
                        if kind == '1':
                            add_candidates(_candidates(db,cursor.lastrowid,batch_id,text,posted,namespace,session,duplicate_index))
                    processed += 1
                    db.execute('UPDATE batches SET processed=?,stats=?,warnings=?,updated_at=? WHERE id=?',(processed,dumps(stats),dumps(notices),stamp(),batch_id))
            with connect(data_dir) as db:
                _link_context(db,namespace,session)
        with connect(data_dir) as db:
            db.execute("UPDATE batches SET status='done',stats=?,warnings=?,updated_at=? WHERE id=?",(dumps(stats),dumps(notices),stamp(),batch_id))
    except Exception as exc:
        message = str(exc) if isinstance(exc,ImportProblem) else '处理失败：'+type(exc).__name__+'；请检查导出文件后重试'
        with connect(data_dir) as db:
            db.execute("UPDATE batches SET status='error',error=?,stats=?,warnings=?,updated_at=? WHERE id=?",(message[:1000],dumps(stats),dumps(notices),stamp(),batch_id))
    return get_batch(data_dir,batch_id)