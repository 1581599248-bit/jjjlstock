import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fetchStockIndustry } from "../app/lib/eastmoney.ts";
import { loadMarketSnapshot } from "./lib/market-snapshot.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
const concurrency = Math.max(1, Math.min(12, Number(args.get("concurrency") ?? 8)));
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const overviewDir = path.join(root, "public/data/overview", period);
const outputDir = path.join(root, "public/data/sectors", period);
const cacheDir = path.join(root, "work/industry-cache");
const cacheFile = path.join(cacheDir, "eastmoney-stock-industries.json");
const snapshot = await loadMarketSnapshot(root, period);
await mkdir(outputDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const isOtherIndustry = (industry) => /^(其他|未分类|未知|其他\/未分类)$/.test(String(industry ?? "").trim());

const overviewByCompany = new Map();
const stockCodes = new Set();
for (const file of await readdir(overviewDir)) {
  if (!/^\d{8}\.json$/.test(file)) continue;
  const payload = JSON.parse(await readFile(path.join(overviewDir, file), "utf8"));
  overviewByCompany.set(payload.companyId, payload);
  for (const manager of Object.values(payload.managers ?? {})) {
    for (const holding of manager.holdings ?? []) stockCodes.add(holding.stockCode);
  }
}

let industryByCode = {};
if (existsSync(cacheFile)) industryByCode = JSON.parse(await readFile(cacheFile, "utf8"));
const pending = [...stockCodes].filter((code) => !industryByCode[code] || isOtherIndustry(industryByCode[code]));
let cursor = 0;
let completed = 0;
let unresolved = 0;

async function fetchIndustryWithRetry(code) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const industry = String(await fetchStockIndustry(code)).trim();
      if (industry && !isOtherIndustry(industry)) return industry;
    } catch { /* retry below */ }
    if (attempt < 2) await sleep(500 * (attempt + 1));
  }
  return "其他/未分类";
}

async function worker() {
  while (cursor < pending.length) {
    const code = pending[cursor++];
    const industry = await fetchIndustryWithRetry(code);
    industryByCode[code] = industry;
    if (isOtherIndustry(industry)) unresolved += 1;
    completed += 1;
    if (completed % 100 === 0 || completed === pending.length) {
      process.stdout.write(`\r${completed}/${pending.length} detailed stock industries`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
if (pending.length) process.stdout.write("\n");
await writeFile(cacheFile, JSON.stringify(industryByCode, null, 2));

let managerCount = 0;
let managersWithSectors = 0;
let classifiedHoldings = 0;
let totalHoldings = 0;

for (const company of snapshot.companies) {
  const overview = overviewByCompany.get(company.id);
  if (!overview) throw new Error(`Missing overview payload ${company.id}`);
  const managers = {};
  for (const managerIndex of company.managers) {
    const manager = overview.managers[managerIndex.id];
    const holdings = manager?.holdings ?? [];
    const topMarketValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
    const sectorMap = new Map();
    for (const holding of holdings) {
      const industry = String(industryByCode[holding.stockCode] || "其他/未分类").trim() || "其他/未分类";
      const sector = sectorMap.get(industry) ?? { industry, marketValue: 0, navWeight: 0, stockCount: 0 };
      sector.marketValue += holding.marketValue;
      sector.navWeight += holding.weight;
      sector.stockCount += 1;
      sectorMap.set(industry, sector);
      totalHoldings += 1;
      if (!isOtherIndustry(industry)) classifiedHoldings += 1;
    }
    const sectors = [...sectorMap.values()]
      .sort((a, b) => Number(isOtherIndustry(a.industry)) - Number(isOtherIndustry(b.industry)) || b.marketValue - a.marketValue)
      .map((sector, index) => ({
        ...sector,
        rank: index + 1,
        holdingShare: topMarketValue > 0 ? sector.marketValue / topMarketValue * 100 : 0,
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
    source: "东方财富证券行情细分行业字段（基金经理前十大重仓股）",
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
  stockCodes: stockCodes.size,
  newlyFetchedIndustries: pending.length,
  unresolvedIndustries: unresolved,
  classificationCoverage: totalHoldings ? classifiedHoldings / totalHoldings : 1,
  outputDir,
}));