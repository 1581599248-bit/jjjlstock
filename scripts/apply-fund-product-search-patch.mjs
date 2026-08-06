import { readFileSync, writeFileSync } from "node:fs";

function replaceOneOf(source, anchors, replacement, label) {
  if (source.includes(replacement)) return source;
  for (const anchor of anchors) {
    const count = source.split(anchor).length - 1;
    if (count === 1) return source.replace(anchor, replacement);
  }
  throw new Error(`Unable to find one ${label} anchor`);
}

function replaceRegex(source, pattern, replacement, marker, label) {
  if (marker && source.includes(marker)) return source;
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`Expected one ${label} match, found ${matches?.length ?? 0}`);
  return source.replace(pattern, replacement);
}

const pagePath = "app/page.tsx";
let page = readFileSync(pagePath, "utf8");

page = replaceOneOf(
  page,
  ['import publishedPeriods from "./data/published-periods.json";'],
  'import publishedPeriods from "./data/published-periods.json";\nimport MarketIndustryAllocation from "./market-industry-allocation";',
  "market industry import",
);
page = replaceOneOf(
  page,
  ["  const [fundHoldings, setFundHoldings] = useState<FundHoldings | null>(null);"],
  "  const [fundHoldings, setFundHoldings] = useState<FundHoldings | null>(null);\n  const [fundProducts, setFundProducts] = useState<StaticFundProduct[]>([]);",
  "fund product state",
);
page = replaceOneOf(
  page,
  ['  const [mode, setMode] = useState<"overview" | "manager" | "fund" | "stock">("overview");'],
  '  const [mode, setMode] = useState<"overview" | "manager" | "fund" | "stock" | "industry">("overview");',
  "industry mode",
);
page = replaceOneOf(page, ["    setCompanyData(null);"], "    setCompanyData(null); setFundProducts([]);", "fund product reset");
page = replaceOneOf(
  page,
  ['      setCompanyData({ company, funds, mode: "static" });'],
  '      setFundProducts(payload.products);\n      setCompanyData({ company, funds, mode: "static" });',
  "fund product assignment",
);
page = replaceOneOf(
  page,
  ['    }).catch(async () => {\n      const response = await fetch(`/api/company?id=${encodeURIComponent(companyId)}&period=${encodeURIComponent(period)}&metadata=3`);'],
  '    }).catch(async () => {\n      setFundProducts([]);\n      const response = await fetch(`/api/company?id=${encodeURIComponent(companyId)}&period=${encodeURIComponent(period)}&metadata=3`);',
  "live fallback reset",
);
page = replaceOneOf(
  page,
  ['  const filteredFunds = useMemo(() => { const key = query.trim().toLowerCase(); return key ? funds.filter((item) => `${item.code} ${item.name} ${item.pinyin} ${item.managers.join(" ")}`.toLowerCase().includes(key)) : funds; }, [funds, query]);'],
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
  "fund stock filtering",
);
page = replaceOneOf(
  page,
  ["  const selectedFund = funds.find((item) => item.code === selectedFundCode) ?? funds[0];"],
  `  const selectedFund = filteredFunds.find((item) => item.code === selectedFundCode) ?? filteredFunds[0] ?? funds.find((item) => item.code === selectedFundCode) ?? funds[0];

  useEffect(() => {
    if (mode !== "fund" || !filteredFunds.length) return;
    if (!filteredFunds.some((item) => item.code === selectedFundCode)) setSelectedFundCode(filteredFunds[0].code);
  }, [mode, filteredFunds, selectedFundCode]);`,
  "selected fund filtering",
);
page = replaceOneOf(page, ['mode === "fund" ? "搜索基金代码、名称、经理"'], 'mode === "fund" ? "搜索基金代码、名称、经理或重仓股票"', "fund search placeholder");
page = replaceOneOf(
  page,
  ['<div className="result-head"><strong>全部基金</strong><span>{filteredFunds.length} 条 · 横向滑动</span></div>'],
  '<div className="result-head"><strong>{query.trim() && fundStockMatches.size ? "重仓股票匹配基金" : "全部基金"}</strong><span>{filteredFunds.length} 条 · 横向滑动</span></div>',
  "fund result heading",
);
page = replaceOneOf(
  page,
  ['<small className="fund-scale">{item.netAsset !== null ? "净资产规模" : "期末份额规模"} {fundScale(item)}</small></button>'],
  '<small className="fund-scale">{item.netAsset !== null ? "净资产规模" : "期末份额规模"} {fundScale(item)}</small>{fundStockMatches.get(item.code) ? <small className="fund-stock-hit">重仓 {fundStockMatches.get(item.code)!.stockName} · 第 {fundStockMatches.get(item.code)!.rank} 名 · 净值 {fmt(fundStockMatches.get(item.code)!.weight, 2)}%</small> : null}</button>',
  "fund hit badge",
);

page = replaceOneOf(
  page,
  [
    '{mode === "stock" ? <label><span>股票反查范围</span><div className="scope-display">全市场基金公司与基金经理</div></label> : <label><span>基金公司 · 全市场</span>',
    '{mode === "stock" || mode === "industry" ? <label><span>{mode === "industry" ? "行业配置范围" : "股票反查范围"}</span><div className="scope-display">{mode === "industry" ? "全市场基金公司与全部公募基金" : "全市场基金公司与基金经理"}</div></label> : <label><span>基金公司 · 全市场</span>',
  ],
  '{mode === "stock" || mode === "industry" ? <label><span>{mode === "industry" ? "全行业统计范围" : "股票配置范围"}</span><div className="scope-display">{mode === "industry" ? "主动偏股公募基金 · 申万一级行业" : "全市场基金公司与基金经理"}</div></label> : <label><span>基金公司 · 全市场</span>',
  "full-market scope control",
);
page = replaceOneOf(
  page,
  [
    '{mode === "stock" ? <section className="coverage"><div><small>可反查股票</small>',
    '{mode === "industry" ? <section className="coverage"><div><small>配置范围</small><strong className="status-text">全市场</strong></div><div><small>统计口径</small><strong className="status-text">全部公募</strong></div><div><small>数据类型</small><strong className="status-text">行业配置</strong></div><div><small>当前报告期</small><strong className="status-text">{period.slice(0, 7)}</strong></div></section> : mode === "stock" ? <section className="coverage"><div><small>可反查股票</small>',
  ],
  '{mode === "industry" ? <section className="coverage"><div><small>基金范围</small><strong className="status-text">主动偏股</strong></div><div><small>基金类型</small><strong className="status-text">四类权益</strong></div><div><small>行业标准</small><strong className="status-text">申万一级</strong></div><div><small>当前报告期</small><strong className="status-text">{period.slice(0, 7)}</strong></div></section> : mode === "stock" ? <section className="coverage"><div><small>可配置股票</small>',
  "industry coverage strip",
);

const finalTabs = '<div className="tabs"><button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>基金总览</button><button className={mode === "manager" ? "active" : ""} onClick={() => setMode("manager")}>基金经理</button><button className={mode === "fund" ? "active" : ""} onClick={() => setMode("fund")}>基金产品</button><button className={mode === "stock" ? "active" : ""} onClick={() => { setMode("stock"); setQuery(""); }}>股票配置</button><button className={mode === "industry" ? "active" : ""} onClick={() => { setMode("industry"); setQuery(""); }}>全行业</button></div>';
page = replaceRegex(page, /<div className="tabs">[\s\S]*?<\/div>/, finalTabs, '>全行业</button></div>', "module tabs");
page = replaceOneOf(page, ['className={`entity-tools${mode === "stock" ? " stock-tools" : ""}`}'], 'className={`entity-tools${mode === "stock" || mode === "industry" ? " stock-tools" : ""}`}', "full-width industry tools");
page = replaceOneOf(
  page,
  [
    'placeholder={mode === "stock" ? "输入股票代码或名称" : mode === "fund" ? "搜索基金代码、名称、经理或重仓股票" : "搜索经理、在管基金"}',
    'placeholder={mode === "industry" ? "搜索行业名称" : mode === "stock" ? "输入股票代码或名称" : mode === "fund" ? "搜索基金代码、名称、经理或重仓股票" : "搜索经理、在管基金"}',
  ],
  'placeholder={mode === "industry" ? "搜索申万一级行业" : mode === "stock" ? "输入股票代码或名称" : mode === "fund" ? "搜索基金代码、名称、经理或重仓股票" : "搜索经理、在管基金"}',
  "industry search placeholder",
);
page = replaceOneOf(page, ['{mode !== "stock" && <div className="export-actions">'], '{mode !== "stock" && mode !== "industry" && <div className="export-actions">', "industry export suppression");
page = replaceOneOf(page, ['{mode === "stock" ? <StockReverseLookup'], '{mode === "industry" ? <MarketIndustryAllocation period={period} query={query} /> : mode === "stock" ? <StockReverseLookup', "industry rendering");
page = replaceOneOf(page, ['{mode !== "stock" && error && <div className="error-banner">{error}</div>}'], '{mode !== "stock" && mode !== "industry" && error && <div className="error-banner">{error}</div>}', "industry error isolation");
writeFileSync(pagePath, page);

const cssPath = "app/globals.css";
let css = readFileSync(cssPath, "utf8");
css = css.replace(/\.tabs\{padding:3px;display:grid;grid-template-columns:repeat\([45],1fr\);background:#f0eff0;border-radius:11px\}/, ".tabs{padding:3px;display:grid;grid-template-columns:repeat(5,1fr);background:#f0eff0;border-radius:11px}");
css = replaceOneOf(
  css,
  [".entity-rail>button.active .fund-scale{color:#fff}"],
  `.entity-rail>button.active .fund-scale{color:#fff}
.entity-rail>button .fund-stock-hit{margin-top:4px;padding-top:4px;color:#a33a30;border-top:1px dashed #ead7d2;font-weight:800}
.entity-rail>button.active .fund-stock-hit{color:#fff2ed;border-top-color:rgba(255,255,255,.3)}`,
  "fund hit styles",
);
if (!css.includes(".market-industry-scope{")) css += `

/* Active-equity public-fund allocation by SW 2021 level-one industry. */
.market-industry-module{padding:3px 1px 1px}
.market-industry-title{padding:8px 1px 12px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.market-industry-title span{color:var(--red);font-size:7px;font-weight:850;letter-spacing:.16em}
.market-industry-title h2{margin:3px 0 2px;font-family:Georgia,"Songti SC",serif;font-size:21px}
.market-industry-title p{margin:0;color:#817c82;font-size:8px;line-height:1.5}
.market-industry-title em{padding:5px 8px;color:#c83227;background:var(--soft);border-radius:999px;font-size:8px;font-style:normal;font-weight:800;white-space:nowrap}
.market-industry-scope{display:flex;flex-wrap:wrap;gap:6px;padding:8px 9px;background:linear-gradient(135deg,#292326,#211c1d);border-radius:10px;color:#c8c2c4;font-size:7px}
.market-industry-scope span{padding-right:8px;border-right:1px solid rgba(255,255,255,.12)}
.market-industry-scope span:last-child{border:0}
.market-industry-scope b{color:#fff;font-size:9px}
.market-industry-toolbar{margin:11px 1px 7px;display:flex;justify-content:space-between;align-items:end;gap:10px}
.market-industry-toolbar>div{display:flex;flex-direction:column;gap:2px}
.market-industry-toolbar strong{font-size:10px}
.market-industry-toolbar span{color:#918c92;font-size:7px}
.market-industry-table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;scrollbar-color:#d2a39b #f1eded}
.market-industry-table{width:100%;border-collapse:collapse;font-size:8px;font-variant-numeric:tabular-nums}
.market-industry-table.compact-five{min-width:470px}
.market-industry-table th{padding:8px;color:#f7f4f4;background:var(--dark);text-align:left;font-size:7px;white-space:nowrap}
.market-industry-table td{height:40px;padding:6px 8px;border-bottom:1px solid #eceaec;white-space:nowrap}
.market-industry-table tr:nth-child(even) td{background:#faf9fa}
.market-industry-table tr:last-child td{border-bottom:0}
.market-industry-table .num{text-align:right}
.market-industry-name{min-width:145px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.market-industry-name>strong{overflow:hidden;text-overflow:ellipsis;font-size:8px}
.market-industry-name>small{color:#aaa4a8;font-size:6px}
.industry-up{color:#c52d24;font-weight:800}
.industry-down{color:#25735d;font-weight:800}
.market-industry-note{margin:8px 2px 0;color:#898388;font-size:7px;line-height:1.65}
@media(max-width:520px){
  .tabs button{font-size:9px}
  .market-industry-table.compact-five{min-width:430px}
  .market-industry-name{min-width:120px}
}
`;
writeFileSync(cssPath, css);

console.log("Fund stock search and active-equity full-industry module applied.");
