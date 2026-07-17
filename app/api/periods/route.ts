import published from "../../data/published-periods.json";

export async function GET() {
  return Response.json(
    { periods: published.periods, mode: "published", publishedAt: published.updatedAt, checkedAt: new Date().toISOString() },
    { headers: { "cache-control": "public, max-age=300, s-maxage=600" } },
  );
}
