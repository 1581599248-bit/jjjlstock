import { fetchFundHoldings, fetchFundNetAsset } from "../../lib/eastmoney";

type ProductInput = { code?: string; shareCodes?: string[]; netAsset?: number | null };
type ManagerInput = { id?: string; products?: ProductInput[] };

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { period?: string; managers?: ManagerInput[] };
  const period = body.period ?? "";
  if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) return Response.json({ error: "财报期无效" }, { status: 400 });

  const managers = (body.managers ?? []).slice(0, 12).map((manager) => ({
    id: String(manager.id ?? ""),
    products: (manager.products ?? []).filter((product) => /^\d{6}$/.test(String(product.code ?? ""))).slice(0, 80).map((product) => ({ code: String(product.code), shareCodes: [...new Set((product.shareCodes ?? [String(product.code)]).filter((code) => /^\d{6}$/.test(code)))], netAsset: typeof product.netAsset === "number" && Number.isFinite(product.netAsset) && product.netAsset >= 0 ? product.netAsset : null })),
  })).filter((manager) => manager.id);
  if (!managers.length) return Response.json({ error: "基金经理参数无效" }, { status: 400 });

  const codes = [...new Set(managers.flatMap((manager) => manager.products.map((product) => product.code)))];
  const fundMap = new Map<string, Awaited<ReturnType<typeof fetchFundHoldings>>>();
  for (let index = 0; index < codes.length; index += 8) {
    const batchCodes = codes.slice(index, index + 8);
    const batch = await Promise.allSettled(batchCodes.map((code) => fetchFundHoldings(code, period)));
    batch.forEach((result, offset) => { if (result.status === "fulfilled") fundMap.set(batchCodes[offset], result.value); });
  }
  const missingScaleCodes = [...new Set(managers.flatMap((manager) => manager.products.filter((product) => product.netAsset === null).flatMap((product) => product.shareCodes)))];
  const scaleMap = new Map<string, number>();
  for (let index = 0; index < missingScaleCodes.length; index += 8) {
    const batchCodes = missingScaleCodes.slice(index, index + 8);
    const batch = await Promise.allSettled(batchCodes.map((code) => fetchFundNetAsset(code, period)));
    batch.forEach((result, offset) => { if (result.status === "fulfilled" && result.value !== null) scaleMap.set(batchCodes[offset], result.value); });
  }

  const summaries: Record<string, unknown> = {};
  for (const manager of managers) {
    const resolvedProducts = manager.products.map((product) => ({ ...product, netAssetWan: product.netAsset === null ? product.shareCodes.reduce((sum, code) => sum + (scaleMap.get(code) ?? 0), 0) : product.netAsset * 10_000 }));
    const validProducts = resolvedProducts.filter((product) => product.netAssetWan > 0 && fundMap.has(product.code));
    const managedNav = validProducts.reduce((sum, product) => sum + product.netAssetWan, 0);
    const stocks = new Map<string, { stockCode: string; stockName: string; marketValue: number; fundCount: number; shares: number; previousShares: number }>();
    for (const product of validProducts) {
      for (const holding of fundMap.get(product.code)?.holdings ?? []) {
        const item = stocks.get(holding.stockCode) ?? { stockCode: holding.stockCode, stockName: holding.stockName, marketValue: 0, fundCount: 0, shares: 0, previousShares: 0 };
        item.marketValue += holding.marketValue;
        item.fundCount += 1;
        item.shares += holding.shares;
        item.previousShares += holding.changeShares === null ? holding.shares : holding.shares - holding.changeShares;
        stocks.set(holding.stockCode, item);
      }
    }
    const holdings = [...stocks.values()].sort((a, b) => b.marketValue - a.marketValue).slice(0, 10).map((item, index) => {
      const changeShares = item.shares - item.previousShares;
      return { ...item, rank: index + 1, industry: "", weight: managedNav > 0 ? item.marketValue / managedNav * 100 : 0, change: item.previousShares <= 0 ? "新进" : Math.abs(changeShares) < 0.005 ? "不变" : changeShares > 0 ? "增持" : "减持", changeShares };
    });
    summaries[manager.id] = { period, requested: manager.products.length, succeeded: validProducts.length, failed: manager.products.length - validProducts.length, managedNav, holdings, sectors: [], source: "东方财富基金公开数据（批量基金经理持仓；各份额规模合并）" };
  }
  return Response.json({ period, managers: summaries, uniqueFunds: codes.length }, { headers: { "cache-control": "private, max-age=300" } });
}
