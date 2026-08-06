import { mkdir, writeFile } from "node:fs/promises";

const pageUrl = "https://fund.eastmoney.com/data/hypzlist.html";
const headers = {
  "user-agent": "Mozilla/5.0 (compatible; FundHoldingsRadar/1.0)",
  referer: "https://fund.eastmoney.com/",
};

const page = await fetch(pageUrl, { headers }).then(async (response) => {
  if (!response.ok) throw new Error(`page ${response.status}`);
  return response.text();
});
const srcs = [...page.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => new URL(match[1], pageUrl).href);
const hits = [];
for (const url of srcs) {
  try {
    const text = await fetch(url, { headers }).then((response) => response.ok ? response.text() : "");
    if (!text) continue;
    const patterns = [/hypz/ig, /FundDataPortfolio_Interface/ig, /ajax/ig, /Data\//ig, /行业配置/g];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const start = Math.max(0, (match.index ?? 0) - 260);
        const end = Math.min(text.length, (match.index ?? 0) + 620);
        hits.push({ url, keyword: match[0], snippet: text.slice(start, end) });
        if (hits.length >= 120) break;
      }
      if (hits.length >= 120) break;
    }
  } catch (error) {
    hits.push({ url, error: error instanceof Error ? error.message : String(error) });
  }
  if (hits.length >= 120) break;
}
await mkdir("public", { recursive: true });
await writeFile("public/industry-api-discovery.json", JSON.stringify({ pageUrl, scripts: srcs, hits }, null, 2));
console.log(`industry discovery: ${srcs.length} scripts, ${hits.length} hits`);
