"use client";

import { useEffect, useMemo, useState } from "react";
import { exportHoldingsWorkbook } from "./lib/export-xlsx";
import type { CompanyIndex, FundHoldings, FundItem, Holding, ManagerIndex, MarketIndex } from "./types";

type CompanyPayload = { company: CompanyIndex; funds: FundItem[]; mode: "live" | "snapshot" };
type ManagerHolding = { rank: number; stockCode: string; stockName: string; marketValue: number; fundCount: number; estimatedWeight: number; change: string; changeShares: number; shares: number };
type ManagerPayload = { period: string; requested: number; succeeded: number; failed: number; estimatedNav: number; holdings: ManagerHolding[]; source: string };
const FALLBACK_PERIODS = ["2026-03-31", "2025-12-31", "2025-09-30"];

const fmt = (value: number, digits = 1) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
const periodLabel = (period: string) => `${period.slice(0, 4)} ${period.slice(5, 7) === "03" ? "一季报" : period.slice(5, 7) === "06" ? "中报" : period.slice(5, 7) === "09" ? "三季报" : "年报"}`;
const changeTone = (change: string) => change === "增持" || change === "新进" ? "up" : change === "减持" ? "down" : "flat";

function representativeCodes(manager: ManagerIndex) {
  const result = new Map<string, string>();
  manager.fundCodes.forEach((code, index) => {
    const name = manager.fundNames[index] ?? code;
    const key = name.replace(/\((?:QDII|FOF)\)/gi, "").replace(/[A-EHIOY]$/, "").replace(/人民币.*$/, "").trim();
    if (!result.has(key)) result.set(key, code);
  });
  return [...result.values()];
}

function Skeleton({ label }: { label: string }) { return <div className="loading-state"><span className="spinner" />{label}</div>; }

function FundTable({ rows }: { rows: Holding[] }) {
  if (!rows.length) return <div className="empty-state">该财报期未披露股票前十大持仓</div>;
  return <div className="table-wrap" tabIndex={0} role="region" aria-label="基金前十大重仓股，可横向滚动"><table><thead><tr><th>#</th><th>股票</th><th className="num core-col">占净值</th><th className="core-col">持仓变化</th><th className="optional-col">代码</th><th className="num optional-col">持股/万</th><th className="num optional-col">市值/万</th></tr></thead><tbody>{rows.map((row) => <tr key={row.stockCode}><td><b className={`rank r${row.rank}`}>{row.rank}</b></td><td><strong>{row.stockName}</strong></td><td className="num accent core-col">{fmt(row.weight, 2)}%</td><td className="core-col"><span className={`change ${changeTone(row.change)}`}>{row.change}{row.changeShares !== null && row.changeShares !== 0 ? ` ${row.changeShares > 0 ? "+" : ""}${fmt(row.changeShares, 1)}` : ""}</span></td><td className="muted mono optional-col">{row.stockCode}</td><td className="num mono optional-col">{fmt(row.shares, 2)}</td><td className="num mono optional-col">{fmt(row.marketValue, 0)}</td></tr>)}</tbody></table></div>;
}

function ManagerTable({ rows }: { rows: ManagerHolding[] }) {
  if (!rows.length) return <div className="empty-state">在管基金未披露股票前十大持仓</div>;
  return <div className="table-wrap" tabIndex={0} role="region" aria-label="基金经理汇总前十大重仓股，可横向滚动"><table><thead><tr><th>#</th><th>股票</th><th className="num core-col">估算占净值</th><th className="core-col">持仓变化</th><th className="optional-col">代码</th><th className="num optional-col">汇总市值/万</th><th className="num optional-col">涉及基金</th></tr></thead><tbody>{rows.map((row) => <tr key={row.stockCode}><td><b className={`rank r${row.rank}`}>{row.rank}</b></td><td><strong>{row.stockName}</strong></td><td className="num accent core-col">{fmt(row.estimatedWeight, 2)}%</td><td className="core-col"><span className={`change ${changeTone(row.change)}`}>{row.change}{row.changeShares !== 0 ? ` ${row.changeShares > 0 ? "+" : ""}${fmt(row.changeShares, 1)}` : ""}</span></td><td className="muted mono optional-col">{row.stockCode}</td><td className="num mono optional-col">{fmt(row.marketValue, 0)}</td><td className="num mono optional-col">{row.fundCount}</td></tr>)}</tbody></table></div>;
}

export default function Home() {
  const [market, setMarket] = useState<MarketIndex | null>(null);
  const [marketMode, setMarketMode] = useState<"live" | "snapshot">("snapshot");
  const [periods, setPeriods] = useState(FALLBACK_PERIODS);
  const [period, setPeriod] = useState(FALLBACK_PERIODS[0]);
  const [companyId, setCompanyId] = useState("80000222");
  const [companyData, setCompanyData] = useState<CompanyPayload | null>(null);
  const [mode, setMode] = useState<"manager" | "fund">("manager");
  const [query, setQuery] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [selectedFundCode, setSelectedFundCode] = useState("");
  const [fundHoldings, setFundHoldings] = useState<FundHoldings | null>(null);
  const [managerHoldings, setManagerHoldings] = useState<ManagerPayload | null>(null);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/market").then((response) => response.json()), fetch("/api/periods").then((response) => response.json())]).then(([marketResult, periodResult]) => {
      setMarket(marketResult); setMarketMode(marketResult.mode ?? "snapshot");
      const nextPeriods = periodResult.periods?.length ? periodResult.periods : FALLBACK_PERIODS; setPeriods(nextPeriods); setPeriod(nextPeriods[0]);
      if (!marketResult.companies.some((item: CompanyIndex) => item.id === companyId)) setCompanyId(marketResult.companies[0]?.id ?? "");
    }).catch(() => setError("全市场索引加载失败，请稍后重试"));
    fetch("/api/market-live").then((response) => response.json()).then((result) => { if (result.mode === "live" && result.companyCount > 100) { setMarket(result); setMarketMode("live"); } }).catch(() => undefined);
  }, []);

  const company = useMemo(() => market?.companies.find((item) => item.id === companyId) ?? null, [market, companyId]);
  useEffect(() => {
    if (!companyId) return;
    setCompanyLoading(true); setError(""); setQuery("");
    fetch(`/api/company?id=${encodeURIComponent(companyId)}`).then(async (response) => { if (!response.ok) throw new Error("公司数据加载失败"); return response.json(); }).then((result: CompanyPayload) => {
      setCompanyData(result); setSelectedManagerId(result.company.managers[0]?.id ?? ""); setSelectedFundCode(result.funds[0]?.code ?? "");
    }).catch((reason) => setError(reason.message)).finally(() => setCompanyLoading(false));
  }, [companyId]);

  const managers = companyData?.company.managers ?? company?.managers ?? [];
  const funds = companyData?.funds ?? [];
  const filteredManagers = useMemo(() => { const key = query.trim().toLowerCase(); return key ? managers.filter((item) => `${item.name} ${item.fundNames.join(" ")}`.toLowerCase().includes(key)) : managers; }, [managers, query]);
  const filteredFunds = useMemo(() => { const key = query.trim().toLowerCase(); return key ? funds.filter((item) => `${item.code} ${item.name} ${item.pinyin} ${item.managers.join(" ")}`.toLowerCase().includes(key)) : funds; }, [funds, query]);
  const selectedManager = managers.find((item) => item.id === selectedManagerId) ?? managers[0];
  const selectedFund = funds.find((item) => item.code === selectedFundCode) ?? funds[0];

  useEffect(() => {
    if (mode !== "fund" || !selectedFund?.code || !period) return;
    setDetailLoading(true); setFundHoldings(null); setError("");
    fetch(`/api/holdings?code=${selectedFund.code}&period=${period}`).then(async (response) => { if (!response.ok) throw new Error("基金持仓加载失败"); return response.json(); }).then(setFundHoldings).catch((reason) => setError(reason.message)).finally(() => setDetailLoading(false));
  }, [mode, selectedFund?.code, period]);

  useEffect(() => {
    if (mode !== "manager" || !selectedManager?.id || !period) return;
    setDetailLoading(true); setManagerHoldings(null); setError("");
    fetch("/api/manager-holdings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codes: representativeCodes(selectedManager), period }) }).then(async (response) => { if (!response.ok) throw new Error("经理持仓汇总失败"); return response.json(); }).then(setManagerHoldings).catch((reason) => setError(reason.message)).finally(() => setDetailLoading(false));
  }, [mode, selectedManager?.id, period]);

  const exportCurrent = () => {
    if (!company) return;
    if (mode === "fund" && selectedFund && fundHoldings) exportHoldingsWorkbook({ companyName: company.name, entityType: "基金", entityName: selectedFund.name, entityCode: selectedFund.code, period, holdings: fundHoldings.holdings, notes: [["基金经理", selectedFund.managers.join("、") || "未匹配"], ["数据源", fundHoldings.source]] });
    if (mode === "manager" && selectedManager && managerHoldings) exportHoldingsWorkbook({ companyName: company.name, entityType: "基金经理", entityName: selectedManager.name, period, holdings: managerHoldings.holdings, notes: [["在管基金", selectedManager.fundCodes.length], ["参与汇总基金", managerHoldings.succeeded], ["估算在管净值(亿元)", managerHoldings.estimatedNav / 10000], ["失败基金", managerHoldings.failed], ["数据源", managerHoldings.source]] });
  };

  const canExport = mode === "fund" ? Boolean(fundHoldings) : Boolean(managerHoldings);
  return <main>
    <header className="topbar"><div className="logo">仓</div><div><strong>全市场持仓雷达</strong><small>PUBLIC FUND HOLDINGS</small></div><span className={`health ${marketMode}`}><i />{marketMode === "live" ? "实时索引" : "快照已加载"}</span></header>
    <section className="hero"><p className="kicker">QUARTERLY OWNERSHIP INTELLIGENCE</p><h1>全市场基金与基金经理<br />近三期重仓股</h1><p>覆盖全部基金公司，按公司穿透全部基金与基金经理；最新报告期自动发现，数据按需加载并可导出高密度 Excel。</p><div className="market-strip"><span><b>{market?.companyCount ?? "—"}</b> 管理机构</span><span><b>{fmt(market?.managerCount ?? 0, 0)}</b> 基金经理</span><span><b>{fmt(market?.managedFundCount ?? 0, 0)}</b> 在管基金代码</span></div></section>
    <section className="controls"><label><span>最新财报期 · 自动探测</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>{periods.map((item) => <option key={item} value={item}>{periodLabel(item)} · {item}</option>)}</select></label><label><span>基金公司 · 全市场</span><select value={companyId} onChange={(event) => setCompanyId(event.target.value)} disabled={!market}>{market?.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></section>
    <section className="coverage"><div><small>该公司基金</small><strong>{companyLoading ? "…" : funds.length}</strong></div><div><small>基金经理</small><strong>{companyLoading ? "…" : managers.length}</strong></div><div><small>数据状态</small><strong className="status-text">{companyData?.mode === "live" ? "实时" : "回退"}</strong></div><div><small>当前报告期</small><strong className="status-text">{period.slice(0, 7)}</strong></div></section>
    <section className="workspace">
      <div className="tabs"><button className={mode === "manager" ? "active" : ""} onClick={() => setMode("manager")}>基金经理</button><button className={mode === "fund" ? "active" : ""} onClick={() => setMode("fund")}>基金产品</button></div>
      <div className="entity-tools"><div className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "manager" ? "搜索经理、在管基金" : "搜索基金代码、名称、经理"} />{query && <button onClick={() => setQuery("")}>×</button>}</div><button className="export" onClick={exportCurrent} disabled={!canExport || detailLoading}>导出当前 Excel</button></div>
      {companyLoading ? <Skeleton label="正在读取该公司全部基金与经理…" /> : <><div className="result-head"><strong>{mode === "manager" ? "全部基金经理" : "全部基金"}</strong><span>{mode === "manager" ? filteredManagers.length : filteredFunds.length} 条 · 横向滑动</span></div><div className="entity-rail">{mode === "manager" ? filteredManagers.map((item) => <button key={item.id} className={item.id === selectedManager?.id ? "active" : ""} onClick={() => setSelectedManagerId(item.id)}><strong>{item.name}</strong><small>{item.fundCodes.length} 只 · 从业 {fmt(item.tenureDays / 365, 1)} 年</small></button>) : filteredFunds.map((item) => <button key={item.code} className={item.code === selectedFund?.code ? "active" : ""} onClick={() => setSelectedFundCode(item.code)}><strong>{item.name}</strong><small>{item.code} · {item.managers.join("、") || "经理待匹配"}</small></button>)}</div></>}
      {error && <div className="error-banner">{error}</div>}
      <div className="detail-card">
        {mode === "manager" && selectedManager && <><div className="detail-title"><div><span>FUND MANAGER</span><h2>{selectedManager.name}</h2><p>{company?.name} · {selectedManager.fundCodes.length} 个在管基金代码 · 净值占比为在管基金汇总估算</p></div><em>估算汇总</em></div><div className="mini-metrics"><div><small>从业年限</small><b>{fmt(selectedManager.tenureDays / 365, 1)} 年</b></div><div><small>去重后产品</small><b>{representativeCodes(selectedManager).length} 只</b></div><div><small>估算在管净值</small><b>{managerHoldings ? `${fmt(managerHoldings.estimatedNav / 10000, 1)} 亿` : "—"}</b></div><div><small>成功汇总</small><b>{managerHoldings?.succeeded ?? "—"} 只</b></div></div>{detailLoading ? <Skeleton label="正在汇总经理在管基金持仓…" /> : <ManagerTable rows={managerHoldings?.holdings ?? []} />}</>}
        {mode === "fund" && selectedFund && <><div className="detail-title"><div><span>PUBLIC FUND</span><h2>{selectedFund.name}</h2><p>{selectedFund.code} · {selectedFund.managers.join("、") || "基金经理待匹配"}</p></div><em>公开披露</em></div><div className="mini-metrics"><div><small>财报期</small><b>{period.slice(0, 7)}</b></div><div><small>披露股票</small><b>{fundHoldings?.holdings.length ?? "—"} 只</b></div><div><small>前十净值占比</small><b>{fundHoldings ? `${fmt(fundHoldings.holdings.reduce((sum, item) => sum + item.weight, 0), 1)}%` : "—"}</b></div><div><small>数据源</small><b>东方财富</b></div></div>{detailLoading ? <Skeleton label="正在读取基金季报持仓…" /> : <FundTable rows={fundHoldings?.holdings ?? []} />}</>}
      </div>
    </section>
    <section className="method"><div><span>自动化数据链路</span><h2>实时索引 → 公司全量 → 单体持仓 → 季度缓存</h2></div><ol><li><b>主源</b> iFind 官方 API：账号具备数据接口权限后优先启用。</li><li><b>容灾</b> 东方财富：自动取得公司、经理、基金与定期报告持仓。</li><li><b>更新</b> 每 6 小时探测最新财报期；中报公开后自动出现 2026-06-30。</li><li><b>口径</b> 基金占净值为原始披露；经理占净值为去重在管基金净值汇总估算。</li></ol></section>
    <footer><strong>全市场持仓雷达</strong><span>索引更新 {market?.generatedAt ? new Date(market.generatedAt).toLocaleString("zh-CN") : "读取中"} · 数据仅供研究</span></footer>
  </main>;
}

