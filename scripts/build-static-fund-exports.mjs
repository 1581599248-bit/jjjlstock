import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { companyProducts } from "./lib/company-products.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const snapshot = JSON.parse(await readFile(path.join(root, "app/data/market-index.json"), "utf8"));
const outputDir = path.join(root, "public/data/funds", period);
await mkdir(outputDir, { recursive: true });

let productCount = 0;
for (const company of snapshot.companies) {
  const products = [];
  for (const product of companyProducts(company)) {
    const checkpoint = path.join(root, "work/static-overview", period, company.id, `${product.code}.json`);
    if (!existsSync(checkpoint)) throw new Error(`Missing checkpoint ${company.id}/${product.code}`);
    const holdingPayload = JSON.parse(await readFile(checkpoint, "utf8"));
    products.push({ ...product, holdings: holdingPayload.holdings ?? [] });
  }
  const generatedAt = new Date().toISOString();
  const payload = {
    version: 1,
    companyId: company.id,
    companyName: company.name,
    period,
    generatedAt,
    source: "东方财富基金公开数据（后台预计算基金产品持仓）",
    productCount: products.length,
    products,
  };
  payload.contentHash = createHash("sha256").update(JSON.stringify(products)).digest("hex");
  await writeFile(path.join(outputDir, `${company.id}.json`), JSON.stringify(payload));
  productCount += products.length;
}

console.log(JSON.stringify({ period, companies: snapshot.companies.length, products: productCount, outputDir }));
