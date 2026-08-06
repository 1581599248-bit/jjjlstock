"use client";

import { useEffect, useMemo, useState } from "react";

type MarketIndustryRow = { rank: number; industry: string; industryCode?: string; marketValue: number; allocationShare: number; qoqChange: number | null };
type MarketIndustryPayload = {
  version: number; period: string; quarter: string; generatedAt: string; source: string;
  scope: { fundUniverse: string; fundTypes: string[]; classification: string; holdingScope: string; denominator?: string };
  activeFundCount: number; activeCompanyCount?: number; coveredCompanyCount?: number;
  classifiedMarketValue?: number; totalIndustryMarketValue?: number; classificationCoverage: number;
  industryCount?: number; industries: MarketIndustryRow[];
};

const fmt = (value: number, digits = 1) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
const periodLabel = (period: string) => `${period.slice(0, 4)} ${period.slice(5, 7) === "03" ? "一季报" : period.slice(5, 7) === "06" ? "中报" : period.slice(5, 7) === "09" ? "三季报" : "年报"}`;
const quarterLabel = (period: string) => `Q${Number(period.slice(5, 7)) / 3}`;
const changeText = (value: number | null) => value === null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${fmt(value, 2)}pct`;

export default function MarketIndustryAllocation({ period, query }: { period: string; query: string }) {
  const [data, setData] = useState<MarketIndustryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setData(null); setError("");
    fetch(`/api/market-industries?period=${encodeURIComponent(period)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as MarketIndustryPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || "该财报期的全行业数据尚未发布");
        return payload;
      })
      .then((payload) => {
        if (payload.version !== 2 || payload.period !== period || payload.scope?.fundUniverse !== "主动偏股公募基金" || payload.scope?.classification !== "申万一级行业（2021）" || !Array.isArray(payload.industries)) throw new Error("全行业数据口径不匹配");
        if (!controller.signal.aborted) setData(payload);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "全行业数据读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period]);

  const rows = useMemo(() => {
    const key = query.trim().replace(/\s+/g, "").toLowerCase();
    if (!key) return data?.industries ?? [];
    return (data?.industries ?? []).filter((item) => `${item.industry}${item.industryCode ?? ""}`.replace(/\s+/g, "").toLowerCase().includes(key));
  }, [data, query]);

  return <section className="market-industry-module" aria-label="主动偏股公募基金申万一级行业配置">
    <div className="market-industry-title"><div><span>ACTIVE EQUITY · SW LEVEL 1</span><h2>全行业</h2><p>普通股票型 + 偏股混合型 + 灵活配置型 + 平衡混合型 · 申万一级行业</p></div><em>{periodLabel(period)}</em></div>
    {loading ? <div className="loading-state"><span className="spinner" />正在读取主动偏股公募行业配置…</div> : error ? <div className="error-banner">{error}</div> : data ? <>
      <div className="market-industry-scope"><span><b>{fmt(data.activeFundCount, 0)}</b> 只主动偏股基金</span><span><b>{data.industryCount ?? data.industries.length}</b> 个申万一级行业</span><span>行业识别覆盖 <b>{fmt(data.classificationCoverage * 100, 1)}%</b></span></div>
      <div className="market-industry-toolbar"><div><strong>{query.trim() ? "匹配行业" : `${quarterLabel(period)}行业配置排名`}</strong><span>{rows.length} 条 · 按总市值降序</span></div></div>
      {rows.length ? <div className="market-industry-table-wrap" tabIndex={0} role="region" aria-label="主动偏股公募基金申万一级行业配置表">
        <table className="market-industry-table compact-five"><thead><tr><th>排名</th><th>行业</th><th className="num">总市值</th><th className="num">{quarterLabel(period)}占比</th><th className="num">环比变动</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.industryCode || row.industry}><td><b className={`rank r${row.rank}`}>{row.rank}</b></td><td><div className="market-industry-name"><strong>{row.industry}</strong>{row.industryCode ? <small>{row.industryCode}</small> : null}</div></td><td className="num"><strong>{fmt(row.marketValue / 10_000, 1)}亿</strong></td><td className="num accent">{fmt(row.allocationShare, 2)}%</td><td className={`num ${row.qoqChange !== null && row.qoqChange > 0 ? "industry-up" : row.qoqChange !== null && row.qoqChange < 0 ? "industry-down" : ""}`}>{changeText(row.qoqChange)}</td></tr>)}</tbody>
        </table>
      </div> : <div className="empty-state">没有找到匹配的行业</div>}
      <p className="market-industry-note">口径：{data.scope.fundTypes.join("、")}；按基金季度前十大重仓股中的A股持仓汇总，A/C等份额按基金产品去重；行业采用申万一级行业（2021）。“{quarterLabel(period)}占比”以纳入统计并完成申万一级分类的A股重仓总市值为分母，“环比变动”为较上一财报期的占比变化。数据源：{data.source}。</p>
    </> : null}
  </section>;
}
