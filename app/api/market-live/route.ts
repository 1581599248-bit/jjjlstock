import snapshot from "../../data/market-index.json";
import { fetchMarketIndex } from "../../lib/eastmoney";

export async function GET() {
  try {
    const live = await fetchMarketIndex();
    return Response.json({ ...live, mode: "live" }, { headers: { "cache-control": "public, max-age=1800, s-maxage=21600" } });
  } catch {
    return Response.json({ ...snapshot, mode: "snapshot" }, { headers: { "cache-control": "public, max-age=300" } });
  }
}
