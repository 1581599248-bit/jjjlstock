import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { companyProducts } from "./lib/company-products.mjs";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const period = args.get("period") ?? "2026-03-31";
const companyWorkers = Math.max(1, Math.min(6, Number(args.get("workers") ?? 3)));
const fundConcurrency = Math.max(1, Math.min(6, Number(args.get("fund-concurrency") ?? 2)));
const maxAttempts = Math.max(1, Math.min(8, Number(args.get("attempts") ?? 4)));
const force = args.get("force") === "true";
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid period");

const root = process.cwd();
const snapshot = JSON.parse(await readFile(path.join(root, "app/data/market-index.json"), "utf8"));
const outputDir = path.join(root, "public/data/overview", period);
const progressFile = path.join(root, "work/static-overview", period, "market-progress.json");
await mkdir(outputDir, { recursive: true });
await mkdir(path.dirname(progressFile), { recursive: true });

async function isComplete(company) {
  const outputFile = path.join(outputDir, `${company.id}.json`);
  const fundOutputFile = path.join(root, "public/data/funds", period, `${company.id}.json`);
  if (!existsSync(outputFile) || !existsSync(fundOutputFile)) return false;
  try {
    const payload = JSON.parse(await readFile(outputFile, "utf8"));
    const fundPayload = JSON.parse(await readFile(fundOutputFile, "utf8"));
    const expected = company.managers.map((manager) => manager.id).sort();
    const actual = Object.keys(payload.managers ?? {}).sort();
    return payload.period === period
      && payload.companyId === company.id
      && payload.quality?.failedDownloads === 0
      && payload.quality?.completedManagers === expected.length
      && JSON.stringify(actual) === JSON.stringify(expected)
      && fundPayload.companyId === company.id
      && fundPayload.period === period
      && fundPayload.productCount === companyProducts(company).length;
  } catch { return false; }
}

const completed = new Set();
const queue = [];
for (const company of snapshot.companies) {
  if (!force && await isComplete(company)) completed.add(company.id);
  else queue.push({ company, attempt: 1 });
}
const failures = [];
const startedAt = new Date().toISOString();

async function saveProgress(active = []) {
  await writeFile(progressFile, JSON.stringify({
    period, startedAt, updatedAt: new Date().toISOString(), total: snapshot.companies.length,
    completed: completed.size, pending: queue.length, active, failures,
  }, null, 2));
}

function runCompany(company) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "scripts/build-static-overview.mjs"),
      `--company=${company.id}`, `--period=${period}`,
      `--concurrency=${fundConcurrency}`, "--skip-manifest=true",
    ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
    child.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(output || `child exit ${code}`)));
  });
}

let queueCursor = 0;
async function worker(workerId) {
  while (queueCursor < queue.length) {
    const item = queue[queueCursor++];
    const { company, attempt } = item;
    try {
      await runCompany(company);
      completed.add(company.id);
      process.stdout.write(`${completed.size}/${snapshot.companies.length} ${company.name} complete (worker ${workerId})\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(-1_000) : String(error);
      if (attempt < maxAttempts) queue.push({ company, attempt: attempt + 1 });
      else failures.push({ companyId: company.id, companyName: company.name, attempts: attempt, error: message });
      process.stdout.write(`${company.name} attempt ${attempt} failed${attempt < maxAttempts ? ", queued for retry" : ""}\n`);
    }
    await saveProgress([company.id]);
  }
}

await saveProgress();
await Promise.all(Array.from({ length: companyWorkers }, (_, index) => worker(index + 1)));
if (failures.length) {
  await saveProgress();
  throw new Error(`Market build incomplete: ${JSON.stringify(failures.slice(0, 10))}`);
}

const overviewRoot = path.join(root, "public/data/overview");
const manifest = { version: 1, updatedAt: new Date().toISOString(), entries: {} };
for (const periodEntry of await readdir(overviewRoot, { withFileTypes: true })) {
  if (!periodEntry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(periodEntry.name)) continue;
  const files = await readdir(path.join(overviewRoot, periodEntry.name), { withFileTypes: true });
  for (const file of files) {
    if (!file.isFile() || !/^\d{8}\.json$/.test(file.name)) continue;
    const payload = JSON.parse(await readFile(path.join(overviewRoot, periodEntry.name, file.name), "utf8"));
    manifest.entries[`${payload.companyId}:${payload.period}`] = {
      companyId: payload.companyId, companyName: payload.companyName, period: payload.period,
      generatedAt: payload.generatedAt, managerCount: payload.managerCount,
      productCount: payload.representativeProductCount,
      path: `/data/overview/${payload.period}/${payload.companyId}.json`, contentHash: payload.contentHash,
    };
  }
}
await writeFile(path.join(overviewRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
await saveProgress();
console.log(JSON.stringify({ period, companies: completed.size, failures: failures.length, manifestEntries: Object.keys(manifest.entries).length }));
