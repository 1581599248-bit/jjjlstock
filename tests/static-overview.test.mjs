import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const fundTypeSnapshot = JSON.parse(await readFile(new URL("app/data/fund-types.json", root), "utf8"));
const period = "2026-03-31";
const snapshot = JSON.parse(await readFile(new URL(`public/data/market/${period}.json`, root), "utf8"));
const overviewDirectory = new URL(`public/data/overview/${period}/`, root);
const fundDirectory = new URL(`public/data/funds/${period}/`, root);
const sectorDirectory = new URL(`public/data/sectors/${period}/`, root);
const manifest = JSON.parse(await readFile(new URL("public/data/overview/manifest.json", root), "utf8"));
const allowedChanges = new Set(["\u65b0\u8fdb", "\u4e0d\u53d8", "\u589e\u6301", "\u51cf\u6301"]);

test("the Q1 static market covers every company and manifest entry", async () => {
  const files = (await readdir(overviewDirectory)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
  assert.deepEqual(files, snapshot.companies.map((company) => `${company.id}.json`).sort());
  assert.deepEqual(
    Object.keys(manifest.entries).filter((key) => key.endsWith(`:${period}`)).sort(),
    snapshot.companies.map((company) => `${company.id}:${period}`).sort(),
  );
});

test("fund type metadata uses source classifications instead of a generic public-fund label", () => {
  const marketCodes = new Set(snapshot.companies.flatMap((company) => company.managers.flatMap((manager) => manager.fundCodes)));
  const matchedCodes = [...marketCodes].filter((code) => fundTypeSnapshot.types[code]);
  assert.ok(fundTypeSnapshot.count >= 20_000);
  assert.equal(fundTypeSnapshot.count, Object.keys(fundTypeSnapshot.types).length);
  assert.ok(matchedCodes.length / marketCodes.size >= 0.999);
  assert.equal(fundTypeSnapshot.types["001924"], "混合型-灵活");
  assert.equal(fundTypeSnapshot.types["000015"], "债券型-长债");
  assert.equal(fundTypeSnapshot.types["000343"], "货币型-普通货币");
  assert.equal(fundTypeSnapshot.types["005534"], "QDII-混合灵活");
  assert.equal(fundTypeSnapshot.types["508016"], "REITs");
  assert.ok(!Object.values(fundTypeSnapshot.types).includes("公募基金"));
});

test("every Q1 payload has the exact manager roster and valid holdings", async () => {
  let managerCount = 0;
  for (const company of snapshot.companies) {
    const overviewPath = new URL(`${company.id}.json`, overviewDirectory);
    const overview = JSON.parse(await readFile(overviewPath, "utf8"));
    const managerIds = company.managers.map((manager) => manager.id).sort();
    managerCount += overview.managerCount;
    assert.equal(overview.companyId, company.id);
    assert.equal(overview.companyName, company.name);
    assert.equal(overview.period, period);
    assert.equal(overview.quality.failedDownloads, 0);
    assert.equal(overview.quality.completedManagers, managerIds.length);
    assert.equal(overview.quality.fetchedProducts, overview.representativeProductCount);
    assert.equal(overview.quality.matchedScaleShareCodes / overview.quality.expectedShareCodes, overview.quality.scaleCoverage);
    if (overview.quality.expectedShareCodes >= 10) assert.ok(overview.quality.scaleCoverage >= 0.25);
    assert.deepEqual(Object.keys(overview.managers).sort(), managerIds);
    const contentHash = createHash("sha256").update(JSON.stringify(overview.managers)).digest("hex");
    assert.equal(overview.contentHash, contentHash);
    assert.equal(manifest.entries[`${company.id}:${period}`].contentHash, contentHash);
    for (const manager of Object.values(overview.managers)) {
      assert.equal(manager.period, period);
      assert.ok(Number.isFinite(manager.managedNav) && manager.managedNav >= 0);
      assert.equal(manager.requested, manager.succeeded + manager.failed);
      assert.ok(manager.holdings.length <= 10);
      assert.ok(manager.holdings.reduce((sum, item) => sum + item.weight, 0) <= 100.01);
      manager.holdings.forEach((holding, index) => {
        assert.equal(holding.rank, index + 1);
        assert.match(holding.stockCode, /^[A-Z0-9._-]{1,16}$/i);
        assert.ok(holding.stockName);
        assert.ok(Number.isFinite(holding.marketValue) && holding.marketValue >= 0);
        assert.ok(Number.isFinite(holding.weight) && holding.weight >= 0);
        assert.ok(allowedChanges.has(holding.change));
      });
    }
    assert.ok((await stat(overviewPath)).size < 1_000_000, `${company.id} mobile payload should stay below 1 MB`);
  }
  assert.equal(managerCount, snapshot.managerCount);
});

test("every company has a complete Q1 fund-product export payload", async () => {
  const files = (await readdir(fundDirectory)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
  assert.deepEqual(files, snapshot.companies.map((company) => `${company.id}.json`).sort());
  let productCount = 0;
  let netAssetProducts = 0;
  let shareOnlyProducts = 0;
  for (const company of snapshot.companies) {
    const fundPayload = JSON.parse(await readFile(new URL(`${company.id}.json`, fundDirectory), "utf8"));
    const overview = JSON.parse(await readFile(new URL(`${company.id}.json`, overviewDirectory), "utf8"));
    assert.equal(fundPayload.companyId, company.id);
    assert.equal(fundPayload.companyName, company.name);
    assert.equal(fundPayload.period, period);
    assert.equal(fundPayload.version, 2);
    assert.equal(fundPayload.productCount, fundPayload.quality.periodProducts);
    assert.equal(fundPayload.products.length, fundPayload.productCount);
    assert.equal(fundPayload.quality.missingScaleProducts, 0);
    assert.equal(fundPayload.quality.netAssetProducts + fundPayload.quality.shareOnlyProducts, fundPayload.productCount);
    assert.equal(fundPayload.contentHash, createHash("sha256").update(JSON.stringify(fundPayload.products)).digest("hex"));
    const codes = new Set();
    for (const product of fundPayload.products) {
      assert.match(product.code, /^\d{6}$/);
      assert.ok(product.name);
      assert.ok(product.shareCodes.includes(product.code));
      assert.ok(Array.isArray(product.managers));
      assert.ok(product.type && product.type !== "公募基金");
      assert.equal(product.scalePeriod, period);
      assert.ok(product.netAsset !== null || product.endShares !== null);
      assert.ok(product.netAsset === null || Number.isFinite(product.netAsset) && product.netAsset >= 0);
      assert.ok(product.endShares === null || Number.isFinite(product.endShares) && product.endShares >= 0);
      assert.ok(!codes.has(product.code));
      codes.add(product.code);
      assert.ok(product.holdings.length <= 10);
      product.holdings.forEach((holding, index) => {
        assert.equal(holding.rank, index + 1);
        assert.match(holding.stockCode, /^[A-Z0-9._-]{1,16}$/i);
        assert.ok(holding.stockName);
        assert.ok(Number.isFinite(holding.weight) && holding.weight >= 0);
        assert.ok(allowedChanges.has(holding.change));
      });
    }
    productCount += fundPayload.productCount;
    netAssetProducts += fundPayload.quality.netAssetProducts;
    shareOnlyProducts += fundPayload.quality.shareOnlyProducts;
  }
  assert.ok(productCount > 10_000);
  assert.ok(netAssetProducts / productCount >= 0.99);
  assert.ok(shareOnlyProducts > 0);
});

test("every company has source-backed manager-sector export data", async () => {
  const files = (await readdir(sectorDirectory)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
  assert.deepEqual(files, snapshot.companies.map((company) => `${company.id}.json`).sort());
  let totalStocks = 0;
  let classifiedStocks = 0;
  for (const company of snapshot.companies) {
    const payload = JSON.parse(await readFile(new URL(`${company.id}.json`, sectorDirectory), "utf8"));
    const managerIds = company.managers.map((manager) => manager.id).sort();
    assert.equal(payload.companyId, company.id);
    assert.equal(payload.companyName, company.name);
    assert.equal(payload.period, period);
    assert.equal(payload.managerCount, managerIds.length);
    assert.deepEqual(Object.keys(payload.managers).sort(), managerIds);
    assert.equal(payload.contentHash, createHash("sha256").update(JSON.stringify(payload.managers)).digest("hex"));
    for (const manager of Object.values(payload.managers)) {
      let seenOther = false;
      manager.sectors.forEach((sector, index) => {
        const isOther = /^(其他|未分类|未知|其他\/未分类)$/.test(sector.industry.trim());
        assert.equal(sector.rank, index + 1);
        assert.ok(sector.industry);
        assert.ok(Number.isFinite(sector.marketValue) && sector.marketValue >= 0);
        assert.ok(Number.isFinite(sector.navWeight) && sector.navWeight >= 0);
        assert.ok(Number.isFinite(sector.holdingShare) && sector.holdingShare >= 0);
        assert.ok(Number.isInteger(sector.stockCount) && sector.stockCount > 0);
        if (seenOther) assert.ok(isOther, "其他/未分类之后不能出现正式行业");
        if (isOther) seenOther = true;
        totalStocks += sector.stockCount;
        if (!isOther) classifiedStocks += sector.stockCount;
      });
      assert.ok(manager.sectors.reduce((sum, sector) => sum + sector.navWeight, 0) <= 100.01);
    }
  }
  assert.ok(classifiedStocks / totalStocks >= 0.99);
});
