import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { companyProductsForPeriod, productKey } from "./lib/company-products.mjs";
import { fetchCompanyScaleRows, productScaleFields } from "./lib/company-scales.mjs";
import { loadMarketSnapshot } from "./lib/market-snapshot.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
const concurrency = Math.max(1, Math.min(12, Number(args.get("concurrency") ?? 6)));
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const market = await loadMarketSnapshot(root, period);
const fundTypes = JSON.parse(await readFile(path.join(root, "app/data/fund-types.json"), "utf8")).types;
const companyFilter = new Set((args.get("company") ?? "").split(",").filter(Boolean));
const selectedCompanies = companyFilter.size ? market.companies.filter((company) => companyFilter.has(company.id)) : market.companies;
const queue = selectedCompanies.map((company) => ({ company, attempt: 1 }));
const failures = [];
const summary = { companies: 0, productsBefore: 0, productsAfter: 0, netAssetProducts: 0, shareOnlyProducts: 0, missingScaleProducts: 0, addedPeriodProducts: 0, excludedNonPeriodProducts: 0 };
let cursor = 0;

async function enrich(company) {
  const file = path.join(root, "public/data/funds", period, `${company.id}.json`);
  const payload = JSON.parse(await readFile(file, "utf8"));
  const expectedCodes = company.managers.flatMap((manager) => manager.fundCodes);
  const scaleRows = await fetchCompanyScaleRows(company.id, period, { expectedCodes });
  const scaleByCode = new Map(scaleRows.map((row) => [row.code, row]));
  const existingByKey = new Map(payload.products.map((product) => [productKey(product.name), product]));
  const products = companyProductsForPeriod(company, scaleRows).map((product) => {
    const existing = existingByKey.get(productKey(product.name));
    const scale = productScaleFields(product, scaleByCode);
    const managers = [...new Set([...(product.managers ?? []), ...(existing?.managers ?? [])])];
    return {
      ...product,
      managers,
      type: product.shareCodes.map((code) => fundTypes[code]).find(Boolean) ?? "类型待披露",
      ...scale,
      holdings: existing?.holdings ?? [],
    };
  });
  const matchedExistingKeys = new Set(products.map((product) => productKey(product.name)).filter((key) => existingByKey.has(key)));
  const quality = {
    periodShareCodes: scaleRows.length,
    netAssetShareCodes: scaleRows.filter((row) => row.netAsset !== null).length,
    periodProducts: products.length,
    netAssetProducts: products.filter((product) => product.netAsset !== null).length,
    shareOnlyProducts: products.filter((product) => product.netAsset === null && product.endShares !== null).length,
    missingScaleProducts: products.filter((product) => product.netAsset === null && product.endShares === null).length,
    addedPeriodProducts: products.filter((product) => !existingByKey.has(productKey(product.name))).length,
    excludedNonPeriodProducts: payload.products.length - matchedExistingKeys.size,
  };
  const generatedAt = new Date().toISOString();
  const next = {
    ...payload,
    version: 2,
    generatedAt,
    source: "东方财富基金公开数据（报告期产品范围、净资产/份额规模与预计算持仓）",
    productCount: products.length,
    products,
    quality,
  };
  next.contentHash = createHash("sha256").update(JSON.stringify(products)).digest("hex");
  await writeFile(file, JSON.stringify(next));
  summary.companies += 1;
  summary.productsBefore += payload.products.length;
  summary.productsAfter += products.length;
  for (const key of Object.keys(summary)) if (key in quality) summary[key] += quality[key];
  process.stdout.write(`${summary.companies}/${selectedCompanies.length} ${company.name} ${payload.products.length}->${products.length}\n`);
}

async function worker() {
  while (cursor < queue.length) {
    const item = queue[cursor++];
    try {
      await enrich(item.company);
    } catch (error) {
      if (item.attempt < 4) queue.push({ company: item.company, attempt: item.attempt + 1 });
      else failures.push({ companyId: item.company.id, companyName: item.company.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
if (failures.length) throw new Error(`Scale enrichment incomplete: ${JSON.stringify(failures)}`);
console.log(JSON.stringify({ period, ...summary }, null, 2));
