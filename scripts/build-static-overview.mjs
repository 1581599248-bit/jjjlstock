import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { companyProductsForPeriod, managerProductsForPeriod } from "./lib/company-products.mjs";
import { fetchCompanyScaleRows, productScaleFields } from "./lib/company-scales.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const companyId = args.get("company") ?? "80000222";
const period = args.get("period") ?? "2026-03-31";
const concurrency = Math.max(1, Math.min(12, Number(args.get("concurrency") ?? 6)));
if (!/^\d{8}$/.test(companyId) || !/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid company or period");

const root = process.cwd();
const snapshot = JSON.parse(await readFile(path.join(root, "app/data/market-index.json"), "utf8"));
const fundTypes = JSON.parse(await readFile(path.join(root, "app/data/fund-types.json"), "utf8")).types;
const company = snapshot.companies.find((item) => item.id === companyId);
if (!company) throw new Error(`Unknown company ${companyId}`);
const expectedShareCodes = new Set(company.managers.flatMap((manager) => manager.fundCodes));

const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; FundHoldingsStaticBuilder/1.0)", referer: "https://fund.eastmoney.com/" };
const HOLDINGS_API = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx";
const checkpointDir = path.join(root, "work/static-overview", period, companyId);
const outputDir = path.join(root, "public/data/overview", period);
const fundOutputDir = path.join(root, "public/data/funds", period);
await mkdir(checkpointDir, { recursive: true });
await mkdir(outputDir, { recursive: true });
await mkdir(fundOutputDir, { recursive: true });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const unescapeHtml = (value) => value.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const stripTags = (value) => unescapeHtml(value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());

async function fetchText(url, referer = HEADERS.referer) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, { headers: { ...HEADERS, referer }, signal: controller.signal });
      if (!response.ok) throw new Error(`upstream ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("empty upstream response");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(700 * (attempt + 1));
    } finally { clearTimeout(timeout); }
  }
  throw lastError instanceof Error ? lastError : new Error("upstream request failed");
}

function parseQuarterTables(text) {
  const result = new Map();
  const blockPattern = /截止至：<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/g;
  for (const match of text.matchAll(blockPattern)) {
    const rows = [];
    for (const rowMatch of match[2].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => stripTags(cell[1]));
      if (cells.length < 6) continue;
      rows.push({
        rank: Number.parseInt(cells[0], 10) || rows.length + 1,
        stockCode: cells[1], stockName: cells[2],
        weight: Number.parseFloat((cells.at(-3) ?? "").replace("%", "")) || 0,
        shares: Number.parseFloat((cells.at(-2) ?? "").replace(/,/g, "")) || 0,
        marketValue: Number.parseFloat((cells.at(-1) ?? "").replace(/,/g, "")) || 0,
      });
    }
    result.set(match[1], rows.slice(0, 10));
  }
  return result;
}

function previousPeriod(value) {
  const [year, month] = value.split("-").map(Number);
  if (month === 3) return `${year - 1}-12-31`;
  if (month === 6) return `${year}-03-31`;
  if (month === 9) return `${year}-06-30`;
  return `${year}-09-30`;
}

async function fetchHolding(code) {
  const fetchYear = async (year) => {
    const params = new URLSearchParams({ type: "jjcc", code, topline: "10", year, month: period.slice(5, 7), rt: String(Date.now()) });
    return parseQuarterTables(await fetchText(`${HOLDINGS_API}?${params}`, `https://fundf10.eastmoney.com/ccmx_${code}.html`));
  };
  const currentYear = period.slice(0, 4);
  const prior = previousPeriod(period);
  const currentMap = await fetchYear(currentYear);
  const currentRows = currentMap.get(period) ?? [];
  if (!currentRows.length) return { code, period, holdings: [] };
  const priorMap = prior.slice(0, 4) === currentYear ? currentMap : await fetchYear(prior.slice(0, 4));
  const previous = new Map((priorMap.get(prior) ?? []).map((row) => [row.stockCode, row.shares]));
  const holdings = currentRows.map((row) => {
    const previousShares = previous.get(row.stockCode);
    const changeShares = previousShares === undefined ? row.shares : row.shares - previousShares;
    return { ...row, changeShares, change: previousShares === undefined ? "新进" : Math.abs(changeShares) < 0.005 ? "不变" : changeShares > 0 ? "增持" : "减持" };
  });
  return { code, period, holdings };
}

async function fetchScales() {
  return fetchCompanyScaleRows(companyId, period, { expectedCodes: expectedShareCodes });
}

const scaleRows = await fetchScales();
const scaleByCode = new Map(scaleRows.map((row) => [row.code, row]));
const scaleMap = new Map(scaleRows.filter((row) => row.netAsset !== null).map((row) => [row.code, row.netAsset]));
const productsByManager = new Map(company.managers.map((manager) => [manager.id, managerProductsForPeriod(manager, scaleRows)]));
const productCatalog = companyProductsForPeriod(company, scaleRows);
const representativeCodes = productCatalog.map((product) => product.code);
const fundMap = new Map();
const failures = [];
let cursor = 0;

async function worker() {
  while (cursor < representativeCodes.length) {
    const code = representativeCodes[cursor++];
    const checkpoint = path.join(checkpointDir, `${code}.json`);
    try {
      const value = existsSync(checkpoint) ? JSON.parse(await readFile(checkpoint, "utf8")) : await fetchHolding(code);
      fundMap.set(code, value);
      if (!existsSync(checkpoint)) await writeFile(checkpoint, JSON.stringify(value));
    } catch (error) {
      failures.push({ code, error: error instanceof Error ? error.message : String(error) });
    }
    if (cursor % 25 === 0 || cursor === representativeCodes.length) process.stdout.write(`\r${Math.min(cursor, representativeCodes.length)}/${representativeCodes.length} products`);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
process.stdout.write("\n");
if (failures.length) throw new Error(`Holding downloads failed: ${JSON.stringify(failures.slice(0, 10))}`);
const matchedScaleShareCodes = [...expectedShareCodes].filter((code) => scaleMap.has(code)).length;

const summaries = {};
let managersWithHoldings = 0;
let zeroNavManagers = 0;
for (const manager of company.managers) {
  const products = productsByManager.get(manager.id) ?? [];
  const resolved = products.map((product) => ({ ...product, netAssetWan: product.shareCodes.reduce((sum, code) => sum + (scaleMap.get(code) ?? 0) * 10_000, 0) }));
  const validProducts = resolved.filter((product) => product.netAssetWan > 0 && fundMap.has(product.code));
  const managedNav = validProducts.reduce((sum, product) => sum + product.netAssetWan, 0);
  const stocks = new Map();
  for (const product of validProducts) for (const holding of fundMap.get(product.code)?.holdings ?? []) {
    const item = stocks.get(holding.stockCode) ?? { stockCode: holding.stockCode, stockName: holding.stockName, marketValue: 0, fundCount: 0, shares: 0, previousShares: 0 };
    item.marketValue += holding.marketValue; item.fundCount += 1; item.shares += holding.shares;
    item.previousShares += holding.changeShares === null ? holding.shares : holding.shares - holding.changeShares;
    stocks.set(holding.stockCode, item);
  }
  const holdings = [...stocks.values()].sort((a, b) => b.marketValue - a.marketValue).slice(0, 10).map((item, index) => {
    const changeShares = item.shares - item.previousShares;
    return { ...item, rank: index + 1, industry: "", weight: managedNav > 0 ? item.marketValue / managedNav * 100 : 0, change: item.previousShares <= 0 ? "新进" : Math.abs(changeShares) < 0.005 ? "不变" : changeShares > 0 ? "增持" : "减持", changeShares };
  });
  if (holdings.length) managersWithHoldings += 1;
  if (managedNav <= 0) zeroNavManagers += 1;
  summaries[manager.id] = { period, requested: products.length, succeeded: validProducts.length, failed: products.length - validProducts.length, managedNav, holdings, sectors: [], source: "东方财富基金公开数据（后台预计算静态数据；各份额规模合并）" };
}

const generatedAt = new Date().toISOString();
const fundProducts = productCatalog.map((product) => ({
  ...product,
  type: product.shareCodes.map((code) => fundTypes[code]).find(Boolean) ?? "类型待披露",
  ...productScaleFields(product, scaleByCode),
  holdings: fundMap.get(product.code)?.holdings ?? [],
}));
const fundPayload = {
  version: 2, companyId, companyName: company.name, period, generatedAt,
  source: "东方财富基金公开数据（报告期产品范围、净资产/份额规模与预计算持仓）",
  productCount: fundProducts.length, products: fundProducts,
  quality: {
    periodShareCodes: scaleRows.length,
    netAssetShareCodes: scaleRows.filter((row) => row.netAsset !== null).length,
    periodProducts: fundProducts.length,
    netAssetProducts: fundProducts.filter((product) => product.netAsset !== null).length,
    shareOnlyProducts: fundProducts.filter((product) => product.netAsset === null && product.endShares !== null).length,
    missingScaleProducts: fundProducts.filter((product) => product.netAsset === null && product.endShares === null).length,
  },
};
fundPayload.contentHash = createHash("sha256").update(JSON.stringify(fundProducts)).digest("hex");
await writeFile(path.join(fundOutputDir, `${companyId}.json`), JSON.stringify(fundPayload));
const payload = {
  version: 1, companyId, companyName: company.name, period, generatedAt,
  source: "东方财富基金公开数据", managerCount: company.managers.length,
  representativeProductCount: representativeCodes.length, managers: summaries,
  quality: {
    requestedManagers: company.managers.length,
    completedManagers: Object.keys(summaries).length,
    fetchedProducts: fundMap.size,
    failedDownloads: failures.length,
    periodScaleShareCodes: scaleRows.length,
    scaleShareCodes: scaleMap.size,
    expectedShareCodes: expectedShareCodes.size,
    matchedScaleShareCodes,
    scaleCoverage: expectedShareCodes.size ? matchedScaleShareCodes / expectedShareCodes.size : 1,
    managersWithHoldings,
    zeroNavManagers,
  },
};
payload.contentHash = createHash("sha256").update(JSON.stringify(payload.managers)).digest("hex");
const outputFile = path.join(outputDir, `${companyId}.json`);
await writeFile(outputFile, JSON.stringify(payload));

const manifestFile = path.join(root, "public/data/overview/manifest.json");
if (args.get("skip-manifest") !== "true") {
  let manifest = { version: 1, updatedAt: generatedAt, entries: {} };
  if (existsSync(manifestFile)) manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.updatedAt = generatedAt;
  manifest.entries[`${companyId}:${period}`] = { companyId, companyName: company.name, period, generatedAt, managerCount: payload.managerCount, productCount: payload.representativeProductCount, path: `/data/overview/${period}/${companyId}.json`, contentHash: payload.contentHash };
  await mkdir(path.dirname(manifestFile), { recursive: true });
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
}
console.log(JSON.stringify({ outputFile, ...payload.quality, representativeProductCount: payload.representativeProductCount, bytes: (await readFile(outputFile)).byteLength }));
