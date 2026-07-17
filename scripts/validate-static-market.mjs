import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const dataDir = path.join(root, "public/data/overview", period);
const fundDataDir = path.join(root, "public/data/funds", period);
const sectorDataDir = path.join(root, "public/data/sectors", period);
const stockDataDir = path.join(root, "public/data/stocks", period);
const stockBucketDir = path.join(stockDataDir, "buckets");
const snapshot = JSON.parse(await readFile(path.join(root, "app/data/market-index.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "public/data/overview/manifest.json"), "utf8"));
const files = (await readdir(dataDir)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
const fundFiles = (await readdir(fundDataDir)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
const sectorFiles = (await readdir(sectorDataDir)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
const stockIndex = JSON.parse(await readFile(path.join(stockDataDir, "index.json"), "utf8"));
const stockBucketFiles = (await readdir(stockBucketDir)).filter((name) => /^[0-9a-f]{2}\.json$/.test(name)).sort();
const expectedFiles = snapshot.companies.map((company) => `${company.id}.json`).sort();
const issues = [];
const allowedChanges = new Set(["\u65b0\u8fdb", "\u4e0d\u53d8", "\u589e\u6301", "\u51cf\u6301"]);
const addIssue = (severity, code, detail) => issues.push({ severity, code, detail });

if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
  addIssue("critical", "company_file_set", { expected: expectedFiles.length, actual: files.length });
}
if (JSON.stringify(fundFiles) !== JSON.stringify(expectedFiles)) {
  addIssue("critical", "fund_export_file_set", { expected: expectedFiles.length, actual: fundFiles.length });
}
if (JSON.stringify(sectorFiles) !== JSON.stringify(expectedFiles)) {
  addIssue("critical", "sector_export_file_set", { expected: expectedFiles.length, actual: sectorFiles.length });
}

const expectedManifestKeys = snapshot.companies.map((company) => `${company.id}:${period}`).sort();
const actualManifestKeys = Object.keys(manifest.entries ?? {}).filter((key) => key.endsWith(`:${period}`)).sort();
if (JSON.stringify(actualManifestKeys) !== JSON.stringify(expectedManifestKeys)) {
  addIssue("critical", "manifest_key_set", { expected: expectedManifestKeys.length, actual: actualManifestKeys.length });
}

const summary = {
  period,
  companies: 0,
  managers: 0,
  representativeProducts: 0,
  fundProducts: 0,
  fundProductsWithNetAsset: 0,
  fundProductsWithShareScale: 0,
  sectorStocks: 0,
  classifiedSectorStocks: 0,
  expectedShareCodes: 0,
  matchedScaleShareCodes: 0,
  managersWithHoldings: 0,
  zeroNavManagers: 0,
  disclosedHoldings: 0,
  stockSearchStocks: 0,
  stockSearchRecords: 0,
  stockSearchBuckets: stockBucketFiles.length,
  filesOver1Mb: 0,
  maxPayloadBytes: 0,
  maxPayloadCompany: "",
};

for (const company of snapshot.companies) {
  const file = path.join(dataDir, `${company.id}.json`);
  let payload;
  let fundPayload;
  let sectorPayload;
  try {
    payload = JSON.parse(await readFile(file, "utf8"));
    fundPayload = JSON.parse(await readFile(path.join(fundDataDir, `${company.id}.json`), "utf8"));
    sectorPayload = JSON.parse(await readFile(path.join(sectorDataDir, `${company.id}.json`), "utf8"));
  } catch (error) {
    addIssue("critical", "unreadable_company_payload", { companyId: company.id, error: String(error) });
    continue;
  }

  summary.companies += 1;
  summary.managers += payload.managerCount ?? 0;
  summary.representativeProducts += payload.representativeProductCount ?? 0;
  summary.fundProducts += fundPayload.productCount ?? 0;
  summary.expectedShareCodes += payload.quality?.expectedShareCodes ?? 0;
  summary.matchedScaleShareCodes += payload.quality?.matchedScaleShareCodes ?? 0;
  summary.managersWithHoldings += payload.quality?.managersWithHoldings ?? 0;
  summary.zeroNavManagers += payload.quality?.zeroNavManagers ?? 0;
  const size = (await stat(file)).size;
  if (size > 1_000_000) summary.filesOver1Mb += 1;
  if (size > summary.maxPayloadBytes) {
    summary.maxPayloadBytes = size;
    summary.maxPayloadCompany = company.name;
  }

  if (payload.companyId !== company.id || payload.companyName !== company.name || payload.period !== period) {
    addIssue("critical", "company_identity", { companyId: company.id });
  }
  const fundHash = createHash("sha256").update(JSON.stringify(fundPayload.products ?? [])).digest("hex");
  if (fundPayload.companyId !== company.id
    || fundPayload.companyName !== company.name
    || fundPayload.period !== period
    || fundPayload.version !== 2
    || fundPayload.productCount !== fundPayload.quality?.periodProducts
    || fundPayload.products?.length !== fundPayload.productCount
    || fundPayload.quality?.missingScaleProducts !== 0
    || fundPayload.quality?.netAssetProducts + fundPayload.quality?.shareOnlyProducts !== fundPayload.productCount
    || fundPayload.contentHash !== fundHash) {
    addIssue("critical", "fund_export_identity_or_integrity", { companyId: company.id });
  }
  summary.fundProductsWithNetAsset += fundPayload.quality?.netAssetProducts ?? 0;
  summary.fundProductsWithShareScale += fundPayload.quality?.shareOnlyProducts ?? 0;
  const fundCodes = new Set();
  for (const product of fundPayload.products ?? []) {
    if (!/^\d{6}$/.test(product.code)
      || !product.name
      || !product.shareCodes?.includes(product.code)
      || !Array.isArray(product.managers)
      || !product.type || product.type === "公募基金"
      || product.scalePeriod !== period
      || (product.netAsset === null && product.endShares === null)
      || (product.netAsset !== null && (!Number.isFinite(product.netAsset) || product.netAsset < 0))
      || (product.endShares !== null && (!Number.isFinite(product.endShares) || product.endShares < 0))
      || fundCodes.has(product.code)
      || !Array.isArray(product.holdings)
      || product.holdings.length > 10) {
      addIssue("high", "fund_export_product", { companyId: company.id, code: product.code });
      continue;
    }
    fundCodes.add(product.code);
    product.holdings.forEach((holding, index) => {
      if (holding.rank !== index + 1
        || !/^[A-Z0-9._-]{1,16}$/i.test(holding.stockCode)
        || !holding.stockName
        || !Number.isFinite(holding.weight) || holding.weight < 0
        || !allowedChanges.has(holding.change)) {
        addIssue("high", "fund_export_holding", { companyId: company.id, code: product.code, rank: index + 1 });
      }
    });
  }

  const expectedManagerIds = company.managers.map((manager) => manager.id).sort();
  const actualManagerIds = Object.keys(payload.managers ?? {}).sort();
  const actualSectorManagerIds = Object.keys(sectorPayload.managers ?? {}).sort();
  if (JSON.stringify(actualManagerIds) !== JSON.stringify(expectedManagerIds)) {
    addIssue("critical", "manager_roster", { companyId: company.id, expected: expectedManagerIds.length, actual: actualManagerIds.length });
  }
  const sectorHash = createHash("sha256").update(JSON.stringify(sectorPayload.managers ?? {})).digest("hex");
  if (sectorPayload.companyId !== company.id
    || sectorPayload.companyName !== company.name
    || sectorPayload.period !== period
    || sectorPayload.managerCount !== expectedManagerIds.length
    || JSON.stringify(actualSectorManagerIds) !== JSON.stringify(expectedManagerIds)
    || sectorPayload.contentHash !== sectorHash) {
    addIssue("critical", "sector_export_identity_or_integrity", { companyId: company.id });
  }
  for (const [managerId, manager] of Object.entries(sectorPayload.managers ?? {})) {
    let seenOther = false;
    let navWeight = 0;
    for (let index = 0; index < (manager.sectors ?? []).length; index += 1) {
      const sector = manager.sectors[index];
      const isOther = /^(其他|未分类|未知|其他\/未分类)$/.test(sector.industry?.trim() ?? "");
      if (sector.rank !== index + 1
        || !sector.industry
        || !Number.isFinite(sector.marketValue) || sector.marketValue < 0
        || !Number.isFinite(sector.navWeight) || sector.navWeight < 0
        || !Number.isFinite(sector.holdingShare) || sector.holdingShare < 0
        || !Number.isInteger(sector.stockCount) || sector.stockCount < 1
        || (seenOther && !isOther)) {
        addIssue("high", "sector_export_row", { companyId: company.id, managerId, rank: index + 1 });
      }
      if (isOther) seenOther = true;
      navWeight += sector.navWeight;
      summary.sectorStocks += sector.stockCount;
      if (!isOther) summary.classifiedSectorStocks += sector.stockCount;
    }
    if (navWeight > 100.01) addIssue("high", "sector_export_nav_weight", { companyId: company.id, managerId, navWeight });
  }
  if (payload.managerCount !== expectedManagerIds.length
    || payload.quality?.requestedManagers !== expectedManagerIds.length
    || payload.quality?.completedManagers !== expectedManagerIds.length) {
    addIssue("critical", "manager_counts", { companyId: company.id });
  }
  if (payload.quality?.failedDownloads !== 0
    || payload.quality?.fetchedProducts !== payload.representativeProductCount) {
    addIssue("critical", "download_completeness", { companyId: company.id, quality: payload.quality });
  }
  const scaleCoverage = payload.quality?.expectedShareCodes
    ? payload.quality.matchedScaleShareCodes / payload.quality.expectedShareCodes
    : 1;
  if (Math.abs((payload.quality?.scaleCoverage ?? scaleCoverage) - scaleCoverage) > 1e-12
    || (payload.quality?.expectedShareCodes >= 10 && scaleCoverage < 0.25)
    || (payload.quality?.scaleShareCodes > 0 && payload.quality?.matchedScaleShareCodes === 0)) {
    addIssue("high", "scale_coverage", { companyId: company.id, quality: payload.quality });
  }

  const expectedHash = createHash("sha256").update(JSON.stringify(payload.managers)).digest("hex");
  const manifestEntry = manifest.entries?.[`${company.id}:${period}`];
  if (payload.contentHash !== expectedHash
    || manifestEntry?.contentHash !== expectedHash
    || manifestEntry?.path !== `/data/overview/${period}/${company.id}.json`) {
    addIssue("critical", "content_integrity", { companyId: company.id });
  }

  let computedManagersWithHoldings = 0;
  let computedZeroNavManagers = 0;
  for (const [managerId, manager] of Object.entries(payload.managers ?? {})) {
    if (manager.period !== period || !Number.isFinite(manager.managedNav) || manager.managedNav < 0) {
      addIssue("high", "manager_period_or_nav", { companyId: company.id, managerId });
    }
    if (manager.requested !== manager.succeeded + manager.failed || manager.requested < 0 || manager.succeeded < 0 || manager.failed < 0) {
      addIssue("high", "manager_request_counts", { companyId: company.id, managerId });
    }
    if (!Array.isArray(manager.holdings) || manager.holdings.length > 10) {
      addIssue("high", "holding_count", { companyId: company.id, managerId, count: manager.holdings?.length });
      continue;
    }

    if (manager.holdings.length) computedManagersWithHoldings += 1;
    if (manager.managedNav <= 0) computedZeroNavManagers += 1;
    summary.disclosedHoldings += manager.holdings.length;
    const codes = new Set();
    let weightSum = 0;
    for (let index = 0; index < manager.holdings.length; index += 1) {
      const holding = manager.holdings[index];
      weightSum += holding.weight;
      if (holding.rank !== index + 1
        || (index > 0 && manager.holdings[index - 1].marketValue < holding.marketValue)
        || !/^[A-Z0-9._-]{1,16}$/i.test(holding.stockCode)
        || !holding.stockName
        || codes.has(holding.stockCode)
        || !Number.isFinite(holding.marketValue) || holding.marketValue < 0
        || !Number.isFinite(holding.weight) || holding.weight < 0
        || !Number.isInteger(holding.fundCount) || holding.fundCount < 1
        || !allowedChanges.has(holding.change)) {
        addIssue("high", "holding_validity", { companyId: company.id, managerId, rank: index + 1 });
      }
      codes.add(holding.stockCode);
    }
    if (weightSum > 100.01) addIssue("high", "manager_weight_sum", { companyId: company.id, managerId, weightSum });
  }

  if (computedManagersWithHoldings !== payload.quality?.managersWithHoldings
    || computedZeroNavManagers !== payload.quality?.zeroNavManagers) {
    addIssue("high", "quality_rollup", { companyId: company.id });
  }
}

if (summary.managers !== snapshot.managerCount) {
  addIssue("critical", "market_manager_total", { expected: snapshot.managerCount, actual: summary.managers });
}
const expectedStockHash = createHash("sha256").update(JSON.stringify(stockIndex.stocks ?? [])).digest("hex");
const stockCodes = new Set();
const expectedBuckets = new Set();
const bucketCache = new Map();
for (const stock of stockIndex.stocks ?? []) {
  if (stockCodes.has(stock.stockCode)
    || !/^[A-Z0-9._-]{1,16}$/i.test(stock.stockCode)
    || !stock.stockName
    || !Number.isInteger(stock.companyCount) || stock.companyCount < 1
    || !Number.isInteger(stock.managerCount) || stock.managerCount < 1
    || !/^[0-9a-f]{2}$/.test(stock.bucket)) {
    addIssue("high", "stock_search_index_row", { stockCode: stock.stockCode });
    continue;
  }
  stockCodes.add(stock.stockCode);
  expectedBuckets.add(`${stock.bucket}.json`);
  let bucket = bucketCache.get(stock.bucket);
  if (!bucket) {
    bucket = JSON.parse(await readFile(path.join(stockBucketDir, `${stock.bucket}.json`), "utf8"));
    bucketCache.set(stock.bucket, bucket);
  }
  const detail = bucket.stocks?.[stock.stockCode];
  const detailManagers = detail?.companies?.flatMap((company) => company.managers ?? []) ?? [];
  if (bucket.period !== period
    || detail?.stockCode !== stock.stockCode
    || detail?.stockName !== stock.stockName
    || detail?.companyCount !== stock.companyCount
    || detail?.managerCount !== stock.managerCount
    || detail?.companies?.length !== stock.companyCount
    || detailManagers.length !== stock.managerCount) {
    addIssue("critical", "stock_search_detail_identity", { stockCode: stock.stockCode });
    continue;
  }
  const managerKeys = new Set();
  for (const company of detail.companies) for (const manager of company.managers) {
    const key = `${company.companyId}:${manager.managerId}`;
    if (!company.companyName || managerKeys.has(key)
      || !manager.managerName
      || !Number.isInteger(manager.rank) || manager.rank < 1 || manager.rank > 10
      || !Number.isFinite(manager.navWeight) || manager.navWeight < 0
      || !Number.isFinite(manager.marketValue) || manager.marketValue < 0
      || !Number.isInteger(manager.fundCount) || manager.fundCount < 1
      || !allowedChanges.has(manager.change)) addIssue("high", "stock_search_manager_row", { stockCode: stock.stockCode, key });
    managerKeys.add(key);
  }
  summary.stockSearchRecords += detailManagers.length;
}
summary.stockSearchStocks = stockCodes.size;
if (stockIndex.period !== period
  || stockIndex.stockCount !== stockCodes.size
  || stockIndex.managerHoldingCount !== summary.stockSearchRecords
  || stockIndex.contentHash !== expectedStockHash
  || JSON.stringify([...expectedBuckets].sort()) !== JSON.stringify(stockBucketFiles)
  || summary.stockSearchRecords !== summary.disclosedHoldings) {
  addIssue("critical", "stock_search_completeness", { indexStocks: stockIndex.stockCount, actualStocks: stockCodes.size, indexRecords: stockIndex.managerHoldingCount, reverseRecords: summary.stockSearchRecords, disclosedHoldings: summary.disclosedHoldings, expectedBuckets: expectedBuckets.size, actualBuckets: stockBucketFiles.length });
}
summary.scaleCoverage = summary.expectedShareCodes ? summary.matchedScaleShareCodes / summary.expectedShareCodes : 1;
summary.fundScaleDisplayCoverage = summary.fundProducts ? (summary.fundProductsWithNetAsset + summary.fundProductsWithShareScale) / summary.fundProducts : 1;
summary.fundNetAssetCoverage = summary.fundProducts ? summary.fundProductsWithNetAsset / summary.fundProducts : 1;
if (summary.fundScaleDisplayCoverage < 1 || summary.fundNetAssetCoverage < 0.99) addIssue("high", "fund_product_scale_coverage", { display: summary.fundScaleDisplayCoverage, netAsset: summary.fundNetAssetCoverage });
summary.industryClassificationCoverage = summary.sectorStocks ? summary.classifiedSectorStocks / summary.sectorStocks : 1;
if (summary.industryClassificationCoverage < 0.99) addIssue("high", "industry_classification_coverage", { actual: summary.industryClassificationCoverage, minimum: 0.99 });
if (summary.filesOver1Mb > 0) addIssue("medium", "mobile_payload_size", { filesOver1Mb: summary.filesOver1Mb });

const result = {
  status: issues.some((issue) => issue.severity === "critical" || issue.severity === "high") ? "failed" : "passed",
  summary,
  issueCounts: issues.reduce((counts, issue) => ({ ...counts, [issue.severity]: (counts[issue.severity] ?? 0) + 1 }), {}),
  issues: issues.slice(0, 100),
};
console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed") process.exitCode = 1;
