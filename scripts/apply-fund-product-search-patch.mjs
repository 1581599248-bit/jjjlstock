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
  "  const [fundHoldings, setFundHoldings] = useState<FundHoldings | null>(null);",
  "  const [fundHoldings, setFundHoldings] = useState<FundHoldings | null>(null);\n  const [fundProducts, setFundProducts] = useState<StaticFundProduct[]>([]);",
  "fundProducts state",
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
  "mode === \"fund\" ? \"搜索基金代码、名称、经理\"",
  "mode === \"fund\" ? \"搜索基金代码、名称、经理或重仓股票\"",
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
writeFileSync(pagePath, page);

const cssPath = "app/globals.css";
let css = readFileSync(cssPath, "utf8");
css = replaceOnce(
  css,
  ".entity-rail>button.active .fund-scale{color:#fff}",
  `.entity-rail>button.active .fund-scale{color:#fff}
.entity-rail>button .fund-stock-hit{margin-top:4px;padding-top:4px;color:#a33a30;border-top:1px dashed #ead7d2;font-weight:800}
.entity-rail>button.active .fund-stock-hit{color:#fff2ed;border-top-color:rgba(255,255,255,.3)}`,
  "fund stock hit styles",
);
writeFileSync(cssPath, css);

console.log("Fund product stock search patch applied.");
