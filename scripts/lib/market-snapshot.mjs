import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export function marketSnapshotPath(root, period) {
  return path.join(root, "public/data/market", `${period}.json`);
}

export async function loadMarketSnapshot(root, period) {
  const periodFile = marketSnapshotPath(root, period);
  const file = existsSync(periodFile) ? periodFile : path.join(root, "app/data/market-index.json");
  return JSON.parse(await readFile(file, "utf8"));
}

export async function saveMarketSnapshot(root, period, snapshot) {
  const file = marketSnapshotPath(root, period);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(snapshot)}\n`, "utf8");
  return file;
}
