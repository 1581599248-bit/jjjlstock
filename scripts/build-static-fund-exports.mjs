import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { companyProductsForPeriod } from "./lib/company-products.mjs";
import { fetchCompanyScaleRows, productScaleFields } from "./lib/company-scales.mjs";
import { loadMarketSnapshot } from "./lib/market-snapshot.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const snapshot = await loadMarketSnapshot(root, period);
const fundTypes = JSON.parse(await readFile(path.join(root, "app/data/fund-types.json"), "utf8")).types;
const outputDir = path.join(root, "public/data/funds", period);
await mkdir(outputDir, { recursive: true });

let productCount = 0;
for (const company of snapshot.companies) {
  const expectedCodes = company.managers.flatMap((manager) => manager.fundCodes);
  const scaleRows = await fetchCompanyScaleRows(company.id, period, { expectedCodes });
  const scaleByCode = new Map(scaleRows.map((row) => [row.code, row]));
  const products = [];
  for (const product of companyProductsForPeriod(company, scaleRows)) {
    const checkpoint = path.join(root, "work/static-overview", period, company.id, `${product.code}.json`);
    if (!existsSync(checkpoint)) throw new Error(`Missing checkpoint ${company.id}/${product.code}`);
    const holdingPayload = JSON.parse(await readFile(checkpoint, "utf8"));
    products.push({
      ...product,
      type: product.shareCodes.map((code) => fundTypes[code]).find(Boolean) ?? "类型待披露",
      ...productScaleFields(product, scaleByCode),
      holdings: holdingPayload.holdings ?? [],
    });
  }
  const generatedAt = new Date().toISOString();
  const payload = {
    version: 2,
    companyId: company.id,
    companyName: company.name,
    period,
    generatedAt,
    source: "东方财富基金公开数据（报告期产品范围、净资产/份额规模与预计算持仓）",
    productCount: products.length,
    products,
    quality: {
      periodShareCodes: scaleRows.length,
      netAssetShareCodes: scaleRows.filter((row) => row.netAsset !== null).length,
      periodProducts: products.length,
      netAssetProducts: products.filter((product) => product.netAsset !== null).length,
      shareOnlyProducts: products.filter((product) => product.netAsset === null && product.endShares !== null).length,
      missingScaleProducts: products.filter((product) => product.netAsset === null && product.endShares === null).length,
    },
  };
  payload.contentHash = createHash("sha256").update(JSON.stringify(products)).digest("hex");
  await writeFile(path.join(outputDir, `${company.id}.json`), JSON.stringify(payload));
  productCount += products.length;
}

console.log(JSON.stringify({ period, companies: snapshot.companies.length, products: productCount, outputDir }));
