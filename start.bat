@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 goto fail
)
.venv\Scripts\python.exe -I -c "import fastapi, uvicorn, PIL" >nul 2>nul
if errorlevel 1 (
  .venv\Scripts\python.exe -I -m pip install -r requirements.txt
  if errorlevel 1 goto fail
)
.venv\Scripts\python.exe -I -X utf8 run.py --open
if errorlevel 1 goto fail
exit /b 0
:fail
echo 启动未完成，请保留此窗口查看上方错误。需要 Python 3.11 或更高版本。
pause
exit /b 1
