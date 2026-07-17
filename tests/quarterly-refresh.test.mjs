import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nextUnpublishedPeriod, previousPublishedPeriod, sortPeriodsDesc } from "../scripts/lib/report-periods.mjs";

test("quarter discovery advances one completed report period and retains history", () => {
  const published = ["2026-03-31", "2025-12-31"];
  assert.equal(nextUnpublishedPeriod(published, new Date("2026-07-18T00:00:00Z")), "2026-06-30");
  assert.equal(nextUnpublishedPeriod(["2026-06-30", ...published], new Date("2026-07-18T00:00:00Z")), null);
  assert.equal(previousPublishedPeriod(["2026-03-31", "2025-12-31"], "2026-06-30"), "2026-03-31");
  assert.deepEqual(sortPeriodsDesc(["2026-03-31", "2026-06-30", "2026-03-31"]), ["2026-06-30", "2026-03-31"]);
});

test("published periods and period-specific market snapshots drive the website", async () => {
  const root = new URL("../", import.meta.url);
  const published = JSON.parse(await readFile(new URL("app/data/published-periods.json", root), "utf8"));
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  const route = await readFile(new URL("app/api/periods/route.ts", root), "utf8");
  assert.ok(published.periods.includes("2026-03-31"));
  assert.deepEqual(published.periods, sortPeriodsDesc(published.periods));
  assert.match(page, /publishedPeriods\.periods/);
  assert.match(page, /\/data\/market\/\$\{period\}\.json/);
  assert.match(route, /published\.periods/);
});

test("GitHub performs scheduled refreshes and Render deploys committed data", async () => {
  const root = new URL("../", import.meta.url);
  const workflow = await readFile(new URL(".github/workflows/quarterly-refresh.yml", root), "utf8");
  const render = await readFile(new URL("render.yaml", root), "utf8");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /node scripts\/refresh-quarter\.mjs/);
  assert.match(workflow, /permissions:\s+contents: write/s);
  assert.match(workflow, /npm test/);
  assert.match(render, /runtime: node/);
  assert.match(render, /autoDeployTrigger: commit/);
  assert.match(render, /healthCheckPath: \/api\/periods/);
});
