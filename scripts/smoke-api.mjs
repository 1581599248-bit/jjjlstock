const { default: worker } = await import(new URL(`../dist/server/index.js?smoke=${Date.now()}`, import.meta.url));
const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
async function call(path, init) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, init), env, ctx);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
const market = await call("/api/market");
const periods = await call("/api/periods");
const company = await call("/api/company?id=80000222");
const holdings = await call(`/api/holdings?code=000001&period=${periods.periods[0]}`);
const manager = await call("/api/manager-holdings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codes: ["000001"], period: periods.periods[0] }) });
console.log(JSON.stringify({ market: { companies: market.companyCount, managers: market.managerCount, funds: market.managedFundCount }, periods: periods.periods, company: { name: company.company.name, funds: company.funds.length, managers: company.company.managers.length, mode: company.mode }, holdings: holdings.holdings.length, managerHoldings: manager.holdings.length }));

