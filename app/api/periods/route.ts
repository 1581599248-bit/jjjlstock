const availablePeriods = ["2026-03-31"];

export async function GET() {
  return Response.json(
    { periods: availablePeriods, mode: "published", checkedAt: new Date().toISOString() },
    { headers: { "cache-control": "public, max-age=3600, s-maxage=86400" } },
  );
}
