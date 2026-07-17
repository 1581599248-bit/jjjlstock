import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceUrl = "https://fund.eastmoney.com/js/fundcode_search.js";
const response = await fetch(sourceUrl, { headers: { "user-agent": "Mozilla/5.0 (compatible; FundHoldingsRadar/1.0)", referer: "https://fund.eastmoney.com/" } });
if (!response.ok) throw new Error(`Eastmoney fund metadata ${response.status}`);
const text = await response.text();
const start = text.indexOf("[");
const end = text.lastIndexOf("]");
if (start < 0 || end <= start) throw new Error("Eastmoney fund metadata array missing");
const rows = JSON.parse(text.slice(start, end + 1));
if (!Array.isArray(rows) || rows.length < 20_000) throw new Error(`Unexpected fund metadata rows: ${rows.length}`);

const types = {};
for (const row of rows) {
  const code = String(row?.[0] ?? "");
  const rawType = String(row?.[3] ?? "").trim();
  if (!/^\d{6}$/.test(code)) continue;
  types[code] = rawType && !/^\?+$/.test(rawType) ? rawType.replace(/^Reits$/i, "REITs") : "类型待披露";
}

const output = {
  generatedAt: new Date().toISOString(),
  source: "东方财富基金基础资料",
  sourceUrl,
  count: Object.keys(types).length,
  types,
};
const outputPath = path.resolve("app/data/fund-types.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, count: output.count, generatedAt: output.generatedAt }));
