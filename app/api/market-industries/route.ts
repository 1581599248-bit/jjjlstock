type MarketCompany = { id: string; name: string };
type MarketPayload = { companies?: MarketCompany[] };
type FundHolding = { stockCode?: string; stockName?: string; marketValue?: number };
type FundProduct = { code?: string; type?: string; holdings?: FundHolding[] };
type FundPayload = { products?: FundProduct[] };
type IndustryAggregate = { industry: string; marketValue: number };

type BuiltPeriod = {
  period: string;
  activeFundCount: number;
  coveredCompanyCount: number;
  totalHoldingMarketValue: number;
  classifiedMarketValue: number;
  fundTypeCounts: Record<string, number>;
  industries: IndustryAggregate[];
};

const ACTIVE_TYPES = new Map([
  ["股票型", "普通股票型"],
  ["混合型-偏股", "偏股混合型"],
  ["混合型-灵活", "灵活配置型"],
  ["混合型-平衡", "平衡混合型"],
]);

const SW_LEVEL_ONE = [
  ["801010", "农林牧渔"], ["801030", "基础化工"], ["801040", "钢铁"], ["801050", "有色金属"],
  ["801080", "电子"], ["801110", "家用电器"], ["801120", "食品饮料"], ["801130", "纺织服饰"],
  ["801140", "轻工制造"], ["801150", "医药生物"], ["801160", "公用事业"], ["801170", "交通运输"],
  ["801180", "房地产"], ["801200", "商贸零售"], ["801210", "社会服务"], ["801230", "综合"],
  ["801710", "建筑材料"], ["801720", "建筑装饰"], ["801730", "电力设备"], ["801740", "国防军工"],
  ["801750", "计算机"], ["801760", "传媒"], ["801770", "通信"], ["801780", "银行"],
  ["801790", "非银金融"], ["801880", "汽车"], ["801890", "机械设备"], ["801950", "煤炭"],
  ["801960", "石油石化"], ["801970", "环保"], ["801980", "美容护理"],
] as const;

const payloadCache = new Map<string, Promise<Record<string, unknown>>>();
let swClassificationPromise: Promise<Map<string, string>> | null = null;

function normalizeStockCode(value: unknown) {
  const match = String(value ?? "").match(/\d{6}/);
  return match?.[0] ?? "";
}

function previousPeriod(period: string) {
  const year = Number(period.slice(0, 4));
  const month = period.slice(5, 7);
  if (month === "06") return `${year}-03-31`;
  if (month === "09") return `${year}-06-30`;
  if (month === "12") return `${year}-09-30`;
  return `${year - 1}-12-31`;
}

function quarter(period: string) {
  return period.slice(5, 7) === "03" ? "Q1" : period.slice(5, 7) === "06" ? "Q2" : period.slice(5, 7) === "09" ? "Q3" : "Q4";
}

async function fetchJson<T>(url: string | URL, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json,text/plain,*/*", "user-agent": "Mozilla/5.0 (compatible; FundHoldingsRadar/2.0)" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

async function loadSwClassification() {
  if (swClassificationPromise) return swClassificationPromise;
  swClassificationPromise = (async () => {
    const classification = new Map<string, string>();
    await mapLimit([...SW_LEVEL_ONE], 8, async ([indexCode, industry]) => {
      const url = new URL("https://www.swsresearch.com/institute-sw/api/index_publish/details/component_stocks/");
      url.searchParams.set("swindexcode", indexCode);
      url.searchParams.set("page", "1");
      url.searchParams.set("page_size", "10000");
      const payload = await fetchJson<{ data?: { results?: Array<Record<string, unknown> | unknown[]> } }>(url, 45_000);
      for (const row of payload.data?.results ?? []) {
        const code = normalizeStockCode(Array.isArray(row) ? row[0] : row.stockcode ?? row.stockCode ?? row.symbol);
        if (code) classification.set(code, industry);
      }
    });
    if (classification.size < 4_000) throw new Error(`申万一级行业成分股覆盖不足：${classification.size}`);
    return classification;
  })().catch((error) => {
    swClassificationPromise = null;
    throw error;
  });
  return swClassificationPromise;
}

async function buildPeriod(request: Request, period: string, swClassification: Map<string, string>): Promise<BuiltPeriod> {
  const market = await fetchJson<MarketPayload>(new URL(`/data/market/${period}.json`, request.url));
  const companies = market.companies ?? [];
  if (!companies.length) throw new Error(`${period} 全市场基金公司索引为空`);

  const industryMap = new Map<string, number>();
  const fundTypeCounts: Record<string, number> = Object.fromEntries([...ACTIVE_TYPES.values()].map((name) => [name, 0]));
  let activeFundCount = 0;
  let coveredCompanyCount = 0;
  let totalHoldingMarketValue = 0;
  let classifiedMarketValue = 0;

  await mapLimit(companies, 12, async (company) => {
    try {
      const payload = await fetchJson<FundPayload>(new URL(`/data/funds/${period}/${company.id}.json`, request.url));
      coveredCompanyCount += 1;
      for (const product of payload.products ?? []) {
        const displayType = ACTIVE_TYPES.get(String(product.type ?? ""));
        if (!displayType) continue;
        activeFundCount += 1;
        fundTypeCounts[displayType] = (fundTypeCounts[displayType] ?? 0) + 1;
        for (const holding of product.holdings ?? []) {
          const marketValue = Number(holding.marketValue ?? 0);
          if (!(marketValue > 0)) continue;
          totalHoldingMarketValue += marketValue;
          const stockCode = normalizeStockCode(holding.stockCode);
          const industry = swClassification.get(stockCode);
          if (!industry) continue;
          classifiedMarketValue += marketValue;
          industryMap.set(industry, (industryMap.get(industry) ?? 0) + marketValue);
        }
      }
    } catch {
      // A missing company snapshot reduces coverage but does not invalidate the full-market aggregation.
    }
  });

  if (!activeFundCount || coveredCompanyCount / companies.length < 0.7) {
    throw new Error(`${period} 主动偏股基金数据覆盖不足：${coveredCompanyCount}/${companies.length}`);
  }
  if (!classifiedMarketValue || classifiedMarketValue / Math.max(totalHoldingMarketValue, 1) < 0.75) {
    throw new Error(`${period} 申万一级行业分类覆盖不足`);
  }

  return {
    period,
    activeFundCount,
    coveredCompanyCount,
    totalHoldingMarketValue,
    classifiedMarketValue,
    fundTypeCounts,
    industries: [...industryMap.entries()].map(([industry, marketValue]) => ({ industry, marketValue })),
  };
}

async function buildPayload(request: Request, period: string) {
  const swClassification = await loadSwClassification();
  const current = await buildPeriod(request, period, swClassification);
  let prior: BuiltPeriod | null = null;
  try {
    prior = await buildPeriod(request, previousPeriod(period), swClassification);
  } catch {
    prior = null;
  }

  const priorTotal = prior?.classifiedMarketValue ?? 0;
  const priorShares = new Map((prior?.industries ?? []).map((item) => [item.industry, priorTotal > 0 ? item.marketValue / priorTotal * 100 : 0]));
  const industries = current.industries
    .sort((a, b) => b.marketValue - a.marketValue)
    .map((item, index) => {
      const allocationShare = item.marketValue / current.classifiedMarketValue * 100;
      const priorShare = priorShares.get(item.industry);
      return {
        rank: index + 1,
        industry: item.industry,
        marketValue: item.marketValue,
        allocationShare,
        qoqChange: priorShare === undefined ? null : allocationShare - priorShare,
      };
    });

  return {
    version: 2,
    period,
    quarter: quarter(period),
    generatedAt: new Date().toISOString(),
    source: "基金定期报告前十大重仓股汇总；申万宏源研究行业分类",
    sourceUrl: [
      "https://fund.eastmoney.com/",
      "https://www.swsresearch.com/institute_sw/allIndex/releasedIndex",
    ],
    scope: {
      fundUniverse: "主动偏股公募基金",
      fundTypes: [...ACTIVE_TYPES.values()],
      classification: "申万一级行业（2021）",
      holdingScope: "基金定期报告前十大重仓股",
    },
    activeFundCount: current.activeFundCount,
    coveredCompanyCount: current.coveredCompanyCount,
    fundTypeCounts: current.fundTypeCounts,
    totalHoldingMarketValue: current.totalHoldingMarketValue,
    totalIndustryMarketValue: current.classifiedMarketValue,
    classificationCoverage: current.classifiedMarketValue / Math.max(current.totalHoldingMarketValue, 1),
    priorPeriod: prior?.period ?? null,
    industries,
  };
}

export async function GET(request: Request) {
  const period = new URL(request.url).searchParams.get("period") ?? "";
  if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) {
    return Response.json({ error: "invalid period" }, { status: 400 });
  }

  try {
    const staticResponse = await fetch(new URL(`/data/market-industries/${period}.json`, request.url), { cache: "force-cache" });
    if (staticResponse.ok) {
      const payload = await staticResponse.json() as { version?: number; period?: string; scope?: { fundUniverse?: string; classification?: string }; industries?: unknown[] };
      if (
        payload.version === 2
        && payload.period === period
        && payload.scope?.fundUniverse === "主动偏股公募基金"
        && payload.scope?.classification === "申万一级行业（2021）"
        && Array.isArray(payload.industries)
      ) {
        return Response.json(payload, { headers: { "cache-control": "public, max-age=300, s-maxage=1800" } });
      }
    }
  } catch {
    // Generate from the published fund-product snapshots below.
  }

  const cacheKey = `${new URL(request.url).origin}|${period}`;
  if (!payloadCache.has(cacheKey)) {
    payloadCache.set(cacheKey, buildPayload(request, period).finally(() => payloadCache.delete(cacheKey)));
  }
  try {
    const payload = await payloadCache.get(cacheKey)!;
    return Response.json(payload, { headers: { "cache-control": "public, max-age=300, s-maxage=1800" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "主动偏股公募全行业数据生成失败" }, { status: 503 });
  }
}
