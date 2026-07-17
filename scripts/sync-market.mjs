import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { saveMarketSnapshot } from "./lib/market-snapshot.mjs";

const period = process.argv.find((item) => item.startsWith("--period="))?.slice(9) ?? "";
if (period && !/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const base = "https://fund.eastmoney.com/Data/FundDataPortfolio_Interface.aspx";
const headers = { "user-agent": "Mozilla/5.0 (compatible; FundHoldingsRadar/1.0)", referer: "https://fund.eastmoney.com/manager/default.html" };
const readPage = async (page) => {
  const endpoint = `${base}?dt=14&mc=returnjson&ft=all&pn=50&pi=${page}&sc=abbname&st=asc`;
  const response = await fetch(endpoint, { headers });
  if (!response.ok) throw new Error(`Eastmoney manager endpoint ${response.status}`);
  const source = await response.text();
  const sandbox = {};
  vm.runInNewContext(`${source};globalThis.payload=returnjson`, sandbox, { timeout: 1000 });
  return sandbox.payload;
};
const first = await readPage(1);
const pages = Number(first.pages ?? 1);
const payloads = [first];
for (let page = 2; page <= pages; page += 8) payloads.push(...await Promise.all(Array.from({ length: Math.min(8, pages - page + 1) }, (_, offset) => readPage(page + offset))));
const rows = payloads.flatMap((payload) => payload.data);
const managers = rows.map((row) => ({
  id: row[0] ?? "", name: row[1] ?? "", companyId: row[2] ?? "", companyName: row[3] ?? "",
  fundCodes: (row[4] ?? "").split(",").filter(Boolean), fundNames: (row[5] ?? "").split(",").filter(Boolean),
  tenureDays: Number.parseInt(row[6] ?? "0", 10) || 0,
  bestReturn: Number.isFinite(Number.parseFloat(row[7])) ? Number.parseFloat(row[7]) : null,
  bestFundCode: row[8] ?? "", bestFundName: row[9] ?? "",
})).filter((item) => item.id && item.companyId);
const uniqueManagers = new Map();
for (const manager of managers) {
  const key = `${manager.companyId}:${manager.id}`;
  const existing = uniqueManagers.get(key);
  if (!existing) {
    uniqueManagers.set(key, manager);
    continue;
  }
  const funds = new Map(existing.fundCodes.map((code, index) => [code, existing.fundNames[index] ?? ""]));
  manager.fundCodes.forEach((code, index) => funds.set(code, manager.fundNames[index] ?? funds.get(code) ?? ""));
  const preferManager = (manager.bestReturn ?? -Infinity) > (existing.bestReturn ?? -Infinity);
  uniqueManagers.set(key, {
    ...existing,
    fundCodes: [...funds.keys()],
    fundNames: [...funds.values()],
    tenureDays: Math.max(existing.tenureDays, manager.tenureDays),
    bestReturn: preferManager ? manager.bestReturn : existing.bestReturn,
    bestFundCode: preferManager ? manager.bestFundCode : existing.bestFundCode,
    bestFundName: preferManager ? manager.bestFundName : existing.bestFundName,
  });
}
const normalizedManagers = [...uniqueManagers.values()];
const grouped = new Map();
for (const manager of normalizedManagers) { const entry = grouped.get(manager.companyId) ?? { name: manager.companyName, managers: [] }; entry.managers.push(manager); grouped.set(manager.companyId, entry); }
const companies = [...grouped.entries()].map(([id, entry]) => ({ id, name: entry.name, managerCount: entry.managers.length, managedFundCount: new Set(entry.managers.flatMap((manager) => manager.fundCodes)).size, managers: entry.managers.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")) })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
const output = { generatedAt: new Date().toISOString(), source: "东方财富基金公开数据", sourceUrl: base, companyCount: companies.length, managerCount: normalizedManagers.length, managedFundCount: new Set(normalizedManagers.flatMap((manager) => manager.fundCodes)).size, companies };
await fs.writeFile(path.resolve("app/data/market-index.json"), `${JSON.stringify(output)}\n`, "utf8");
if (period) await saveMarketSnapshot(process.cwd(), period, output);
console.log(JSON.stringify({ period: period || null, companies: output.companyCount, managers: output.managerCount, funds: output.managedFundCount, generatedAt: output.generatedAt }));
