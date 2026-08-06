"use client";

import { useEffect, useMemo, useState } from "react";

type MarketIndustryRow = {
  rank: number;
  industry: string;
  fundCount: number;
  companyCount: number;
  marketValue: number;
  navWeight: number;
  stockShare: number;
  changePp: number | null;
  marketValueChange: number | null;
  rankChange: number | null;
};

type MarketIndustryPayload = {
  version: number;
  period: string;
  generatedAt: string;
  source: string;
  sourceUrl: string;
  totalCompanyCount: number;
  coveredCompanyCount: number;
  failedCompanyCount: number;
  coverageRatio: number;
  coveredProductCount: number;
  coveredNetAsset: number;
  totalIndustryMarketValue: number;
  totalIndustryNavWeight: number;
  industryCount: number;
  industries: MarketIndustryRow[];
};

const fmt = (value: number, digits = 1) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
const periodLabel = (period: string) => `${period.slice(0, 4)} ${period.slice(5, 7) === "03" ? "一季报" : period.slice(5, 7) === "06" ? "中报" : period.slice(5, 7) === "09" ? "三季报" : "年报"}`;
const changeText = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmt(value, 2)}pct`;
};

export default function MarketIndustryAllocation({ period, query }: { period: string; query: string }) {
  const [data, setData] = useState<MarketIndustryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError("");
    fetch(`/api/market-industries?period=${encodeURIComponent(period)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as MarketIndustryPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || "该财报期的全市场行业配置尚未发布");
        return payload;
      })
      .then((payload) => {
        if (payload.period !== period || !Array.isArray(payload.industries)) throw new Error("全市场行业配置数据范围不匹配");
        if (!controller.signal.aborted) setData(payload);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "全市场行业配置读取失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period]);

  const rows = useMemo(() => {
    const key = query.trim().replace(/\s+/g, "").toLowerCase();
    if (!key) return data?.industries ?? [];
    return (data?.industries ?? []).filter((item) => item.industry.replace(/\s+/g, "").toLowerCase().includes(key));
  }, [data, query]);
  const maxMarketValue = Math.max(1, ...rows.map((item) => item.marketValue));

  return <section className="market-industry-module" aria-label="全市场公募基金行业配置">
    <div className="market-industry-title">
      <div><span>MARKET INDUSTRY ALLOCATION</span><h2>全市场行业配置</h2><p>全市场 · 全机构 · 全部公募基金行业持仓汇总</p></div>
      <em>{periodLabel(period)}</em>
    </div>

    {loading ? <div className="loading-state"><span className="spinner" />正在读取全市场行业配置，首次汇总可能需要一些时间…</div> : error ? <div className="error-banner">{error}</div> : data ? <>
      <div className="market-industry-metrics">
        <div><small>覆盖基金公司</small><b>{data.coveredCompanyCount}<i> / {data.totalCompanyCount}</i></b></div>
        <div><small>覆盖基金产品</small><b>{fmt(data.coveredProductCount, 0)}</b></div>
        <div><small>股票行业市值</small><b>{fmt(data.totalIndustryMarketValue / 10_000, 0)}<i> 亿</i></b></div>
        <div><small>占公募净值</small><b>{fmt(data.totalIndustryNavWeight, 2)}<i>%</i></b></div>
      </div>

      <div className="market-industry-toolbar">
        <div><strong>{query.trim() ? "匹配行业" : "行业持仓排名"}</strong><span>{rows.length} 个行业 · 市值口径</span></div>
        <small>数据覆盖 {fmt(data.coverageRatio * 100, 1)}%</small>
      </div>

      {rows.length ? <div className="market-industry-table-wrap" tabIndex={0} role="region" aria-label="全市场公募基金行业配置表，可横向滚动">
        <table className="market-industry-table">
          <thead><tr><th>#</th><th>行业</th><th className="num">持仓市值</th><th className="num">占公募净值</th><th className="num">股票仓位占比</th><th className="num optional-col">基金数</th><th className="num optional-col">机构数</th><th className="num optional-col">环比</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.industry}>
            <td><b className={`rank r${row.rank}`}>{row.rank}</b></td>
            <td><div className="market-industry-name"><strong>{row.industry}</strong><i><span style={{ width: `${Math.max(2, row.marketValue / maxMarketValue * 100)}%` }} /></i>{row.rankChange !== null && row.rankChange !== 0 ? <small className={row.rankChange > 0 ? "up" : "down"}>排名{row.rankChange > 0 ? `升${row.rankChange}` : `降${Math.abs(row.rankChange)}`}</small> : null}</div></td>
            <td className="num"><strong>{fmt(row.marketValue / 10_000, 1)}亿</strong></td>
            <td className="num accent">{fmt(row.navWeight, 2)}%</td>
            <td className="num">{fmt(row.stockShare, 2)}%</td>
            <td className="num optional-col">{fmt(row.fundCount, 0)}</td>
            <td className="num optional-col">{fmt(row.companyCount, 0)}</td>
            <td className={`num optional-col ${row.changePp !== null && row.changePp > 0 ? "industry-up" : row.changePp !== null && row.changePp < 0 ? "industry-down" : ""}`}>{changeText(row.changePp)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="empty-state">没有找到匹配的行业</div>}

      <p className="market-industry-note">“占公募净值”＝该行业持仓市值 ÷ 已覆盖基金产品净资产；“股票仓位占比”＝该行业持仓市值 ÷ 全部行业股票持仓市值。基金数与市值直接汇总东方财富基金公司行业配置，A/C 等份额沿用公开披露口径。数据源：{data.source}。</p>
    </> : null}
  </section>;
}
