# Rackline — Valero terminal rack price tracker

每天抓取并保存 [Valero 加拿大终端装车价格 PDF](https://valeroapps.valero.com/public/rpt_Terminal_Rack_Prices.pdf)，然后通过一个无需后端的静态网页展示历史走势与最新报价。

> 价格单位为加元分/升、税前、EXW。本项目与 Valero 无隶属关系；若数据存在差异，以 Valero 的正式价格确认通知为准。

## 功能

- GitHub Actions 每天自动抓取（UTC 10:20）
- 按 PDF 坐标解析产品 × 终端的稀疏价格矩阵
- 每个生效日保存独立 JSON，并记录源文件 SHA-256
- 同一天源 PDF 更新时自动覆盖为最新版本
- 响应式静态看板：关键指标、单品单站趋势、最新报价筛选
- 无数据库、无前端依赖，可直接部署到 GitHub Pages

## 本地运行

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python scripts/collect.py
python -m http.server 8000 --directory docs
```

打开 <http://localhost:8000>。

也可以解析已经下载的 PDF：

```bash
python scripts/collect.py --pdf path/to/rpt_Terminal_Rack_Prices.pdf
```

## 发布到 GitHub Pages

1. 在 GitHub 创建空仓库，把本项目推送到 `main`。
2. 打开 **Settings → Pages**。
3. 在 **Build and deployment → Source** 选择 **GitHub Actions**。
4. 打开 **Settings → Actions → General**，在 **Workflow permissions** 选择 **Read and write permissions** 并保存。
5. 在 **Actions** 手动运行一次 `Collect daily rack prices`。

采集完成后，同一个任务会直接部署 `docs` 目录，因此由机器人提交的新数据也会立即反映到网页。之后任务每天运行一次；只有 PDF 内容变化时才会产生提交。GitHub 的定时任务可能延迟，漏跑时可在 Actions 页面手动触发。

## 数据结构

- `docs/data/daily/YYYY-MM-DD.json`：当天完整快照
- `docs/data/history.json`：网页读取的合并历史
- `source_sha256`：对应源 PDF 的 SHA-256，用于判断是否更新和审计

默认不把 PDF 二进制文件提交到 Git，避免仓库每年增长约 80 MB。如确实需要归档原件，可运行：

```bash
python scripts/collect.py --archive-pdf
```

## 解析与质量保护

源 PDF 有文本层，但表格在普通文本提取时会丢失空单元格。解析器使用页面固定列坐标映射 18 个终端，并在写入前检查产品数量、报价数量和合理价格范围。若 Valero 改版导致结构变化，任务会失败而不会写入可疑数据。

## License

MIT
