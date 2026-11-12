"""Local quote extraction in 万元 / 万公里; approximate mileage is marked 万+."""
from datetime import date
import re
import unicodedata

MODEL_PATTERNS = [
    (r'领克\s*0([1-9])', lambda m: '领克 0' + m[1]),
    (r'科鲁泽', '雪佛兰 科鲁泽'), (r'科鲁兹', '雪佛兰 科鲁兹'),
    (r'缤越', '吉利 缤越'), (r'缤瑞', '吉利 缤瑞'), (r'星瑞', '吉利 星瑞'),
    (r'gs\s*4', '广汽传祺 GS4'), (r'gs\s*8', '广汽传祺 GS8'),
    (r'英朗', '别克 英朗'), (r'威朗', '别克 威朗'), (r'君威', '别克 君威'),
    (r'迈锐宝\s*xl', '雪佛兰 迈锐宝XL'), (r'福克斯', '福特 福克斯'),
    (r'高尔夫', '大众 高尔夫'), (r'朗逸', '大众 朗逸'), (r'速腾', '大众 速腾'),
    (r'思域', '本田 思域'), (r'飞度', '本田 飞度'), (r'卡罗拉', '丰田 卡罗拉'),
    (r'轩逸', '日产 轩逸'), (r'天籁', '日产 天籁'), (r'哈弗\s*h6', '哈弗 H6'),
    (r'瑞虎\s*8\s*plus', '奇瑞 瑞虎8 PLUS'), (r'瑞虎\s*8', '奇瑞 瑞虎8'),
    (r'凌云', '星途 凌云'), (r'艾瑞泽\s*8|艾8', '奇瑞 艾瑞泽8'),
    (r'海豹\s*06', '比亚迪 海豹06'), (r'秦\s*plus', '比亚迪 秦PLUS'),
]
HYPHENS = str.maketrans({'‑':'-', '–':'-', '—':'-', '－':'-'})
NUM = r'\d+(?:\.\d+)?'

APPROX = re.compile(r'多|余|约|左右|上下|出头|不到|大概|大约|将近|接近|快|~|至|到|以上|以下|以内|\+')
ODO_LABEL = r'(?<!质保)(?<!保修)(?<!保养)(?<!续航)(?:公里数|表显里程|行驶里程|里程)'
_UNSUPPORTED_START = r'^[0-9一二三四五六七八九十百千万两多余额约左右上下出头起]'
CN_DIGITS = {'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}


def is_approximate(value):
    return bool(APPROX.search(str(value or '')))


def normalize(text):
    return re.sub(r'[\s_\-]+', '', unicodedata.normalize('NFKC', str(text))).casefold()


def engine_displacement(value):
    """Normalize 1.3T / 1.3TD / 1.3 to 1.3 for comparable grouping."""
    raw = str(value or '').strip()
    match = re.search(r'[0-9]+(?:[.][0-9]+)?', raw)
    if not match:
        return raw
    size = float(match.group(0))
    return f'{size:.1f}' if size > 0 else raw


def clean_text(text):
    text = unicodedata.normalize('NFKC', str(text)).translate(HYPHENS).replace('\r', '')
    return re.sub(r'^[a-zA-Z0-9_.@-]+:\s*\n', '', text).strip()


def find_model(header, aliases):
    key = normalize(header)
    for a in sorted(aliases, key=lambda a: len(normalize(a['raw'])), reverse=True):
        if normalize(a['raw']) and normalize(a['raw']) in key:
            return a['name'], True
    for pattern, name in MODEL_PATTERNS:
        match = re.search(pattern, header, re.I)
        if match:
            return name(match) if callable(name) else name, True
    name = re.sub(r'^(?:车型|车名)\s*[:：]?\s*', '', header)
    name = re.sub(r'(?<!\d)(?:20)?\d{2}\s*[款年]', '', name)
    return name.strip(' ,，:：')[:100] or '待确认车系', False


def field(text, label):
    match = re.search(r'(?:' + label + r')[ \t]*[:：]?[ \t]*([^\n]+)', text, re.I)
    return match[1].strip() if match else ''


def registration(text):
    value = field(text, r'上牌时间|上牌年月|首次登记|上牌')
    if not value:
        match = re.search(r'(?<!\d)((?:20)?\d{2})年上牌', text)
        value = match[1] if match else ''
    match = re.match(r'((?:19|20)\d{2}|\d{2})(?:[年.\-/]\s*(\d{1,2}))?', value)
    if not match:
        return ''
    year = int(match[1])
    if year < 100:
        year += 1900 if year >= 80 else 2000
    if not 1980 <= year <= date.today().year + 1:
        return ''
    if match[2] and 1 <= int(match[2]) <= 12:
        return f'{year}-{int(match[2]):02d}'
    return str(year)


def _short_number(value):
    return f'{value:.2f}'.rstrip('0').rstrip('.')


def price_from(value):
    """Return (万元 value, unit, matched text, note) from a labelled price line."""
    value = str(value or '').strip()
    if not value:
        return None, None, '', ''
    match = re.match(
        r'(' + NUM + r')\s*(万(?:元)?|[wW]|元)?\s*(?:([0-9一二三四五六七八九])(?![0-9.年月日万])\s*千?)?',
        value, re.I)
    if not match:
        return None, None, '', ''
    amount = float(match[1])
    unit = match[2]
    tenth = match[3]
    if unit == '元':
        amount /= 10000
    elif unit and ('万' in unit or unit.lower() == 'w'):
        if tenth:
            digit = CN_DIGITS.get(tenth)
            amount += (digit if digit is not None else int(tenth)) / 10
    elif not unit and amount >= 1000:
        amount /= 10000
    rest = value[match.end():].strip(' 。；;，,()（）')
    note = '价格表达需核验' if re.match(_UNSUPPORTED_START, rest) else ''
    return amount, '万元', match[0].strip(), note


PRICE_TOKEN = re.compile(r'(?<![\d.])([0-9]+(?:\.[0-9]+)?)\s*(万元|万|元|千元|千|[wW])')
MILEAGE_PREFIX = re.compile(r'(?:公里数|表显里程|行驶里程|里程|公里)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(万)?\s*(?:多|余|出头)?')
MILEAGE_TOKEN = re.compile(r'(?<![\d.])([0-9]+(?:\.[0-9]+)?)\s*(万)?\s*(?:([0-9一二三四五六七八九])\s*千)?\s*(?:多|余|出头|左右|上下)?\s*(?:公里|km|KM)')
PRICE_LABEL = re.compile(r'(车价|售价|报价|价格|整车|全款|裸车|到手|落地)')
PAY_CONTEXT = re.compile(r'(首付|月供|分期|定金|订金|贷款|按揭|运费|服务费|手续费|上牌费|保险)')
TIRE_CONTEXT = re.compile(r'(质保|保修|保养|续航|三电|电池|发变|延保|电保)')
AFTER_QUANTITY = re.compile(r'^\s*(?:年|个月|月|天|次|台|辆|位|名)')
UNIT_FACTOR = {'万元': 1.0, '万': 1.0, 'w': 1.0, 'W': 1.0, '元': 0.0001, '千元': 0.1, '千': 0.1}
# “安阳 7.18 发变质保…”：地名后面跟一个不带单位的两位小数，按万元理解
PLACE_PRICE = re.compile(r'[\u4e00-\u9fa5]{2,4}\s*[，,]?\s*(?<![\d.])(\d{1,2}\.\d{1,2})(?![\d.\s]*(?:万|公里|km|T|L|年|月|次))')


def find_price(text):
    """整段消息里找整车报价：支持句中的“泉州 4.6万”“成都 52500元”。"""
    ranked = []
    for match in PRICE_TOKEN.finditer(text):
        before = text[max(0, match.start() - 12):match.start()]
        after = text[match.end():match.end() + 6]
        unit = match.group(2)
        if AFTER_QUANTITY.match(after):
            continue
        if re.search(r'(?:公里数|里程|表显|公里)[ \t]*$', before):
            continue
        if re.match(r'^\s*万?\s*(?:多|余)?\s*(?:公里|km|里)', after, re.I):
            continue
        if PAY_CONTEXT.search(before) or re.match(r'^\s*[（(【\[]?\s*(?:首付|月供|分期|订金|定金)', after):
            continue
        value = float(match.group(1)) * UNIT_FACTOR.get(unit, 1.0)
        if not 0.3 <= value <= 1000:
            continue
        score = 0
        if PRICE_LABEL.search(before):
            score += 5
        if unit in ('万', '万元', 'w', 'W'):
            score += 2
        score += 2 if re.match(r'^\s*(?:带|包|，|,|。|；|;|\s|$)', after) else 0
        ranked.append((score, -match.start(), round(value, 4), match.group(0).strip()))
    if not ranked:
        return None, '', False
    ranked.sort(reverse=True)
    score, _, value, raw = ranked[0]
    return value, raw, score >= 4


def find_mileage(text):
    """整段消息里找表显里程：支持“实表4.9万公里 门槛钣金”与“公里6万”两种写法。"""
    best = None
    for match in MILEAGE_PREFIX.finditer(text):
        if TIRE_CONTEXT.search(text[max(0, match.start() - 8):match.start()]):
            continue
        number = float(match.group(1))
        value = number if match.group(2) else number / 10000
        if not 0.01 <= value <= 100:
            continue
        candidate = (3, -match.start(), value, match.group(0), text[max(0, match.start() - 6):match.start()], text[match.end():match.end() + 6])
        if best is None or candidate[:2] > best[:2]:
            best = candidate
    for match in MILEAGE_TOKEN.finditer(text):
        before = text[max(0, match.start() - 12):match.start()]
        if TIRE_CONTEXT.search(before):
            continue
        number = float(match.group(1))
        has_wan = bool(match.group(2))
        tenth = match.group(3)
        value = number if has_wan else number / 10000
        if tenth:
            digit = CN_DIGITS.get(tenth)
            value += (digit if digit is not None else int(tenth)) / 10
        if not 0.01 <= value <= 100:
            continue
        score = 0
        if re.search(r'(里程|公里数|表显|行驶|实表)', before):
            score += 3
        if has_wan:
            score += 1
        candidate = (score, -match.start(), value, match.group(0), before, text[match.end():match.end() + 6])
        if best is None or candidate[:2] > best[:2]:
            best = candidate
    if best is None:
        return None, '', False
    _, _, value, raw, before, after = best
    context = before + raw + after
    approximate = bool(re.search(r'多|余|约|左右|不到|以上|以下|\+', context))
    if not approximate:
        return round(value, 4), raw, False
    base = _short_number(value)
    if re.search(r'多|余|\+', context):
        display = base + '万+'
    elif re.search(r'不到|以下|以内', context):
        display = base + '万-'
    else:
        display = base + '万左右'
    return round(value, 4), display, True


TRIM_NOISE = re.compile(r'(手动挡|自动挡|自动|手动|改款|全新|准新车|款)')
TRIM_STOP = re.compile(r'公里|过户|车况|原版|喷漆|钣金|一手|实表|出险|三方能过|费用|发变|[，,。；;（(]')
TRIM_LATIN = [('halo', 'Halo'), ('pro', 'Pro'), ('max', 'Max'), ('plus', 'Plus'), ('stline', 'ST Line')]


def compose_display_name(model_name, model_year, engine, trim):
    """统一展示名：品牌车系 + 款年 + 排量 + 配置（纯电无排量就跳过）。"""
    brand, _, series = str(model_name or '').partition(' ')
    series_plain = series.replace(' ', '')
    head = series if series_plain and series_plain.lower().startswith(brand.lower()) else (brand + series_plain)
    parts = [head or str(model_name or '')]
    if model_year:
        parts.append(f'{model_year}款')
    if str(engine or '').strip():
        parts.append(str(engine).strip())
    if str(trim or '').strip():
        parts.append(str(trim).strip())
    return re.sub(r'\s+', ' ', ' '.join(p for p in parts if p)).strip()


def normalize_trim(value):
    """统一配置写法：劲冠军 / 劲冠军版 / 劲 冠军版 → 劲 冠军版；劲Pro版 → 劲Pro。"""
    text = re.sub(r'\s+', ' ', str(value or '').strip())
    if not text:
        return ''
    text = text.replace('➕', '+').replace('＋', '+')
    text = re.sub(r'(冠军)(?!版)', r'\1版', text)
    text = re.sub(r'([A-Za-z])\s*版$', r'\1', text)
    text = re.sub(r'(?<=[\u4e00-\u9fa5])\s*(?=[A-Za-z])', '', text)
    text = re.sub(r'(劲|型|耀|领)(冠军版|尊贵版|豪华版|精英版|运动版)', r'\1 \2', text)
    return text.strip()


def find_trim(text, name):
    """从消息里取配置/版本（如“四驱劲halo”“耀pro带包”“劲 冠军版”）。"""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines[:4]:
        marked = re.search(r'款|(?<![\d.])[1-6]\.\d\s*(?:TD|TGDI|GTDI|GDIT|GDI|T|L)', line, re.I)
        if not marked:
            continue
        line = re.sub(r'【[^】]*】', ' ', line)
        line = re.sub(r'(?:车型|车名|标题|品牌车型|车辆名称)\s*[:：]?', ' ', line)
        core = re.sub(r'(?:19|20)\d{2}\s*款?|(?<!\d)\d{2}\s*[年款]', ' ', line)
        core = re.sub(r'\d{1,2}\s*月', ' ', core)
        core = re.sub(r'领克\s*0[1-9]', ' ', core, flags=re.I)
        for token in re.split(r'\s+', name or ''):
            if len(token) >= 2:
                core = re.sub(re.escape(token), ' ', core, flags=re.I)
        core = re.sub(r'(?<![\d.])([1-6]\.\d)\s*(TD|TGDI|GTDI|GDIT|GDI|T|L)?', ' ', core, flags=re.I)
        core = TRIM_NOISE.sub(' ', core)
        core = TRIM_STOP.split(core)[0]
        core = re.sub(r'[（）()·\s]+', ' ', core).strip(' -,，.。;；:：')
        has_engine = bool(re.search(r'(?<![\d.])[1-6]\.\d\s*(?:TD|TGDI|GTDI|GDIT|GDI|T|L)', line, re.I))
        if core in ('型', '版', '款', '系'):
            # “1.5型”这类写法里的“型”是型号后缀，不是配置名
            continue
        if (len(core) >= 2 or (len(core) == 1 and has_engine)) and not re.search(r'款|年|领克|^(?:19|20)\d{2}', core):
            for a, b in TRIM_LATIN:
                core = re.sub(a, b, core, flags=re.I)
            return normalize_trim(core[:24])
    return ''


PLACE_BEFORE = re.compile(r'([\u4e00-\u9fa5]{2,4})\s*[，,]?\s*$')
CITY_LEXICON = '''合肥,芜湖,蚌埠,安庆,阜阳,六安,温州,杭州,宁波,嘉兴,湖州,绍兴,金华,义乌,台州,丽水,衢州,舟山,徐州,南京,苏州,无锡,常州,南通,扬州,盐城,连云港,淮安,泰州,宿迁,镇江,上海,北京,天津,重庆,广州,深圳,佛山,东莞,中山,珠海,惠州,汕头,江门,湛江,肇庆,清远,揭阳,福州,厦门,泉州,漳州,莆田,龙岩,三明,南平,宁德,南昌,赣州,九江,上饶,宜春,吉安,抚州,景德镇,济南,青岛,烟台,潍坊,临沂,淄博,济宁,泰安,威海,日照,德州,聊城,菏泽,枣庄,郑州,洛阳,商丘,南阳,新乡,开封,许昌,平顶山,安阳,焦作,信阳,周口,驻马店,三门峡,武汉,宜昌,襄阳,荆州,黄石,十堰,孝感,黄冈,长沙,株洲,湘潭,衡阳,岳阳,常德,郴州,邵阳,益阳,永州,怀化,娄底,成都,绵阳,德阳,南充,宜宾,泸州,自贡,乐山,达州,遂宁,内江,贵阳,遵义,六盘水,昆明,曲靖,玉溪,大理,南宁,柳州,桂林,北海,海口,三亚,太原,大同,临汾,运城,长治,石家庄,唐山,保定,邯郸,廊坊,沧州,邢台,秦皇岛,张家口,承德,衡水,沈阳,大连,鞍山,锦州,营口,盘锦,丹东,长春,吉林,四平,哈尔滨,大庆,齐齐哈尔,牡丹江,呼和浩特,包头,鄂尔多斯,银川,兰州,天水,西宁,乌鲁木齐,拉萨'''.split(',')
PLACE_BAD = r'漆|色|况|版|新|旧|原|手|保|费|元|万|公里|险|车|价|发变'


def find_region(text, price_text):
    """地区：先认显式标签，再从价格前面的地名补（“成都，52500元”“泉州 4.6万”）。"""
    value = field(text, r'所在地|位置|地点|车在')
    if value:
        value = re.split(r'[，,。；;\s]', value)[0]
        if 2 <= len(value) <= 6 and not re.search(r'[0-9元万公里险漆色况版费保年月]', value):
            return value
    for city in sorted(CITY_LEXICON, key=len, reverse=True):
        if city and city in text:
            return city
    if not price_text:
        return ''
    position = text.find(price_text)
    if position <= 0:
        return ''
    match = PLACE_BEFORE.search(text[max(0, position - 12):position])
    if match:
        place = match[1]
        if 2 <= len(place) <= 6 and not re.search(PLACE_BAD, place):
            return place
    # 地名也可能写在价格后面：“4.9万，徐州”“48500元，… 温州”
    tail = text[position + len(price_text):position + len(price_text) + 40]
    for token in re.split(r'[，,。；;\s]+', tail):
        token = token.strip()
        if 2 <= len(token) <= 6 and not re.search(PLACE_BAD, token):
            return token
    return ''


def parse_mileage(value):
    """Parse mileage into 万公里. Returns (value, display text, approximate, valid)."""
    raw = str(value or '').strip().strip('。；;，, ').strip()
    if not raw:
        return None, '', False, True
    match = re.search(
        r'(' + NUM + r')\s*(万(?:公里)?|公里|km)?\s*(?:([0-9一二三四五六七八九])(?![0-9.年月日万])\s*千?)?',
        raw, re.I)
    if not match:
        return None, raw, False, False
    amount = float(match[1])
    unit = (match[2] or '').lower()
    tenth = match[3]
    if '万' in unit:
        if tenth:
            digit = CN_DIGITS.get(tenth)
            amount += (digit if digit is not None else int(tenth)) / 10
    elif unit:
        amount /= 10000
    elif amount >= 1000:
        amount /= 10000
    approximate = is_approximate(raw)
    if not approximate:
        return amount, raw, False, True
    base = _short_number(amount)
    if re.search(r'多|余|出头|以上|\+', raw):
        display = base + '万+'
    elif re.search(r'不到|以下|以内', raw):
        display = base + '万-'
    else:
        display = base + '万左右'
    return amount, display, True, True


def mileage_from(text):
    value = field(text, ODO_LABEL)
    if not value:
        bare_mileage = re.compile(
            NUM + r'\s*(?:万多|万余)\s*[。]?|'
            + NUM + r'\s*(?:万多|万余|万)?\s*(?:公里|km)\s*[。]?|'
            + NUM + r'\s*万\s*\+\s*[。]?', re.I)
        value = next((line.strip().rstrip('。') for line in text.splitlines()
                      if bare_mileage.fullmatch(line.strip())), '')
    mileage, display, approximate, _ = parse_mileage(value)
    return mileage, '万公里', display, approximate


def extract_one(text, aliases):
    if re.search(r'求购|收购|已售|已出|已卖', text):
        return None
    header = field(text, r'车型|车名') or next(iter(text.splitlines()), '')
    name, known = find_model(header, aliases)
    if not known and not re.search(r'车型|车名|价格|车价|售价|报价|首付|月供', text):
        value, unit, raw, approx = mileage_from(text)
        if raw:
            return dict(kind='supplement', name='', price=None, price_unit=None, mileage=value,
                        mileage_unit=unit, mileage_text=raw, issues=['补充里程归属待确认'], raw=text)
        return None
    issues = [] if known else ['车系名称待确认']
    model_year = re.search(r'(?<!\d)((?:19|20)\d{2}|\d{2})\s*款', text)
    if not model_year:
        head_line = text.splitlines()[0] if text.splitlines() else ''
        if '上牌' not in head_line:
            model_year = re.match(r'\s*((?:19|20)\d{2}|\d{2})\s*年', head_line)
    model_year = int(model_year[1]) if model_year else None
    if model_year and model_year < 100:
        model_year += 1900 if model_year >= 80 else 2000
    engine_header = re.sub(r'领克\s*0[1-9]', ' ', header, flags=re.I)
    engine = re.search(r'(?<!\d)([1-6]\.\d)\s*(TD|TGDI|GTDI|GDIT|GDI|T|L)?', engine_header, re.I)
    if not engine:
        # 标题行常只有“20年2月领克01”，排量写在下一行；正文只认带 T/L 的写法，避免把“4.9万公里”当排量
        body = '\n'.join(text.splitlines()[1:4])
        body = re.sub(r'领克\s*0[1-9]', ' ', body, flags=re.I)
        engine = re.search(r'(?<!\d)([1-6]\.\d)\s*(TD|TGDI|GTDI|GDIT|GDI|T|L)', body, re.I)
    if engine:
        mark = (engine[2] or '').upper()
        engine = engine[1] + ('' if mark in ('', 'L') else 'T')
    else:
        engine = ''
    price = None
    price_unit = None
    price_text = ''
    price_note = ''
    price_lines = '\n'.join(line for line in text.splitlines()
                             if not (re.search(r'首付|月供|订金|定金|分期', line) and re.search(r'车价|售价|报价|价格|万|元', line)))
    price_field = field(price_lines, r'整车价|车价|售价|报价|价格')
    if price_field:
        price, price_unit, price_text, price_note = price_from(price_field)
    elif not re.search(r'首付|月供|订金|定金', text):
        bare = [re.fullmatch(r'(' + NUM + r')\s*(万|万元|[wW]|元)', line.strip()) for line in text.splitlines()]
        bare = [x for x in bare if x]
        if len(bare) == 1:
            price, price_unit, price_text, price_note = price_from(bare[0][0])
            if price is not None:
                issues.append('整车报价标签缺失')
    if price is None:
        place = PLACE_PRICE.search(text)
        if place and 1 <= float(place.group(1)) <= 200:
            price, price_unit, price_text = float(place.group(1)), '万元', place.group(0).strip()
            issues.append('价格缺单位，按万元理解')
    if price is None:
        inline, inline_text, inline_labeled = find_price(text)
        if inline is not None:
            price, price_unit, price_text = inline, '万元', inline_text
            if not inline_labeled:
                issues.append('整车报价标签缺失')
    if price_note:
        issues.append(price_note)
    if price is None or price <= 0:
        issues.append('缺少可信整车报价')
        price = None
        price_unit = None
    mileage, mileage_unit, mileage_text, approximate = mileage_from(text)
    if mileage is None:
        inline_mileage, inline_text, inline_approx = find_mileage(text)
        if inline_mileage is not None:
            mileage, mileage_unit, mileage_text, approximate = inline_mileage, '万公里', inline_text, inline_approx
    year = registration(text)
    if not year:
        issues.append('上牌时间缺失')
    condition = field(text, r'车况')
    if not condition:
        condition = '；'.join(line.strip() for line in text.splitlines()
                            if re.search(r'钣金|喷漆|铁件|更换|过户', line) and not re.search(r'价格|车价|车型', line))
    if not condition:
        issues.append('车况信息待补充')
    if not model_year or not engine:
        issues.append('款年或动力待补充')
    trim = find_trim(text, name)
    return dict(kind='listing', name=name, model_year=model_year, engine=engine, trim=trim,
                year=year, price=price, price_unit=price_unit, price_text=price_text,
                mileage=mileage, mileage_unit=mileage_unit, mileage_text=mileage_text,
                region=find_region(text, price_text), condition=condition,
                issues=issues, raw=text)


def extract_candidates(text, aliases=None):
    text = clean_text(text)
    if not text or text.startswith(('http://', 'https://', '<')):
        return []
    parts = [p.strip() for p in re.split(r'(?m)(?=^\s*车型\s*[:：])', text) if p.strip()]
    return [candidate for part in parts if (candidate := extract_one(part, aliases or []))]