import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadMarketSnapshot } from "./lib/market-snapshot.mjs";
import { isReportPeriod, nextUnpublishedPeriod, previousPublishedPeriod, sortPeriodsDesc } from "./lib/report-periods.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const root = process.cwd();
const publishedFile = path.join(root, "app/data/published-periods.json");
const published = JSON.parse(await readFile(publishedFile, "utf8"));
const requestedPeriod = args.get("period") ?? "";
const force = args.get("force") === "true";
const checkOnly = args.get("check-only") === "true";
const threshold = Math.max(0.5, Math.min(1, Number(args.get("probe-threshold") ?? 0.9)));
const now = process.env.REFRESH_NOW ? new Date(process.env.REFRESH_NOW) : new Date();
if (requestedPeriod && !isReportPeriod(requestedPeriod)) throw new Error("Invalid requested report period");
const period = requestedPeriod || nextUnpublishedPeriod(published.periods, now);
if (!period) {
  console.log(JSON.stringify({ status: "up-to-date", published: published.periods }));
  process.exit(0);
}
if (published.periods.includes(period) && !force) {
  console.log(JSON.stringify({ status: "already-published", period }));
  process.exit(0);
}
const baseline = previousPublishedPeriod(published.periods, period);
if (!baseline) throw new Error(`No published baseline exists before ${period}`);

const SOURCE = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx";
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; FundHoldingsQuarterMonitor/1.0)", referer: "https://fundf10.eastmoney.com/" };

async function probeCode(code) {
  const params = new URLSearchParams({ type: "jjcc", code, topline: "10", year: period.slice(0, 4), month: period.slice(5, 7), rt: String(Date.now()) });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${SOURCE}?${params}`, { headers: HEADERS, signal: controller.signal });
      if (!response.ok) throw new Error(`upstream ${response.status}`);
      const text = await response.text();
      return text.includes(period) && new RegExp(`截止至：?<font[^>]*>${period.replaceAll("-", "\\-")}<\\/font>`).test(text);
    } catch {
      if (attempt === 1) return false;
    } finally { clearTimeout(timeout); }
  }
  return false;
}

async function probeAvailability() {
  const market = await loadMarketSnapshot(root, baseline);
  const codes = [];
  for (const company of market.companies) {
    try {
      const payload = JSON.parse(await readFile(path.join(root, "public/data/funds", baseline, `${company.id}.json`), "utf8"));
      const product = payload.products.find((item) => item.netAsset > 0 && item.holdings?.length >= 5);
      if (product && !codes.includes(product.code)) codes.push(product.code);
    } catch { /* A missing baseline company is handled by validation. */ }
    if (codes.length >= 32) break;
  }
  let cursor = 0;
  let available = 0;
  await Promise.all(Array.from({ length: Math.min(8, codes.length) }, async () => {
    while (cursor < codes.length) {
      const code = codes[cursor++];
      if (await probeCode(code)) available += 1;
    }
  }));
  const ratio = codes.length ? available / codes.length : 0;
  return { attempted: codes.length, available, ratio, threshold, ready: codes.length >= 12 && ratio >= threshold };
}

const probe = await probeAvailability();
console.log(JSON.stringify({ status: probe.ready ? "source-ready" : "waiting-for-disclosures", period, baseline, probe }));
if (checkOnly || (!probe.ready && !force)) process.exit(0);

function run(script, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, script), ...scriptArgs], { cwd: root, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`)));
  });
}

await run("scripts/sync-market.mjs", [`--period=${period}`]);
await run("scripts/sync-fund-types.mjs");
await run("scripts/build-static-market.mjs", [`--period=${period}`, "--force=true", "--workers=3", "--fund-concurrency=2", "--attempts=5"]);
await run("scripts/validate-static-market-release.mjs", [`--period=${period}`, `--baseline=${baseline}`]);

published.periods = sortPeriodsDesc([...published.periods, period]);
published.updatedAt = new Date().toISOString();
await writeFile(publishedFile, `${JSON.stringify(published, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "published-locally", period, retainedPeriods: published.periods }));
