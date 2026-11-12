# CarWatch · 车价观察

本地运行的二手车行情工作台：把微信群里的报价导出（JSON + 图片）整理成结构化台账，按「同车型 + 同款年 + 同排量」看价格走势，并查看地区油价。

聊天记录读取的是 [SIWX](https://siwx.upxuu.com/) 导出的 `stories-in-wx` 格式（微信 4.x 本地解密导出，全程在本机完成）。

所有数据都留在你自己的电脑上：SQLite 单文件 + 图片目录，服务只监听 `127.0.0.1`，不联网上报。

## 功能

- **导入**：支持微信群导出目录或 ZIP，2MB 分块上传、断点续传、失败重试；图片按 SHA-256 去重
- **解析**：本地规则从聊天原文里抽取车型、款年、排量、配置、报价、里程、地区、车况，并保留原文可回查
- **台账**：表格 / 图片墙两种视图，搜索与车型筛选，点行打开详情抽屉（图集、报价历史、原文、备注、字段编辑、同车合并）
- **趋势**：关注列表 + 单车型报价走势（每日中位线、逐车散点、样本数），悬浮显示该车缩略图与信息
- **油价**：分省 92/95 号历史曲线、较上次调价涨跌、手动补录
- **数据安全**：备份为包含图片与原始批次的 ZIP；浏览器端不存储任何业务数据

## 聊天记录从哪来

本工具不直接读取微信数据，只解析 **SIWX** 导出的目录：

1. 在 [SIWX](https://siwx.upxuu.com/) 里解密并打开目标群，进入「导出」
2. 格式选 `stories-in-wx`，勾选图片，导出为文件夹（或打包成 ZIP）
3. 目录结构大致是：

   ```
   <群名>/
     manifest.json
     <群名>_<日期>_<序号>.json
     media/*.jpg
   ```

4. 在本工具「导入」页选择这个文件夹或 ZIP，上传后会自动解析成台账

> SIWX 与本项目没有隶属关系，只是这里用到的导出格式来源；它也支持其他导出格式，本工具只认 `stories-in-wx`。

## 快速开始

需要 Python 3.11+。

```bash
# Windows：双击 start.bat（自动建虚拟环境并装依赖）
# macOS / Linux：
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python run.py --open
```

打开 <http://127.0.0.1:5138>。资料默认存放在 `./data`，可用 `--data-dir` 指定：

```bash
python run.py --data-dir /path/to/data --port 5138 --open
```

## 界面

- `/` → 新版界面 `/v2/`（React，已随仓库提供构建产物）
- `/legacy` → 旧版原生界面（保留作对照）

## 开发

```bash
# 后端测试
.venv/bin/python -m pytest -q

# 前端（可选，仅在修改 React 界面时需要）
cd app
npm install
npm run build      # 产物输出到 ../web/v2
```

前端源码在 `app/`（Vite + React + TypeScript），构建产物 `web/v2/` 已提交，便于开箱即用；改完源码记得重新构建。

## 目录

```
backend/      FastAPI 路由、导入器、解析规则、业务查询
tests/        pytest（API + 导入 + 解析回归）
web/          旧版静态界面 + 新版构建产物 v2/
app/          新版前端源码（Vite + React + TS）
data/         运行时生成：carwatch.sqlite3、media/、thumbs/、batches/、backups/
run.py        启动入口
```

## 数据与隐私

- 只依赖本机：无账号、无云服务、无遥测
- 图片与聊天原文按原样保存在本地，供核对
- 油价来自公开数据源（东方财富 Choice 数据），页面标注来源与生效日期

## 已知限制

- 解析基于本地规则，排版差异大的消息需要人工在台账里修正（详情抽屉支持编辑）
- 暂不支持视频附件与 OCR
- 仅提供 92/95 号汽油

## License

MIT