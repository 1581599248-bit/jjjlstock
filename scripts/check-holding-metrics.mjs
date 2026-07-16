import assert from "node:assert/strict";

const { default: worker } = await import(new URL(`../dist/server/index.js?metrics=${Date.now()}`, import.meta.url));
const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
async function call(path, init) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, init), env, ctx);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

const fund = await call("/api/holdings?code=000001&period=2026-03-31");
assert.equal(fund.holdings.length, 10);
assert.ok(fund.holdings.every((item) => item.weight > 0));
assert.ok(fund.holdings.every((item) => ["新进", "增持", "减持", "不变", "未知"].includes(item.change)));

const manager = await call("/api/manager-holdings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codes: ["001924", "010692"], period: "2026-03-31" }) });
assert.ok(manager.managedNav > 0);
assert.ok(manager.holdings.length > 0);
assert.ok(manager.holdings.every((item) => Number.isFinite(item.weight) && item.weight >= 0));
assert.ok(manager.holdings.every((item) => ["新进", "增持", "减持", "不变"].includes(item.change)));
console.log(JSON.stringify({ fund: fund.holdings[0], manager: { managedNav: manager.managedNav, first: manager.holdings[0] } }));
