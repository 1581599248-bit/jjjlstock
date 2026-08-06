import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadMarketSnapshot } from "./lib/market-snapshot.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const overviewDir = path.join(root, "public/data/overview", period);
const fundDir = path.join(root, "public/data/funds", period);
const outputDir = path.join(root, "public/data/stocks", period);
const bucketDir = path.join(outputDir, "buckets");
const snapshot = await loadMarketSnapshot(root, period);
await mkdir(bucketDir, { recursive: true });
for (const file of await readdir(bucketDir)) if (/^[0-9a-f]{2}\.json$/.test(file)) await unlink(path.join(bucketDir, file));

function emptyStock(stockCode) {
  return { stockCode, names: new Map(), companies: new Map(), institutions: new Map() };
}

function emptyChangeCounts() {
  return { new: 0, increased: 0, decreased: 0, unchanged: 0, unknown: 0 };
}

function addChangeCount(counts, change) {
  if (change === "新进") counts.new += 1;
  else if (change === "增持") counts.increased += 1;
  else if (change === "减持") counts.decreased += 1;
  else if (change === "不变") counts.unchanged += 1;
  else counts.unknown += 1;
}

function normalizeStock(companyId, ownerId, holding) {
  const code = String(holding.stockCode ?? "").trim().toUpperCase();
  const name = String(holding.stockName ?? "").trim();
  if (!/^[A-Z0-9._-]{1,16}$/.test(code) || !name) throw new Error(`Invalid stock ${companyId}:${ownerId}:${code}`);
  return { code, name };
}

const stocks = new Map();
let managerHoldingCount = 0;
let productHoldingCount = 0;

for (const company of snapshot.companies) {
  const overview = JSON.parse(await readFile(path.join(overviewDir, `${company.id}.json`), "utf8"));
  const managerById = new Map(company.managers.map((manager) => [manager.id, manager]));
  for (const [managerId, payload] of Object.entries(overview.managers ?? {})) {
    const manager = managerById.get(managerId);
    if (!manager) throw new Error(`Unknown manager ${company.id}:${managerId}`);
    for (const holding of payload.holdings ?? []) {
      const { code, name } = normalizeStock(company.id, managerId, holding);
      const stock = stocks.get(code) ?? emptyStock(code);
      stock.names.set(name, (stock.names.get(name) ?? 0) + 1);
      const ownerCompany = stock.companies.get(company.id) ?? { companyId: company.id, companyName: company.name, managers: [] };
      ownerCompany.managers.push({
        managerId,
        managerName: manager.name,
        rank: holding.rank,
        navWeight: holding.weight,
        marketValue: holding.marketValue,
        change: holding.change,
        fundCount: holding.fundCount,
      });
      stock.companies.set(company.id, ownerCompany);
      stocks.set(code, stock);
      managerHoldingCount += 1;
    }
  }

  let fundPayload;
  try {
    fundPayload = JSON.parse(await readFile(path.join(fundDir, `${company.id}.json`), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  if (fundPayload.period !== period) throw new Error(`Fund period mismatch ${company.id}`);
  for (const product of fundPayload.products ?? []) {
    for (const holding of product.holdings ?? []) {
      const { code, name } = normalizeStock(company.id, product.code, holding);
      const stock = stocks.get(code) ?? emptyStock(code);
      stock.names.set(name, (stock.names.get(name) ?? 0) + 1);
      const institution = stock.institutions.get(company.id) ?? {
        companyId: company.id,
        companyName: company.name,
        fundCodes: new Set(),
        shares: 0,
        marketValue: 0,
        netChangeShares: 0,
        changeSharesAvailable: 0,
        changeCounts: emptyChangeCounts(),
      };
      institution.fundCodes.add(String(product.code));
      institution.shares += Number.isFinite(Number(holding.shares)) ? Number(holding.shares) : 0;
      institution.marketValue += Number.isFinite(Number(holding.marketValue)) ? Number(holding.marketValue) : 0;
      if (holding.changeShares !== null && Number.isFinite(Number(holding.changeShares))) {
        institution.netChangeShares += Number(holding.changeShares);
        institution.changeSharesAvailable += 1;
      }
      addChangeCount(institution.changeCounts, holding.change);
      stock.institutions.set(company.id, institution);
      stocks.set(code, stock);
      productHoldingCount += 1;
    }
  }
}

const collator = new Intl.Collator("zh-CN");
const buckets = new Map();
const index = [];
let institutionHoldingCount = 0;
for (const stock of stocks.values()) {
  const stockName = [...stock.names.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))[0][0];
  const companies = [...stock.companies.values()]
    .map((company) => ({
      ...company,
      managers: company.managers.sort((a, b) => b.navWeight - a.navWeight || a.rank - b.rank || collator.compare(a.managerName, b.managerName)),
    }))
    .sort((a, b) => b.managers.length - a.managers.length || collator.compare(a.companyName, b.companyName));
  const managerCount = companies.reduce((sum, company) => sum + company.managers.length, 0);
  const allInstitutions = [...stock.institutions.values()]
    .map((institution) => ({
      companyId: institution.companyId,
      companyName: institution.companyName,
      fundCount: institution.fundCodes.size,
      shares: institution.shares,
      marketValue: institution.marketValue,
      netChangeShares: institution.changeSharesAvailable > 0 ? institution.netChangeShares : null,
      changeCounts: institution.changeCounts,
    }))
    .sort((a, b) => b.marketValue - a.marketValue || b.shares - a.shares || collator.compare(a.companyName, b.companyName));
  const institutionCount = allInstitutions.length;
  institutionHoldingCount += institutionCount;
  const institutions = allInstitutions.slice(0, 10).map((institution, rank) => ({ rank: rank + 1, ...institution }));
  const bucket = createHash("sha1").update(stock.stockCode).digest("hex").slice(0, 2);
  const detail = {
    stockCode: stock.stockCode,
    stockName,
    companyCount: companies.length,
    managerCount,
    institutionCount,
    institutions,
    companies,
  };
  const bucketStocks = buckets.get(bucket) ?? {};
  bucketStocks[stock.stockCode] = detail;
  buckets.set(bucket, bucketStocks);
  index.push({ stockCode: stock.stockCode, stockName, companyCount: companies.length, managerCount, institutionCount, bucket });
}
index.sort((a, b) => b.institutionCount - a.institutionCount || b.managerCount - a.managerCount || b.companyCount - a.companyCount || collator.compare(a.stockName, b.stockName) || a.stockCode.localeCompare(b.stockCode));

const generatedAt = new Date().toISOString();
const source = "东方财富基金定期报告前十大重仓（基金产品按基金公司汇总；基金经理维度沿用经理汇总）";
for (const [bucket, bucketStocks] of buckets) {
  await writeFile(path.join(bucketDir, `${bucket}.json`), JSON.stringify({ version: 2, period, generatedAt, source, stocks: bucketStocks }));
}
const payload = {
  version: 2,
  period,
  generatedAt,
  source,
  stockCount: index.length,
  companyCount: snapshot.companies.length,
  managerCount: snapshot.managerCount,
  managerHoldingCount,
  productHoldingCount,
  institutionHoldingCount,
  contentHash: createHash("sha256").update(JSON.stringify(index)).digest("hex"),
  stocks: index,
};
await writeFile(path.join(outputDir, "index.json"), JSON.stringify(payload));
console.log(JSON.stringify({ period, stocks: index.length, companies: snapshot.companies.length, managers: snapshot.managerCount, managerHoldingCount, productHoldingCount, institutionHoldingCount, buckets: buckets.size, outputDir }));
