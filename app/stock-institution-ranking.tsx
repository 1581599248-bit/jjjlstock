"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type ChangeCounts = {
  new: number;
  increased: number;
  decreased: number;
  unchanged: number;
  unknown: number;
};

type InstitutionHolding = {
  rank: number;
  companyId: string;
  companyName: string;
  fundCount: number;
  shares: number;
  marketValue: number;
  netChangeShares: number | null;
  changeCounts: ChangeCounts;
};

type StockDetail = {
  stockCode: string;
  stockName: string;
  institutionCount?: number;
  institutions?: InstitutionHolding[];
};

type StockSearchIndex = {
  period: string;
  stocks: Array<{ stockCode: string; bucket: string }>;
};

type StockBucketPayload = {
  period: string;
  source: string;
  stocks: Record<string, StockDetail>;
};

type Selection = { period: string; stockCode: string };

const number = (value: number, digits = 2) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
const signed = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${number(value, 2)}`;

function currentSelection(): Selection | null {
  const period = document.querySelector<HTMLSelectElement>(".controls select")?.value?.trim() ?? "";
  const active = document.querySelector<HTMLButtonElement>(".stock-result-rail button.active");
  const stockCode = active?.querySelector("small")?.textContent?.trim()
    ?? document.querySelector(".stock-owner-head span")?.textContent?.trim()
    ?? "";
  return period && stockCode ? { period, stockCode } : null;
}

function changeSummary(counts: ChangeCounts) {
  const items = [
    ["新进", counts.new],
    ["增持", counts.increased],
    ["减持", counts.decreased],
    ["不变", counts.unchanged],
    ["其他", counts.unknown],
  ].filter(([, count]) => Number(count) > 0);
  return items.length ? items.map(([label, count]) => `${label}${count}`).join(" · ") : "—";
}

export default function StockInstitutionRanking() {
  const [target, setTarget] = useState<Element | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => {
      const ownerDetail = document.querySelector(".stock-owner-detail");
      const toolbar = ownerDetail?.querySelector(":scope > .stock-owner-toolbar");
      let slot = ownerDetail?.querySelector(":scope > .stock-institution-ranking-slot") ?? null;
      if (ownerDetail && toolbar && !slot) {
        slot = document.createElement("div");
        slot.className = "stock-institution-ranking-slot";
        ownerDetail.insertBefore(slot, toolbar);
      }
      setTarget((current) => current === slot ? current : slot);
      const next = currentSelection();
      setSelection((current) => current?.period === next?.period && current?.stockCode === next?.stockCode ? current : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selection) {
      setDetail(null);
      setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    (async () => {
      const indexResponse = await fetch(`/data/stocks/${selection.period}/index.json`, { signal: controller.signal });
      if (!indexResponse.ok) throw new Error("机构持仓索引读取失败");
      const index = await indexResponse.json() as StockSearchIndex;
      const item = index.stocks.find((stock) => stock.stockCode === selection.stockCode);
      if (!item) throw new Error("未找到该股票的机构持仓数据");
      const bucketResponse = await fetch(`/data/stocks/${selection.period}/buckets/${item.bucket}.json`, { signal: controller.signal });
      if (!bucketResponse.ok) throw new Error("机构持仓明细读取失败");
      const bucket = await bucketResponse.json() as StockBucketPayload;
      const nextDetail = bucket.stocks[selection.stockCode];
      if (!nextDetail) throw new Error("未找到该股票的机构持仓明细");
      setDetail(nextDetail);
      setSource(bucket.source ?? "");
    })().catch((reason) => {
      if (reason?.name !== "AbortError") {
        console.error(reason);
        setDetail(null);
        setError(reason instanceof Error ? reason.message : "机构持仓数据读取失败");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [selection]);

  if (!target) return null;
  const institutions = detail?.institutions ?? [];
  return createPortal(<>
    <section className="institution-ranking-card" aria-label="持仓该股票规模前十机构">
      <header>
        <div><span>INSTITUTION HOLDINGS</span><h3>持仓该股票规模前十机构</h3></div>
        <b>{detail?.institutionCount ?? institutions.length} 家</b>
      </header>
      <p className="institution-ranking-method">基金产品定期报告前十大重仓按基金公司汇总，按披露持仓市值排序；A/C等份额合并后仅计算一次。</p>
      {loading ? <div className="institution-ranking-state">正在读取机构持仓排名…</div>
        : error ? <div className="institution-ranking-state error">{error}</div>
        : institutions.length ? <div className="institution-ranking-table" role="region" aria-label="机构持仓前十，可横向滚动" tabIndex={0}>
          <table><thead><tr><th>排名</th><th>基金公司</th><th className="num">基金数</th><th className="num">持股/万股</th><th className="num">持仓市值/万</th><th className="num">净增减/万股</th><th>持仓变化</th></tr></thead>
            <tbody>{institutions.map((row) => <tr key={row.companyId}>
              <td><b className={`institution-rank r${row.rank}`}>{row.rank}</b></td>
              <td><strong>{row.companyName}</strong></td>
              <td className="num">{row.fundCount}</td>
              <td className="num mono">{number(row.shares)}</td>
              <td className="num mono accent">{number(row.marketValue, 0)}</td>
              <td className={`num mono ${row.netChangeShares !== null && row.netChangeShares > 0 ? "up" : row.netChangeShares !== null && row.netChangeShares < 0 ? "down" : ""}`}>{signed(row.netChangeShares)}</td>
              <td><span className="change-summary">{changeSummary(row.changeCounts)}</span></td>
            </tr>)}</tbody></table>
        </div> : <div className="institution-ranking-state">该股票暂无基金产品前十大持仓机构数据</div>}
      {source && <small className="institution-ranking-source">数据源：{source}</small>}
    </section>
    <style>{`
      .stock-institution-ranking-slot { margin: 18px 0; }
      .institution-ranking-card { padding: 18px; border: 1px solid rgba(116,70,55,.16); border-radius: 18px; background: linear-gradient(145deg,#fffaf6,#fff); box-shadow: 0 10px 30px rgba(72,38,27,.05); }
      .institution-ranking-card header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
      .institution-ranking-card header span { display:block; color:#a76550; font-size:11px; font-weight:800; letter-spacing:.12em; }
      .institution-ranking-card h3 { margin:4px 0 0; font-size:20px; }
      .institution-ranking-card header>b { color:#8f4c3a; background:#f8e7df; padding:7px 11px; border-radius:999px; white-space:nowrap; }
      .institution-ranking-method { margin:10px 0 14px; color:#745f57; font-size:13px; line-height:1.7; }
      .institution-ranking-table { overflow-x:auto; border:1px solid rgba(116,70,55,.12); border-radius:14px; background:#fff; }
      .institution-ranking-table table { width:100%; min-width:850px; border-collapse:collapse; }
      .institution-ranking-table th,.institution-ranking-table td { padding:12px 13px; border-bottom:1px solid #f0e5df; text-align:left; white-space:nowrap; }
      .institution-ranking-table th { background:#9a5141; color:#fff; font-size:12px; }
      .institution-ranking-table tbody tr:last-child td { border-bottom:0; }
      .institution-ranking-table tbody tr:hover { background:#fff8f4; }
      .institution-ranking-table .num { text-align:right; }
      .institution-ranking-table .mono { font-variant-numeric:tabular-nums; }
      .institution-ranking-table .accent { color:#9a5141; font-weight:800; }
      .institution-ranking-table .up { color:#bd3e32; }
      .institution-ranking-table .down { color:#258060; }
      .institution-rank { display:inline-grid; place-items:center; width:27px; height:27px; border-radius:9px; background:#f3e8e3; color:#7b4a3d; }
      .institution-rank.r1,.institution-rank.r2,.institution-rank.r3 { background:#9a5141; color:white; }
      .change-summary { color:#715d56; font-size:12px; }
      .institution-ranking-state { padding:24px; text-align:center; color:#806b63; background:#fff; border-radius:12px; }
      .institution-ranking-state.error { color:#a33a33; }
      .institution-ranking-source { display:block; margin-top:10px; color:#9a8982; line-height:1.5; }
      @media (max-width: 640px) { .institution-ranking-card { padding:14px; border-radius:15px; } .institution-ranking-card h3 { font-size:18px; } }
    `}</style>
  </>, target);
}
