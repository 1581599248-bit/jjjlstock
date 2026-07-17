import { fetchFundHoldings, fetchFundNetAsset, fetchStockIndustry } from "../../lib/eastmoney";

type ProductInput = { code: string; shareCodes?: string[]; netAsset: number | null };

async function buildManagerHoldings(productsInput: ProductInput[], period: string) {
  const products = [...new Map(productsInput.filter((product) => /^\d{6}$/.test(product.code)).map((product) => [product.code, { ...product, shareCodes: [...new Set((product.shareCodes ?? [product.code]).filter((code) => /^\d{6}$/.test(code)))] }])).values()].slice(0, 80);
  if (!products.length || !/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) return Response.json({ error: "参数无效" }, { status: 400 });
  const results: Array<{ holdings: Awaited<ReturnType<typeof fetchFundHoldings>>; netAsset: number | null }> = [];
  let failed = 0;
  for (let index = 0; index < products.length; index += 8) {
    const batch = await Promise.allSettled(products.slice(index, index + 8).map(async (product) => {
      const holdings = await fetchFundHoldings(product.code, period);
      const netAsset = product.netAsset === null ? (await Promise.all(product.shareCodes.map((code) => fetchFundNetAsset(code, period)))).reduce((sum, value) => sum + (value ?? 0), 0) || null : product.netAsset * 10_000;
      return { holdings, netAsset };
    }));
    for (const item of batch) {
      if (item.status === "fulfilled") results.push(item.value);
      else failed += 1;
    }
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
  const rankedHoldings = [...stocks.values()]
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 10);
  const industries = await Promise.all(rankedHoldings.map(async (item) => {
    try { return await fetchStockIndustry(item.stockCode); } catch { return "其他/未分类"; }
  }));
  const holdings = rankedHoldings.map((item, index) => {
      const changeShares = item.shares - item.previousShares;
      const weight = managedNav > 0 ? item.marketValue / managedNav * 100 : 0;
      return {
        ...item,
        rank: index + 1,
        industry: industries[index],
        weight,
        change: item.previousShares <= 0 ? "新进" : Math.abs(changeShares) < 0.005 ? "不变" : changeShares > 0 ? "增持" : "减持",
        changeShares,
      };
    });
  const topMarketValue = holdings.reduce((sum, item) => sum + item.marketValue, 0);
  const sectorMap = new Map<string, { industry: string; marketValue: number; navWeight: number; stockCount: number }>();
  for (const holding of holdings) {
    const sector = sectorMap.get(holding.industry) ?? { industry: holding.industry, marketValue: 0, navWeight: 0, stockCount: 0 };
    sector.marketValue += holding.marketValue;
    sector.navWeight += holding.weight;
    sector.stockCount += 1;
    sectorMap.set(holding.industry, sector);
  }
  const isOtherIndustry = (industry: string) => /^(其他|未分类|未知|其他\/未分类)$/.test(industry.trim());
  const sectors = [...sectorMap.values()].sort((a, b) => Number(isOtherIndustry(a.industry)) - Number(isOtherIndustry(b.industry)) || b.marketValue - a.marketValue).map((sector, index) => ({
    ...sector,
    rank: index + 1,
    holdingShare: topMarketValue > 0 ? sector.marketValue / topMarketValue * 100 : 0,
  }));
  return Response.json({ period, requested: products.length, succeeded, failed, managedNav, holdings, sectors, source: "东方财富基金公开数据（各份额规模合并、基金持仓与股票行业）" }, { headers: { "cache-control": "public, max-age=1800, s-maxage=86400" } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const products = (params.get("products") ?? "").split(",").map((item) => {
    const [code, netAssetText] = item.split(":");
    const netAsset = Number.parseFloat(netAssetText ?? "");
    return { code, shareCodes: [code], netAsset: Number.isFinite(netAsset) && netAsset >= 0 ? netAsset : null };
  });
  const fallback = (params.get("codes") ?? "").split(",").map((code) => ({ code, shareCodes: [code], netAsset: null }));
  return buildManagerHoldings(products.some((product) => product.code) ? products : fallback, params.get("period") ?? "");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { codes?: string[]; products?: ProductInput[]; period?: string };
  return buildManagerHoldings(body.products ?? (body.codes ?? []).map((code) => ({ code, shareCodes: [code], netAsset: null })), body.period ?? "");
}
