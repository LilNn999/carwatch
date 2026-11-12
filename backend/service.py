"""Local business actions; mutations and their audit records commit together."""
from datetime import date, datetime, timedelta, timezone
import json
import math
import re
import sqlite3
import statistics
import time
from urllib.parse import urlparse

from .db import connect, dumps, stamp
from .extract import engine_displacement,normalize,is_approximate,parse_mileage,compose_display_name
from .importer import ImportProblem
from . import oil

CHINA = timezone(timedelta(hours=8))
BASE_LISTING = '''SELECT l.*,m.name,s.source,
 (SELECT count(DISTINCT media_id) FROM listing_images WHERE listing_id=l.id) image_count,
 (SELECT '/api/media/'||media_id||'?thumb=1' FROM listing_images WHERE listing_id=l.id ORDER BY (status='confirmed') DESC, rowid LIMIT 1) thumbnail
 FROM listings l JOIN models m ON m.id=l.model_id JOIN messages s ON s.id=l.source_message_id'''


def number(value,label,minimum=0,maximum=100000,allow_none=False):
    if value is None and allow_none:
        return None
    if type(value) not in (int,float) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise ImportProblem(label+'必须是有效数字，且在允许范围内')
    return float(value)


def text(value,label,limit=200,required=False):
    if not isinstance(value,str) or len(value)>limit or (required and not value.strip()):
        raise ImportProblem(label+'内容为空或过长')
    return value.strip()


def boolean(value):
    if type(value) is not bool:
        raise ImportProblem('开关值必须为true或false')
    return int(value)


def audit(db,listing_id,action,detail):
    db.execute('INSERT INTO audit(listing_id,created_at,action,detail) VALUES(?,?,?,?)',(listing_id,stamp(),action,dumps(detail)))


def _listing(row):
    value = dict(row)
    for key in ('favorite','in_compare'):
        value[key] = bool(value[key])
    return value


def _require_listing(db,listing_id,active=True):
    row = db.execute(BASE_LISTING+' WHERE l.id=?',(listing_id,)).fetchone()
    if not row:
        raise ImportProblem('车源不存在',404)
    if active and row['merged_into'] is not None:
        raise ImportProblem('该车源已合并，请打开目标车源',409)
    return _listing(row)


def listings(data_dir,q='',model_id=None,max_price=None,favorites=False,page=1,page_size=25,status=''):
    where = ['l.merged_into IS NULL']
    params = []
    if status:
        if status not in ('pending','confirmed','excluded'):
            raise ImportProblem('车源状态无效')
        where.append('l.status=?'); params.append(status)
    else:
        where.append("l.status!='excluded'")
    if q:
        q = text(q,'搜索词',200)
        # 车系名里带空格（“领克 03”），用户习惯打成“领克03”，两种都要能搜到
        compact = q.replace(' ','')
        where.append("(replace(m.name,' ','') LIKE ? OR m.name LIKE ? OR l.display_name LIKE ? OR l.trim LIKE ? OR l.region LIKE ? OR l.condition LIKE ?)")
        params += ['%'+compact+'%','%'+q+'%','%'+q+'%','%'+q+'%','%'+q+'%','%'+q+'%']
    if model_id:
        where.append('l.model_id=?'); params.append(model_id)
    if max_price is not None:
        where.append('l.price<=?'); params.append(number(max_price,'最高报价'))
    if favorites:
        where.append('l.favorite=1')
    page = max(1,min(int(page),100000)); page_size = max(1,min(int(page_size),100))
    clause = ' WHERE '+' AND '.join(where)
    with connect(data_dir) as db:
        total = db.execute('SELECT count(*) FROM ('+BASE_LISTING+clause+')',params).fetchone()[0]
        rows = db.execute(BASE_LISTING+clause+' ORDER BY l.posted DESC,l.id DESC LIMIT ? OFFSET ?',params+[page_size,(page-1)*page_size]).fetchall()
        return {'items':[_listing(r) for r in rows],'total':total,'page':page,'page_size':page_size}


def _settings(db):
    value = {r['key']:json.loads(r['value']) for r in db.execute("SELECT * FROM settings WHERE key IN ('province','budget')")}
    return value | {'ocr_available':False,'ocr_note':'当前使用本地文本规则和已确认别名；图片保留作证据，尚未启用OCR。'}


def settings(data_dir,body=None):
    with connect(data_dir) as db:
        if body is not None:
            for key,value in body.items():
                if key == 'province':
                    if value not in oil.PROVINCES: raise ImportProblem('请选择支持的油价地区')
                elif key == 'budget':
                    value = number(value,'购车预算',0,10000)
                else:
                    raise ImportProblem('设置字段无效')
                db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)',(key,dumps(value)))
        return _settings(db)


def listing_detail(data_dir,listing_id):
    with connect(data_dir) as db:
        item = _require_listing(db,listing_id)
        source = db.execute('SELECT * FROM messages WHERE id=?',(item['source_message_id'],)).fetchone()
        item['raw'] = source['text']
        item['quotes'] = [dict(r) for r in db.execute('SELECT id,amount,as_of,is_confirmed,raw_price FROM quotes WHERE listing_id=? ORDER BY as_of,id',(listing_id,))]
        item['images'] = [{'id':r['media_id'],'url':'/api/media/'+r['media_id'],'status':r['status'],'source_message_id':r['source_message_id']} for r in db.execute('SELECT * FROM listing_images WHERE listing_id=?',(listing_id,))]
        item['audit'] = [dict(r) for r in db.execute('SELECT created_at,action,detail FROM audit WHERE listing_id=? ORDER BY id DESC LIMIT 100',(listing_id,))]
        item['issues'] = []
        for r in db.execute("SELECT data FROM candidates WHERE listing_id=? AND state='pending'",(listing_id,)):
            item['issues'].extend(json.loads(r['data']).get('issues',[]))
    item['cohort'] = analysis(data_dir,item['model_id'],model_year=item['model_year'],engine=item['engine'],trim=item['trim']) if item['model_year'] and item['engine'] else None
    return item


VEHICLE_TEXT = {'engine':('动力',50),'trim':('原文配置',200),'year':('上牌时间',30),'region':('地区',100),'condition':('车况',2000)}
VEHICLE_KEYS = {'model_id','model_year','price','mileage','mileage_text',*VEHICLE_TEXT}


def _rebuild_display_name(db,listing_id):
    """车型/款年/排量/配置改动后重算展示名：品牌车系 + 款年 + 排量 + 配置。"""
    row = db.execute('SELECT l.model_year,l.engine,l.trim,m.name FROM listings l JOIN models m ON m.id=l.model_id WHERE l.id=?',(listing_id,)).fetchone()
    if not row:
        return
    db.execute('UPDATE listings SET display_name=? WHERE id=?',
               (compose_display_name(row['name'], row['model_year'], row['engine'], row['trim']), listing_id))


def patch_listing(data_dir,listing_id,body):
    with connect(data_dir) as db:
        db.execute('BEGIN IMMEDIATE')
        before = _require_listing(db,listing_id)
        vehicle = False
        for key,value in body.items():
            if key in ('favorite','in_compare'):
                value = boolean(value)
                if key=='in_compare' and value and not before['in_compare']:
                    if db.execute('SELECT count(*) FROM listings WHERE in_compare=1 AND merged_into IS NULL').fetchone()[0]>=4:
                        raise ImportProblem('最多对比4辆车，请先移除一辆',409)
            elif key=='notes':
                value = text(value,'备注',2000)
            elif key=='sale_state':
                if value not in ('unknown','sold'): raise ImportProblem('在售状态无效')
            elif key in VEHICLE_KEYS:
                if before['status'] != 'confirmed':
                    raise ImportProblem('待校对车源请先在待校对中确认，再修正已确认信息',409)
                vehicle = True
                if key=='model_id':
                    if type(value) is not int or not db.execute('SELECT 1 FROM models WHERE id=?',(value,)).fetchone():
                        raise ImportProblem('车型不存在，请先在车型档案中建立')
                elif key=='model_year':
                    if value is not None and (type(value) is not int or not 1980<=value<=date.today().year+1):
                        raise ImportProblem('款年无效')
                elif key in VEHICLE_TEXT:
                    label,limit = VEHICLE_TEXT[key]
                    value = text(value or '',label,limit)
                elif key=='price':
                    value = number(value,'价格',0.000001,10000)
                elif key=='mileage':
                    value = None if value is None else number(value,'里程',0,500)
                elif key=='mileage_text':
                    raw = text(value or '','里程',50)
                    parsed, display, _, valid = parse_mileage(raw)
                    if not valid:
                        raise ImportProblem('里程格式无效，请填数字、万公里或 7万+')
                    db.execute('UPDATE listings SET mileage=?,mileage_text=? WHERE id=?',(parsed,display,listing_id))
                    continue
            else:
                raise ImportProblem('车源修改字段无效')
            db.execute(f'UPDATE listings SET {key}=? WHERE id=?',(value,listing_id))
        if 'price' in body:
            latest = db.execute('SELECT id FROM quotes WHERE listing_id=? AND is_confirmed=1 ORDER BY as_of DESC,id DESC LIMIT 1',(listing_id,)).fetchone()
            if latest:
                db.execute('UPDATE quotes SET amount=?,is_confirmed=1 WHERE id=?',(body['price'],latest['id']))
            else:
                message = db.execute('SELECT source_message_id,segment,posted FROM listings WHERE id=?',(listing_id,)).fetchone()
                existing = db.execute('SELECT id FROM quotes WHERE source_message_id=? AND segment=?',
                                      (message['source_message_id'],message['segment'])).fetchone()
                if existing:
                    # 导入时生成的报价行还没被确认过：这里就地改成人工修正值，避免撞唯一约束
                    db.execute('UPDATE quotes SET listing_id=?,amount=?,is_confirmed=1,raw_price=? WHERE id=?',
                               (listing_id,body['price'],'人工修正',existing['id']))
                else:
                    db.execute('INSERT INTO quotes(listing_id,source_message_id,segment,amount,as_of,is_confirmed,raw_price) VALUES(?,?,?,?,?,1,?)',
                               (listing_id,message['source_message_id'],message['segment'],body['price'],message['posted'],'人工修正'))
            _refresh_price(db,listing_id)
        if vehicle:
            _rebuild_display_name(db,listing_id)
        action = '修正车源信息' if vehicle else '修改车源'
        audit(db,listing_id,action,{'before':{k:before[k] for k in body},'after':body})
        return _require_listing(db,listing_id)


def compare(data_dir):
    with connect(data_dir) as db:
        return {'items':[_listing(r) for r in db.execute(BASE_LISTING+' WHERE l.in_compare=1 AND l.merged_into IS NULL AND l.status!=\'excluded\' ORDER BY l.posted DESC')],'budget':_settings(db)['budget']}


def reviews(data_dir):
    with connect(data_dir) as db:
        rows = db.execute("SELECT c.*,m.text,m.source,m.created_at FROM candidates c JOIN messages m ON m.id=c.message_id WHERE c.state='pending' ORDER BY m.created_at,c.id").fetchall()
        return {'items':[{'id':r['id'],'kind':r['kind'],'raw':r['text'],'issues':json.loads(r['data']).get('issues',[]),'listing_id':r['listing_id'],'candidate':json.loads(r['data']),'source':r['source'],'posted':r['created_at']} for r in rows],'total':len(rows)}


def _review(db,review_id,kind=None):
    r = db.execute('SELECT * FROM candidates WHERE id=?',(review_id,)).fetchone()
    if not r: raise ImportProblem('校对项目不存在',404)
    if r['state']!='pending': raise ImportProblem('该项目已经处理，请刷新',409)
    if kind and r['kind']!=kind: raise ImportProblem('校对项目类型不匹配')
    return r,json.loads(r['data'])


def _unit(value,unit,key):
    allowed = ('万元','元') if key=='price' else ('万公里','公里')
    if value is None:
        return None
    if unit not in allowed:
        raise ImportProblem(('价格' if key=='price' else '里程')+'必须选择明确单位')
    value = number(value,'价格' if key=='price' else '里程',0.000001 if key=='price' else 0,100000000)
    canonical = value/10000 if unit in ('元','公里') else value
    if canonical > (10000 if key=='price' else 500):
        raise ImportProblem('数值过大，请检查单位')
    return canonical


def _refresh_price(db,listing_id):
    latest = db.execute('SELECT amount,as_of FROM quotes WHERE listing_id=? AND is_confirmed=1 AND amount IS NOT NULL ORDER BY as_of DESC,id DESC LIMIT 1',(listing_id,)).fetchone()
    if latest:
        db.execute('UPDATE listings SET price=?,posted=? WHERE id=?',(latest['amount'],latest['as_of'],listing_id))


def confirm_review(data_dir,review_id,body):
    with connect(data_dir) as db:
        db.execute('BEGIN IMMEDIATE')
        r,c = _review(db,review_id,'listing')
        before = _require_listing(db,r['listing_id'])
        if before['merged_into']: raise ImportProblem('该候选所属车源已合并，请在目标车源处理',409)
        name = text(body.get('name',c.get('name','')),'标准车系名',100,True)
        price = _unit(body.get('price',c.get('price')),body.get('price_unit',c.get('price_unit')),'price')
        if price is None: raise ImportProblem('请填写整车报价后确认；缺价可保留待校对')
        approximate = bool(body.get('approximate_mileage',False))
        was_approximate = is_approximate(c.get('mileage_text',''))
        if was_approximate and not approximate:
            raise ImportProblem('原文里程为近似表达，请勾选保留近似里程')
        mileage = None if approximate else _unit(body.get('mileage',c.get('mileage')),body.get('mileage_unit',c.get('mileage_unit')),'mileage')
        year = body.get('model_year',c.get('model_year'))
        if year is not None and (type(year) is not int or not 1980<=year<=date.today().year+1):
            raise ImportProblem('款年无效')
        engine = text(body.get('engine',c.get('engine','')) or '','动力',50)
        trim = text(body.get('trim',c.get('trim','')) or '','原文配置',200)
        registration = text(body.get('year',c.get('year','')) or '','上牌时间',30)
        region = text(body.get('region',c.get('region','')) or '','地区',100)
        condition = text(body.get('condition',c.get('condition','')) or '','车况',2000)
        db.execute('INSERT OR IGNORE INTO models(name) VALUES(?)',(name,))
        model_id = db.execute('SELECT id FROM models WHERE name=?',(name,)).fetchone()[0]
        db.execute("UPDATE listings SET model_id=?,model_year=?,engine=?,trim=?,year=?,price=?,mileage=?,region=?,condition=?,status='confirmed' WHERE id=?",
                   (model_id,year,engine,trim,registration,price,mileage,region,condition,before['id']))
        db.execute('UPDATE quotes SET amount=?,is_confirmed=1 WHERE source_message_id=? AND segment=?',(price,r['message_id'],r['segment']))
        _refresh_price(db,before['id'])
        db.execute("UPDATE candidates SET state='confirmed' WHERE id=?",(review_id,))
        if body.get('remember_units'):
            message = db.execute('SELECT namespace,session FROM messages WHERE id=?',(r['message_id'],)).fetchone()
            scope = dumps([message['namespace'],message['session']])
            rules = {}
            for key,canon,large,small in [('price',price,'万元','元'),('mileage',mileage,'万公里','公里')]:
                original = c.get(key)
                rules[key] = large if original and canon is not None and math.isclose(original,canon) else small if original and canon is not None and math.isclose(original/10000,canon) else None
            db.execute('INSERT INTO unit_rules VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET price_unit=COALESCE(excluded.price_unit,price_unit),mileage_unit=COALESCE(excluded.mileage_unit,mileage_unit)',(scope,rules['price'],rules['mileage']))
        audit(db,before['id'],'人工校对',{'review_id':review_id,'before':before,'after':body,'approximate_mileage':approximate})
        return _require_listing(db,before['id'])


def assign_supplement(data_dir,review_id,body):
    with connect(data_dir) as db:
        db.execute('BEGIN IMMEDIATE')
        r,c = _review(db,review_id,'supplement')
        listing_id = body.get('listing_id')
        before = _require_listing(db,listing_id)
        approximate = bool(body.get('approximate',False))
        if is_approximate(c.get('mileage_text','')) and not approximate:
            raise ImportProblem('原文里程是近似表达，请保留近似状态')
        mileage = None if approximate else _unit(body.get('mileage',c.get('mileage')),body.get('mileage_unit',c.get('mileage_unit')),'mileage')
        if not approximate and mileage is None: raise ImportProblem('请填写里程并选择单位')
        db.execute('UPDATE listings SET mileage=?,mileage_text=? WHERE id=?',(mileage,c.get('mileage_text',''),listing_id))
        db.execute("UPDATE candidates SET state='confirmed',listing_id=? WHERE id=?",(listing_id,review_id))
        audit(db,listing_id,'关联里程补充',{'review_id':review_id,'source_message_id':r['message_id'],'before':before['mileage'],'mileage':mileage,'approximate':approximate})
        return _require_listing(db,listing_id)


def ignore_review(data_dir,review_id):
    with connect(data_dir) as db:
        db.execute('BEGIN IMMEDIATE')
        r,c = _review(db,review_id)
        if r['kind']=='listing':
            source = _require_listing(db,r['listing_id'])
            if source['merged_into']: raise ImportProblem('该候选所属车源已合并，请在目标车源处理',409)
        db.execute("UPDATE candidates SET state='ignored' WHERE id=?",(review_id,))
        if r['kind']=='listing':
            db.execute("UPDATE listings SET status='excluded',in_compare=0 WHERE id=?",(r['listing_id'],))
            db.execute('UPDATE quotes SET is_confirmed=0 WHERE source_message_id=? AND segment=?',(r['message_id'],r['segment']))
        audit(db,r['listing_id'],'忽略候选',{'review_id':review_id,'source_message_id':r['message_id']})
        return {'ok':True}


def confirm_image(data_dir,listing_id,media_id,message_id):
    with connect(data_dir) as db:
        _require_listing(db,listing_id)
        cursor = db.execute("UPDATE listing_images SET status='confirmed' WHERE listing_id=? AND media_id=? AND source_message_id=?",(listing_id,media_id,message_id))
        if not cursor.rowcount: raise ImportProblem('图片关联候选不存在',404)
        audit(db,listing_id,'确认图片归属',{'media_id':media_id,'source_message_id':message_id})
        return {'ok':True}


def merge(data_dir,target_id,source_id):
    if target_id==source_id: raise ImportProblem('不能将车源与自身合并')
    with connect(data_dir) as db:
        db.execute('BEGIN IMMEDIATE')
        target = _require_listing(db,target_id)
        source = _require_listing(db,source_id)
        if target['model_id'] != source['model_id']: raise ImportProblem('仅支持同车系的同车合并，请先校对车系')
        if db.execute("SELECT 1 FROM candidates WHERE listing_id IN (?,?) AND state='pending' LIMIT 1",(target_id,source_id)).fetchone():
            raise ImportProblem('存在待校对项目，请先确认或忽略后再合并',409)
        sale_state = 'sold' if 'sold' in (target['sale_state'],source['sale_state']) else target['sale_state']
        db.execute('UPDATE quotes SET listing_id=? WHERE listing_id=?',(target_id,source_id))
        db.execute('INSERT OR IGNORE INTO listing_images SELECT ?,media_id,source_message_id,status FROM listing_images WHERE listing_id=?',(target_id,source_id))
        db.execute('DELETE FROM listing_images WHERE listing_id=?',(source_id,))
        db.execute('UPDATE candidates SET listing_id=? WHERE listing_id=?',(target_id,source_id))
        db.execute('UPDATE listings SET merged_into=?,in_compare=0,sale_state=? WHERE id=?',(target_id,sale_state,source_id))
        db.execute('UPDATE listings SET sale_state=? WHERE id=?',(sale_state,target_id))
        _refresh_price(db,target_id)
        audit(db,target_id,'确认同车并合并',{'source_id':source_id,'source':source,'target_before':target})
        return _require_listing(db,target_id)


def analysis(data_dir,model_id=None,days=30,model_year=None,engine=None,trim=None,mileage_min=None,mileage_max=None,region=None,scope=None):
    days = max(1,min(int(days),3650))
    if scope not in (None,'','model'):
        raise ImportProblem('分析范围无效')
    broad = scope == 'model'
    end = int(time.time())
    start = end-days*86400
    with connect(data_dir) as db:
        rows = db.execute(BASE_LISTING+" WHERE l.model_id=? AND l.status='confirmed' AND l.merged_into IS NULL AND l.sale_state!='sold'",(model_id,)).fetchall() if model_id else []
        quotes = [dict(q) for q in db.execute("SELECT q.* FROM quotes q JOIN listings l ON l.id=q.listing_id WHERE l.model_id=? AND l.status='confirmed' AND l.merged_into IS NULL AND l.sale_state!='sold' AND q.is_confirmed=1 AND q.as_of BETWEEN ? AND ? ORDER BY q.as_of,q.id",(model_id,start,end))] if model_id else []
    latest_quotes = {}
    for quote in quotes:
        if quote['amount'] is not None:
            latest_quotes[quote['listing_id']] = quote
    latest = {listing_id:quote['amount'] for listing_id,quote in latest_quotes.items()}
    model_items = [_listing(row) for row in rows if row['id'] in latest]
    model_count = len(model_items)
    items = list(model_items)
    def size_of(item):
        return engine_displacement(item.get('engine'))
    groups = {}
    for item in items:
        if item['model_year'] and size_of(item):
            key = (item['model_year'],size_of(item))
            groups[key] = groups.get(key,0)+1
    ordered = sorted(groups,key=lambda k:(-groups[k],str(k)))
    scope_parts = [f'{days}天内已确认的独立车源']
    if broad:
        scope_parts.append('同车型全部（款年或动力不一致，仅浏览实测报价）')
    elif model_year is None and engine is None and ordered:
        model_year,engine = ordered[0]
    if model_year not in (None,''):
        items = [i for i in items if i['model_year']==model_year]
        scope_parts.append(f'款年：{model_year}')
    if engine not in (None,''):
        engine = engine_displacement(engine)
        items = [i for i in items if size_of(i)==engine]
        scope_parts.append(f'动力：{engine}')
    for key,value,label in [('trim',trim,'原文配置'),('region',region,'地区')]:
        if value not in (None,''):
            items = [i for i in items if i[key]==value]
            scope_parts.append(f'{label}：{value}')
    if not broad and (not model_year or not engine):
        items = []
        scope_parts.append('款年或动力不足，暂不形成可比组')
    if mileage_min is not None:
        mileage_min = number(mileage_min,'最低里程',0,500)
        items = [i for i in items if i['mileage'] is not None and i['mileage']>=mileage_min]
        scope_parts.append(f'里程≥{mileage_min:g}万公里')
    if mileage_max is not None:
        mileage_max = number(mileage_max,'最高里程',0,500)
        items = [i for i in items if i['mileage'] is not None and i['mileage']<=mileage_max]
        scope_parts.append(f'里程≤{mileage_max:g}万公里')
    observations = [{'id':i['id'],'price':latest[i['id']],
                     'observed_at':datetime.fromtimestamp(latest_quotes[i['id']]['as_of'],CHINA).date().isoformat(),
                     'name':i.get('name'),'model_year':i.get('model_year'),'engine':i.get('engine'),
                     'trim':i.get('trim'),'region':i.get('region')} for i in items]
    observations.sort(key=lambda o:(o['observed_at'],o['id']))
    if broad:
        labels,series,daily_counts,change = [],[],[],None
        sufficient = False
        median = None
        quartiles = [None]*3
    else:
        ids = {i['id'] for i in items}
        daily = {}
        for q in quotes:
            if q['listing_id'] in ids and q['amount'] is not None:
                day = datetime.fromtimestamp(q['as_of'],CHINA).date().isoformat()
                daily.setdefault(day,{})[q['listing_id']] = q['amount']
        labels = sorted(daily)
        daily_counts = [len(daily[d]) for d in labels]
        series = [statistics.median(daily[d].values()) for d in labels]
        prices = sorted(latest[i['id']] for i in items)
        sufficient = len(prices)>=5
        median = statistics.median(prices) if sufficient else None
        quartiles = statistics.quantiles(prices,n=4,method='inclusive') if sufficient else [None]*3
        change = round((series[-1]/series[0]-1)*100,2) if len(series)>=2 and series[0] else None
    for item in items: item['price']=latest[item['id']]
    return {'model_id':model_id,'count':len(items),'model_count':model_count,'broad':broad,'median':median,'low':quartiles[0],'high':quartiles[2], 'change':change,
            'insufficient':not sufficient,'scope':'；'.join(scope_parts),'labels':labels,'series':series,'daily_counts':daily_counts,'observations':observations,
            'cohort':None if broad else {'model_year':model_year if model_year not in (None,'') else None,'engine':engine if engine not in (None,'') else None},
            'groups':[{'model_year':k[0],'engine':k[1],'count':groups[k]} for k in ordered], 'listings':items}

def models(data_dir):
    with connect(data_dir) as db:
        rows = [dict(r) for r in db.execute('SELECT * FROM models ORDER BY followed DESC,name')]
        aliases = [dict(r) for r in db.execute('SELECT * FROM aliases')]
    for row in rows:
        a = analysis(data_dir,row['id'])
        row.update({k:a[k] for k in ('count','median','low','high','change')})
        group = a['groups'][0] if a['groups'] else {}
        row.update(model_year=group.get('model_year'),engine=group.get('engine',''),trim=group.get('trim',''),followed=bool(row['followed']),aliases=[{'id':a['id'],'raw':a['raw']} for a in aliases if a['model_id']==row['id']])
    return {'items':rows}


def patch_model(data_dir,model_id,body):
    with connect(data_dir) as db:
        if not db.execute('SELECT 1 FROM models WHERE id=?',(model_id,)).fetchone(): raise ImportProblem('车型不存在',404)
        for key,value in body.items():
            if key=='name': value=text(value,'标准车系名',100,True)
            elif key=='followed': value=boolean(value)
            else: raise ImportProblem('车型修改字段无效')
            if key=='name':
                old = db.execute('SELECT name FROM models WHERE id=?',(model_id,)).fetchone()[0]
            try:
                db.execute(f'UPDATE models SET {key}=? WHERE id=?',(value,model_id))
            except sqlite3.IntegrityError as exc: raise ImportProblem('该标准车系名已存在',409) from exc
            if key=='name' and old != value:
                norm = normalize(old)
                existing = db.execute("SELECT model_id FROM aliases WHERE scope='*' AND norm=?",(norm,)).fetchone()
                if existing and existing['model_id'] != model_id:
                    raise ImportProblem('原车系名已被其他车型使用，无法保留为别名',409)
                db.execute("INSERT OR IGNORE INTO aliases(model_id,raw,norm,scope) VALUES(?,?,?,'*')",(model_id,old,norm))
    return next(m for m in models(data_dir)['items'] if m['id']==model_id)


def add_alias(data_dir,model_id,body):
    raw=text(body.get('raw'),'车型别名',100,True)
    scope=text(body.get('scope','*'),'适用来源',500,True)
    norm=normalize(raw)
    if len(norm)<2: raise ImportProblem('别名至少两个有效字符')
    with connect(data_dir) as db:
        if not db.execute('SELECT 1 FROM models WHERE id=?',(model_id,)).fetchone(): raise ImportProblem('车型不存在',404)
        existing=db.execute('SELECT * FROM aliases WHERE scope=? AND norm=?',(scope,norm)).fetchone()
        if existing:
            if existing['model_id']!=model_id: raise ImportProblem('这个别名已经属于另一车系',409)
            return dict(existing)
        cursor=db.execute('INSERT INTO aliases(model_id,raw,norm,scope) VALUES(?,?,?,?)',(model_id,raw,norm,scope))
        return {'id':cursor.lastrowid,'raw':raw,'scope':scope,'model_id':model_id}


def overview(data_dir,days=30,model_id=None,model_year=None,engine=None,trim=None,mileage_min=None,mileage_max=None,region=None):
    days=max(1,min(int(days),3650))
    all_models=models(data_dir)['items']
    selected=next((m for m in all_models if m['id']==model_id),None) if model_id else next(iter(all_models),None)
    with connect(data_dir) as db:
        counts={'listings':db.execute("SELECT count(*) FROM listings WHERE merged_into IS NULL AND status!='excluded'").fetchone()[0],
                'models':len(all_models),'new_listings':db.execute("SELECT count(*) FROM listings WHERE merged_into IS NULL AND status!='excluded' AND posted>=?",(time.time()-days*86400,)).fetchone()[0],
                'pending':db.execute("SELECT count(*) FROM candidates WHERE state='pending'").fetchone()[0]}
        last=db.execute("SELECT max(updated_at) FROM batches WHERE status='done'").fetchone()[0]
    return {'counts':counts,'recent':listings(data_dir,page_size=6)['items'],'models':all_models,'selected_model':selected,
            'analysis':analysis(data_dir,selected['id'] if selected else None,days=days,model_year=model_year,engine=engine,trim=trim,mileage_min=mileage_min,mileage_max=mileage_max,region=region),'fuel':fuel(data_dir,settings(data_dir)['province']),'last_import':last}


def fuel(data_dir,province):
    if province not in oil.PROVINCES: raise ImportProblem('请选择支持的油价地区')
    today=datetime.now(CHINA).date().isoformat()
    with connect(data_dir) as db:
        rows=[dict(r) for r in db.execute('SELECT * FROM fuel WHERE province=? ORDER BY effective_date',(province,))]
        state=db.execute('SELECT * FROM fuel_status WHERE province=?',(province,)).fetchone()
    active=[r for r in rows if r['effective_date']<=today]
    latest=active[-1] if active else None
    meta=latest or (rows[-1] if rows else {})
    error=state['error'] if state else None
    last_success=state['last_success'] if state and 'last_success' in state.keys() else None
    recent=bool(last_success) and last_success[:10]==datetime.now(timezone.utc).date().isoformat()
    return {'province':province,'status':'ok' if rows and recent and not error else 'cached' if rows else 'empty',
            'source':meta.get('source',''),'source_url':meta.get('source_url',''),'fetched_at':meta.get('fetched_at'),'verified_at':meta.get('verified_at'),
            'error':error,'records':[{k:r[k] for k in ('effective_date','p92','p95','source')} for r in rows],
            'latest':{k:latest[k] for k in ('effective_date','p92','p95')} if latest else None,'provinces':oil.PROVINCES}


def refresh_fuel(data_dir,province):
    if province not in oil.PROVINCES: raise ImportProblem('请选择支持的油价地区')
    try:
        result=oil.fetch_prices(province)
        with connect(data_dir) as db:
            for r in result['records']:
                # A manual entry is preserved until the user chooses a different date.
                db.execute('INSERT INTO fuel VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(province,effective_date) DO UPDATE SET p92=excluded.p92,p95=excluded.p95,source=excluded.source,source_url=excluded.source_url,fetched_at=excluded.fetched_at,verified_at=excluded.verified_at WHERE fuel.source!=\'手工记录\'',
                           (province,r['effective_date'],r['p92'],r['p95'],result['source'],result['source_url'],result['fetched_at'],stamp()))
            db.execute('INSERT INTO fuel_status(province,error,last_attempt,last_success) VALUES(?,NULL,?,?) ON CONFLICT(province) DO UPDATE SET error=NULL,last_attempt=excluded.last_attempt,last_success=excluded.last_success',(province,stamp(),stamp()))
    except (oil.OilFetchError,ValueError) as exc:
        with connect(data_dir) as db:
            db.execute('INSERT INTO fuel_status(province,error,last_attempt) VALUES(?,?,?) ON CONFLICT(province) DO UPDATE SET error=excluded.error,last_attempt=excluded.last_attempt',(province,'公开来源获取失败，已保留本地缓存。'+str(exc)[:250],stamp()))
    return fuel(data_dir,province)


def manual_fuel(data_dir,body):
    province=body.get('province')
    if province not in oil.PROVINCES: raise ImportProblem('请选择支持的油价地区')
    try:
        day=date.fromisoformat(body.get('effective_date','')).isoformat()
    except (ValueError,TypeError) as exc: raise ImportProblem('请填写有效生效日期') from exc
    p92=number(body.get('p92'),'92号油价',0.01,99)
    p95=number(body.get('p95'),'95号油价',0.01,99)
    url=text(body.get('source_url',''),'来源链接',1000)
    if url and urlparse(url).scheme not in ('https','http'): raise ImportProblem('来源链接仅支持http或https')
    with connect(data_dir) as db:
        if db.execute('SELECT 1 FROM fuel WHERE province=? AND effective_date=?',(province,day)).fetchone():
            raise ImportProblem('该日期已有记录，不能直接覆盖',409)
        db.execute('INSERT INTO fuel VALUES(?,?,?,?,?,?,?,?)',(province,day,p92,p95,'手工记录',url,stamp(),stamp()))
    return fuel(data_dir,province)
