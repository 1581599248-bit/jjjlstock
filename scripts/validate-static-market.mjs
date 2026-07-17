import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { companyProducts } from "./lib/company-products.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const dataDir = path.join(root, "public/data/overview", period);
const fundDataDir = path.join(root, "public/data/funds", period);
const snapshot = JSON.parse(await readFile(path.join(root, "app/data/market-index.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "public/data/overview/manifest.json"), "utf8"));
const files = (await readdir(dataDir)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
const fundFiles = (await readdir(fundDataDir)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
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
  expectedShareCodes: 0,
  matchedScaleShareCodes: 0,
  managersWithHoldings: 0,
  zeroNavManagers: 0,
  disclosedHoldings: 0,
  filesOver1Mb: 0,
  maxPayloadBytes: 0,
  maxPayloadCompany: "",
};

for (const company of snapshot.companies) {
  const file = path.join(dataDir, `${company.id}.json`);
  let payload;
  let fundPayload;
  try {
    payload = JSON.parse(await readFile(file, "utf8"));
    fundPayload = JSON.parse(await readFile(path.join(fundDataDir, `${company.id}.json`), "utf8"));
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
  const expectedFundProducts = companyProducts(company);
  const fundHash = createHash("sha256").update(JSON.stringify(fundPayload.products ?? [])).digest("hex");
  if (fundPayload.companyId !== company.id
    || fundPayload.companyName !== company.name
    || fundPayload.period !== period
    || fundPayload.productCount !== expectedFundProducts.length
    || fundPayload.products?.length !== expectedFundProducts.length
    || fundPayload.contentHash !== fundHash) {
    addIssue("critical", "fund_export_identity_or_integrity", { companyId: company.id });
  }
  const fundCodes = new Set();
  for (const product of fundPayload.products ?? []) {
    if (!/^\d{6}$/.test(product.code)
      || !product.name
      || !product.shareCodes?.includes(product.code)
      || !product.managers?.length
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
  if (JSON.stringify(actualManagerIds) !== JSON.stringify(expectedManagerIds)) {
    addIssue("critical", "manager_roster", { companyId: company.id, expected: expectedManagerIds.length, actual: actualManagerIds.length });
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
summary.scaleCoverage = summary.expectedShareCodes ? summary.matchedScaleShareCodes / summary.expectedShareCodes : 1;
if (summary.filesOver1Mb > 0) addIssue("medium", "mobile_payload_size", { filesOver1Mb: summary.filesOver1Mb });

const result = {
  status: issues.some((issue) => issue.severity === "critical" || issue.severity === "high") ? "failed" : "passed",
  summary,
  issueCounts: issues.reduce((counts, issue) => ({ ...counts, [issue.severity]: (counts[issue.severity] ?? 0) + 1 }), {}),
  issues: issues.slice(0, 100),
};
console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed") process.exitCode = 1;
