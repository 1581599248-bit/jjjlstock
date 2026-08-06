import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-06-30";
const concurrency = Math.max(1, Math.min(10, Number(args.get("concurrency") ?? 6)));
const minimumClassificationCoverage = Math.max(0.5, Math.min(1, Number(args.get("minimum-classification-coverage") ?? 0.9)));
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const ACTIVE_FUND_TYPES = new Set([
  "股票型",
  "股票型-普通股票",
  "混合型-偏股",
  "混合型-灵活",
  "混合型-平衡",
]);
const ACTIVE_FUND_TYPE_LABELS = ["普通股票型", "偏股混合型", "灵活配置型", "平衡混合型"];
const SW_CURRENT_API = "https://www.swsresearch.com/institute-sw/api/index_publish/current/";
const SW_COMPONENT_API = "https://www.swsresearch.com/institute-sw/api/index_publish/details/component_stocks/";
const SW_SOURCE_URL = "https://www.swsresearch.com/institute_sw/allIndex/releasedIndex";
const HEADERS = {
  accept: "application/json,text/plain,*/*",
  referer: SW_SOURCE_URL,
  "user-agent": "Mozilla/5.0 (compatible; FundHoldingsRadar/1.0)",
};

const root = process.cwd();
const fundDir = path.join(root, "public/data/funds", period);
const outputDir = path.join(root, "public/data/market-industries");
const outputFile = path.join(outputDir, `${period}.json`);
const cacheDir = path.join(root, "work/sw-industry-cache");
const cacheFile = path.join(cacheDir, "sw-level-one-2021.json");
await mkdir(outputDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });
if (!existsSync(fundDir)) throw new Error(`Missing fund directory ${fundDir}`);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalizeStockCode = (value) => String(value ?? "").match(/\d{6}/)?.[0] ?? "";
const isActiveFundType = (value) => ACTIVE_FUND_TYPES.has(String(value ?? "").trim());
const quarterNumber = Number(period.slice(5, 7)) / 3;

async function fetchJson(url, params) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`${url}?${new URLSearchParams(params)}`, { headers: HEADERS, signal: controller.signal });
      if (!response.ok) throw new Error(`upstream ${response.status}`);
      const payload = await response.json();
      if (!payload?.data) throw new Error("missing upstream data");
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SW industry request failed");
}

function normalizeIndexRow(row) {
  if (Array.isArray(row)) return { code: String(row[0] ?? ""), name: String(row[1] ?? "").trim() };
  return {
    code: String(row?.swindexcode ?? row?.swIndexCode ?? row?.indexCode ?? row?.code ?? ""),
    name: String(row?.swindexname ?? row?.swIndexName ?? row?.indexName ?? row?.name ?? "").trim(),
  };
}

async function loadSwLevelOneMap() {
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8"));
      if (cached?.version === 1 && Array.isArray(cached.industries) && cached.industries.length >= 25 && cached.stockIndustries) return cached;
    } catch { /* refresh invalid cache */ }
  }

  const catalogPayload = await fetchJson(SW_CURRENT_API, { page: "1", page_size: "100", indextype: "一级行业" });
  const catalogRows = catalogPayload?.data?.results ?? catalogPayload?.data?.list ?? [];
  const industries = catalogRows
    .map(normalizeIndexRow)
    .filter((item) => /^801\d{3}$/.test(item.code) && item.name)
    .filter((item, index, rows) => rows.findIndex((other) => other.code === item.code) === index);
  if (industries.length < 25) throw new Error(`SW level-one catalog incomplete: ${industries.length}`);

  const stockIndustries = {};
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < industries.length) {
      const industry = industries[cursor++];
      try {
        const payload = await fetchJson(SW_COMPONENT_API, { swindexcode: industry.code, page: "1", page_size: "10000" });
        const rows = payload?.data?.results ?? [];
        if (!Array.isArray(rows) || !rows.length) throw new Error("empty component list");
        for (const row of rows) {
          const code = normalizeStockCode(row?.stockcode ?? row?.stockCode ?? (Array.isArray(row) ? row[0] : ""));
          if (code) stockIndustries[code] = { industry: industry.name, industryCode: industry.code };
        }
      } catch (error) {
        failures.push({ industryCode: industry.code, industry: industry.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, industries.length) }, () => worker()));
  if (failures.length || Object.keys(stockIndustries).length < 4_000) {
    throw new Error(`SW component map incomplete: ${Object.keys(stockIndustries).length} stocks; ${JSON.stringify(failures.slice(0, 5))}`);
  }
  const result = { version: 1, generatedAt: new Date().toISOString(), source: "申万宏源研究申万2021行业分类", industries, stockIndustries };
  await writeFile(cacheFile, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const sw = await loadSwLevelOneMap();
const industryMap = new Map(sw.industries.map((item) => [item.name, {
  industry: item.name,
  industryCode: item.code,
  marketValue: 0,
  productCodes: new Set(),
  companyIds: new Set(),
  holdingCount: 0,
}]));
const activeProducts = new Set();
const activeCompanies = new Set();
const typeCounts = new Map();
const unclassified = new Map();
let aShareMarketValue = 0;
let classifiedMarketValue = 0;
let activeHoldingCount = 0;

const files = (await readdir(fundDir)).filter((file) => /^\d{8}\.json$/.test(file));
for (const file of files) {
  const payload = JSON.parse(await readFile(path.join(fundDir, file), "utf8"));
  for (const product of payload.products ?? []) {
    if (!isActiveFundType(product.type)) continue;
    const productCode = String(product.code ?? "");
    activeProducts.add(productCode);
    activeCompanies.add(String(payload.companyId ?? file.slice(0, 8)));
    typeCounts.set(product.type, (typeCounts.get(product.type) ?? 0) + 1);
    for (const holding of product.holdings ?? []) {
      const code = normalizeStockCode(holding.stockCode);
      const marketValue = Number(holding.marketValue);
      if (!code || !(marketValue > 0)) continue;
      activeHoldingCount += 1;
      aShareMarketValue += marketValue;
      const classification = sw.stockIndustries[code];
      if (!classification) {
        const missing = unclassified.get(code) ?? { stockCode: code, stockName: String(holding.stockName ?? ""), marketValue: 0, occurrences: 0 };
        missing.marketValue += marketValue;
        missing.occurrences += 1;
        unclassified.set(code, missing);
        continue;
      }
      const item = industryMap.get(classification.industry);
      if (!item) continue;
      item.marketValue += marketValue;
      item.productCodes.add(productCode);
      item.companyIds.add(String(payload.companyId ?? file.slice(0, 8)));
      item.holdingCount += 1;
      classifiedMarketValue += marketValue;
    }
  }
}

const classificationCoverage = aShareMarketValue > 0 ? classifiedMarketValue / aShareMarketValue : 0;
if (!activeProducts.size) throw new Error(`No active equity fund products found for ${period}`);
if (classificationCoverage < minimumClassificationCoverage) {
  const topMissing = [...unclassified.values()].sort((a, b) => b.marketValue - a.marketValue).slice(0, 12);
  throw new Error(`SW classification coverage too low: ${(classificationCoverage * 100).toFixed(2)}%; ${JSON.stringify(topMissing)}`);
}

let priorPayload = null;
try {
  const published = JSON.parse(await readFile(path.join(root, "app/data/published-periods.json"), "utf8"));
  const ordered = published.periods ?? [];
  const position = ordered.indexOf(period);
  const priorPeriod = position >= 0 ? ordered[position + 1] : null;
  if (priorPeriod) {
    const priorFile = path.join(outputDir, `${priorPeriod}.json`);
    if (existsSync(priorFile)) {
      const candidate = JSON.parse(await readFile(priorFile, "utf8"));
      if (candidate?.scope?.classification === "申万一级行业（2021）" && candidate?.scope?.fundUniverse === "主动偏股公募基金") priorPayload = candidate;
    }
  }
} catch { /* quarter comparison is optional */ }
const priorByIndustry = new Map((priorPayload?.industries ?? []).map((item) => [item.industry, item]));

const industries = [...industryMap.values()]
  .sort((a, b) => b.marketValue - a.marketValue || a.industry.localeCompare(b.industry, "zh-CN"))
  .map((item, index) => {
    const allocationShare = classifiedMarketValue > 0 ? item.marketValue / classifiedMarketValue * 100 : 0;
    const prior = priorByIndustry.get(item.industry);
    const priorShare = prior ? Number(prior.allocationShare ?? prior.navWeight ?? 0) : null;
    return {
      rank: index + 1,
      industry: item.industry,
      industryCode: item.industryCode,
      marketValue: item.marketValue,
      allocationShare,
      qoqChange: priorShare === null ? null : allocationShare - priorShare,
      fundCount: item.productCodes.size,
      companyCount: item.companyIds.size,
      holdingCount: item.holdingCount,
    };
  });

const payload = {
  version: 2,
  period,
  quarter: `Q${quarterNumber}`,
  generatedAt: new Date().toISOString(),
  source: "东方财富基金季度前十大重仓股；申万宏源研究申万2021行业分类",
  sourceUrls: ["https://fundf10.eastmoney.com/", SW_SOURCE_URL],
  scope: {
    fundUniverse: "主动偏股公募基金",
    fundTypes: ACTIVE_FUND_TYPE_LABELS,
    sourceFundTypes: [...ACTIVE_FUND_TYPES],
    classification: "申万一级行业（2021）",
    holdingScope: "季度前十大重仓股中的A股持仓",
    denominator: "纳入统计且完成申万一级分类的A股重仓持仓总市值",
  },
  activeFundCount: activeProducts.size,
  activeCompanyCount: activeCompanies.size,
  activeHoldingCount,
  classifiedMarketValue,
  aShareMarketValue,
  classificationCoverage,
  industryCount: industries.length,
  typeCounts: Object.fromEntries([...typeCounts.entries()].sort()),
  industries,
  quality: {
    minimumClassificationCoverage,
    unclassifiedStockCount: unclassified.size,
    topUnclassified: [...unclassified.values()].sort((a, b) => b.marketValue - a.marketValue).slice(0, 30),
  },
};
payload.contentHash = createHash("sha256").update(JSON.stringify({ scope: payload.scope, industries })).digest("hex");
await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({
  period,
  quarter: payload.quarter,
  activeFunds: activeProducts.size,
  activeCompanies: activeCompanies.size,
  industries: industries.length,
  classifiedMarketValue,
  classificationCoverage,
  outputFile,
}));
