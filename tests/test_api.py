import copy
import io
import json
import time
import zipfile

import pytest
from fastapi.testclient import TestClient
from backend.db import connect
from test_imports import sample, imported

HEADERS = {'X-Requested-With':'CarWatch'}


@pytest.fixture
def client(tmp_path):
    from backend.api import create_app
    with TestClient(create_app(tmp_path,run_worker=False),base_url='http://127.0.0.1:5138',headers=HEADERS) as c:
        c.data_dir = tmp_path
        yield c


def seed(client,n=1,ambiguous=False):
    files = sample()
    doc = json.loads(files['root/chat.json'])
    text = doc['messages'][0]
    if ambiguous:
        text['content'] = '车型：19款领克022.0耀pro\n上牌时间：19.4\n公里数：9.6\n车况：原版\n车价:3.65'
    doc['messages'] = []
    for i in range(n):
        m = copy.deepcopy(text)
        m['platformMessageId'] = str(9223372036854775808+i)
        m['createTime'] = int(time.time())-86400*(n-i)
        if not ambiguous:
            m['content'] = m['content'].replace('2.5万',f'{2.5+i/10}万')
        doc['messages'].append(m)
    result = imported(client.data_dir,{'root/chat.json':json.dumps(doc,ensure_ascii=False).encode()})
    assert result['status'] == 'done'
    return client.get('/api/listings').json()['items']


def test_empty_database_is_honest_and_static_is_restricted(client):
    data = client.get('/api/overview').json()
    assert data['counts'] == {'listings':0,'models':0,'new_listings':0,'pending':0}
    assert data['analysis']['insufficient'] is True
    assert client.get('/api/fuel?province=浙江').json()['latest'] is None
    assert client.get('/api/settings').json()['ocr_available'] is False
    assert client.get('/api/health').json()['status'] == 'ok'
    assert client.get('/data/carwatch.sqlite3').status_code == 404
    assert client.get('/api/media/../../carwatch.sqlite3').status_code == 404


def test_origin_host_and_custom_mutation_header(client):
    assert client.get('/api/health',headers={'Host':'evil.test'}).status_code == 400
    assert client.patch('/api/settings',json={'budget':9},headers={'Origin':'https://evil.test'}).status_code == 403
    assert client.patch('/api/settings',json={'budget':9},headers={'Origin':'http://127.0.0.1:9999'}).status_code == 403
    with TestClient(client.app,base_url='http://127.0.0.1:5138') as other:
        assert other.patch('/api/settings',json={'budget':9}).status_code == 403
    assert client.patch('/api/settings',json={'budget':9},headers={'Content-Type':'text/plain'}).status_code == 415


def test_chunk_upload_and_review_normalize_units(client):
    from backend.importer import run_batch
    body = sample()['root/chat.json']
    b = client.post('/api/imports',json={'name':'test','files':[{'path':'chat.json','size':len(body)}]}).json()
    f = b['files'][0]
    assert client.put(f"/api/imports/{b['id']}/files/{f['id']}?offset=0",content=body).status_code == 200
    assert client.post(f"/api/imports/{b['id']}/complete",json={}).json()['status'] == 'queued'
    assert run_batch(client.data_dir,b['id'])['status'] == 'done'
    assert client.get('/api/listings').json()['total'] == 1


def test_import_normalizes_units_and_auto_confirms_without_review(client):
    listing = seed(client,ambiguous=True)[0]
    detail = client.get(f"/api/listings/{listing['id']}").json()
    assert detail['status'] == 'confirmed'
    assert (detail['price'],detail['mileage']) == (3.65,9.6)
    assert detail['quotes'][0]['is_confirmed'] == 1
    assert client.get('/api/reviews').json()['total'] == 0
    assert client.get('/api/overview').json()['counts']['pending'] == 0


def test_supplement_stays_out_of_the_review_queue(client):
    imported(client.data_dir,sample())
    assert client.get('/api/reviews').json()['total'] == 0
    with connect(client.data_dir) as db:
        row = db.execute("SELECT state,listing_id FROM candidates WHERE kind='supplement'").fetchone()
    assert row['state'] == 'ignored' and row['listing_id'] is None


def test_alias_conflicts_are_rejected(client):
    listing = seed(client)[0]
    model = listing['model_id']
    assert client.post(f'/api/models/{model}/aliases',json={'raw':'小科'}).status_code == 200
    with connect(client.data_dir) as db:
        other = db.execute("INSERT INTO models(name) VALUES('领克 02')").lastrowid
    assert client.post(f'/api/models/{other}/aliases',json={'raw':'小科'}).status_code == 409
    assert client.patch(f'/api/models/{model}',json={'followed':True}).json()['followed'] is True


def test_favorites_compare_budget_notes_are_persistent_and_limit_four(client):
    listings = seed(client,5)
    for x in listings[:4]:
        assert client.patch(f"/api/listings/{x['id']}",json={'in_compare':True,'favorite':True,'notes':'待查看底盘'}).status_code == 200
    assert client.patch(f"/api/listings/{listings[4]['id']}",json={'in_compare':True}).status_code == 409
    assert client.patch('/api/settings',json={'budget':4.5}).status_code == 200
    assert client.get('/api/compare').json()['budget'] == 4.5
    assert len(client.get('/api/compare').json()['items']) == 4
    assert client.get('/api/listings?favorites=true').json()['total'] == 4
    assert client.get(f"/api/listings/{listings[0]['id']}").json()['notes']=='待查看底盘'
    from backend.api import create_app
    with TestClient(create_app(client.data_dir,run_worker=False),base_url='http://127.0.0.1') as restarted:
        assert len(restarted.get('/api/compare').json()['items']) == 4


def test_statistics_need_five_independent_vehicles_and_do_not_fake_days(client):
    listings = seed(client,5)
    mid = listings[0]['model_id']
    analysis = client.get(f'/api/models/{mid}/analysis').json()
    assert analysis['count'] == 5 and analysis['median'] == 2.7
    assert analysis['insufficient'] is False
    assert len(analysis['labels']) == 5
    assert analysis['series'] == [2.5,2.6,2.7,2.8,2.9]  # one car per day: daily median is that car's quote
    assert analysis['daily_counts'] == [1,1,1,1,1]
    assert len(analysis['observations']) == 5
    narrow = client.get(f'/api/models/{mid}/analysis?mileage_min=10').json()
    assert narrow['count'] == 0 and narrow['median'] is None
    assert narrow['insufficient'] is True


def test_trend_shows_daily_median_below_five_quotes_per_day(client):
    from datetime import datetime, time as clock_time, timedelta, timezone
    listings = seed(client,5)
    mid = listings[0]['model_id']
    china = timezone(timedelta(hours=8))
    now = datetime.now(china)
    day1 = (now-timedelta(days=2)).date()
    day2 = (now-timedelta(days=1)).date()
    first = datetime.combine(day1,clock_time(10),tzinfo=china).timestamp()
    second = datetime.combine(day2,clock_time(15),tzinfo=china).timestamp()
    times = [first,first+3600,second,second+3600,second+7200]
    with connect(client.data_dir) as db:
        rows = db.execute('SELECT id FROM listings ORDER BY id').fetchall()
        for row,moment in zip(rows,times):
            db.execute('UPDATE listings SET posted=? WHERE id=?',(int(moment),row['id']))
            db.execute('UPDATE messages SET created_at=? WHERE id=(SELECT source_message_id FROM listings WHERE id=?)',(int(moment),row['id']))
            db.execute('UPDATE quotes SET as_of=? WHERE listing_id=?',(int(moment),row['id']))
    analysis = client.get(f'/api/models/{mid}/analysis?days=30').json()
    assert analysis['count'] == 5 and analysis['insufficient'] is False
    assert analysis['labels'] == [day1.isoformat(),day2.isoformat()]
    assert analysis['series'] == [2.55,2.8]
    assert analysis['daily_counts'] == [2,3]
    assert analysis['change'] == 9.8
    assert len(analysis['observations']) == 5
    assert analysis['cohort'] == {'model_year':2020,'engine':'1.3'}


def test_overview_accepts_cohort_filter_and_keeps_trend(client):
    listings = seed(client,5)
    mid = listings[0]['model_id']
    with connect(client.data_dir) as db:
        rows = db.execute('SELECT id FROM listings ORDER BY id').fetchall()
        for i,row in enumerate(rows):
            db.execute('UPDATE listings SET engine=? WHERE id=?',('2.0T' if i >= 3 else '1.5T',row['id']))
    default = client.get(f'/api/overview?model_id={mid}').json()['analysis']
    assert default['cohort'] == {'model_year':2020,'engine':'1.5'}
    data = client.get(f'/api/overview?model_id={mid}&model_year=2020&engine=2.0').json()
    analysis = data['analysis']
    assert analysis['count'] == 2 and analysis['cohort'] == {'model_year':2020,'engine':'2.0'}
    assert len(analysis['labels']) == 2 and len(analysis['series']) == 2
    assert analysis['daily_counts'] == [1,1]
    assert len(analysis['observations']) == 2


def test_default_cohort_groups_by_year_and_displacement_not_trim(client):
    listings = seed(client,5)
    mid = listings[0]['model_id']
    with connect(client.data_dir) as db:
        rows = db.execute("SELECT id FROM listings ORDER BY id").fetchall()
        for i,row in enumerate(rows):
            db.execute("UPDATE listings SET trim=?, engine=? WHERE id=?",(f'配置{i+1}','1.3TD' if i < 3 else '1.3',row['id']))
    default = client.get(f'/api/models/{mid}/analysis?days=30').json()
    assert default['count'] == 5 and default['model_count'] == 5
    assert default['insufficient'] is False and default['median'] == 2.7
    assert len(default['groups']) == 1
    assert default['groups'][0]['engine'] == '1.3'
    assert 'trim' not in default['groups'][0]
    assert '动力：1.3' in default['scope']
    narrowed = client.get(f'/api/models/{mid}/analysis?days=30&trim=配置1').json()
    assert narrowed['count'] == 1 and narrowed['insufficient'] is True


def test_model_scope_lists_all_engine_groups_without_valuation(client):
    listings = seed(client,5)
    mid = listings[0]['model_id']
    with connect(client.data_dir) as db:
        rows = db.execute("SELECT id FROM listings ORDER BY id").fetchall()
        for i,row in enumerate(rows):
            db.execute("UPDATE listings SET engine=? WHERE id=?",(f'{1.0+i/10:.1f}T',row['id']))
    default = client.get(f'/api/models/{mid}/analysis?days=30').json()
    assert default['count'] == 1 and default['model_count'] == 5
    assert default['insufficient'] is True and default['broad'] is False
    assert {g['engine'] for g in default['groups']} == {'1.0','1.1','1.2','1.3','1.4'}
    broad = client.get(f'/api/models/{mid}/analysis?days=30&scope=model').json()
    assert broad['broad'] is True and broad['count'] == 5 and broad['model_count'] == 5
    assert broad['median'] is None and broad['low'] is None and broad['high'] is None
    assert broad['insufficient'] is True and broad['change'] is None
    assert len(broad['observations']) == 5
    assert {o['engine'] for o in broad['observations']} == {f'{1.0+i/10:.1f}T' for i in range(5)}
    assert all(o['price'] and o['observed_at'] for o in broad['observations'])
    assert '同车型全部' in broad['scope']


def test_merge_preserves_history_orders_by_message_time_and_reduces_sample(client):
    listings = seed(client,5)
    target,source = listings[0],listings[-1]  # newest target, oldest source
    merged = client.post(f"/api/listings/{target['id']}/merge",json={'source_id':source['id']})
    assert merged.status_code == 200
    detail = client.get(f"/api/listings/{target['id']}").json()
    assert len(detail['quotes']) == 2
    assert detail['price'] == target['price']
    assert client.get('/api/listings').json()['total'] == 4
    analysis = client.get(f"/api/models/{target['model_id']}/analysis").json()
    assert analysis['count'] == 4 and analysis['median'] is None
    assert client.post(f"/api/listings/{target['id']}/merge",json={'source_id':target['id']}).status_code == 400
    assert client.post(f"/api/listings/{source['id']}/merge",json={'source_id':target['id']}).status_code == 409


def test_media_shows_pending_thumbnail_and_confirmation_records_owner(client):
    # 台账列表要直接有图可看：缩略图优先取已确认图，没有已确认图时退回该车源的第一张（可能是待确认）。
    imported(client.data_dir,sample())
    listing = client.get('/api/listings').json()['items'][0]
    detail = client.get(f"/api/listings/{listing['id']}").json()
    image = detail['images'][0]
    assert image['status'] == 'pending'
    assert listing['thumbnail'] and image['id'] in listing['thumbnail']
    assert client.get(image['url']).headers['content-type'] == 'image/jpeg'
    assert client.post(f"/api/listings/{listing['id']}/images/{image['id']}/confirm",json={'source_message_id':image['source_message_id']}).status_code == 200
    confirmed = client.get(f"/api/listings/{listing['id']}").json()
    assert confirmed['thumbnail'] == listing['thumbnail']
    assert all(item['status'] == 'confirmed' for item in confirmed['images'] if item['id'] == image['id'])


def test_oil_failure_preserves_cache_and_manual_does_not_overwrite(client,monkeypatch):
    manual = {'province':'浙江','effective_date':'2026-10-30','p92':8.85,'p95':9.42}
    assert client.post('/api/fuel/manual',json=manual).json()['latest']['p92']==8.85
    assert client.get('/api/fuel?province=浙江').json()['records'][0]['source']=='手工记录'
    import backend.oil
    def fail(*a,**kw): raise backend.oil.OilFetchError('network unavailable')
    monkeypatch.setattr(backend.oil,'fetch_prices',fail)
    failed = client.post('/api/fuel/refresh',json={'province':'浙江'}).json()
    assert failed['status'] == 'cached' and failed['latest']['p95']==9.42 and failed['error']
    assert client.post('/api/fuel/manual',json=manual|{'p92':1}).status_code == 409
    assert client.get('/api/fuel?province=bad').status_code == 400


def test_overview_new_listing_count_matches_selected_days(client):
    seed(client,5)
    assert client.get('/api/overview?days=7').json()['counts']['new_listings']==5
    assert client.get('/api/overview?days=1').json()['counts']['new_listings']==0


def test_worker_recovers_committed_running_batch_on_restart(tmp_path):
    from backend.api import create_app
    from backend.db import init_db
    from test_imports import upload
    init_db(tmp_path)
    batch_id = upload(tmp_path,sample())
    with connect(tmp_path) as db:
        db.execute("UPDATE batches SET status='running' WHERE id=?",(batch_id,))
    with TestClient(create_app(tmp_path,run_worker=True),base_url='http://127.0.0.1') as c:
        deadline=time.monotonic()+12
        while time.monotonic()<deadline:
            b=c.get('/api/imports/'+batch_id).json()
            if b['status'] in ('done','error'): break
            time.sleep(0.1)
        assert b['status']=='done',b
        assert c.get('/api/health').json()['worker'] is True
        assert c.get('/api/listings').json()['total']==1
    with TestClient(create_app(tmp_path,run_worker=True),base_url='http://127.0.0.1') as c:
        assert c.get('/api/listings').json()['total']==1


def test_backup_is_a_consistent_database_with_media_and_raw_files(client):
    imported(client.data_dir,sample())
    response = client.get('/api/backup')
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        assert 'carwatch.sqlite3' in z.namelist()
        assert any(n.startswith('media/') for n in z.namelist())
        assert any(n.startswith('batches/') for n in z.namelist())
    client.post('/api/imports',json={'files':[{'path':'chat.json','size':100}]})
    assert client.get('/api/backup').status_code == 409


def test_import_fills_approximate_mileage_as_wan_plus(client):
    files = sample()
    doc = json.loads(files['root/chat.json'])
    doc['messages'] = doc['messages'][:1]
    doc['messages'][0]['content'] = '车型：2020款科鲁泽1.3T\n上牌：2020年\n里程：6万出头公里\n价格：2.5万\n车况：原版'
    assert imported(client.data_dir, {'root/chat.json': json.dumps(doc, ensure_ascii=False).encode()})['status'] == 'done'
    listing = client.get('/api/listings').json()['items'][0]
    detail = client.get(f"/api/listings/{listing['id']}").json()
    assert detail['status'] == 'confirmed'
    assert detail['mileage'] == 6 and detail['mileage_text'] == '6万+'
    assert detail['quotes'][0]['is_confirmed'] == 1
    assert client.get('/api/reviews').json()['total'] == 0


def test_multi_car_message_auto_confirms_both_and_merges_manually(client):
    files = sample()
    doc = json.loads(files['root/chat.json'])
    doc['messages'] = [{
        'platformMessageId':'9223372036854775900','localType':1,'createTime':1793588400,'senderUsername':'seller-a',
        'content':'车型：2020款科鲁泽1.3T\n上牌：2020年\n里程：6万公里\n价格：2.5万\n车况：原版\n车型：2019款科鲁泽1.3T\n上牌：2019年\n里程：7万公里\n车况：原版'}]
    assert imported(client.data_dir, {'root/chat.json': json.dumps(doc, ensure_ascii=False).encode()})['status'] == 'done'
    items = client.get('/api/listings').json()['items']
    assert len(items) == 2 and all(x['status'] == 'confirmed' for x in items)
    target = next(x for x in items if x['price'] is not None)
    source = next(x for x in items if x['id'] != target['id'])
    response = client.post(f"/api/listings/{target['id']}/merge",json={'source_id':source['id']})
    assert response.status_code == 200
    assert client.get(f"/api/listings/{target['id']}").json()['price'] == 2.5


def test_merge_carries_sold_state_conservatively(client):
    listings = seed(client,5)
    source, target = listings[-1], listings[0]
    assert client.patch(f"/api/listings/{source['id']}",json={'sale_state':'sold'}).status_code == 200
    assert client.post(f"/api/listings/{target['id']}/merge",json={'source_id':source['id']}).status_code == 200
    detail = client.get(f"/api/listings/{target['id']}").json()
    assert detail['sale_state'] == 'sold'
    assert client.get(f"/api/models/{target['model_id']}/analysis").json()['count'] == 3


def test_model_rename_keeps_future_imports_in_same_family(client):
    listing = seed(client)[0]
    model_id = listing['model_id']
    assert client.patch(f'/api/models/{model_id}',json={'name':'科鲁泽'}).status_code == 200
    files = sample()
    doc = json.loads(files['root/chat.json'])
    doc['messages'] = doc['messages'][:1]
    doc['messages'][0]['platformMessageId'] = '9223372036854775901'
    doc['messages'][0]['content'] = '车型：2020款科鲁泽1.3T\n上牌：2020年\n里程：6万公里\n价格：3万\n车况：原版'
    assert imported(client.data_dir, {'root/chat.json': json.dumps(doc, ensure_ascii=False).encode()})['status'] == 'done'
    models = client.get('/api/models').json()['items']
    assert len(models) == 1 and models[0]['id'] == model_id
    assert client.get('/api/listings').json()['total'] == 2


def test_manual_fuel_does_not_suppress_public_refresh(client,monkeypatch):
    assert client.post('/api/fuel/manual',json={'province':'浙江','effective_date':'2026-10-30','p92':8.85,'p95':9.42}).status_code == 200
    assert client.get('/api/fuel?province=浙江').json()['status'] == 'cached'
    import backend.oil
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    def ok(*a,**kw):
        return {'source':'测试公开来源','source_url':'https://example.invalid/oil','fetched_at':now,
                'records':[{'effective_date':'2026-10-29','p92':8.80,'p95':9.30}]}
    monkeypatch.setattr(backend.oil,'fetch_prices',ok)
    refreshed = client.post('/api/fuel/refresh',json={'province':'浙江'}).json()
    assert refreshed['status'] == 'ok'
    assert refreshed['latest']['effective_date'] == '2026-10-30'
    assert refreshed['source'] == '手工记录'


def test_cancelled_unfinished_upload_allows_backup(client):
    from backend.importer import create_upload
    batch = create_upload(client.data_dir,{'name':'abandoned','files':[{'path':'chat.json','size':100}]})
    assert client.get('/api/backup').status_code == 409
    assert client.post(f"/api/imports/{batch['id']}/cancel",json={}).status_code == 200
    assert client.get(f"/api/imports/{batch['id']}").json()['status'] == 'error'
    assert client.get('/api/backup').status_code == 200


def test_confirmed_listing_correction_is_audited_and_updates_quote(client):
    listing = seed(client)[0]
    assert listing['status'] == 'confirmed'
    before = client.get(f"/api/listings/{listing['id']}").json()
    response = client.patch(f"/api/listings/{listing['id']}", json={
        'model_id': before['model_id'], 'model_year': 2021, 'engine': '1.5T',
        'trim': 'RS 手动核对', 'year': '2021年5月', 'price': 3.28, 'mileage': 5.6,
        'region': '杭州', 'condition': '人工核对：右前叶补漆'})
    assert response.status_code == 200, response.text
    after = client.get(f"/api/listings/{listing['id']}").json()
    assert (after['model_year'], after['engine'], after['trim'], after['year']) == (2021, '1.5T', 'RS 手动核对', '2021年5月')
    assert (after['price'], after['mileage'], after['region']) == (3.28, 5.6, '杭州')
    assert after['quotes'][-1]['amount'] == 3.28 and after['quotes'][-1]['is_confirmed'] == 1
    entry = next(a for a in after['audit'] if a['action'] == '修正车源信息')
    audit_detail = json.loads(entry['detail']) if isinstance(entry['detail'], str) else entry['detail']
    assert audit_detail['before']['price'] == 2.5 and audit_detail['after']['price'] == 3.28
    assert client.patch(f"/api/listings/{listing['id']}", json={'model_year': 1800}).status_code == 400


def test_price_correction_works_when_quote_is_not_confirmed(client):
    # 导入时生成的报价行可能还没确认（is_confirmed=0）：改价要就地更新，不能撞唯一约束
    imported(client.data_dir,sample())
    listing = client.get('/api/listings').json()['items'][0]
    with connect(client.data_dir) as db:
        db.execute('UPDATE quotes SET is_confirmed=0 WHERE listing_id=?',(listing['id'],))
    response = client.patch(f"/api/listings/{listing['id']}", json={'price': 4.25})
    assert response.status_code == 200, response.text
    assert response.json()['price'] == 4.25
    detail = client.get(f"/api/listings/{listing['id']}").json()
    assert any(quote['amount'] == 4.25 and quote['is_confirmed'] == 1 for quote in detail['quotes'])


def test_ledger_corrects_mileage_text_expression(client):
    listing = seed(client)[0]
    url = f"/api/listings/{listing['id']}"
    saved = client.patch(url,json={'mileage_text':'7万+'}).json()
    assert (saved['mileage'],saved['mileage_text']) == (7,'7万+')
    saved = client.patch(url,json={'mileage_text':'7.3万公里'}).json()
    assert (saved['mileage'],saved['mileage_text']) == (7.3,'7.3万公里')
    saved = client.patch(url,json={'mileage_text':''}).json()
    assert saved['mileage'] is None and saved['mileage_text'] == ''
    assert client.patch(url,json={'mileage_text':'不清楚'}).status_code == 400
    detail = client.get(url).json()
    assert sum(a['action'] == '修正车源信息' for a in detail['audit']) >= 3