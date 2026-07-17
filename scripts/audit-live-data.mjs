import assert from "node:assert/strict";

const { default: worker } = await import(new URL(`../dist/server/index.js?audit=${Date.now()}`, import.meta.url));
const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function call(path, init) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, init), env, ctx);
  const body = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(body)}`);
  return body;
}

const periods = await call("/api/periods");
assert.equal(periods.periods.length, 3);
assert.deepEqual(periods.periods, [...periods.periods].sort().reverse());
assert.ok(periods.periods.every((period) => /^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)));

const market = await call("/api/market-live");
assert.equal(market.mode, "live");
assert.ok(market.companyCount > 150);
assert.ok(market.managerCount > 4_000);
assert.equal(new Set(market.companies.map((company) => company.id)).size, market.companies.length);
assert.equal(market.companies.reduce((sum, company) => sum + company.managers.length, 0), market.managerCount);

const companyChecks = [];
for (const name of ["华夏基金", "浙商基金", "长信基金"]) {
  const company = market.companies.find((item) => item.name === name);
  assert.ok(company, `missing company ${name}`);
  const payload = await call(`/api/company?id=${encodeURIComponent(company.id)}`);
  assert.ok(payload.funds.length > 0, `${name} has no funds`);
  assert.equal(new Set(payload.funds.map((fund) => fund.code)).size, payload.funds.length, `${name} duplicate fund codes`);
  companyChecks.push({ name, managers: company.managers.length, funds: payload.funds.length });
}

const fund = await call(`/api/holdings?code=000001&period=${periods.periods[0]}`);
assert.equal(fund.holdings.length, 10);
assert.equal(new Set(fund.holdings.map((item) => item.stockCode)).size, fund.holdings.length);
assert.ok(fund.holdings.every((item) => item.weight > 0 && item.weight <= 100 && item.marketValue >= 0 && item.shares >= 0));
assert.ok(fund.holdings.every((item) => ["新进", "增持", "减持", "不变"].includes(item.change)));

const manager = await call("/api/manager-holdings", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ codes: ["001924", "010692"], period: "2026-03-31" }),
});
assert.ok(manager.managedNav > 0);
assert.ok(manager.holdings.length > 0 && manager.holdings.length <= 10);
assert.ok(manager.holdings.every((item) => Math.abs(item.weight - item.marketValue / manager.managedNav * 100) < 1e-9));
assert.ok(manager.holdings.every((item) => item.industry && item.industry !== "其他/未分类"));
assert.ok(Math.abs(manager.sectors.reduce((sum, item) => sum + item.holdingShare, 0) - 100) < 0.01);
assert.ok(manager.sectors.every((item) => item.navWeight >= 0 && item.holdingShare >= 0));
const firstOtherSector = manager.sectors.findIndex((item) => /^(其他|未分类|未知|其他\/未分类)$/.test(item.industry));
if (firstOtherSector >= 0) assert.ok(manager.sectors.slice(firstOtherSector).every((item) => /^(其他|未分类|未知|其他\/未分类)$/.test(item.industry)), "其他/未分类行业必须固定置底");

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  periods: periods.periods,
  market: { companies: market.companyCount, managers: market.managerCount, managedFundCodes: market.managedFundCount },
  companies: companyChecks,
  fundSample: { code: fund.code, first: fund.holdings[0] },
  managerSample: { succeeded: manager.succeeded, failed: manager.failed, managedNav: manager.managedNav, first: manager.holdings[0], sectors: manager.sectors.length },
}));
