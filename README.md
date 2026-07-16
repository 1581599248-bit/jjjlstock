# 持仓雷达

手机优先的公募基金季度重仓股分析网站。支持按财报期和基金公司筛选，查看基金经理与基金产品前十大重仓，并导出高密度 Excel。

当前样本由用户提供的 iFind 导出文件标准化生成；生产数据链路预留 iFind 主源、Tushare Pro 备源和公开披露抽样校验。

## 本地运行

```bash
npm install
npm run dev
```

## 验证

```bash
npm test
npx tsc --noEmit
```
