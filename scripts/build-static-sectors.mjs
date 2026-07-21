import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadMarketSnapshot } from "./lib/market-snapshot.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
const concurrency = Math.max(1, Math.min(12, Number(args.get("concurrency") ?? 6)));
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const overviewDir = path.join(root, "public/data/overview", period);
const fundDir = path.join(root, "public/data/funds", period);
const outputDir = path.join(root, "public/data/sectors", period);
const cacheDir = path.join(root, "work/industry-cache");
const cacheFile = path.join(cacheDir, `eastmoney-fund-industries-${period}.json`);
const snapshot = await loadMarketSnapshot(root, period);
await mkdir(outputDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const numberOrNull = (value) => {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[% ,]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const normalizeDate = (value) => String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";

function normalizeIndustryRow(row) {
  const values = Object.values(row ?? {});
  const reportDate = normalizeDate(
    row?.FSRQ ?? row?.REPORTDATE ?? row?.ReportDate ?? row?.JZRQ ?? row?.ENDDATE ?? values[1],
  );
  const industry = String(
    row?.HYMC ?? row?.INDUSTRYNAME ?? row?.IndustryName ?? row?.HYLB ?? row?.HY ?? values[3] ?? "",
  ).trim();
  const marketValue = numberOrNull(
    row?.SZ ?? row?.MARKETVALUE ?? row?.MarketValue ?? row?.CCSZ ?? row?.HYSZ ?? values[4],
  );
  const navWeight = numberOrNull(
    row?.ZJZBL ?? row?.NAVRATIO ?? row?.NAVRatio ?? row?.JZBL ?? row?.ZJZB ?? values[6],
  );
  if (reportDate !== period || !industry || /^(合计|总计)$/.test(industry)) return null;
  if (marketValue === null && navWeight === null) return null;
  return { industry, marketValue, navWeight };
}

async function fetchFundIndustries(code) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const callback = `jQuery${Date.now()}_${code}_${attempt}`;
      const params = new URLSearchParams({ fundCode: code, year: period.slice(0, 4), callback, _: String(Date.now()) });
      const response = await fetch(`https://api.fund.eastmoney.com/f10/HYPZ/?${params}`, {
        headers: {
          accept: "*/*",
          referer: "https://fundf10.eastmoney.com/",
          "user-agent": "Mozilla/5.0 (compatible; FundManagerIndustryBuilder/1.0)",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`industry upstream ${response.status}`);
      const text = await response.text();
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("invalid industry response");
      const payload = JSON.parse(text.slice(start, end + 1));
      const quarterInfos = payload?.Data?.QuarterInfos;
      if (!Array.isArray(quarterInfos)) throw new Error("missing industry quarter data");
      const rows = quarterInfos
        .flatMap((quarter) => Array.isArray(quarter?.HYPZInfo) ? quarter.HYPZInfo : [])
        .map(normalizeIndustryRow)
        .filter(Boolean);
      const merged = new Map();
      for (const row of rows) {
        const item = merged.get(row.industry) ?? { industry: row.industry, marketValue: 0, navWeight: 0 };
        if (row.marketValue !== null) item.marketValue += row.marketValue;
        if (row.navWeight !== null) item.navWeight += row.navWeight;
        merged.set(row.industry, item);
      }
      return [...merged.values()];
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("industry request failed");
}

const overviewByCompany = new Map();
const fundsByCompany = new Map();
const fundCodes = new Set();
for (const company of snapshot.companies) {
  const overview = JSON.parse(await readFile(path.join(overviewDir, `${company.id}.json`), "utf8"));
  const funds = JSON.parse(await readFile(path.join(fundDir, `${company.id}.json`), "utf8"));
  overviewByCompany.set(company.id, overview);
  fundsByCompany.set(company.id, funds);
  for (const product of funds.products ?? []) {
    if (product.netAsset > 0 && Array.isArray(product.managers) && product.managers.length) fundCodes.add(product.code);
  }
}

let industryByFund = {};
if (existsSync(cacheFile)) {
  const cached = JSON.parse(await readFile(cacheFile, "utf8"));
  if (cached?.period === period && cached?.funds && typeof cached.funds === "object") industryByFund = cached.funds;
}
const pending = [...fundCodes].filter((code) => !Object.hasOwn(industryByFund, code));
const failures = [];
let cursor = 0;
let completed = 0;

async function worker() {
  while (cursor < pending.length) {
    const code = pending[cursor++];
    try {
      industryByFund[code] = await fetchFundIndustries(code);
    } catch (error) {
      failures.push({ code, error: error instanceof Error ? error.message : String(error) });
    }
    completed += 1;
    if (completed % 100 === 0 || completed === pending.length) process.stdout.write(`\r${completed}/${pending.length} fund industries`);
    await sleep(80 + Math.floor(Math.random() * 120));
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
if (pending.length) process.stdout.write("\n");
await writeFile(cacheFile, JSON.stringify({ version: 1, period, funds: industryByFund }, null, 2));

let managerCount = 0;
let managersWithSectors = 0;
let managerProducts = 0;
let managerProductsWithIndustry = 0;
let normalizedFundWeights = 0;

for (const company of snapshot.companies) {
  const overview = overviewByCompany.get(company.id);
  const fundPayload = fundsByCompany.get(company.id);
  if (!overview) throw new Error(`Missing overview payload ${company.id}`);
  if (!fundPayload) throw new Error(`Missing fund payload ${company.id}`);
  const managers = {};
  for (const managerIndex of company.managers) {
    const managerFundCodes = new Set(managerIndex.fundCodes ?? []);
    const products = (fundPayload.products ?? []).filter((product) => (
      product.netAsset > 0
      && Array.isArray(product.shareCodes)
      && product.shareCodes.some((code) => managerFundCodes.has(code))
    ));
    const managedNav = products.reduce((sum, product) => sum + Number(product.netAsset) * 10_000, 0);
    const sectorMap = new Map();
    for (const product of products) {
      managerProducts += 1;
      const rows = (industryByFund[product.code] ?? []).filter((row) => row.navWeight > 0);
      if (rows.length) managerProductsWithIndustry += 1;
      const reportedWeight = rows.reduce((sum, row) => sum + row.navWeight, 0);
      const weightScale = reportedWeight > 100 ? 100 / reportedWeight : 1;
      if (weightScale < 1) normalizedFundWeights += 1;
      const productNavWan = Number(product.netAsset) * 10_000;
      for (const row of rows) {
        const marketValue = productNavWan * row.navWeight * weightScale / 100;
        if (!(marketValue > 0)) continue;
        const sector = sectorMap.get(row.industry) ?? { industry: row.industry, marketValue: 0, productCodes: new Set() };
        sector.marketValue += marketValue;
        sector.productCodes.add(product.code);
        sectorMap.set(row.industry, sector);
      }
    }
    const totalIndustryMarketValue = [...sectorMap.values()].reduce((sum, sector) => sum + sector.marketValue, 0);
    const sectors = [...sectorMap.values()]
      .sort((a, b) => b.marketValue - a.marketValue)
      .map((sector, index) => ({
        industry: sector.industry,
        marketValue: sector.marketValue,
        navWeight: managedNav > 0 ? sector.marketValue / managedNav * 100 : 0,
        stockCount: Math.max(1, sector.productCodes.size),
        rank: index + 1,
        holdingShare: totalIndustryMarketValue > 0 ? sector.marketValue / totalIndustryMarketValue * 100 : 0,
      }));
    managers[managerIndex.id] = { name: managerIndex.name, sectors };
    managerCount += 1;
    if (sectors.length) managersWithSectors += 1;
  }
  const generatedAt = new Date().toISOString();
  const payload = {
    version: 1,
    companyId: company.id,
    companyName: company.name,
    period,
    generatedAt,
    source: "东方财富基金官方行业配置（按基金行业占净值比例与同口径管理规模汇总至基金经理）",
    managerCount: company.managers.length,
    managers,
  };
  payload.contentHash = createHash("sha256").update(JSON.stringify(managers)).digest("hex");
  await writeFile(path.join(outputDir, `${company.id}.json`), JSON.stringify(payload));
}

console.log(JSON.stringify({
  period,
  companies: snapshot.companies.length,
  managers: managerCount,
  managersWithSectors,
  fundCodes: fundCodes.size,
  newlyFetchedFunds: pending.length,
  failedIndustryDownloads: failures.length,
  managerProductCoverage: managerProducts ? managerProductsWithIndustry / managerProducts : 1,
  normalizedFundWeights,
  outputDir,
}));