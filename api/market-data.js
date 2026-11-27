const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
async function rows(table, query = "") {
  const r = await fetch(`${BASE}/rest/v1/${table}?${query}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(12000),
    cache: "no-store"
  });
  if (!r.ok) throw new Error(`Supabase ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!BASE || !KEY) return res.status(503).json({ error: "Database not configured" });
  try {
    const [products, pharmacies, availability, sources, runs] = await Promise.all([
      rows("market_products", "select=*&order=canonical_name.asc&verification_status=eq.verified"),
      rows("market_pharmacies", "select=*&order=city.asc&is_active=eq.true"),
      rows("market_availability", "select=*,product:market_products(canonical_name),pharmacy:market_pharmacies(name,city)&order=observed_at.desc&limit=500&verification_status=eq.verified"),
      rows("market_sources", "select=id,name,source_type,enabled,last_success_at&order=name.asc"),
      rows("market_ingestion_runs", "select=id,status,records_seen,records_written,error_message,started_at,finished_at,source:market_sources(name)&order=started_at.desc&limit=100")
    ]);
    return res.status(200).json({ products, pharmacies, availability, sources, runs });
  } catch (e) { return res.status(502).json({ error: "Could not load market data", detail: String(e.message || e) }); }
}