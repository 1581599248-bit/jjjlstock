type CacheRequest = { key: string; managerId: string };
type CacheWrite = CacheRequest & { companyId: string; period: string; payload: unknown };

const FRESH_FOR_MS = 12 * 60 * 60 * 1000;

async function database() {
  try {
    const { env } = await import("cloudflare:workers");
    return env.DB ?? null;
  } catch { return null; }
}

export async function readManagerOverviewCache(entries: CacheRequest[]) {
  const db = await database();
  const result = new Map<string, unknown>();
  if (!db || !entries.length) return result;
  try {
    const rows = await db.batch(entries.map((entry) => db.prepare("SELECT payload FROM manager_overview_cache WHERE cache_key = ? AND updated_at >= ? LIMIT 1").bind(entry.key, Date.now() - FRESH_FOR_MS)));
    rows.forEach((row, index) => {
      const payload = (row.results?.[0] as { payload?: string } | undefined)?.payload;
      if (payload) result.set(entries[index].managerId, JSON.parse(payload));
    });
  } catch { /* cache misses must never block live public data */ }
  return result;
}

export async function writeManagerOverviewCache(entries: CacheWrite[]) {
  const db = await database();
  if (!db || !entries.length) return;
  try {
    await db.batch(entries.map((entry) => db.prepare("INSERT INTO manager_overview_cache (cache_key, company_id, period, manager_id, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at").bind(entry.key, entry.companyId, entry.period, entry.managerId, JSON.stringify(entry.payload), Date.now())));
  } catch { /* fresh response is still returned when persistence is unavailable */ }
}
