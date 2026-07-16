import { fetchAvailablePeriods } from "../../lib/periods";

const fallback = ["2026-03-31", "2025-12-31", "2025-09-30"];

export async function GET() {
  try {
    const periods = await fetchAvailablePeriods();
    return Response.json({ periods: periods.length === 3 ? periods : fallback, mode: periods.length === 3 ? "live" : "fallback", checkedAt: new Date().toISOString() }, { headers: { "cache-control": "public, max-age=1800, s-maxage=21600" } });
  } catch {
    return Response.json({ periods: fallback, mode: "fallback", checkedAt: new Date().toISOString() }, { headers: { "cache-control": "public, max-age=300" } });
  }
}
