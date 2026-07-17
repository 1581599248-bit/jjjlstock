"use client";

import { useEffect, useMemo, useState } from "react";
import { exportCompanyFundsWorkbook, exportCompanyInstitutionWorkbook, exportCompanyManagerSectorsWorkbook, exportCompanyOverviewWorkbook, exportHoldingsWorkbook } from "./lib/export-xlsx";
import type { CompanyIndex, FundHoldings, FundItem, Holding, ManagerIndex, MarketIndex } from "./types";

type CompanyPayload = { company: CompanyIndex; funds: FundItem[]; mode: "live" | "snapshot" };
type ManagerHolding = { rank: number; stockCode: string; stockName: string; industry: string; marketValue: number; fundCount: number; weight: number; change: string; shares: number };
type SectorHolding = { rank: number; industry: string; marketValue: number; navWeight: number; holdingShare: number; stockCount: number };
type ManagerPayload = { period: string; requested: number; succeeded: number; failed: number; managedNav: number; holdings: ManagerHolding[]; sectors: SectorHolding[]; source: string };
type StaticOverviewPayload = { companyId: string; period: string; managers: Record<string, ManagerPayload> };
type StaticFundProduct = { code: string; name: string; shareCodes: string[]; managers: string[]; holdings: Holding[] };
type StaticFundPayload = { companyId: string; companyName: string; period: string; source: string; productCount: number; products: StaticFundProduct[] };
type StaticSectorPayload = { companyId: string; companyName: string; period: string; source: string; managerCount: number; managers: Record<string, { name: string; sectors: SectorHolding[] }> };
type StockIndexItem = { stockCode: string; stockName: string; companyCount: number; managerCount: number; bucket: string };
type StockSearchIndex = { period: string; generatedAt: string; source: string; stockCount: number; companyCount: number; managerCount: number; managerHoldingCount: number; stocks: StockIndexItem[] };
type StockOwnerManager = { managerId: string; managerName: string; rank: number; navWeight: number; marketValue: number; change: string; fundCount: number };
type StockOwnerCompany = { companyId: string; companyName: string; managers: StockOwnerManager[] };
type StockOwnerDetail = { stockCode: string; stockName: string; companyCount: number; managerCount: number; companies: StockOwnerCompany[] };
type StockBucketPayload = { period: string; source: string; stocks: Record<string, StockOwnerDetail> };
const AVAILABLE_PERIODS = ["2026-03-31"];
const OVERVIEW_PAGE_SIZE = 12;
const STOCK_COMPANY_PAGE_SIZE = 10;
const stockBucketCache = new Map<string, Promise<StockBucketPayload>>();

const fmt = (value: number, digits = 1) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
const fundScale = (value: number | null) => value === null ? "待披露" : `${fmt(value, value >= 100 ? 1 : 2)} 亿`;
const periodLabel = (period: string) => `${period.slice(0, 4)} ${period.slice(5, 7) === "03" ? "一季报" : period.slice(5, 7) === "06" ? "中报" : period.slice(5, 7) === "09" ? "三季报" : "年报"}`;
const changeTone = (change: string) => change === "增持" || change === "新进" ? "up" : change === "减持" ? "down" : "flat";
const holdingMarketValue = (value: number) => value >= 10_000 ? `${fmt(value / 10_000, 2)}亿` : `${fmt(value, 0)}万`;
const isOtherIndustry = (industry: string) => /^(其他|未分类|未知|其他\/未分类)$/.test(industry.trim());
const orderSectors = (rows: SectorHolding[]) => [...rows].sort((a, b) => Number(isOtherIndustry(a.industry)) - Number(isOtherIndustry(b.industry)) || b.marketValue - a.marketValue);
const productKey = (name: string) => name
  .replace(/\s+/g, "")
  .replace(/(?:人民币|美元现汇|美元现钞|美汇|美钞|美元)(?=[（(]|$)/i, "")
  .replace(/[A-EHIOY](?:\d+)?(?=[（(]|$)/i, "")
  .replace(/(?:人民币|美元现汇|美元现钞|美汇|美钞|美元)$/i, "")
  .replace(/[A-EHIOY](?:\d+)?$/i, "")
  .trim();

function fetchStockBucket(period: string, bucket: string) {
  const key = `${period}|${bucket}`;
  if (!stockBucketCache.has(key)) {
    stockBucketCache.set(key, fetch(`/data/stocks/${period}/buckets/${bucket}.json`).then(async (response) => {
      if (!response.ok) throw new Error("股票机构数据读取失败");
      const payload = await response.json() as StockBucketPayload;
      if (payload.period !== period) throw new Error("股票机构数据财报期不匹配");
      return payload;
    }).catch((error) => { stockBucketCache.delete(key); throw error; }));
  }
  return stockBucketCache.get(key)!;
}

function representativeCodes(manager: ManagerIndex) {
  const result = new Map<string, string>();
  manager.fundCodes.forEach((code, index) => {
    const name = manager.fundNames[index] ?? code;
    const key = productKey(name);
    if (!result.has(key)) result.set(key, code);
  });
  return [...result.values()];
}

function managerProducts(manager: ManagerIndex, funds: FundItem[]) {
  const fundMap = new Map(funds.map((fund) => [fund.code, fund]));
  const grouped = new Map<string, { code: string; shareCodes: string[] }>();
  manager.fundCodes.forEach((code, index) => {
    const key = productKey(manager.fundNames[index] ?? code);
    const group = grouped.get(key) ?? { code, shareCodes: [] };
    group.shareCodes.push(code); grouped.set(key, group);
  });
  return [...grouped.values()].map((group) => {
    const disclosed = group.shareCodes.map((code) => fundMap.get(code)?.netAsset).filter((value): value is number => typeof value === "number");
    return { code: group.code, shareCodes: group.shareCodes, netAsset: disclosed.length ? disclosed.reduce((sum, value) => sum + value, 0) : null };
  });
}

function overviewRequestGroups(managers: ManagerIndex[], funds: FundItem[], maxUniqueProducts = 20) {
  const groups: Array<Array<{ id: string; products: ReturnType<typeof managerProducts> }>> = [];
  let current: Array<{ id: string; products: ReturnType<typeof managerProducts> }> = [];
  let currentCodes = new Set<string>();
  for (const manager of managers) {
    const products = managerProducts(manager, funds);
    const nextCodes = new Set([...currentCodes, ...products.map((product) => product.code)]);
    if (current.length && nextCodes.size > maxUniqueProducts) {
      groups.push(current); current = []; currentCodes = new Set<string>();
    }
    current.push({ id: manager.id, products });
    products.forEach((product) => currentCodes.add(product.code));
  }
  if (current.length) groups.push(current);
  return groups;
}

function Skeleton({ label }: { label: string }) { return <div className="loading-state"><span className="spinner" />{label}</div>; }

function FundTable({ rows }: { rows: Holding[] }) {
  if (!rows.length) return <div className="empty-state">该财报期未披露股票前十大持仓</div>;
  return <div className="table-wrap" tabIndex={0} role="region" aria-label="基金前十大重仓股，可横向滚动"><table><thead><tr><th>#</th><th>股票</th><th className="num core-col">净值占比</th><th className="core-col">持仓变化</th><th className="num optional-col">持股/万</th><th className="num optional-col">披露市值/万</th></tr></thead><tbody>{rows.map((row) => <tr key={row.stockCode}><td><b className={`rank r${row.rank}`}>{row.rank}</b></td><td><strong>{row.stockName}</strong></td><td className="num accent core-col">{fmt(row.weight, 2)}%</td><td className="core-col"><span className={`change ${changeTone(row.change)}`}>{row.change}</span></td><td className="num mono optional-col">{fmt(row.shares, 2)}</td><td className="num mono optional-col">{fmt(row.marketValue, 0)}</td></tr>)}</tbody></table></div>;
}

function ManagerTable({ rows }: { rows: ManagerHolding[] }) {
  if (!rows.length) return <div className="empty-state">在管基金未披露股票前十大持仓</div>;
  return <><div className="table-wrap" tabIndex={0} role="region" aria-label="基金经理汇总前十大重仓股，可横向滚动"><table><thead><tr><th>#</th><th>股票</th><th className="num core-col">净值占比</th><th className="core-col">持仓变化</th><th className="num optional-col">披露市值/万</th><th className="num optional-col">涉及基金</th></tr></thead><tbody>{rows.map((row) => <tr key={row.stockCode}><td><b className={`rank r${row.rank}`}>{row.rank}</b></td><td><strong>{row.stockName}</strong></td><td className="num accent core-col">{fmt(row.weight, 2)}%</td><td className="core-col"><span className={`change ${changeTone(row.change)}`}>{row.change}</span></td><td className="num mono optional-col">{fmt(row.marketValue, 0)}</td><td className="num mono optional-col">{row.fundCount}</td></tr>)}</tbody></table></div><p className="value-note">披露市值直接加总各产品定期报告数据；A/C 等份额持仓只计算一次，净资产规模合并后用于计算经理净值占比。</p></>;
}

function SectorBreakdown({ rows }: { rows: SectorHolding[] }) {
  if (!rows.length) return null;
  const orderedRows = orderSectors(rows);
  return <section className="sector-card" aria-label="基金经理重仓行业分布"><div className="sector-head"><div><span>INDUSTRY ALLOCATION</span><h3>重仓行业分布</h3></div><small>行业：东方财富原始分类</small></div><div className="sector-list">{orderedRows.map((row) => <div className={`sector-row${isOtherIndustry(row.industry) ? " other" : ""}`} key={row.industry}><div className="sector-label"><b>{row.industry}</b><small>{row.stockCount} 只股票</small></div><div className="sector-track"><i style={{ width: `${Math.max(row.holdingShare, 2)}%` }} /></div><div className="sector-values"><b>{fmt(row.holdingShare, 1)}%</b><small>净值 {fmt(row.navWeight, 2)}%</small></div></div>)}</div><p>行业名称直接读取东方财富行业字段，不做模型推断；无法识别的证券归入“其他/未分类”并固定置底。柱形为该行业占经理前十大重仓市值的比例。</p></section>;
}

function StockReverseLookup({ query, items, selectedCode, onSelect, detail, indexLoading, detailLoading, error, companyPage, onCompanyPage }: {
  query: string;
  items: StockIndexItem[];
  selectedCode: string;
  onSelect: (code: string) => void;
  detail: StockOwnerDetail | null;
  indexLoading: boolean;
  detailLoading: boolean;
  error: string;
  companyPage: number;
  onCompanyPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil((detail?.companies.length ?? 0) / STOCK_COMPANY_PAGE_SIZE));
  const companies = detail?.companies.slice(companyPage * STOCK_COMPANY_PAGE_SIZE, (companyPage + 1) * STOCK_COMPANY_PAGE_SIZE) ?? [];
  return <>
    <div className="stock-lookup-title"><div><span>STOCK OWNERSHIP LOOKUP</span><h2>股票重仓反查</h2><p>输入股票代码或名称，查看全市场哪些基金公司与基金经理将其列入前十大重仓。</p></div><em>全市场</em></div>
    {indexLoading ? <Skeleton label="正在读取全市场股票反查索引…" /> : <>
      <div className="result-head"><strong>{query.trim() ? "匹配股票" : "基金经理覆盖最多"}</strong><span>{items.length} 条结果 · 横向滑动</span></div>
      {items.length ? <div className="stock-result-rail">{items.map((item) => <button key={item.stockCode} className={item.stockCode === selectedCode ? "active" : ""} onClick={() => onSelect(item.stockCode)}><strong>{item.stockName}</strong><small>{item.stockCode}</small><span>{item.companyCount} 家机构 · {item.managerCount} 位经理</span></button>)}</div> : <div className="empty-state">没有找到进入基金经理前十大重仓的匹配股票</div>}
    </>}
    {error && <div className="error-banner">{error}</div>}
    {selectedCode && <div className="stock-owner-detail">{detailLoading ? <Skeleton label="正在读取该股票的机构与经理…" /> : detail ? <>
      <div className="stock-owner-head"><div><span>{detail.stockCode}</span><h2>{detail.stockName}</h2><p>{detail.companyCount} 家基金公司 · {detail.managerCount} 位基金经理的前十大重仓</p></div><b>{detail.managerCount}</b></div>
      <div className="stock-owner-toolbar"><div><strong>持仓机构与基金经理</strong><span>按机构覆盖经理数排序；经理按净值占比排序</span></div><div className="pager"><button onClick={() => onCompanyPage(Math.max(0, companyPage - 1))} disabled={companyPage === 0}>‹</button><b>{companyPage + 1} / {pageCount}</b><button onClick={() => onCompanyPage(Math.min(pageCount - 1, companyPage + 1))} disabled={companyPage >= pageCount - 1}>›</button></div></div>
      <div className="owner-company-list">{companies.map((company) => <article className="owner-company" key={company.companyId}><header><div><strong>{company.companyName}</strong><small>{company.managers.length} 位重仓经理</small></div><span>机构</span></header><div className="owner-manager-list">{company.managers.map((manager) => <div className="owner-manager" key={manager.managerId}><div><b>{manager.managerName}</b><small>第 {manager.rank} 名 · 涉及 {manager.fundCount} 只基金 · 市值 {holdingMarketValue(manager.marketValue)}</small></div><div className="owner-weight"><strong>{fmt(manager.navWeight, 2)}%</strong><small>净值占比</small></div><span className={`change ${changeTone(manager.change)}`}>{manager.change}</span></div>)}</div></article>)}</div>
      <p className="overview-note">口径为基金经理在管产品合并后的前十大重仓。联合管理基金会分别计入对应经理；机构数量和经理数量用于表示覆盖范围，不将经理市值再次汇总为机构市值。未出现不代表完全未持有，只表示未进入经理汇总前十。</p>
    </> : null}</div>}
  </>;
}

function OverviewMatrix({ managers, data, loading }: { managers: ManagerIndex[]; data: Record<string, ManagerPayload>; loading: boolean }) {
  if (!managers.length) return <div className="empty-state">未找到符合条件的基金经理</div>;
  const holdingAt = (manager: ManagerIndex, rank: number) => data[manager.id]?.holdings[rank];
  return <div className="overview-matrix-wrap" tabIndex={0} role="region" aria-label="基金公司全部基金经理持仓总览，可横向滚动">
    <table className="overview-matrix">
      <thead><tr><th className="matrix-label">经理指标</th>{managers.map((manager) => <th key={manager.id}><strong>{manager.name}</strong><small>{data[manager.id] ? `${data[manager.id].succeeded}/${data[manager.id].requested} 只成功` : loading ? "读取中" : "待读取"}</small></th>)}</tr></thead>
      <tbody>
        <tr className="manager-stat"><th className="matrix-label">在管基金总规模</th>{managers.map((manager) => <td key={manager.id}>{data[manager.id] ? `${fmt(data[manager.id].managedNav / 10000, 2)}亿` : "—"}</td>)}</tr>
        <tr className="manager-stat"><th className="matrix-label">投资经理年限</th>{managers.map((manager) => <td key={manager.id}>{fmt(manager.tenureDays / 365, 1)}年</td>)}</tr>
        <tr className="manager-stat stat-end"><th className="matrix-label">在任管理基金数</th>{managers.map((manager) => <td key={manager.id}>{representativeCodes(manager).length}</td>)}</tr>
      </tbody>
        {Array.from({ length: 10 }, (_, rank) => <tbody className="rank-group" key={rank}>
          <tr className="rank-stock"><th className="matrix-label">第{rank + 1}名</th>{managers.map((manager) => <td key={manager.id}><strong>{holdingAt(manager, rank)?.stockName ?? "—"}</strong></td>)}</tr>
          <tr><th className="matrix-label">净值占比</th>{managers.map((manager) => <td className="matrix-weight" key={manager.id}>{holdingAt(manager, rank) ? `${fmt(holdingAt(manager, rank)!.weight, 2)}%` : "—"}</td>)}</tr>
          <tr className="rank-end"><th className="matrix-label">重仓股持仓变动</th>{managers.map((manager) => { const change = holdingAt(manager, rank)?.change; return <td key={manager.id}>{change ? <span className={`matrix-change ${changeTone(change)}`}>{change}</span> : "—"}</td>; })}</tr>
        </tbody>)}
    </table>
  </div>;
}

export default function Home() {
  const [market, setMarket] = useState<MarketIndex | null>(null);
  const [periods, setPeriods] = useState(AVAILABLE_PERIODS);
  const [period, setPeriod] = useState(AVAILABLE_PERIODS[0]);
  const [companyId, setCompanyId] = useState("80000222");
  const [companyData, setCompanyData] = useState<CompanyPayload | null>(null);
  const [mode, setMode] = useState<"overview" | "manager" | "fund" | "stock">("overview");
  const [query, setQuery] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [selectedFundCode, setSelectedFundCode] = useState("");
  const [fundHoldings, setFundHoldings] = useState<FundHoldings | null>(null);
  const [managerHoldings, setManagerHoldings] = useState<ManagerPayload | null>(null);
  const [overviewPage, setOverviewPage] = useState(0);
  const [overviewData, setOverviewData] = useState<Record<string, ManagerPayload>>({});
  const [overviewScope, setOverviewScope] = useState("");
  const [overviewStaticScope, setOverviewStaticScope] = useState("");
  const [overviewStaticHit, setOverviewStaticHit] = useState(false);
  const [sectorData, setSectorData] = useState<StaticSectorPayload | null>(null);
  const [sectorStaticScope, setSectorStaticScope] = useState("");
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewProgress, setOverviewProgress] = useState(0);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [fundExportLoading, setFundExportLoading] = useState(false);
  const [sectorExportLoading, setSectorExportLoading] = useState(false);
  const [institutionExportLoading, setInstitutionExportLoading] = useState(false);
  const [stockIndex, setStockIndex] = useState<StockSearchIndex | null>(null);
  const [selectedStockCode, setSelectedStockCode] = useState("");
  const [stockDetail, setStockDetail] = useState<StockOwnerDetail | null>(null);
  const [stockIndexLoading, setStockIndexLoading] = useState(false);
  const [stockDetailLoading, setStockDetailLoading] = useState(false);
  const [stockCompanyPage, setStockCompanyPage] = useState(0);
  const [stockError, setStockError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/market").then((response) => response.json()), fetch("/api/periods").then((response) => response.json())]).then(([marketResult, periodResult]) => {
      setMarket(marketResult);
      const nextPeriods = periodResult.periods?.length ? periodResult.periods : AVAILABLE_PERIODS; setPeriods(nextPeriods); setPeriod(nextPeriods[0]);
      if (!marketResult.companies.some((item: CompanyIndex) => item.id === companyId)) setCompanyId(marketResult.companies[0]?.id ?? "");
    }).catch(() => setError("全市场索引加载失败，请稍后重试"));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStockIndexLoading(true); setStockIndex(null); setSelectedStockCode(""); setStockDetail(null); setStockError("");
    fetch(`/data/stocks/${period}/index.json`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("该季度的股票反查数据尚未发布");
      return response.json() as Promise<StockSearchIndex>;
    }).then((payload) => {
      if (payload.period !== period) throw new Error("股票反查数据财报期不匹配");
      if (!controller.signal.aborted) setStockIndex(payload);
    }).catch((reason) => { if (!controller.signal.aborted) setStockError(reason instanceof Error ? reason.message : "股票反查索引读取失败"); }).finally(() => { if (!controller.signal.aborted) setStockIndexLoading(false); });
    return () => controller.abort();
  }, [period]);

  const company = useMemo(() => market?.companies.find((item) => item.id === companyId) ?? null, [market, companyId]);
  useEffect(() => {
    if (!companyId) return;
    setCompanyLoading(true); setError(""); setQuery("");
    setCompanyData(null);
    fetch(`/api/company?id=${encodeURIComponent(companyId)}&period=${encodeURIComponent(period)}&metadata=2`).then(async (response) => { if (!response.ok) throw new Error("公司数据加载失败"); return response.json(); }).then((result: CompanyPayload) => {
      setCompanyData(result); setSelectedFundCode(result.funds[0]?.code ?? "");
    }).catch((reason) => setError(reason.message)).finally(() => setCompanyLoading(false));
  }, [companyId, period]);

  const managers = company?.managers ?? companyData?.company.managers ?? [];
  const marketProductCount = useMemo(() => {
    const products = new Set<string>();
    for (const item of market?.companies ?? []) for (const manager of item.managers) manager.fundCodes.forEach((code, index) => {
      products.add(`${item.id}:${productKey(manager.fundNames[index] ?? code)}`);
    });
    return products.size;
  }, [market]);
  const companyProductCount = useMemo(() => {
    const products = new Set<string>();
    for (const manager of managers) manager.fundCodes.forEach((code, index) => products.add(productKey(manager.fundNames[index] ?? code)));
    return products.size;
  }, [managers]);
  const managerByFund = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const manager of managers) for (const code of manager.fundCodes) {
      const names = result.get(code) ?? [];
      names.push(manager.name);
      result.set(code, names);
    }
    return result;
  }, [managers]);
  const funds = useMemo(() => (companyData?.funds ?? []).map((fund) => ({ ...fund, managers: managerByFund.get(fund.code) ?? fund.managers })), [companyData?.funds, managerByFund]);
  useEffect(() => {
    if (managers.length && !managers.some((item) => item.id === selectedManagerId)) setSelectedManagerId(managers[0].id);
  }, [managers, selectedManagerId]);
  const filteredManagers = useMemo(() => { const key = query.trim().toLowerCase(); return key ? managers.filter((item) => `${item.name} ${item.fundNames.join(" ")}`.toLowerCase().includes(key)) : managers; }, [managers, query]);
  const filteredFunds = useMemo(() => { const key = query.trim().toLowerCase(); return key ? funds.filter((item) => `${item.code} ${item.name} ${item.pinyin} ${item.managers.join(" ")}`.toLowerCase().includes(key)) : funds; }, [funds, query]);
  const filteredStocks = useMemo(() => {
    const key = query.trim().replace(/\s+/g, "").toLowerCase();
    const rows = key ? (stockIndex?.stocks ?? []).filter((item) => `${item.stockCode}${item.stockName}`.replace(/\s+/g, "").toLowerCase().includes(key)) : stockIndex?.stocks ?? [];
    return rows.slice(0, key ? 40 : 20);
  }, [stockIndex, query]);
  const overviewPageCount = Math.max(1, Math.ceil(filteredManagers.length / OVERVIEW_PAGE_SIZE));
  const overviewManagers = filteredManagers.slice(overviewPage * OVERVIEW_PAGE_SIZE, (overviewPage + 1) * OVERVIEW_PAGE_SIZE);
  const companyScale = funds.reduce((sum, fund) => sum + (fund.netAsset ?? 0), 0);
  const scaleDisclosed = funds.filter((fund) => fund.netAsset !== null).length;
  const selectedManager = managers.find((item) => item.id === selectedManagerId) ?? managers[0];
  const selectedFund = funds.find((item) => item.code === selectedFundCode) ?? funds[0];

  useEffect(() => {
    if (mode !== "stock") return;
    const key = query.trim().replace(/\s+/g, "").toLowerCase();
    const exact = filteredStocks.find((item) => item.stockCode.toLowerCase() === key || item.stockName.replace(/\s+/g, "").toLowerCase() === key);
    const next = filteredStocks.some((item) => item.stockCode === selectedStockCode)
      ? selectedStockCode
      : !key ? filteredStocks[0]?.stockCode ?? ""
        : exact?.stockCode ?? (filteredStocks.length === 1 ? filteredStocks[0].stockCode : "");
    if (next !== selectedStockCode) setSelectedStockCode(next);
  }, [mode, filteredStocks, selectedStockCode, query]);

  useEffect(() => {
    if (mode !== "stock" || !selectedStockCode || !stockIndex) return;
    const item = stockIndex.stocks.find((stock) => stock.stockCode === selectedStockCode);
    if (!item) return;
    let active = true;
    setStockDetailLoading(true); setStockDetail(null); setStockError(""); setStockCompanyPage(0);
    fetchStockBucket(period, item.bucket).then((payload) => {
      const detail = payload.stocks[selectedStockCode];
      if (!detail) throw new Error("未找到该股票的机构明细");
      if (active) setStockDetail(detail);
    }).catch((reason) => { if (active) setStockError(reason instanceof Error ? reason.message : "股票机构明细读取失败"); }).finally(() => { if (active) setStockDetailLoading(false); });
    return () => { active = false; };
  }, [mode, selectedStockCode, stockIndex, period]);

  useEffect(() => { setOverviewPage(0); }, [companyId, period, query]);
  useEffect(() => {
    const scope = `${companyId}|${period}`;
    const controller = new AbortController();
    setOverviewData({});
    setOverviewScope(scope);
    setOverviewStaticScope("");
    setOverviewStaticHit(false);
    setSectorData(null);
    setSectorStaticScope("");
    setOverviewLoading(false);
    setOverviewProgress(0);
    fetch(`/data/overview/${period}/${companyId}.json`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("静态预计算数据不存在");
        return response.json() as Promise<StaticOverviewPayload>;
      })
      .then((payload) => {
        if (payload.companyId !== companyId || payload.period !== period) throw new Error("静态预计算数据范围不匹配");
        if (!controller.signal.aborted) {
          setOverviewData(payload.managers);
          setOverviewStaticHit(true);
        }
      })
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setOverviewStaticScope(scope); });
    fetch(`/data/sectors/${period}/${companyId}.json`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("静态行业数据不存在");
        return response.json() as Promise<StaticSectorPayload>;
      })
      .then((payload) => {
        if (payload.companyId !== companyId || payload.period !== period) throw new Error("静态行业数据范围不匹配");
        if (!controller.signal.aborted) setSectorData(payload);
      })
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setSectorStaticScope(scope); });
    return () => controller.abort();
  }, [companyId, period]);

  useEffect(() => {
    if (mode !== "overview" || !overviewManagers.length || !period || overviewScope !== `${companyId}|${period}` || overviewStaticScope !== `${companyId}|${period}`) return;
    const missing = overviewManagers.filter((manager) => !overviewData[manager.id]);
    if (!missing.length) { setOverviewLoading(false); setOverviewProgress(overviewManagers.length); return; }
    const controller = new AbortController();
    const requestGroups = overviewRequestGroups(missing, funds);
    setOverviewLoading(true); setOverviewProgress(overviewManagers.length - missing.length);
    Promise.allSettled(requestGroups.map(async (group) => {
      const response = await fetch("/api/company-overview", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ companyId, period, managers: group }) });
      if (!response.ok) throw new Error("批量汇总失败");
      const payload = await response.json() as { managers: Record<string, ManagerPayload> };
      if (!controller.signal.aborted) {
        setOverviewData((current) => ({ ...current, ...payload.managers }));
        setOverviewProgress((current) => Math.min(overviewManagers.length, current + Object.keys(payload.managers).length));
      }
      return payload;
    })).then((results) => {
      if (!controller.signal.aborted && results.some((result) => result.status === "rejected")) setError("部分基金经理读取失败，请稍后重试");
    }).finally(() => { if (!controller.signal.aborted) setOverviewLoading(false); });
    return () => controller.abort();
  }, [mode, overviewPage, period, companyId, overviewScope, overviewStaticScope, overviewManagers.map((manager) => manager.id).join("|")]);

  useEffect(() => {
    if (mode !== "fund" || !selectedFund?.code || !period) return;
    setDetailLoading(true); setFundHoldings(null); setError("");
    fetch(`/api/holdings?code=${selectedFund.code}&period=${period}`).then(async (response) => { if (!response.ok) throw new Error("基金持仓加载失败"); return response.json(); }).then(setFundHoldings).catch((reason) => setError(reason.message)).finally(() => setDetailLoading(false));
  }, [mode, selectedFund?.code, period]);

  useEffect(() => {
    if (mode !== "manager" || !selectedManager?.id || !period) return;
    const scope = `${companyId}|${period}`;
    const precomputed = overviewData[selectedManager.id];
    const staticManager = sectorData?.companyId === companyId && sectorData.period === period ? sectorData.managers[selectedManager.id] : undefined;
    if (precomputed) {
      setManagerHoldings({ ...precomputed, sectors: orderSectors(staticManager?.sectors ?? []) });
      setDetailLoading(false); setError("");
      if (staticManager || sectorStaticScope !== scope) return;
    } else if (overviewStaticScope !== scope) {
      setManagerHoldings(null); setDetailLoading(true); setError("");
      return;
    }
    const controller = new AbortController();
    setDetailLoading(!precomputed); setError("");
    fetch("/api/manager-holdings", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ products: managerProducts(selectedManager, funds), period }) }).then(async (response) => { if (!response.ok) throw new Error("经理持仓汇总失败"); return response.json(); }).then((payload: ManagerPayload) => { if (!controller.signal.aborted) setManagerHoldings(payload); }).catch((reason) => { if (!controller.signal.aborted && !precomputed) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [mode, selectedManager?.id, period, companyId, funds.length, overviewData, overviewStaticScope, sectorData, sectorStaticScope]);

  const exportCurrent = async () => {
    if (!company) return;
    if (mode === "overview" && managers.length && managers.every((manager) => overviewData[manager.id])) exportCompanyOverviewWorkbook({ companyName: company.name, period, managers: managers.map((manager) => ({ name: manager.name, tenureYears: manager.tenureDays / 365, fundCount: representativeCodes(manager).length, managedNav: overviewData[manager.id].managedNav, holdings: overviewData[manager.id].holdings })) });
    if (mode === "fund") {
      setFundExportLoading(true); setError("");
      try {
        const response = await fetch(`/data/funds/${period}/${companyId}.json`);
        if (!response.ok) throw new Error("该季度的全部基金导出数据尚未发布");
        const payload = await response.json() as StaticFundPayload;
        if (payload.companyId !== companyId || payload.period !== period) throw new Error("全部基金导出数据范围不匹配");
        const fundByCode = new Map(funds.map((fund) => [fund.code, fund]));
        const exportFunds = payload.products.map((product) => {
          const disclosed = product.shareCodes.map((code) => fundByCode.get(code)?.netAsset).filter((value): value is number => typeof value === "number");
          const fundType = product.shareCodes.map((code) => fundByCode.get(code)?.type).find((value): value is string => Boolean(value));
          return { code: product.code, name: productKey(product.name) || product.name, type: fundType ?? "类型待披露", managers: product.managers, netAsset: disclosed.length ? disclosed.reduce((sum, value) => sum + value, 0) : null, holdings: product.holdings };
        });
        exportCompanyFundsWorkbook({ companyName: company.name, period, funds: exportFunds, source: payload.source });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "全部基金导出失败，请稍后重试");
      } finally { setFundExportLoading(false); }
    }
    if (mode === "manager" && selectedManager && managerHoldings) exportHoldingsWorkbook({ companyName: company.name, entityType: "基金经理", entityName: selectedManager.name, period, holdings: managerHoldings.holdings, sectors: orderSectors(managerHoldings.sectors), notes: [["在管基金产品（份额去重）", representativeCodes(selectedManager).length], ["参与汇总产品", managerHoldings.succeeded], ["在管净值(亿元)", managerHoldings.managedNav / 10000], ["失败产品", managerHoldings.failed], ["行业口径", "东方财富原始行业字段；其他/未分类固定置底"], ["数据源", managerHoldings.source]] });
  };

  const exportAllManagerSectors = async () => {
    if (!company || !managers.length || !managers.every((manager) => overviewData[manager.id])) return;
    setSectorExportLoading(true); setError("");
    try {
      let payload = sectorData?.companyId === companyId && sectorData.period === period ? sectorData : null;
      if (!payload) {
        const response = await fetch(`/data/sectors/${period}/${companyId}.json`);
        if (!response.ok) throw new Error("该季度的基金经理行业数据尚未发布");
        payload = await response.json() as StaticSectorPayload;
        setSectorData(payload);
        setSectorStaticScope(`${companyId}|${period}`);
      }
      if (payload.companyId !== companyId || payload.period !== period || payload.managerCount !== managers.length) throw new Error("基金经理行业数据范围不匹配");
      exportCompanyManagerSectorsWorkbook({
        companyName: company.name,
        period,
        source: payload.source,
        managers: managers.map((manager) => ({
          name: manager.name,
          tenureYears: manager.tenureDays / 365,
          fundCount: representativeCodes(manager).length,
          managedNav: overviewData[manager.id].managedNav,
          sectors: orderSectors(payload.managers[manager.id]?.sectors ?? []),
        })),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "全部基金经理行业导出失败，请稍后重试");
    } finally { setSectorExportLoading(false); }
  };

  const exportInstitution = async () => {
    if (!company || !funds.length || !managers.length || !managers.every((manager) => overviewData[manager.id])) return;
    setInstitutionExportLoading(true); setError("");
    try {
      const sectorPromise = sectorData?.companyId === companyId && sectorData.period === period
        ? Promise.resolve(sectorData)
        : fetch(`/data/sectors/${period}/${companyId}.json`).then(async (response) => {
          if (!response.ok) throw new Error("该季度的基金经理行业数据尚未发布");
          return response.json() as Promise<StaticSectorPayload>;
        });
      const [fundResponse, sectorPayload] = await Promise.all([
        fetch(`/data/funds/${period}/${companyId}.json`),
        sectorPromise,
      ]);
      if (!fundResponse.ok) throw new Error("该季度的全部基金导出数据尚未发布");
      const fundPayload = await fundResponse.json() as StaticFundPayload;
      if (fundPayload.companyId !== companyId || fundPayload.period !== period) throw new Error("全部基金导出数据范围不匹配");
      if (sectorPayload.companyId !== companyId || sectorPayload.period !== period || sectorPayload.managerCount !== managers.length) throw new Error("基金经理行业数据范围不匹配");
      setSectorData(sectorPayload);
      setSectorStaticScope(`${companyId}|${period}`);
      const fundByCode = new Map(funds.map((fund) => [fund.code, fund]));
      const exportFunds = fundPayload.products.map((product) => {
        const disclosed = product.shareCodes.map((code) => fundByCode.get(code)?.netAsset).filter((value): value is number => typeof value === "number");
        const fundType = product.shareCodes.map((code) => fundByCode.get(code)?.type).find((value): value is string => Boolean(value));
        return { code: product.code, name: productKey(product.name) || product.name, type: fundType ?? "类型待披露", managers: product.managers, netAsset: disclosed.length ? disclosed.reduce((sum, value) => sum + value, 0) : null, holdings: product.holdings };
      });
      exportCompanyInstitutionWorkbook({
        companyName: company.name,
        period,
        source: `${fundPayload.source}；${sectorPayload.source}`,
        funds: exportFunds,
        managers: managers.map((manager) => ({
          name: manager.name,
          tenureYears: manager.tenureDays / 365,
          fundCount: representativeCodes(manager).length,
          managedNav: overviewData[manager.id].managedNav,
          holdings: overviewData[manager.id].holdings,
          sectors: orderSectors(sectorPayload.managers[manager.id]?.sectors ?? []),
        })),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "机构完整信息导出失败，请稍后重试");
    } finally { setInstitutionExportLoading(false); }
  };

  const canExport = mode === "overview" ? managers.length > 0 && managers.every((manager) => overviewData[manager.id]) : mode === "fund" ? funds.length > 0 : Boolean(managerHoldings);
  const exportDisabled = !canExport || fundExportLoading || (mode === "overview" && overviewLoading) || (mode === "manager" && detailLoading);
  const sectorExportDisabled = sectorExportLoading || !managers.length || !managers.every((manager) => overviewData[manager.id]);
  const institutionExportDisabled = institutionExportLoading || fundExportLoading || sectorExportLoading || companyLoading || !funds.length || !managers.length || !managers.every((manager) => overviewData[manager.id]);
  const managerSectorPending = mode === "manager" && sectorStaticScope !== `${companyId}|${period}` && !(managerHoldings?.sectors.length);
  return <main>
    <header className="topbar"><div className="logo">仓</div><div><strong>全市场持仓雷达</strong><small>PUBLIC FUND HOLDINGS</small></div><span className="health snapshot"><i />{market ? "全市场库已加载" : "正在加载全市场库"}</span></header>
    <section className="hero"><p className="kicker">QUARTERLY OWNERSHIP INTELLIGENCE</p><h1>全市场基金与基金经理<br />最新季度重仓股</h1><p>覆盖全部基金公司，按公司穿透基金与基金经理，也可从一只股票反查重仓机构；当前提供 2026 年一季完整数据，并可导出高密度 Excel。</p><div className="market-strip"><span><b>{market?.companyCount ?? "—"}</b> 管理机构</span><span><b>{fmt(market?.managerCount ?? 0, 0)}</b> 基金经理</span><span><b>{fmt(marketProductCount, 0)}</b> 在管基金产品<small>A/C 等份额已去重</small></span></div></section>
    <section className="controls"><label><span>当前已发布财报期</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>{periods.map((item) => <option key={item} value={item}>{periodLabel(item)} · {item}</option>)}</select></label>{mode === "stock" ? <label><span>股票反查范围</span><div className="scope-display">全市场基金公司与基金经理</div></label> : <label><span>基金公司 · 全市场</span><select value={companyId} onChange={(event) => setCompanyId(event.target.value)} disabled={!market}>{market?.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</section>
    {mode === "stock" ? <section className="coverage"><div><small>可反查股票</small><strong>{stockIndex?.stockCount ?? "…"}</strong></div><div><small>经理重仓记录</small><strong>{stockIndex ? fmt(stockIndex.managerHoldingCount, 0) : "…"}</strong></div><div><small>覆盖机构</small><strong>{stockIndex?.companyCount ?? "…"}</strong></div><div><small>当前报告期</small><strong className="status-text">{period.slice(0, 7)}</strong></div></section> : <section className="coverage"><div><small>该公司产品</small><strong>{companyProductCount || (companyLoading ? "…" : 0)}</strong></div><div><small>基金经理</small><strong>{managers.length || (companyLoading ? "…" : 0)}</strong></div><div><small>数据状态</small><strong className="status-text">{companyData?.mode === "live" ? "实时" : companyLoading ? "读取中" : "回退"}</strong></div><div><small>当前报告期</small><strong className="status-text">{period.slice(0, 7)}</strong></div></section>}
    <section className="workspace">
      <div className="tabs"><button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>基金总览</button><button className={mode === "manager" ? "active" : ""} onClick={() => setMode("manager")}>基金经理</button><button className={mode === "fund" ? "active" : ""} onClick={() => setMode("fund")}>基金产品</button><button className={mode === "stock" ? "active" : ""} onClick={() => { setMode("stock"); setQuery(""); }}>股票反查</button></div>
      <div className={`entity-tools${mode === "stock" ? " stock-tools" : ""}`}><div className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "stock" ? "输入股票代码或名称" : mode === "fund" ? "搜索基金代码、名称、经理" : "搜索经理、在管基金"} />{query && <button onClick={() => setQuery("")}>×</button>}</div>{mode !== "stock" && <div className="export-actions"><button className="export institution" onClick={exportInstitution} disabled={institutionExportDisabled}>{institutionExportLoading ? "正在准备机构完整信息…" : "导出机构完整 Excel"}</button>{mode === "manager" ? <><button className="export secondary" onClick={exportCurrent} disabled={exportDisabled}>导出当前经理</button><button className="export" onClick={exportAllManagerSectors} disabled={sectorExportDisabled}>{sectorExportLoading ? "正在准备行业数据…" : "导出全部行业 Excel"}</button></> : <button className="export secondary" onClick={exportCurrent} disabled={exportDisabled}>{mode === "overview" ? "导出全部经理 Excel" : fundExportLoading ? "正在准备全部基金…" : "导出全部基金 Excel"}</button>}</div>}</div>
      {mode === "stock" ? <StockReverseLookup query={query} items={filteredStocks} selectedCode={selectedStockCode} onSelect={setSelectedStockCode} detail={stockDetail} indexLoading={stockIndexLoading} detailLoading={stockDetailLoading} error={stockError} companyPage={stockCompanyPage} onCompanyPage={setStockCompanyPage} /> : mode === "overview" ? <>
        <div className="overview-title"><div><span>FUND HOUSE OVERVIEW</span><h2>{company?.name}基金总览</h2><p>{periodLabel(period)} · 公司信息与全部基金经理前十大重仓矩阵</p></div><em>全量经理</em></div>
        <div className="overview-company-metrics"><div><small>报告期基金总规模</small><b>{companyLoading ? "…" : `${fmt(companyScale, 1)} 亿`}</b></div><div><small>旗下基金产品</small><b>{companyProductCount || (companyLoading ? "…" : 0)}</b></div><div><small>在任基金经理</small><b>{managers.length || (companyLoading ? "…" : 0)}</b></div><div><small>份额规模覆盖</small><b>{companyLoading ? "…" : `${funds.length ? fmt(scaleDisclosed / funds.length * 100, 1) : 0}%`}</b></div></div>
        <div className="overview-toolbar"><div><strong>全部经理持仓总览</strong><span>每页 {OVERVIEW_PAGE_SIZE} 位 · 横向滑动</span></div><div className="pager"><button onClick={() => setOverviewPage((page) => Math.max(0, page - 1))} disabled={overviewPage === 0}>‹</button><b>{overviewPage + 1} / {overviewPageCount}</b><button onClick={() => setOverviewPage((page) => Math.min(overviewPageCount - 1, page + 1))} disabled={overviewPage >= overviewPageCount - 1}>›</button></div></div>
        <div className="overview-progress"><i style={{ width: `${overviewManagers.length ? overviewProgress / overviewManagers.length * 100 : 0}%` }} /><span>{overviewLoading ? `正在汇总 ${overviewProgress}/${overviewManagers.length} 位经理` : overviewStaticHit ? `后台预计算数据已就绪 · 本页 ${overviewManagers.length} 位经理` : `本页 ${overviewManagers.length} 位经理已就绪`}</span></div>
        <OverviewMatrix managers={overviewManagers} data={overviewData} loading={overviewLoading} />
        <p className="overview-note">规模与净值占比均为所选财报期公开披露值，不做估算。联合管理基金分别归入每位基金经理；A/C 等份额持仓只计算一次，份额规模全部合并。“导出全部经理 Excel”不受当前分页或搜索影响，一次包含该公司全部基金经理。已生成的季度优先读取后台预计算静态数据，缺失时自动回退实时接口。</p>
      </> : mode === "manager" ? <><div className="result-head"><strong>全部基金经理</strong><span>{filteredManagers.length} 条 · 横向滑动</span></div><div className="entity-rail">{filteredManagers.map((item) => <button key={item.id} className={item.id === selectedManager?.id ? "active" : ""} onClick={() => setSelectedManagerId(item.id)}><strong>{item.name}</strong><small>{representativeCodes(item).length} 个产品 · 从业 {fmt(item.tenureDays / 365, 1)} 年</small></button>)}</div></> : companyLoading ? <Skeleton label="正在读取该公司全部基金与报告期规模…" /> : <><div className="result-head"><strong>全部基金</strong><span>{filteredFunds.length} 条 · 横向滑动</span></div><div className="entity-rail">{filteredFunds.map((item) => <button key={item.code} className={`fund-card${item.code === selectedFund?.code ? " active" : ""}`} onClick={() => setSelectedFundCode(item.code)}><strong>{item.name}</strong><small>{item.code} · {item.managers.join("、") || "经理待匹配"}</small><small className="fund-scale">期末规模 {fundScale(item.netAsset)}</small></button>)}</div></>}
      {mode !== "stock" && error && <div className="error-banner">{error}</div>}
      {(mode === "manager" || mode === "fund") && <div className="detail-card">
        {mode === "manager" && selectedManager && <><div className="detail-title"><div><span>FUND MANAGER</span><h2>{selectedManager.name}</h2><p>{company?.name} · {representativeCodes(selectedManager).length} 个在管基金产品（份额已去重） · 在管产品持仓汇总</p></div><em>经理汇总</em></div><div className="mini-metrics"><div><small>从业年限</small><b>{fmt(selectedManager.tenureDays / 365, 1)} 年</b></div><div><small>去重后产品</small><b>{representativeCodes(selectedManager).length} 只</b></div><div><small>在管净值</small><b>{managerHoldings ? `${fmt(managerHoldings.managedNav / 10000, 1)} 亿` : "—"}</b></div><div><small>成功汇总</small><b>{managerHoldings?.succeeded ?? "—"} 只</b></div></div>{detailLoading ? <Skeleton label="正在读取经理持仓…" /> : <>{managerSectorPending ? <Skeleton label="正在读取已预生成的行业数据…" /> : <SectorBreakdown rows={managerHoldings?.sectors ?? []} />}<ManagerTable rows={managerHoldings?.holdings ?? []} /><p className="value-note">经理持仓与行业分布均优先读取后台预生成季度数据；切换经理无需再次逐只基金查询。“导出全部行业 Excel”不受当前搜索或选中经理影响。</p></>}</>}
        {mode === "fund" && selectedFund && <><div className="detail-title"><div><span>PUBLIC FUND</span><h2>{selectedFund.name}</h2><p>{selectedFund.code} · {selectedFund.managers.join("、") || "基金经理待匹配"}</p></div><em>公开披露</em></div><div className="mini-metrics"><div><small>财报期</small><b>{period.slice(0, 7)}</b></div><div><small>基金规模</small><b>{fundScale(selectedFund.netAsset)}</b></div><div><small>披露股票</small><b>{fundHoldings?.holdings.length ?? "—"} 只</b></div><div><small>前十净值占比</small><b>{fundHoldings ? `${fmt(fundHoldings.holdings.reduce((sum, item) => sum + item.weight, 0), 1)}%` : "—"}</b></div></div>{detailLoading ? <Skeleton label="正在读取基金季报持仓…" /> : <><FundTable rows={fundHoldings?.holdings ?? []} /><p className="value-note">“导出全部基金 Excel”一次包含该公司全部基金产品，不受当前搜索或选中基金影响；A/C 等份额合并规模，持仓只保留一份。</p></>}</>}
      </div>}
    </section>
    <section className="method"><div><span>自动化数据链路</span><h2>市场索引 → 公司总览 → 经理 / 基金持仓 → 股票反查</h2></div><ol><li><b>当前主源</b> 东方财富基金公开数据：公司、经理、基金、报告期末净资产和定期报告持仓。</li><li><b>基金总览</b> 页面优先读取已验证的季度静态数据，联合管理基金分别计入对应经理，同一产品的 A/C 等份额不重复持仓。</li><li><b>股票反查</b> 后台为所有经理前十大重仓建立倒排索引，输入代码或名称后直接定位机构与经理，不在页面临时扫描全市场。</li><li><b>团队加速</b> 全市场数据随网站部署，同事同时打开也直接读取同一份静态结果，不依赖某一台手机的本地缓存。</li><li><b>更新</b> 每个新季度集中刷新全市场公司、基金经理、产品、规模、持仓和股票反查索引，并在校验通过后整体发布。</li><li><b>口径</b> 净值占比由定期报告披露市值与报告期末净资产计算；未披露数据不填充。</li></ol></section>
    <footer><strong>全市场持仓雷达</strong><span>索引更新 {market?.generatedAt ? new Date(market.generatedAt).toLocaleString("zh-CN") : "读取中"} · 数据仅供研究</span></footer>
  </main>;
}
