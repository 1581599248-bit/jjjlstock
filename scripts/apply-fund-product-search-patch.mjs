import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source;
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`Expected one ${label} anchor, found ${count}`);
  return source.replace(oldText, newText);
}

const pagePath = "app/page.tsx";
let page = readFileSync(pagePath, "utf8");

page = replaceOnce(
  page,
  'import publishedPeriods from "./data/published-periods.json";',
  'import publishedPeriods from "./data/published-periods.json";\nimport MarketIndustryAllocation from "./market-industry-allocation";',
  "market industry component import",
);
page = replaceOnce(
  page,
  "  const [fundHoldings, setFundHoldings] = useState<FundHoldings | null>(null);",
  "  const [fundHoldings, setFundHoldings] = useState<FundHoldings | null>(null);\n  const [fundProducts, setFundProducts] = useState<StaticFundProduct[]>([]);",
  "fundProducts state",
);
page = replaceOnce(
  page,
  '  const [mode, setMode] = useState<"overview" | "manager" | "fund" | "stock">("overview");',
  '  const [mode, setMode] = useState<"overview" | "manager" | "fund" | "industry" | "stock">("overview");',
  "industry mode",
);
page = replaceOnce(
  page,
  "    setCompanyData(null);",
  "    setCompanyData(null); setFundProducts([]);",
  "fundProducts reset",
);
page = replaceOnce(
  page,
  "      setCompanyData({ company, funds, mode: \"static\" });",
  "      setFundProducts(payload.products);\n      setCompanyData({ company, funds, mode: \"static\" });",
  "static fund products assignment",
);
page = replaceOnce(
  page,
  "    }).catch(async () => {\n      const response = await fetch(`/api/company?id=${encodeURIComponent(companyId)}&period=${encodeURIComponent(period)}&metadata=3`);",
  "    }).catch(async () => {\n      setFundProducts([]);\n      const response = await fetch(`/api/company?id=${encodeURIComponent(companyId)}&period=${encodeURIComponent(period)}&metadata=3`);",
  "live fallback product reset",
);
page = replaceOnce(
  page,
  "  const filteredFunds = useMemo(() => { const key = query.trim().toLowerCase(); return key ? funds.filter((item) => `${item.code} ${item.name} ${item.pinyin} ${item.managers.join(\" \")}`.toLowerCase().includes(key)) : funds; }, [funds, query]);",
  `  const fundQueryKey = query.trim().replace(/\\s+/g, "").toLowerCase();
  const fundStockMatches = useMemo(() => {
    const matches = new Map<string, Holding>();
    if (!fundQueryKey) return matches;
    for (const product of fundProducts) {
      const holding = product.holdings.find((item) => \`${"${item.stockCode}${item.stockName}"}\`.replace(/\\s+/g, "").toLowerCase().includes(fundQueryKey));
      if (holding) matches.set(product.code, holding);
    }
    return matches;
  }, [fundProducts, fundQueryKey]);
  const filteredFunds = useMemo(() => {
    const key = query.trim().toLowerCase();
    if (!key) return funds;
    return funds.filter((item) => \`${"${item.code} ${item.name} ${item.pinyin} ${item.managers.join(\" \")}"}\`.toLowerCase().includes(key) || fundStockMatches.has(item.code));
  }, [funds, query, fundStockMatches]);`,
  "fund product stock filtering",
);
page = replaceOnce(
  page,
  "  const selectedFund = funds.find((item) => item.code === selectedFundCode) ?? funds[0];",
  `  const selectedFund = filteredFunds.find((item) => item.code === selectedFundCode) ?? filteredFunds[0] ?? funds.find((item) => item.code === selectedFundCode) ?? funds[0];

  useEffect(() => {
    if (mode !== "fund" || !filteredFunds.length) return;
    if (!filteredFunds.some((item) => item.code === selectedFundCode)) setSelectedFundCode(filteredFunds[0].code);
  }, [mode, filteredFunds, selectedFundCode]);`,
  "selected fund follows filtered stock results",
);
page = replaceOnce(
  page,
  'mode === "fund" ? "搜索基金代码、名称、经理"',
  'mode === "fund" ? "搜索基金代码、名称、经理或重仓股票"',
  "fund search placeholder",
);
page = replaceOnce(
  page,
  "<div className=\"result-head\"><strong>全部基金</strong><span>{filteredFunds.length} 条 · 横向滑动</span></div>",
  "<div className=\"result-head\"><strong>{query.trim() && fundStockMatches.size ? \"重仓股票匹配基金\" : \"全部基金\"}</strong><span>{filteredFunds.length} 条 · 横向滑动</span></div>",
  "fund result heading",
);
page = replaceOnce(
  page,
  "<small className=\"fund-scale\">{item.netAsset !== null ? \"净资产规模\" : \"期末份额规模\"} {fundScale(item)}</small></button>",
  "<small className=\"fund-scale\">{item.netAsset !== null ? \"净资产规模\" : \"期末份额规模\"} {fundScale(item)}</small>{fundStockMatches.get(item.code) ? <small className=\"fund-stock-hit\">重仓 {fundStockMatches.get(item.code)!.stockName} · 第 {fundStockMatches.get(item.code)!.rank} 名 · 净值 {fmt(fundStockMatches.get(item.code)!.weight, 2)}%</small> : null}</button>",
  "fund stock hit badge",
);
page = replaceOnce(
  page,
  '{mode === "stock" ? <label><span>股票反查范围</span><div className="scope-display">全市场基金公司与基金经理</div></label> : <label><span>基金公司 · 全市场</span>',
  '{mode === "stock" || mode === "industry" ? <label><span>{mode === "industry" ? "行业配置范围" : "股票反查范围"}</span><div className="scope-display">{mode === "industry" ? "全市场基金公司与全部公募基金" : "全市场基金公司与基金经理"}</div></label> : <label><span>基金公司 · 全市场</span>',
  "full-market scope control",
);
page = replaceOnce(
  page,
  '{mode === "stock" ? <section className="coverage"><div><small>可反查股票</small>',
  '{mode === "industry" ? <section className="coverage"><div><small>配置范围</small><strong className="status-text">全市场</strong></div><div><small>统计口径</small><strong className="status-text">全部公募</strong></div><div><small>数据类型</small><strong className="status-text">行业配置</strong></div><div><small>当前报告期</small><strong className="status-text">{period.slice(0, 7)}</strong></div></section> : mode === "stock" ? <section className="coverage"><div><small>可反查股票</small>',
  "industry coverage strip",
);
page = replaceOnce(
  page,
  '<div className="tabs"><button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>基金总览</button><button className={mode === "manager" ? "active" : ""} onClick={() => setMode("manager")}>基金经理</button><button className={mode === "fund" ? "active" : ""} onClick={() => setMode("fund")}>基金产品</button><button className={mode === "stock" ? "active" : ""} onClick={() => { setMode("stock"); setQuery(""); }}>股票反查</button></div>',
  '<div className="tabs"><button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>基金总览</button><button className={mode === "manager" ? "active" : ""} onClick={() => setMode("manager")}>基金经理</button><button className={mode === "fund" ? "active" : ""} onClick={() => setMode("fund")}>基金产品</button><button className={mode === "industry" ? "active" : ""} onClick={() => { setMode("industry"); setQuery(""); }}>行业配置</button><button className={mode === "stock" ? "active" : ""} onClick={() => { setMode("stock"); setQuery(""); }}>股票反查</button></div>',
  "industry tab",
);
page = replaceOnce(
  page,
  'className={`entity-tools${mode === "stock" ? " stock-tools" : ""}`}',
  'className={`entity-tools${mode === "stock" || mode === "industry" ? " stock-tools" : ""}`}',
  "industry full-width search tools",
);
page = replaceOnce(
  page,
  'placeholder={mode === "stock" ? "输入股票代码或名称" : mode === "fund" ? "搜索基金代码、名称、经理或重仓股票" : "搜索经理、在管基金"}',
  'placeholder={mode === "industry" ? "搜索行业名称" : mode === "stock" ? "输入股票代码或名称" : mode === "fund" ? "搜索基金代码、名称、经理或重仓股票" : "搜索经理、在管基金"}',
  "industry search placeholder",
);
page = replaceOnce(
  page,
  '{mode !== "stock" && <div className="export-actions">',
  '{mode !== "stock" && mode !== "industry" && <div className="export-actions">',
  "industry export suppression",
);
page = replaceOnce(
  page,
  '{mode === "stock" ? <StockReverseLookup',
  '{mode === "industry" ? <MarketIndustryAllocation period={period} query={query} /> : mode === "stock" ? <StockReverseLookup',
  "industry module rendering",
);
page = replaceOnce(
  page,
  '{mode !== "stock" && error && <div className="error-banner">{error}</div>}',
  '{mode !== "stock" && mode !== "industry" && error && <div className="error-banner">{error}</div>}',
  "industry error isolation",
);
writeFileSync(pagePath, page);

const cssPath = "app/globals.css";
let css = readFileSync(cssPath, "utf8");
css = replaceOnce(
  css,
  ".tabs{padding:3px;display:grid;grid-template-columns:repeat(4,1fr);background:#f0eff0;border-radius:11px}",
  ".tabs{padding:3px;display:grid;grid-template-columns:repeat(5,1fr);background:#f0eff0;border-radius:11px}",
  "five module tabs",
);
css = replaceOnce(
  css,
  ".entity-rail>button.active .fund-scale{color:#fff}",
  `.entity-rail>button.active .fund-scale{color:#fff}
.entity-rail>button .fund-stock-hit{margin-top:4px;padding-top:4px;color:#a33a30;border-top:1px dashed #ead7d2;font-weight:800}
.entity-rail>button.active .fund-stock-hit{color:#fff2ed;border-top-color:rgba(255,255,255,.3)}`,
  "fund stock hit styles",
);
if (!css.includes(".market-industry-module{")) css += `

.market-industry-module{padding:3px 1px 1px}
.market-industry-title{padding:8px 1px 12px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.market-industry-title span{color:var(--red);font-size:7px;font-weight:850;letter-spacing:.16em}
.market-industry-title h2{margin:3px 0 2px;font-family:Georgia,"Songti SC",serif;font-size:21px}
.market-industry-title p{margin:0;color:#817c82;font-size:8px;line-height:1.5}
.market-industry-title em{padding:5px 8px;color:#c83227;background:var(--soft);border-radius:999px;font-size:8px;font-style:normal;font-weight:800;white-space:nowrap}
.market-industry-metrics{display:grid;grid-template-columns:repeat(4,1fr);background:linear-gradient(135deg,#292326,#211c1d);border-radius:11px;overflow:hidden}
.market-industry-metrics>div{min-width:0;padding:10px 8px;border-right:1px solid rgba(255,255,255,.09)}
.market-industry-metrics>div:last-child{border:0}
.market-industry-metrics small{display:block;color:#aaa3a6;font-size:7px;white-space:nowrap}
.market-industry-metrics b{display:block;margin-top:3px;color:#fff;font-family:Georgia,serif;font-size:15px;white-space:nowrap}
.market-industry-metrics b i{color:#c8c2c4;font-family:inherit;font-size:7px;font-style:normal}
.market-industry-toolbar{margin:11px 1px 7px;display:flex;justify-content:space-between;align-items:end;gap:10px}
.market-industry-toolbar>div{display:flex;flex-direction:column;gap:2px}
.market-industry-toolbar strong{font-size:10px}
.market-industry-toolbar span,.market-industry-toolbar>small{color:#918c92;font-size:7px}
.market-industry-table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;scrollbar-color:#d2a39b #f1eded}
.market-industry-table{width:100%;min-width:650px;border-collapse:collapse;font-size:8px;font-variant-numeric:tabular-nums}
.market-industry-table th{padding:7px;color:#f7f4f4;background:var(--dark);text-align:left;font-size:7px;white-space:nowrap}
.market-industry-table td{height:42px;padding:6px 7px;border-bottom:1px solid #eceaec;white-space:nowrap}
.market-industry-table tr:nth-child(even) td{background:#faf9fa}
.market-industry-table tr:last-child td{border-bottom:0}
.market-industry-table .num{text-align:right}
.market-industry-name{min-width:190px;display:grid;grid-template-columns:minmax(105px,1fr) 70px auto;align-items:center;gap:7px}
.market-industry-name>strong{max-width:185px;overflow:hidden;text-overflow:ellipsis;font-size:8px}
.market-industry-name>i{height:5px;background:#eee9e8;border-radius:999px;overflow:hidden}
.market-industry-name>i span{display:block;height:100%;background:linear-gradient(90deg,var(--red),var(--orange));border-radius:999px}
.market-industry-name>small{font-size:6px;font-weight:800}
.market-industry-name>small.up,.industry-up{color:#c52d24}
.market-industry-name>small.down,.industry-down{color:#25735d}
.market-industry-note{margin:8px 2px 0;color:#898388;font-size:7px;line-height:1.65}
@media(max-width:520px){
  .tabs button{font-size:10px}
  .market-industry-metrics>div{padding:9px 6px}
  .market-industry-metrics b{font-size:12px}
  .market-industry-table{min-width:520px}
  .market-industry-name{min-width:150px;grid-template-columns:minmax(90px,1fr) 54px auto}
}
`;
writeFileSync(cssPath, css);

console.log("Fund product stock search and market industry module patches applied.");
