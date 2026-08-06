import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadMarketSnapshot } from "./lib/market-snapshot.mjs";
import { parseCompanyIndustryAllocation } from "./lib/market-industry-parser.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
const concurrency = Math.max(1, Math.min(16, Number(args.get("concurrency") ?? 8)));
const minimumCoverage = Math.max(0.1, Math.min(1, Number(args.get("minimum-coverage") ?? 0.7)));
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const snapshot = await loadMarketSnapshot(root, period);
const fundDir = path.join(root, "public/data/funds", period);
const outputDir = path.join(root, "public/data/market-industries");
const outputFile = path.join(outputDir, `${period}.json`);
await mkdir(outputDir, { recursive: true });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const headers = {
  accept: "text/html,application/xhtml+xml",
  referer: "https://fund.eastmoney.com/Company/",
  "user-agent": "Mozilla/5.0 (compatible; FundHoldingsRadar/1.0)",
};

async function fetchCompanyPage(companyId) {
  let lastError;
  const url = `https://fund.eastmoney.com/Company/f10/hypz_${companyId}.html`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`${url}?year=${period.slice(0, 4)}&rt=${Date.now()}`, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`upstream ${response.status}`);
      const html = await response.text();
      if (!html.includes("行业配置")) throw new Error("industry page missing expected heading");
      const rows = parseCompanyIndustryAllocation(html, period);
      if (!rows.length) throw new Error(`no ${period} industry rows`);
      return { url, rows };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("industry request failed");
}

const companies = [];
for (const company of snapshot.companies) {
  const fundFile = path.join(fundDir, `${company.id}.json`);
  if (!existsSync(fundFile)) throw new Error(`Missing fund payload ${company.id}/${period}`);
  const fundPayload = JSON.parse(await readFile(fundFile, "utf8"));
  const netAssetWan = (fundPayload.products ?? []).reduce((sum, product) => sum + (Number(product.netAsset) > 0 ? Number(product.netAsset) * 10_000 : 0), 0);
  companies.push({
    id: company.id,
    name: company.name,
    netAssetWan,
    productCount: Number(fundPayload.productCount ?? fundPayload.products?.length ?? 0),
  });
}

const results = [];
const failures = [];
let cursor = 0;
let completed = 0;
async function worker() {
  while (cursor < companies.length) {
    const company = companies[cursor++];
    try {
      const payload = await fetchCompanyPage(company.id);
      results.push({ ...company, ...payload });
    } catch (error) {
      failures.push({ companyId: company.id, companyName: company.name, error: error instanceof Error ? error.message : String(error) });
    }
    completed += 1;
    if (completed % 20 === 0 || completed === companies.length) process.stdout.write(`\r${completed}/${companies.length} company industry pages`);
    await sleep(50 + Math.floor(Math.random() * 100));
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, companies.length) }, () => worker()));
if (companies.length) process.stdout.write("\n");

const coverageRatio = companies.length ? results.length / companies.length : 0;
if (!results.length || coverageRatio < minimumCoverage) {
  throw new Error(`All-market industry coverage too low: ${results.length}/${companies.length}; sample failures: ${JSON.stringify(failures.slice(0, 8))}`);
}

const industryMap = new Map();
for (const company of results) {
  for (const row of company.rows) {
    const item = industryMap.get(row.industry) ?? {
      industry: row.industry,
      marketValue: 0,
      fundCount: 0,
      companyIds: new Set(),
    };
    item.marketValue += row.marketValue;
    item.fundCount += row.fundCount;
    item.companyIds.add(company.id);
    industryMap.set(row.industry, item);
  }
}

const coveredNetAsset = results.reduce((sum, company) => sum + company.netAssetWan, 0);
const coveredProductCount = results.reduce((sum, company) => sum + company.productCount, 0);
const totalIndustryMarketValue = [...industryMap.values()].reduce((sum, item) => sum + item.marketValue, 0);
let priorPayload = null;
try {
  const published = JSON.parse(await readFile(path.join(root, "app/data/published-periods.json"), "utf8"));
  const ordered = published.periods ?? [];
  const position = ordered.indexOf(period);
  const priorPeriod = position >= 0 ? ordered[position + 1] : null;
  if (priorPeriod) {
    const priorFile = path.join(outputDir, `${priorPeriod}.json`);
    if (existsSync(priorFile)) priorPayload = JSON.parse(await readFile(priorFile, "utf8"));
  }
} catch { /* comparisons are optional */ }
const priorByIndustry = new Map((priorPayload?.industries ?? []).map((item) => [item.industry, item]));

const industries = [...industryMap.values()]
  .sort((a, b) => b.marketValue - a.marketValue)
  .map((item, index) => {
    const prior = priorByIndustry.get(item.industry);
    const navWeight = coveredNetAsset > 0 ? item.marketValue / coveredNetAsset * 100 : 0;
    const stockShare = totalIndustryMarketValue > 0 ? item.marketValue / totalIndustryMarketValue * 100 : 0;
    return {
      rank: index + 1,
      industry: item.industry,
      fundCount: item.fundCount,
      companyCount: item.companyIds.size,
      marketValue: item.marketValue,
      navWeight,
      stockShare,
      changePp: prior ? navWeight - Number(prior.navWeight ?? 0) : null,
      marketValueChange: prior && Number(prior.marketValue) > 0 ? (item.marketValue / Number(prior.marketValue) - 1) * 100 : null,
      rankChange: prior ? Number(prior.rank) - (index + 1) : null,
    };
  });

const payload = {
  version: 1,
  period,
  generatedAt: new Date().toISOString(),
  source: "东方财富基金公司行业配置（全市场基金公司汇总）",
  sourceUrl: "https://fund.eastmoney.com/data/hypzlist.html",
  totalCompanyCount: companies.length,
  coveredCompanyCount: results.length,
  failedCompanyCount: failures.length,
  coverageRatio,
  coveredProductCount,
  coveredNetAsset,
  totalIndustryMarketValue,
  totalIndustryNavWeight: coveredNetAsset > 0 ? totalIndustryMarketValue / coveredNetAsset * 100 : 0,
  industryCount: industries.length,
  industries,
  quality: {
    minimumCoverage,
    failures: failures.slice(0, 50),
  },
};
payload.contentHash = createHash("sha256").update(JSON.stringify(industries)).digest("hex");
await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ period, industries: industries.length, coveredCompanies: results.length, totalCompanies: companies.length, coverageRatio, outputFile }));
