"""SQLite storage. Each operation owns and closes its connection."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS models(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,followed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS aliases(id INTEGER PRIMARY KEY,model_id INTEGER NOT NULL REFERENCES models(id),raw TEXT NOT NULL,norm TEXT NOT NULL,scope TEXT NOT NULL DEFAULT '*',UNIQUE(scope,norm));
CREATE TABLE IF NOT EXISTS unit_rules(scope TEXT PRIMARY KEY,price_unit TEXT,mileage_unit TEXT);
CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'uploading',namespace TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,processed INTEGER NOT NULL DEFAULT 0,total_messages INTEGER NOT NULL DEFAULT 0,stats TEXT NOT NULL DEFAULT '{}',warnings TEXT NOT NULL DEFAULT '[]',error TEXT);
CREATE TABLE IF NOT EXISTS upload_files(id INTEGER PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES batches(id),path TEXT NOT NULL,size INTEGER NOT NULL,received INTEGER NOT NULL DEFAULT 0,UNIQUE(batch_id,path));
CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,ext TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,width INTEGER,height INTEGER);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,namespace TEXT NOT NULL,session TEXT NOT NULL,platform_id TEXT NOT NULL,created_at INTEGER NOT NULL,sender TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,text TEXT NOT NULL,raw_json TEXT NOT NULL,media_id TEXT REFERENCES media(id),source TEXT NOT NULL,batch_id TEXT NOT NULL REFERENCES batches(id),UNIQUE(namespace,session,platform_id));
CREATE TABLE IF NOT EXISTS listings(id INTEGER PRIMARY KEY,model_id INTEGER NOT NULL REFERENCES models(id),display_name TEXT NOT NULL DEFAULT '',trim TEXT NOT NULL DEFAULT '',model_year INTEGER,engine TEXT NOT NULL DEFAULT '',year TEXT NOT NULL DEFAULT '',price REAL,mileage REAL,price_text TEXT NOT NULL DEFAULT '',mileage_text TEXT NOT NULL DEFAULT '',region TEXT NOT NULL DEFAULT '',condition TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',sale_state TEXT NOT NULL DEFAULT 'unknown',favorite INTEGER NOT NULL DEFAULT 0,in_compare INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',posted INTEGER NOT NULL,source_message_id INTEGER NOT NULL REFERENCES messages(id),segment INTEGER NOT NULL DEFAULT 0,merged_into INTEGER REFERENCES listings(id),UNIQUE(source_message_id,segment));
CREATE TABLE IF NOT EXISTS quotes(id INTEGER PRIMARY KEY,listing_id INTEGER NOT NULL REFERENCES listings(id),source_message_id INTEGER NOT NULL REFERENCES messages(id),segment INTEGER NOT NULL DEFAULT 0,amount REAL,as_of INTEGER NOT NULL,is_confirmed INTEGER NOT NULL DEFAULT 0,raw_price TEXT NOT NULL DEFAULT '',UNIQUE(source_message_id,segment));
CREATE TABLE IF NOT EXISTS candidates(id INTEGER PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES batches(id),message_id INTEGER NOT NULL REFERENCES messages(id),segment INTEGER NOT NULL DEFAULT 0,kind TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',data TEXT NOT NULL,listing_id INTEGER REFERENCES listings(id),UNIQUE(message_id,segment));
CREATE TABLE IF NOT EXISTS listing_images(listing_id INTEGER NOT NULL REFERENCES listings(id),media_id TEXT NOT NULL REFERENCES media(id),source_message_id INTEGER NOT NULL REFERENCES messages(id),status TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(listing_id,media_id,source_message_id));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,listing_id INTEGER REFERENCES listings(id),created_at TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fuel(province TEXT NOT NULL,effective_date TEXT NOT NULL,p92 REAL NOT NULL,p95 REAL NOT NULL,source TEXT NOT NULL,source_url TEXT NOT NULL,fetched_at TEXT NOT NULL,verified_at TEXT NOT NULL,PRIMARY KEY(province,effective_date));
CREATE TABLE IF NOT EXISTS fuel_status(province TEXT PRIMARY KEY,error TEXT,last_attempt TEXT,last_success TEXT);
CREATE INDEX IF NOT EXISTS messages_time ON messages(created_at);
CREATE INDEX IF NOT EXISTS messages_context ON messages(namespace,session,sender,created_at);
CREATE INDEX IF NOT EXISTS listings_model ON listings(model_id,status,merged_into);
CREATE INDEX IF NOT EXISTS quotes_time ON quotes(listing_id,as_of);
CREATE INDEX IF NOT EXISTS candidates_pending ON candidates(state,kind);
"""


def dumps(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def init_db(data_dir):
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    for name in ('batches', 'media', 'thumbs', 'backups'):
        (data_dir / name).mkdir(exist_ok=True)
    with connect(data_dir) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript(SCHEMA)
        columns = {row[1] for row in db.execute('PRAGMA table_info(fuel_status)')}
        if 'last_success' not in columns:
            db.execute('ALTER TABLE fuel_status ADD COLUMN last_success TEXT')
        listing_columns = {row[1] for row in db.execute('PRAGMA table_info(listings)')}
        if 'display_name' not in listing_columns:
            db.execute("ALTER TABLE listings ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
        db.execute("INSERT OR IGNORE INTO settings VALUES('province','\"浙江\"')")
        db.execute("INSERT OR IGNORE INTO settings VALUES('budget','5.0')")
        db.execute('PRAGMA user_version=1')
    return data_dir / 'carwatch.sqlite3'


@contextmanager
def connect(data_dir):
    db = sqlite3.connect(Path(data_dir) / 'carwatch.sqlite3', timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA busy_timeout=30000')
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
