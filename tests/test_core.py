import sqlite3
from pathlib import Path
import pytest


def extract(text, aliases=None):
    from backend.extract import extract_candidates
    return extract_candidates(text, aliases or [])


def test_database_is_persistent_and_separates_entities(tmp_path):
    from backend.db import init_db, connect
    init_db(tmp_path)
    with connect(tmp_path) as db:
        tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
        assert {'messages', 'listings', 'models', 'quotes', 'media', 'candidates', 'batches', 'upload_files'} <= tables
        db.execute("insert into settings(key,value) values('test','saved')")
    init_db(tmp_path)
    with connect(tmp_path) as db:
        assert db.execute("select value from settings where key='test'").fetchone()[0] == 'saved'


def test_omitted_units_default_to_wan_and_wan_km():
    c = extract('车型：19款领克022.0耀pro\n上牌时间：19.4\n公里数：9.6\n车价:3.65')[0]
    assert c['name'] == '领克 02'
    assert c['model_year'] == 2019
    assert c['engine'] == '2.0'
    assert c['price'] == 3.65 and c['price_unit'] == '万元'
    assert c['mileage'] == 9.6 and c['mileage_unit'] == '万公里'
    assert c['year'] == '2019-04'
    assert not {'价格单位待确认','里程单位待确认'} & set(c['issues'])


def test_explicit_money_does_not_consume_warranty_mileage():
    c = extract('2019款科鲁泽RS 1.3T 畅快\n上牌：2020年\n里程：7万多公里\n价格：2.45万带一年三万公里发变质保')[0]
    assert c['name'] == '雪佛兰 科鲁泽'
    assert c['price'] == 2.45 and c['price_unit'] == '万元'
    assert c['mileage'] == 7 and c['mileage_unit'] == '万公里'
    assert c['mileage_text'] == '7万+'
    assert c['year'] == '2020'
    assert '里程为近似表达' not in c['issues']


def test_yuan_and_km_are_normalized_to_wan_units():
    c = extract('车型：2021款吉利缤越1.4T\n价格：36500元\n里程：96000公里')[0]
    assert c['price'] == 3.65 and c['price_unit'] == '万元'
    assert c['mileage'] == 9.6 and c['mileage_unit'] == '万公里'


def test_bare_yuan_amounts_are_normalized_to_wan():
    c = extract('车型：2021款吉利缤越1.4T\n价格：36500\n里程：96000')[0]
    assert c['price'] == 3.65 and c['price_unit'] == '万元'
    assert c['mileage'] == 9.6 and c['mileage_unit'] == '万公里'


def test_warranty_only_is_not_vehicle_mileage():
    c = extract('2020款科鲁泽1.0T\n价格2.2万带一年三万公里质保')[0]
    assert c['mileage'] is None
    assert c['mileage_text'] == ''
    assert '里程缺失' not in c['issues']


def test_supplement_is_not_assigned_to_previous_vehicle():
    c = extract('6万多公里')[0]
    assert c['kind'] == 'supplement'
    assert c['mileage'] == 6 and c['mileage_unit'] == '万公里'
    assert c['mileage_text'] == '6万+'


def test_demand_deposit_monthly_and_sold_not_normal_quotes():
    assert extract('求购2020款科鲁泽，预算3万') == []
    assert extract('已售 2020款科鲁泽 售价3万') == []
    c = extract('2020款科鲁泽 首付0.3万 月供1500元')[0]
    assert c['price'] is None
    assert '缺少可信整车报价' in c['issues']


def test_confirmed_alias_matches_before_seed_dictionary():
    c = extract('车型：小蓝02冠军\n价格：3万', [{'raw':'小蓝02冠军','name':'领克 02'}])[0]
    assert c['name'] == '领克 02'


def test_multiple_cars_are_separate_candidates():
    cs = extract('车型：2020款科鲁泽1.3T\n价格：2.5万\n车型：2021款领克031.5T\n价格：4万')
    assert len(cs) == 2
    assert [c['price'] for c in cs] == [2.5,4]
    assert cs[1]['name'] == '领克 03'


def test_bare_price_and_header_prefix_are_retained_for_review():
    c = extract('sender_name:\n21年领克01\n21款暗夜\n7万多公里\n发变质保一年三万公里\n6.7万')[0]
    assert c['name'] == '领克 01'
    assert c['model_year'] == 2021
    assert c['price'] == 6.7 and c['price_unit'] == '万元'
    assert '整车报价标签缺失' in c['issues']


def test_registration_written_before_the_word_shangpai():
    c = extract('2020款科鲁泽1.0T\n20年上牌\n铁件原版\n车在湖南\n价格2.2万')[0]
    assert c['year'] == '2020'


def test_deposit_price_label_is_never_a_confirmed_whole_price():
    c = extract('2020款科鲁泽1.3T\n上牌2020年\n里程6万公里\n车况原版\n首付价格：0.3万')[0]
    assert c['price'] is None
    assert '缺少可信整车报价' in c['issues']


def test_unknown_model_is_not_silently_assumed_known():
    c = extract('车型：2020款新品牌未知款\n价格：4万')[0]
    assert c['name']
    assert '车系名称待确认' in c['issues']


def test_warranty_mileage_label_is_never_odometer():
    c = extract('2020款科鲁泽1.3T\n上牌2020年\n价格2.5万\n车况原版\n质保里程：3万公里')[0]
    assert c['mileage'] is None
    assert c['mileage_text'] == ''
    assert '里程缺失' not in c['issues']


@pytest.mark.parametrize('tail,display', [('6万出头公里','6万+'),('6万公里左右','6万左右')])
def test_approximate_phrase_is_filled_with_a_visible_marker(tail,display):
    c = extract('2020款科鲁泽1.3T\n上牌2020年\n价格2.5万\n车况原版\n里程：' + tail)[0]
    assert c['mileage'] == 6 and c['mileage_unit'] == '万公里'
    assert c['mileage_text'] == display
    assert '里程为近似表达' not in c['issues']


def test_wan_and_thousand_mileage_is_filled_directly():
    c = extract('2020款科鲁泽1.3T\n上牌2020年\n价格2.5万\n车况原版\n里程：6万5千公里')[0]
    assert c['mileage'] == 6.5 and c['mileage_unit'] == '万公里'
    assert c['mileage_text'] == '6万5千公里'
    assert '里程表达需核验' not in c['issues']


def test_finance_price_after_amount_is_not_a_whole_car_price():
    c = extract('2020款科鲁泽1.3T\n上牌2020年\n里程6万公里\n车况原版\n价格：0.3万（首付）')[0]
    assert c['price'] is None
    assert '缺少可信整车报价' in c['issues']


def test_sold_notice_anywhere_excludes_the_message():
    padding = '车况原版，支持检测，手续齐全，可过户，价格可谈，' * 8
    assert extract(f'2020款科鲁泽1.3T\n上牌2020年\n里程6万公里\n价格2.5万\n{padding}已售') == []


def test_colloquial_price_is_filled_in_wan():
    c = extract('2020款科鲁泽1.3T\n上牌2020年\n里程6万公里\n车况原版\n价格：2万五')[0]
    assert c['price'] == 2.5 and c['price_unit'] == '万元'
    assert c['price_text'] == '2万五'
    assert '价格表达需核验' not in c['issues']
    ok = extract('2020款科鲁泽1.3T\n上牌2020年\n里程6万公里\n车况原版\n价格：2万包过户')[0]
    assert ok['price'] == 2 and ok['price_unit'] == '万元'