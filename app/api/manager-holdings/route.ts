import { fetchFundHoldings } from "../../lib/eastmoney";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { codes?: string[]; period?: string };
  const codes = [...new Set((body.codes ?? []).filter((code) => /^\d{6}$/.test(code)))].slice(0, 80);
  const period = body.period ?? "";
  if (!codes.length || !/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) return Response.json({ error: "参数无效" }, { status: 400 });
  const results: Awaited<ReturnType<typeof fetchFundHoldings>>[] = [];
  let failed = 0;
  for (let index = 0; index < codes.length; index += 8) {
    const batch = await Promise.allSettled(codes.slice(index, index + 8).map((code) => fetchFundHoldings(code, period)));
    for (const item of batch) item.status === "fulfilled" ? results.push(item.value) : failed += 1;
  }

  const stocks = new Map<string, { stockCode: string; stockName: string; marketValue: number; fundCount: number; shares: number; previousShares: number }>();
  let estimatedNav = 0;
  for (const fund of results) {
    const navEstimates = fund.holdings
      .filter((holding) => holding.weight > 0 && holding.marketValue > 0)
      .map((holding) => holding.marketValue * 100 / holding.weight)
      .sort((a, b) => a - b);
    if (navEstimates.length) estimatedNav += navEstimates[Math.floor(navEstimates.length / 2)];
    for (const holding of fund.holdings) {
      const item = stocks.get(holding.stockCode) ?? { stockCode: holding.stockCode, stockName: holding.stockName, marketValue: 0, fundCount: 0, shares: 0, previousShares: 0 };
      item.marketValue += holding.marketValue;
      item.fundCount += 1;
      item.shares += holding.shares;
      item.previousShares += holding.changeShares === null ? holding.shares : holding.shares - holding.changeShares;
      stocks.set(holding.stockCode, item);
    }
  }
  const holdings = [...stocks.values()]
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 10)
    .map((item, index) => {
      const changeShares = item.shares - item.previousShares;
      const estimatedWeight = estimatedNav > 0 ? item.marketValue / estimatedNav * 100 : 0;
      return {
        ...item,
        rank: index + 1,
        weight: estimatedWeight,
        estimatedWeight,
        change: item.previousShares <= 0 ? "新进" : Math.abs(changeShares) < 0.005 ? "不变" : changeShares > 0 ? "增持" : "减持",
        changeShares,
      };
    });
  return Response.json({ period, requested: codes.length, succeeded: results.length, failed, estimatedNav, holdings, source: "东方财富基金公开数据（在管基金披露市值汇总，净值占比为估算）" }, { headers: { "cache-control": "public, max-age=1800, s-maxage=86400" } });
}
