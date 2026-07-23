"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { exportStockReverseLookupWorkbook, type StockReverseExportDetail } from "./lib/export-stock-reverse-xlsx";

type StockSearchIndex = {
  period: string;
  source: string;
  stocks: Array<{ stockCode: string; stockName: string; bucket: string }>;
};

type StockBucketPayload = {
  period: string;
  source: string;
  stocks: Record<string, StockReverseExportDetail>;
};

type Selection = { period: string; stockCode: string; stockName: string };

function currentSelection(): Selection | null {
  const period = document.querySelector<HTMLSelectElement>(".controls select")?.value?.trim() ?? "";
  const active = document.querySelector<HTMLButtonElement>(".stock-result-rail button.active");
  const stockCode = active?.querySelector("small")?.textContent?.trim()
    ?? document.querySelector(".stock-owner-head span")?.textContent?.trim()
    ?? "";
  const stockName = active?.querySelector("strong")?.textContent?.trim()
    ?? document.querySelector(".stock-owner-head h2")?.textContent?.trim()
    ?? "";
  return period && stockCode ? { period, stockCode, stockName } : null;
}

export default function StockExportEnhancer() {
  const [target, setTarget] = useState<Element | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const sync = () => {
      const nextTarget = document.querySelector(".entity-tools.stock-tools");
      const nextSelection = currentSelection();
      setTarget((current) => current === nextTarget ? current : nextTarget);
      setSelection((current) => current?.period === nextSelection?.period && current?.stockCode === nextSelection?.stockCode && current?.stockName === nextSelection?.stockName ? current : nextSelection);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setFailed(false); }, [selection?.period, selection?.stockCode]);

  const runExport = async () => {
    if (!selection || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const indexResponse = await fetch(`/data/stocks/${selection.period}/index.json`);
      if (!indexResponse.ok) throw new Error("股票反查索引读取失败");
      const index = await indexResponse.json() as StockSearchIndex;
      if (index.period !== selection.period) throw new Error("股票反查财报期不匹配");
      const item = index.stocks.find((stock) => stock.stockCode === selection.stockCode);
      if (!item) throw new Error("未找到该股票的反查索引");

      const bucketResponse = await fetch(`/data/stocks/${selection.period}/buckets/${item.bucket}.json`);
      if (!bucketResponse.ok) throw new Error("股票机构明细读取失败");
      const bucket = await bucketResponse.json() as StockBucketPayload;
      if (bucket.period !== selection.period) throw new Error("股票机构明细财报期不匹配");
      const detail = bucket.stocks[selection.stockCode];
      if (!detail) throw new Error("未找到该股票的机构明细");

      exportStockReverseLookupWorkbook({ period: selection.period, source: bucket.source || index.source, detail });
    } catch (error) {
      console.error(error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  if (!target) return null;
  return createPortal(
    <div className="export-actions stock-export-action">
      <button className="export secondary" onClick={runExport} disabled={!selection || loading} title={failed ? "导出失败，请重试" : undefined}>
        {loading ? "正在准备股票反查 Excel…" : failed ? "导出失败，点击重试" : "导出股票反查 Excel"}
      </button>
    </div>,
    target,
  );
}
