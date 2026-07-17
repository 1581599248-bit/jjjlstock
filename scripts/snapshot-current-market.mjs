import { readFile } from "node:fs/promises";
import path from "node:path";
import { saveMarketSnapshot } from "./lib/market-snapshot.mjs";

const period = process.argv.find((item) => item.startsWith("--period="))?.slice(9) ?? "";
if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("A valid --period is required");
const root = process.cwd();
const snapshot = JSON.parse(await readFile(path.join(root, "app/data/market-index.json"), "utf8"));
await saveMarketSnapshot(root, period, snapshot);
console.log(JSON.stringify({ status: "saved", period, companies: snapshot.companyCount, managers: snapshot.managerCount }));
