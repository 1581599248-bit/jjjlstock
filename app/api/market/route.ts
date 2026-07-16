import snapshot from "../../data/market-index.json";

export async function GET() {
  return Response.json({ ...snapshot, mode: "snapshot" }, { headers: { "cache-control": "public, max-age=900, s-maxage=21600" } });
}

