import { fetchFundHoldings, fetchFundNetAsset } from "../../lib/eastmoney";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { codes?: string[]; period?: string };
  const codes = [...new Set((body.codes ?? []).filter((code) => /^\d{6}$/.test(code)))].slice(0, 80);
  const period = body.period ?? "";
  if (!codes.length || !/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) return Response.json({ error: "参数无效" }, { status: 400 });
  const results: Array<{ holdings: Awaited<ReturnType<typeof fetchFundHoldings>>; netAsset: number | null }> = [];
  let failed = 0;
  for (let index = 0; index < codes.length; index += 8) {
    const batch = await Promise.allSettled(codes.slice(index, index + 8).map(async (code) => {
      const [holdings, netAsset] = await Promise.all([fetchFundHoldings(code, period), fetchFundNetAsset(code, period)]);
      return { holdings, netAsset };
    }));
    for (const item of batch) item.status === "fulfilled" ? results.push(item.value) : failed += 1;
  }

  const stocks = new Map<string, { stockCode: string; stockName: string; marketValue: number; fundCount: number; shares: number; previousShares: number }>();
  let managedNav = 0;
  let succeeded = 0;
  for (const fund of results) {
    if (fund.netAsset === null) { failed += 1; continue; }
    managedNav += fund.netAsset;
    succeeded += 1;
    for (const holding of fund.holdings.holdings) {
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
      const weight = managedNav > 0 ? item.marketValue / managedNav * 100 : 0;
      return {
        ...item,
        rank: index + 1,
        weight,
        change: item.previousShares <= 0 ? "新进" : Math.abs(changeShares) < 0.005 ? "不变" : changeShares > 0 ? "增持" : "减持",
        changeShares,
      };
    });
  return Response.json({ period, requested: codes.length, succeeded, failed, managedNav, holdings, source: "东方财富基金公开数据（报告期期末净资产与在管基金持仓汇总）" }, { headers: { "cache-control": "public, max-age=1800, s-maxage=86400" } });
}
