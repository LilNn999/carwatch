"""Start CarWatch on this PC: python -I run.py [--data-dir PATH]."""
import argparse
from pathlib import Path
import sys
import threading
import webbrowser

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))


def main():
    parser=argparse.ArgumentParser(description='车价观察 · 本地资料库')
    parser.add_argument('--data-dir',type=Path,default=ROOT/'data')
    parser.add_argument('--port',type=int,default=5138)
    parser.add_argument('--open',action='store_true',help='启动后打开浏览器')
    args=parser.parse_args()
    import uvicorn
    from backend.api import create_app
    app=create_app(args.data_dir)
    url=f'http://127.0.0.1:{args.port}'
    print(f'车价观察：{url}\n资料目录：{args.data_dir.resolve()}\n关闭此窗口或按 Ctrl+C 停止服务。',flush=True)
    if args.open:
        threading.Timer(1.5,lambda:webbrowser.open(url)).start()
    uvicorn.run(app,host='127.0.0.1',port=args.port,access_log=False)


if __name__=='__main__':
    main()
