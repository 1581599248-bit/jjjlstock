import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const period = "2026-03-31";
const stockRoot = path.join(root, "public/data/stocks", period);
const index = JSON.parse(await readFile(path.join(stockRoot, "index.json"), "utf8"));

test("the stock reverse-lookup index covers manager and product holdings", async () => {
  assert.equal(index.version, 2);
  assert.equal(index.period, period);
  assert.ok(index.stockCount >= 2500);
  assert.ok(index.managerHoldingCount >= 31000);
  assert.ok(index.productHoldingCount >= 30000);
  assert.ok(index.institutionHoldingCount >= 10000);
  assert.equal(index.stocks.length, index.stockCount);
  assert.equal(index.contentHash, createHash("sha256").update(JSON.stringify(index.stocks)).digest("hex"));
  assert.equal(new Set(index.stocks.map((stock) => stock.stockCode)).size, index.stockCount);

  const expectedBuckets = [...new Set(index.stocks.map((stock) => `${stock.bucket}.json`))].sort();
  const actualBuckets = (await readdir(path.join(stockRoot, "buckets"))).filter((file) => /^[0-9a-f]{2}\.json$/.test(file)).sort();
  assert.deepEqual(actualBuckets, expectedBuckets);

  const bucketCache = new Map();
  let managerRecords = 0;
  let institutionRecords = 0;
  for (const stock of index.stocks) {
    if (!bucketCache.has(stock.bucket)) bucketCache.set(stock.bucket, JSON.parse(await readFile(path.join(stockRoot, "buckets", `${stock.bucket}.json`), "utf8")));
    const bucket = bucketCache.get(stock.bucket);
    assert.equal(bucket.version, 2);
    const detail = bucket.stocks[stock.stockCode];
    assert.equal(detail.stockName, stock.stockName);
    assert.equal(detail.companies.length, stock.companyCount);
    assert.equal(detail.institutionCount, stock.institutionCount);
    assert.ok(detail.institutions.length <= 10);
    assert.ok(detail.institutions.every((institution, index) => institution.rank === index + 1
      && institution.companyId
      && institution.companyName
      && institution.fundCount >= 1
      && institution.shares >= 0
      && institution.marketValue >= 0
      && (institution.netChangeShares === null || Number.isFinite(institution.netChangeShares))
      && Object.values(institution.changeCounts).every((count) => Number.isInteger(count) && count >= 0)));
    assert.ok(detail.institutions.every((institution, index, rows) => index === 0 || rows[index - 1].marketValue >= institution.marketValue));
    const managers = detail.companies.flatMap((company) => company.managers);
    assert.equal(managers.length, stock.managerCount);
    assert.equal(new Set(detail.companies.flatMap((company) => company.managers.map((manager) => `${company.companyId}:${manager.managerId}`))).size, managers.length);
    managerRecords += managers.length;
    institutionRecords += detail.institutionCount;
  }
  assert.equal(managerRecords, index.managerHoldingCount);
  assert.equal(institutionRecords, index.institutionHoldingCount);
});

test("a representative stock returns institution and manager metrics", async () => {
  const stock = index.stocks.find((item) => item.stockCode === "300750");
  assert.ok(stock);
  const bucket = JSON.parse(await readFile(path.join(stockRoot, "buckets", `${stock.bucket}.json`), "utf8"));
  const detail = bucket.stocks[stock.stockCode];
  assert.equal(detail.stockName, "宁德时代");
  assert.ok(detail.companyCount >= 100);
  assert.ok(detail.managerCount >= 500);
  assert.ok(detail.institutionCount >= 100);
  assert.equal(detail.institutions.length, 10);
  assert.ok(detail.institutions.every((institution) => institution.fundCount >= 1 && institution.marketValue > 0));
  assert.ok(detail.companies.every((company) => company.companyName && company.managers.every((manager) => manager.managerName && manager.rank >= 1 && manager.rank <= 10 && manager.navWeight >= 0 && manager.marketValue >= 0 && manager.fundCount >= 1)));
});
