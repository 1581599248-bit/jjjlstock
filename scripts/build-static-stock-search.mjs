import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const overviewDir = path.join(root, "public/data/overview", period);
const outputDir = path.join(root, "public/data/stocks", period);
const bucketDir = path.join(outputDir, "buckets");
const snapshot = JSON.parse(await readFile(path.join(root, "app/data/market-index.json"), "utf8"));
await mkdir(bucketDir, { recursive: true });
for (const file of await readdir(bucketDir)) if (/^[0-9a-f]{2}\.json$/.test(file)) await unlink(path.join(bucketDir, file));

const stocks = new Map();
let managerHoldingCount = 0;
for (const company of snapshot.companies) {
  const overview = JSON.parse(await readFile(path.join(overviewDir, `${company.id}.json`), "utf8"));
  const managerById = new Map(company.managers.map((manager) => [manager.id, manager]));
  for (const [managerId, payload] of Object.entries(overview.managers ?? {})) {
    const manager = managerById.get(managerId);
    if (!manager) throw new Error(`Unknown manager ${company.id}:${managerId}`);
    for (const holding of payload.holdings ?? []) {
      const code = String(holding.stockCode ?? "").trim().toUpperCase();
      const name = String(holding.stockName ?? "").trim();
      if (!/^[A-Z0-9._-]{1,16}$/.test(code) || !name) throw new Error(`Invalid stock ${company.id}:${managerId}:${code}`);
      const stock = stocks.get(code) ?? { stockCode: code, names: new Map(), companies: new Map() };
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
}

const collator = new Intl.Collator("zh-CN");
const buckets = new Map();
const index = [];
for (const stock of stocks.values()) {
  const stockName = [...stock.names.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))[0][0];
  const companies = [...stock.companies.values()]
    .map((company) => ({
      ...company,
      managers: company.managers.sort((a, b) => b.navWeight - a.navWeight || a.rank - b.rank || collator.compare(a.managerName, b.managerName)),
    }))
    .sort((a, b) => b.managers.length - a.managers.length || collator.compare(a.companyName, b.companyName));
  const managerCount = companies.reduce((sum, company) => sum + company.managers.length, 0);
  const bucket = createHash("sha1").update(stock.stockCode).digest("hex").slice(0, 2);
  const detail = {
    stockCode: stock.stockCode,
    stockName,
    companyCount: companies.length,
    managerCount,
    companies,
  };
  const bucketStocks = buckets.get(bucket) ?? {};
  bucketStocks[stock.stockCode] = detail;
  buckets.set(bucket, bucketStocks);
  index.push({ stockCode: stock.stockCode, stockName, companyCount: companies.length, managerCount, bucket });
}
index.sort((a, b) => b.managerCount - a.managerCount || b.companyCount - a.companyCount || collator.compare(a.stockName, b.stockName) || a.stockCode.localeCompare(b.stockCode));

const generatedAt = new Date().toISOString();
const source = "东方财富基金定期报告前十大重仓股（按基金经理汇总）";
for (const [bucket, bucketStocks] of buckets) {
  await writeFile(path.join(bucketDir, `${bucket}.json`), JSON.stringify({ version: 1, period, generatedAt, source, stocks: bucketStocks }));
}
const payload = {
  version: 1,
  period,
  generatedAt,
  source,
  stockCount: index.length,
  companyCount: snapshot.companies.length,
  managerCount: snapshot.managerCount,
  managerHoldingCount,
  contentHash: createHash("sha256").update(JSON.stringify(index)).digest("hex"),
  stocks: index,
};
await writeFile(path.join(outputDir, "index.json"), JSON.stringify(payload));
console.log(JSON.stringify({ period, stocks: index.length, companies: snapshot.companies.length, managers: snapshot.managerCount, managerHoldingCount, buckets: buckets.size, outputDir }));
