import io
import stat
import json
import zipfile
from pathlib import Path

import pytest
from PIL import Image
from backend.db import init_db, connect


def sample(owner='account-a', missing=False):
    image = io.BytesIO()
    Image.new('RGB', (20, 16), '#dddddd').save(image, format='JPEG')
    data = {'session': {'wxid':'group-a', 'ownerId':owner, 'platform':'wechat', 'displayName':'测试群'},
            'messages': [
                {'platformMessageId':'9223372036854775808','localType':1,'createTime':1793588400,
                 'senderUsername':'seller-a','content':'车型：2020款科鲁泽1.3T\n上牌：2020年\n里程：6万公里\n价格：2.5万\n车况：原版'},
                {'platformMessageId':'9223372036854775809','localType':3,'createTime':1793588401,
                 'senderUsername':'seller-a','content':'[图片]','mediaFile':'media/a.jpg'},
                {'platformMessageId':'9223372036854775810','localType':1,'createTime':1793588402,
                 'senderUsername':'seller-a','content':'6万多公里'}]}
    files = {'root/chat.json':json.dumps(data,ensure_ascii=False).encode('utf-8')}
    if not missing:
        files['root/media/a.jpg'] = image.getvalue()
    return files


def upload(data_dir, files, namespace=''):
    from backend.importer import create_upload, append_upload, finish_upload
    batch = create_upload(data_dir, {'name':'test', 'namespace':namespace,
                          'files':[{'path':p,'size':len(b)} for p,b in files.items()]})
    for f in batch['files']:
        append_upload(data_dir,batch['id'],f['id'],0,files[f['path']])
    finish_upload(data_dir,batch['id'])
    return batch['id']


def imported(data_dir, files, namespace=''):
    from backend.importer import run_batch
    init_db(data_dir)
    return run_batch(data_dir,upload(data_dir,files,namespace))


def counts(data_dir):
    with connect(data_dir) as db:
        return {t:db.execute(f'SELECT count(*) FROM {t}').fetchone()[0]
                for t in ['messages','listings','media','quotes','candidates']}


def test_folder_import_and_repeat_preserve_long_ids_and_context(tmp_path):
    batch = imported(tmp_path,sample())
    assert batch['status'] == 'done'
    assert counts(tmp_path) == {'messages':3,'listings':1,'media':1,'quotes':1,'candidates':2}
    with connect(tmp_path) as db:
        assert db.execute('SELECT platform_id FROM messages ORDER BY id').fetchone()[0] == '9223372036854775808'
        assert db.execute('SELECT status FROM listing_images').fetchone()[0] == 'pending'
        assert db.execute('SELECT status FROM listings').fetchone()[0] == 'confirmed'
        assert db.execute('SELECT is_confirmed FROM quotes').fetchone()[0] == 1
        row = db.execute("SELECT state,listing_id FROM candidates WHERE kind='supplement'").fetchone()
        assert row['state'] == 'ignored' and row['listing_id'] is None
    duplicate = imported(tmp_path,sample())
    assert duplicate['stats']['duplicates'] == 3
    assert counts(tmp_path)['listings'] == 1


def _single_message(files, *, platform_id, shift=0, content=None):
    doc = json.loads(files['root/chat.json'])
    message = doc['messages'][0]
    message['platformMessageId'] = platform_id
    message['createTime'] += shift
    if content is not None:
        message['content'] = content
    doc['messages'] = [message]
    files['root/chat.json'] = json.dumps(doc, ensure_ascii=False).encode()
    return files


def test_duplicate_text_with_new_id_at_same_time_is_ignored(tmp_path):
    imported(tmp_path, sample())
    files = _single_message(sample(), platform_id='different-id-same-time')
    result = imported(tmp_path, files)
    assert result['status'] == 'done'
    assert result['stats']['messages'] == 0 and result['stats']['duplicates'] == 1
    assert counts(tmp_path) == {'messages': 3, 'listings': 1, 'media': 1, 'quotes': 1, 'candidates': 2}


def test_reposted_vehicle_with_new_id_and_time_is_ignored(tmp_path):
    imported(tmp_path, sample())
    files = _single_message(sample(), platform_id='different-id-later', shift=3600,
                            content=sample_text_with_note())
    result = imported(tmp_path, files)
    assert result['status'] == 'done'
    assert result['stats']['messages'] == 1 and result['stats']['duplicates'] == 1
    assert counts(tmp_path) == {'messages': 4, 'listings': 1, 'media': 1, 'quotes': 1, 'candidates': 3}
    with connect(tmp_path) as db:
        row = db.execute('SELECT state,listing_id FROM candidates ORDER BY id DESC LIMIT 1').fetchone()
        assert row['state'] == 'ignored'
        assert row['listing_id'] == db.execute('SELECT id FROM listings').fetchone()[0]


def test_reposted_vehicle_with_changed_price_creates_new_listing(tmp_path):
    imported(tmp_path, sample())
    files = _single_message(sample(), platform_id='different-id-new-price', shift=3600,
                            content=sample_text_with_note().replace('2.5万', '2.4万'))
    result = imported(tmp_path, files)
    assert result['status'] == 'done'
    assert result['stats']['duplicates'] == 0
    assert counts(tmp_path)['listings'] == 2


def sample_text_with_note():
    return chr(10).join(['车型：2020款科鲁泽1.3T','上牌：2020年','里程：6万公里','价格：2.5万','车况：原版，支持第三方检测'])


def test_zip_and_directory_results_are_equivalent(tmp_path):
    folder, zipped = tmp_path/'folder',tmp_path/'zipped'
    imported(folder,sample())
    archive = io.BytesIO()
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for path,value in sample().items(): z.writestr(path,value)
    batch = imported(zipped,{'export.zip':archive.getvalue()})
    assert batch['status'] == 'done'
    assert counts(folder) == counts(zipped)


def test_cross_account_ids_do_not_collide(tmp_path):
    imported(tmp_path,sample())
    imported(tmp_path,sample(owner='account-b'))
    assert counts(tmp_path)['messages'] == 6
    assert counts(tmp_path)['listings'] == 2
    assert counts(tmp_path)['media'] == 1


def test_namespace_is_required_if_export_lacks_account(tmp_path):
    files = sample(owner='')
    result = imported(tmp_path,files)
    assert result['status'] == 'error'
    assert '命名空间' in result['error']
    result = imported(tmp_path,files,'my-wechat')
    assert result['status'] == 'done'


def test_missing_image_is_counted_without_losing_quote(tmp_path):
    result = imported(tmp_path,sample(missing=True))
    assert result['status'] == 'done'
    assert result['stats']['missing'] == 1
    assert result['warnings']
    assert counts(tmp_path)['listings'] == 1


def test_upload_offsets_survive_reopen_and_reject_mismatch(tmp_path):
    from backend.importer import create_upload, append_upload, get_batch, finish_upload, ImportProblem
    init_db(tmp_path)
    body = sample()['root/chat.json']
    batch = create_upload(tmp_path,{'name':'resume','files':[{'path':'chat.json','size':len(body)}]})
    file = batch['files'][0]
    append_upload(tmp_path,batch['id'],file['id'],0,body[:100])
    init_db(tmp_path)
    assert get_batch(tmp_path,batch['id'])['files'][0]['received'] == 100
    with pytest.raises(ImportProblem): append_upload(tmp_path,batch['id'],file['id'],0,body[100:])
    with pytest.raises(ImportProblem): finish_upload(tmp_path,batch['id'])
    append_upload(tmp_path,batch['id'],file['id'],100,body[100:])
    assert finish_upload(tmp_path,batch['id'])['status'] == 'queued'


@pytest.mark.parametrize('path',['../escape.json','C:/bad.json','/absolute.json','a/../../bad','a\\..\\bad'])
def test_upload_rejects_paths_outside_batch(tmp_path,path):
    from backend.importer import create_upload, ImportProblem
    init_db(tmp_path)
    with pytest.raises(ImportProblem): create_upload(tmp_path,{'files':[{'path':path,'size':1}]})


def test_zip_rejects_traversal_before_processing(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf,'w') as z:
        z.writestr('../outside.json','{}')
        for name,body in sample().items(): z.writestr(name,body)
    batch = imported(tmp_path,{'bad.zip':buf.getvalue()})
    assert batch['status'] == 'error'
    assert counts(tmp_path)['messages'] == 0
    assert not (tmp_path/'outside.json').exists()


@pytest.mark.parametrize('case',['nested','encrypted','symlink','ratio'])
def test_zip_rejects_unsafe_members(tmp_path,case):
    buf = io.BytesIO()
    files = sample()
    if case == 'ratio':
        files['root/media/big.jpg'] = bytes(1024 * 1024)
    compression = zipfile.ZIP_DEFLATED if case == 'ratio' else zipfile.ZIP_STORED
    with zipfile.ZipFile(buf,'w',compression) as z:
        for name,body in files.items(): z.writestr(name,body)
        if case == 'nested':
            z.writestr('root/media/inner.zip',b'PK')
        elif case == 'encrypted':
            z.writestr('root/media/secret.jpg',b'secret')
        elif case == 'symlink':
            info = zipfile.ZipInfo('root/media/link.jpg'); info.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(info,b'target')
    if case == 'encrypted':
        raw = bytearray(buf.getvalue()); raw[6] |= 1
        central = raw.find(b'PK'); raw[central + 8] |= 1
        buf = io.BytesIO(raw)
    batch = imported(tmp_path/'case',{'bad.zip':buf.getvalue()})
    assert batch['status'] == 'error'
    assert counts(tmp_path/'case')['messages'] == 0


def test_replaying_interrupted_batch_is_idempotent(tmp_path):
    from backend.importer import run_batch, retry_batch
    result = imported(tmp_path,sample())
    before = counts(tmp_path)
    with connect(tmp_path) as db: db.execute("UPDATE batches SET status='error' WHERE id=?",(result['id'],))
    retry_batch(tmp_path,result['id'])
    assert run_batch(tmp_path,result['id'])['status'] == 'done'
    assert counts(tmp_path) == before


def test_corrupt_json_has_actionable_error(tmp_path):
    result = imported(tmp_path,{'chat.json':b'{bad'})
    assert result['status'] == 'error'
    assert 'JSON' in result['error']


def test_context_image_lookup_uses_bounded_time_index(tmp_path):
    from backend.db import init_db, connect
    from backend.importer import CONTEXT_QUERY
    init_db(tmp_path)
    with connect(tmp_path) as db:
        plan = ' '.join(str(row['detail']) for row in db.execute('EXPLAIN QUERY PLAN ' + CONTEXT_QUERY, (None,) * CONTEXT_QUERY.count('?')))
    assert 'messages_context' in plan and 'created_at>?' in plan and 'created_at<?' in plan

def test_reimport_backfills_records_removed_from_ledger(tmp_path):
    imported(tmp_path,sample())
    with connect(tmp_path) as db:
        db.execute('DELETE FROM listing_images')
        db.execute('DELETE FROM quotes')
        db.execute('DELETE FROM candidates')
        db.execute('DELETE FROM listings')
        db.execute('DELETE FROM models')
    result = imported(tmp_path,sample())
    assert result['status'] == 'done'
    assert result['stats']['duplicates'] == 3
    assert result['stats']['candidates'] == 2
    assert counts(tmp_path) == {'messages':3,'listings':1,'media':1,'quotes':1,'candidates':2}
    with connect(tmp_path) as db:
        assert db.execute('SELECT status FROM listings').fetchone()[0] == 'confirmed'
        states = {r['kind']:r['state'] for r in db.execute('SELECT kind,state FROM candidates')}
    assert states == {'listing':'confirmed','supplement':'ignored'}
