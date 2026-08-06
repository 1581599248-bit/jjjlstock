type IndustryRow = { rank: number; industry: string; fundCount: number; navWeight: number; marketValue: number };
type CompanyIndex = { id: string; name: string; managedFundCount?: number };
type MarketIndex = { companies?: CompanyIndex[] };

const inflight = new Map<string, Promise<Record<string, unknown>>>();
const HEADERS = {
  accept: "text/html,application/xhtml+xml",
  referer: "https://fund.eastmoney.com/Company/",
  "user-agent": "Mozilla/5.0 (compatible; FundHoldingsRadar/1.0)",
};

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function numberValue(value: string | undefined) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCompanyRows(html: string, period: string): IndustryRow[] {
  const escaped = period.replaceAll("-", "\\-");
  const pattern = new RegExp(`截止至[：:]?\\s*(?:<[^>]+>\\s*)*${escaped}(?:\\s*<\\/[^>]+>)*[\\s\\S]{0,2000}?<table\\b[^>]*>([\\s\\S]*?)<\\/table>`, "gi");
  const tables = [...html.matchAll(pattern)].map((match) => match[1]);
  if (!tables.length) {
    const index = html.indexOf(period);
    if (index >= 0) {
      const table = html.slice(index, index + 80_000).match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1];
      if (table) tables.push(table);
    }
  }
  for (const table of tables) {
    const rows: IndustryRow[] = [];
    for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripHtml(cell[1]));
      if (cells.length < 5) continue;
      const rank = Number.parseInt(cells[0], 10);
      const industry = cells[1]?.trim() ?? "";
      const fundCount = numberValue(cells.at(-3));
      const navWeight = numberValue(cells.at(-2));
      const marketValue = numberValue(cells.at(-1));
      if (!Number.isFinite(rank) || !industry || /^(行业类别|行业名称|合计|总计)$/.test(industry)) continue;
      if (fundCount === null || navWeight === null || marketValue === null) continue;
      rows.push({ rank, industry, fundCount: Math.max(0, Math.round(fundCount)), navWeight: Math.max(0, navWeight), marketValue: Math.max(0, marketValue) });
    }
    if (rows.length) return rows;
  }
  return [];
}

async function fetchCompanyRows(company: CompanyIndex, period: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const url = `https://fund.eastmoney.com/Company/f10/hypz_${company.id}.html?year=${period.slice(0, 4)}&rt=${Date.now()}`;
      const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
      if (!response.ok) throw new Error(`upstream ${response.status}`);
      const rows = parseCompanyRows(await response.text(), period);
      if (!rows.length) throw new Error(`no ${period} rows`);
      const denominatorRow = [...rows].filter((row) => row.navWeight >= 0.01 && row.marketValue > 0).sort((a, b) => b.marketValue - a.marketValue)[0];
      const netAsset = denominatorRow ? denominatorRow.marketValue * 100 / denominatorRow.navWeight : 0;
      return { company, rows, netAsset };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
    } finally { clearTimeout(timeout); }
  }
  throw lastError instanceof Error ? lastError : new Error("industry request failed");
}

async function buildLive(request: Request, period: string) {
  const marketResponse = await fetch(new URL(`/data/market/${period}.json`, request.url), { cache: "force-cache" });
  if (!marketResponse.ok) throw new Error("全市场基金公司索引读取失败");
  const market = await marketResponse.json() as MarketIndex;
  const companies = market.companies ?? [];
  const successes: Awaited<ReturnType<typeof fetchCompanyRows>>[] = [];
  const failures: Array<{ companyId: string; companyName: string; error: string }> = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(10, companies.length) }, async () => {
    while (cursor < companies.length) {
      const company = companies[cursor++];
      try { successes.push(await fetchCompanyRows(company, period)); }
      catch (error) { failures.push({ companyId: company.id, companyName: company.name, error: error instanceof Error ? error.message : String(error) }); }
    }
  }));
  if (!successes.length || successes.length / Math.max(companies.length, 1) < 0.35) throw new Error("全市场行业配置源数据覆盖不足");

  const industries = new Map<string, { industry: string; fundCount: number; marketValue: number; companies: Set<string> }>();
  for (const result of successes) for (const row of result.rows) {
    const item = industries.get(row.industry) ?? { industry: row.industry, fundCount: 0, marketValue: 0, companies: new Set<string>() };
    item.fundCount += row.fundCount;
    item.marketValue += row.marketValue;
    item.companies.add(result.company.id);
    industries.set(row.industry, item);
  }
  const coveredNetAsset = successes.reduce((sum, item) => sum + item.netAsset, 0);
  const totalIndustryMarketValue = [...industries.values()].reduce((sum, item) => sum + item.marketValue, 0);
  const rows = [...industries.values()].sort((a, b) => b.marketValue - a.marketValue).map((item, index) => ({
    rank: index + 1,
    industry: item.industry,
    fundCount: item.fundCount,
    companyCount: item.companies.size,
    marketValue: item.marketValue,
    navWeight: coveredNetAsset > 0 ? item.marketValue / coveredNetAsset * 100 : 0,
    stockShare: totalIndustryMarketValue > 0 ? item.marketValue / totalIndustryMarketValue * 100 : 0,
    changePp: null,
    marketValueChange: null,
    rankChange: null,
  }));
  return {
    version: 1,
    period,
    generatedAt: new Date().toISOString(),
    source: "东方财富基金公司行业配置（全市场基金公司实时汇总）",
    sourceUrl: "https://fund.eastmoney.com/data/hypzlist.html",
    totalCompanyCount: companies.length,
    coveredCompanyCount: successes.length,
    failedCompanyCount: failures.length,
    coverageRatio: successes.length / Math.max(companies.length, 1),
    coveredProductCount: successes.reduce((sum, item) => sum + Number(item.company.managedFundCount ?? 0), 0),
    coveredNetAsset,
    totalIndustryMarketValue,
    totalIndustryNavWeight: coveredNetAsset > 0 ? totalIndustryMarketValue / coveredNetAsset * 100 : 0,
    industryCount: rows.length,
    industries: rows,
    quality: { liveFallback: true, failures: failures.slice(0, 30) },
  };
}

export async function GET(request: Request) {
  const period = new URL(request.url).searchParams.get("period") ?? "";
  if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) return Response.json({ error: "invalid period" }, { status: 400 });
  try {
    const staticResponse = await fetch(new URL(`/data/market-industries/${period}.json`, request.url), { cache: "force-cache" });
    if (staticResponse.ok) return new Response(await staticResponse.text(), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=1800" } });
  } catch { /* use the live fallback */ }
  if (!inflight.has(period)) inflight.set(period, buildLive(request, period).finally(() => inflight.delete(period)));
  try {
    const payload = await inflight.get(period)!;
    return Response.json(payload, { headers: { "cache-control": "public, max-age=300, s-maxage=1800" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "全市场行业配置生成失败" }, { status: 503 });
  }
}
