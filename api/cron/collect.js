const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
async function rest(path, method="GET", body) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, { method, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type":"application/json", Prefer:"return=representation" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.status === 204 ? [] : r.json();
}
function parseCsv(text) {
  const lines=text.trim().split(/\r?\n/); if(lines.length<2)return [];
  const headers=lines.shift().split(",").map(x=>x.trim());
  return lines.map(line=>{const values=line.split(",");return Object.fromEntries(headers.map((h,i)=>[h,(values[i]||"").trim()]));});
}
export default async function handler(req,res) {
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  if(!CRON_SECRET || req.headers.authorization!==`Bearer ${CRON_SECRET}`)return res.status(401).json({error:"Unauthorized"});
  if(!BASE||!KEY)return res.status(503).json({error:"Database not configured"});
  let configured=[];try{configured=JSON.parse(process.env.CHILLERA_SOURCE_URLS||"[]");}catch{return res.status(500).json({error:"CHILLERA_SOURCE_URLS must be valid JSON"});}
  const summary=[];
  for(const src of configured.filter(x=>x.enabled===true && x.url && x.name)){
    let runId=null;
    try{
      const inserted=await rest("market_ingestion_runs","POST",{status:"running",metadata:{source:src.name}});
      runId=inserted[0]?.id;
      const response=await fetch(src.url,{headers:{"User-Agent":"ChilleraMarketBot/1.0 (+contact: operator)","Accept":"application/json,text/csv"},signal:AbortSignal.timeout(25000),cache:"no-store"});
      if(!response.ok)throw new Error(`Source HTTP ${response.status}`);
      const body=await response.text();let records;
      if((response.headers.get("content-type")||"").includes("json")){const parsed=JSON.parse(body);records=Array.isArray(parsed)?parsed:parsed.records;}
      else if((response.headers.get("content-type")||"").includes("csv"))records=parseCsv(body);
      else throw new Error("Unsupported source format; expected JSON or CSV");
      if(!Array.isArray(records))throw new Error("Feed must contain an array or {records: []}");
      let written=0;
      for(const item of records){
        if(!item.canonical_name || !["flower","extract","other"].includes(item.product_type||"flower"))continue;
        const product=await rest("market_products?on_conflict=canonical_name,manufacturer,pack_size_g","POST",{canonical_name:item.canonical_name,manufacturer:item.manufacturer||null,brand:item.brand||null,product_type:item.product_type||"flower",thc_percent:item.thc_percent??null,cbd_percent:item.cbd_percent??null,pack_size_g:item.pack_size_g??null,registration_number:item.registration_number||null,source_url:src.url,source_name:src.name,verification_status:"unverified" });
        written+=product.length;
      }
      if(runId)await rest(`market_ingestion_runs?id=eq.${runId}`,"PATCH",{status:"success",records_seen:records.length,records_written:written,finished_at:new Date().toISOString()});
      summary.push({source:src.name,status:"success",seen:records.length,written});
    }catch(e){if(runId)try{await rest(`market_ingestion_runs?id=eq.${runId}`,"PATCH",{status:"failed",error_message:String(e.message||e),finished_at:new Date().toISOString()});}catch{}summary.push({source:src.name,status:"failed",error:String(e.message||e)});}
  }
  return res.status(200).json({ok:true,checked_at:new Date().toISOString(),configured_sources:configured.length,results:summary,note:"Imported records are unverified until reviewed; this collector does not invent pharmacy stock or wholesale prices."});
}