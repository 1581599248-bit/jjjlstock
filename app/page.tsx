"use client";

import { useMemo, useState } from "react";
import dataset from "./data/fund-data.json";
import { exportCompanyWorkbook } from "./lib/xlsx";

type Holding = { rank: number; stock: string; weight: number; change: string; changeShares: number | null };
type Fund = { id: string; name: string; size: number; managers: string[]; return1y: number; type: string; holdings: Holding[]; concepts: { name: string; weight: number }[]; concentration: number };
type Manager = { id: string; name: string; size: number; tenure: number; fundCount: number; equityFundCount: number; managedFundNames: string[]; holdings: Holding[]; concentration: number; aggregation: string };
type Company = (typeof dataset.companies)[number];

const fmt = (value: number, digits = 1) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);

function ChangeTag({ holding }: { holding: Holding }) {
  const tone = holding.change.includes("增") || holding.change.includes("新") ? "up" : holding.change.includes("减") ? "down" : "flat";
  return <span className={`change-tag ${tone}`}><span className="change-dot" />{holding.change}{holding.changeShares !== null && holding.changeShares !== 0 ? ` ${holding.changeShares > 0 ? "+" : ""}${fmt(holding.changeShares, 0)}` : ""}</span>;
}

function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  if (!holdings.length) return <div className="empty-table">该对象本期未披露股票重仓持仓</div>;
  return <div className="table-scroll" role="region" aria-label="前十大重仓股，可横向滚动" tabIndex={0}>
    <table className="holdings-table"><thead><tr><th>排名</th><th>股票名称</th><th className="num">占净值</th><th>持仓变化</th></tr></thead>
      <tbody>{holdings.map((holding) => <tr key={`${holding.rank}-${holding.stock}`}><td><span className={`rank rank-${holding.rank}`}>{holding.rank}</span></td><td className="stock-name">{holding.stock}</td><td className="num weight-cell">{fmt(holding.weight, 2)}%</td><td><ChangeTag holding={holding} /></td></tr>)}</tbody>
    </table>
  </div>;
}

function FundPanel({ fund }: { fund: Fund }) {
  return <><div className="entity-head"><div><span className="eyebrow">基金产品</span><h2>{fund.name}</h2><p>{fund.managers.join("、") || "经理未披露"} · {fund.type}</p></div><span className="source-pill">iFind</span></div>
    <div className="metric-strip"><div><span>基金规模</span><strong>{fmt(fund.size, 2)}亿</strong></div><div><span>近1年</span><strong className={fund.return1y >= 0 ? "positive" : "negative"}>{fund.return1y >= 0 ? "+" : ""}{fmt(fund.return1y, 2)}%</strong></div><div><span>前十集中度</span><strong>{fmt(fund.concentration, 1)}%</strong></div></div>
    {fund.concepts.length > 0 && <div className="concept-row" aria-label="主要概念暴露">{fund.concepts.slice(0, 5).map((concept) => <span key={concept.name}>{concept.name}<b>{fmt(concept.weight, 1)}%</b></span>)}</div>}
    <HoldingsTable holdings={fund.holdings} /></>;
}

function ManagerPanel({ manager }: { manager: Manager }) {
  return <><div className="entity-head"><div><span className="eyebrow">基金经理</span><h2>{manager.name}</h2><p>{manager.aggregation}</p></div><span className="source-pill estimate">估算</span></div>
    <div className="metric-strip manager-metrics"><div><span>在管规模</span><strong>{fmt(manager.size, 1)}亿</strong></div><div><span>投资年限</span><strong>{fmt(manager.tenure, 2)}年</strong></div><div><span>在管基金</span><strong>{manager.fundCount}只</strong></div><div><span>前十集中度</span><strong>{fmt(manager.concentration, 1)}%</strong></div></div>
    {manager.managedFundNames.length > 0 && <details className="managed-funds"><summary>查看在管产品（{manager.managedFundNames.length}）</summary><p>{manager.managedFundNames.join("、")}</p></details>}
    <HoldingsTable holdings={manager.holdings} /></>;
}

export default function Home() {
  const [period, setPeriod] = useState("2026Q1");
  const [companyId, setCompanyId] = useState(dataset.companies[0].id);
  const [mode, setMode] = useState<"manager" | "fund">("manager");
  const [query, setQuery] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState<Record<string, string>>({});
  const [selectedFundId, setSelectedFundId] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const company = dataset.companies.find((item) => item.id === companyId) as Company;
  const managers = company.managers as Manager[];
  const funds = company.funds as Fund[];

  const filteredManagers = useMemo(() => { const keyword = query.trim().toLowerCase(); return keyword ? managers.filter((manager) => `${manager.name} ${manager.managedFundNames.join(" ")} ${manager.holdings.map((item) => item.stock).join(" ")}`.toLowerCase().includes(keyword)) : managers; }, [managers, query]);
  const filteredFunds = useMemo(() => { const keyword = query.trim().toLowerCase(); return keyword ? funds.filter((fund) => `${fund.name} ${fund.type} ${fund.managers.join(" ")} ${fund.holdings.map((item) => item.stock).join(" ")}`.toLowerCase().includes(keyword)) : funds; }, [funds, query]);
  const selectedManager = managers.find((item) => item.id === selectedManagerId[company.id]) ?? filteredManagers.find((item) => item.holdings.length > 0) ?? filteredManagers[0] ?? managers[0];
  const selectedFund = funds.find((item) => item.id === selectedFundId[company.id]) ?? filteredFunds.find((item) => item.holdings.length > 0) ?? filteredFunds[0] ?? funds[0];
  const activeEntities = mode === "manager" ? filteredManagers : filteredFunds;
  const selectedId = mode === "manager" ? selectedManager?.id : selectedFund?.id;
  const aggregateStocks = useMemo(() => { const map = new Map<string, { stock: string; funds: number; value: number }>(); for (const fund of funds) for (const holding of fund.holdings) { const current = map.get(holding.stock) ?? { stock: holding.stock, funds: 0, value: 0 }; current.funds += 1; current.value += fund.size * holding.weight / 100; map.set(holding.stock, current); } return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 5); }, [funds]);
  const onSelectEntity = (id: string) => mode === "manager" ? setSelectedManagerId((state) => ({ ...state, [company.id]: id })) : setSelectedFundId((state) => ({ ...state, [company.id]: id }));
  const onExport = async () => { setExporting(true); try { await exportCompanyWorkbook(company, dataset.methodology); } finally { window.setTimeout(() => setExporting(false), 500); } };

  return <main>
    <header className="topbar"><div className="brand-mark">持</div><div className="brand-copy"><strong>持仓雷达</strong><span>公募基金季度透视</span></div><span className="live-status"><i />数据已载入</span></header>
    <section className="hero"><span className="hero-kicker">FUND HOLDINGS INTELLIGENCE</span><h1>一个入口，穿透基金公司全部重仓</h1><p>按财报期查看基金经理与基金产品前十大持仓，手机端快速检索，一键导出完整 Excel。</p></section>
    <section className="selector-card" aria-label="数据筛选">
      <label><span>最新财报</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>{dataset.availablePeriods.map((item) => <option key={item.id} value={item.id} disabled={item.status !== "available"}>{item.label}{item.status !== "available" ? " · 待导入" : ""}</option>)}</select></label>
      <label><span>基金公司</span><select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setQuery(""); }}>{dataset.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="export-button" onClick={onExport} disabled={exporting}><span className="download-icon">↓</span>{exporting ? "正在生成…" : "导出全公司 Excel"}</button>
    </section>
    <section className="stats-grid" aria-label="公司概览"><div><span>基金产品</span><strong>{company.stats.fundCount}</strong><small>只</small></div><div><span>基金经理</span><strong>{company.stats.managerCount}</strong><small>位</small></div><div><span>样本规模</span><strong>{fmt(company.stats.totalSize, 0)}</strong><small>亿元</small></div><div><span>有股票持仓</span><strong>{company.stats.equityFundCount}</strong><small>只</small></div></section>
    <section className="module-shell">
      <div className="segment" role="tablist" aria-label="持仓模块"><button className={mode === "manager" ? "active" : ""} onClick={() => setMode("manager")} role="tab">基金经理</button><button className={mode === "fund" ? "active" : ""} onClick={() => setMode("fund")} role="tab">基金产品</button></div>
      <div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "manager" ? "搜经理、在管基金或股票" : "搜基金、经理、类型或股票"} />{query && <button onClick={() => setQuery("")} aria-label="清除搜索">×</button>}</div>
      <div className="entity-list-head"><span>{mode === "manager" ? "全部基金经理" : "全部基金产品"}</span><small>{activeEntities.length} 个结果 · 左右滑动</small></div>
      <div className="entity-chips">{activeEntities.map((entity) => <button key={entity.id} className={selectedId === entity.id ? "active" : ""} onClick={() => onSelectEntity(entity.id)}>{entity.name}<small>{mode === "manager" ? `${(entity as Manager).fundCount}只 · ${fmt((entity as Manager).size, 0)}亿` : `${(entity as Fund).type} · ${fmt((entity as Fund).size, 1)}亿`}</small></button>)}{!activeEntities.length && <p className="no-results">没有匹配结果，换个关键词试试。</p>}</div>
      <div className="entity-panel">{mode === "manager" && selectedManager && <ManagerPanel manager={selectedManager} />}{mode === "fund" && selectedFund && <FundPanel fund={selectedFund} />}</div>
    </section>
    <section className="lookthrough-card"><div className="section-title"><div><span className="eyebrow">公司穿透</span><h2>{company.name}核心重仓</h2></div><small>按样本基金规模估算市值</small></div><div className="top-stocks">{aggregateStocks.map((item, index) => <div key={item.stock}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.stock}</strong><small>{item.funds}只基金 · 约{fmt(item.value, 2)}亿元</small></div>)}</div></section>
    <section className="method-card"><strong>数据口径</strong><p>{dataset.methodology} 当前原型来自你提供的两份 iFind 导出文件；历史财报期可按同一模板持续导入。</p><div><span>主数据源 · iFind</span><span>备选 · Tushare Pro</span><span>校验 · 公开披露</span></div></section>
    <footer><strong>持仓雷达</strong><span>数据更新时间 2026-07-16 · 2026 一季报样本</span></footer>
  </main>;
}
