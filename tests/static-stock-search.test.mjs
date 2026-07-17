import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const period = "2026-03-31";
const stockRoot = path.join(root, "public/data/stocks", period);
const index = JSON.parse(await readFile(path.join(stockRoot, "index.json"), "utf8"));

test("the stock reverse-lookup index covers every disclosed manager holding", async () => {
  assert.equal(index.period, period);
  assert.ok(index.stockCount >= 2500);
  assert.ok(index.managerHoldingCount >= 31000);
  assert.equal(index.stocks.length, index.stockCount);
  assert.equal(index.contentHash, createHash("sha256").update(JSON.stringify(index.stocks)).digest("hex"));
  assert.equal(new Set(index.stocks.map((stock) => stock.stockCode)).size, index.stockCount);

  const expectedBuckets = [...new Set(index.stocks.map((stock) => `${stock.bucket}.json`))].sort();
  const actualBuckets = (await readdir(path.join(stockRoot, "buckets"))).filter((file) => /^[0-9a-f]{2}\.json$/.test(file)).sort();
  assert.deepEqual(actualBuckets, expectedBuckets);

  const bucketCache = new Map();
  let records = 0;
  for (const stock of index.stocks) {
    if (!bucketCache.has(stock.bucket)) bucketCache.set(stock.bucket, JSON.parse(await readFile(path.join(stockRoot, "buckets", `${stock.bucket}.json`), "utf8")));
    const detail = bucketCache.get(stock.bucket).stocks[stock.stockCode];
    assert.equal(detail.stockName, stock.stockName);
    assert.equal(detail.companies.length, stock.companyCount);
    const managers = detail.companies.flatMap((company) => company.managers);
    assert.equal(managers.length, stock.managerCount);
    assert.equal(new Set(detail.companies.flatMap((company) => company.managers.map((manager) => `${company.companyId}:${manager.managerId}`))).size, managers.length);
    records += managers.length;
  }
  assert.equal(records, index.managerHoldingCount);
});

test("a representative stock returns institutions and manager-level metrics", async () => {
  const stock = index.stocks.find((item) => item.stockCode === "300750");
  assert.ok(stock);
  const bucket = JSON.parse(await readFile(path.join(stockRoot, "buckets", `${stock.bucket}.json`), "utf8"));
  const detail = bucket.stocks[stock.stockCode];
  assert.equal(detail.stockName, "宁德时代");
  assert.ok(detail.companyCount >= 100);
  assert.ok(detail.managerCount >= 500);
  assert.ok(detail.companies.every((company) => company.companyName && company.managers.every((manager) => manager.managerName && manager.rank >= 1 && manager.rank <= 10 && manager.navWeight >= 0 && manager.marketValue >= 0 && manager.fundCount >= 1)));
});
