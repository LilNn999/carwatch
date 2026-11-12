"""Independent local worker. Import batches survive process restarts."""
from pathlib import Path
import sys

# -I disables imports from an untrusted cwd; only our fixed project is added.
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))

import os
import time
from backend.db import init_db,connect,stamp
from backend.importer import run_batch
from backend import service


def main(data_dir):
    data_dir=Path(data_dir).resolve()
    init_db(data_dir)
    lock=(data_dir/'worker.lock').open('a+b')
    lock.seek(0)
    if lock.read(1)==b'':
        lock.write(b'0'); lock.flush()
    lock.seek(0)
    try:
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:
        lock.close()
        return
    with connect(data_dir) as db:
        db.execute("UPDATE batches SET status='queued',error=NULL,updated_at=? WHERE status='running'",(stamp(),))
    last_oil_attempt=0
    while True:
        with connect(data_dir) as db:
            batch=db.execute("SELECT id FROM batches WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
        if batch:
            run_batch(data_dir,batch['id'])
            continue
        if time.monotonic()-last_oil_attempt>600:
            last_oil_attempt=time.monotonic()
            try:
                province=service.settings(data_dir)['province']
                if service.fuel(data_dir,province)['status']!='ok':
                    service.refresh_fuel(data_dir,province)
            except Exception as exc:
                print('Oil refresh:',type(exc).__name__,flush=True)
        time.sleep(0.5)


if __name__=='__main__':
    main(sys.argv[1])
