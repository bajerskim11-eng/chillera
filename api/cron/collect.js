const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const VALID_TYPES = new Set(["flower","extract","other"]);
const VALID_STATUSES = new Set(["available","unavailable","unknown","on_request"]);

async function rest(path, method="GET", body) {
  const response = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return response.status === 204 ? [] : response.json();
}

function parseCsv(input) {
  const rows=[]; let row=[], field="", quoted=false;
  for(let i=0;i<input.length;i++){
    const c=input[i], next=input[i+1];
    if(c==='"' && quoted && next==='"'){field+='"';i++;}
    else if(c==='"'){quoted=!quoted;}
    else if(c===',' && !quoted){row.push(field);field="";}
    else if((c==='\n'||c==='\r')&&!quoted){
      if(c==='\r'&&next==='\n')i++;
      row.push(field);if(row.some(v=>v.trim()!==""))rows.push(row);
      row=[];field="";
    } else field+=c;
  }
  if(field.length||row.length){row.push(field);rows.push(row);}
  if(rows.length<2)return [];
  const headers=rows.shift().map(x=>x.trim().replace(/^\uFEFF/,""));
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,(values[i]||"").trim()])));
}

function normalizeRecord(row) {
  const item={...row};
  if(!item.pharmacy && item.pharmacy_name) item.pharmacy={
    name:item.pharmacy_name,address:item.pharmacy_address||null,city:item.pharmacy_city||null,
    postal_code:item.pharmacy_postal_code||null,voivodeship:item.pharmacy_voivodeship||null
  };
  if(!item.availability && item.availability_status) item.availability={
    status:item.availability_status,price_pln:item.price_pln??null,quantity_g:item.quantity_g??null
  };
  return item;
}

export default async function handler(req,res) {
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  if(!CRON_SECRET || req.headers.authorization!==`Bearer ${CRON_SECRET}`)return res.status(401).json({error:"Unauthorized"});
  if(!BASE || !KEY)return res.status(503).json({error:"Database not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"});
  let configured=[];
  try{configured=JSON.parse(process.env.CHILLERA_SOURCE_URLS||"[]");}
  catch{return res.status(500).json({error:"CHILLERA_SOURCE_URLS must be valid JSON"});}
  if(!Array.isArray(configured))return res.status(500).json({error:"CHILLERA_SOURCE_URLS must be an array"});
  const eligible=configured.filter(s=>s.enabled===true && s.terms_reviewed===true && s.url && s.name);
  const summary=[];
  for(const src of eligible){
    let runId=null,sourceId=null;
    try{
      const sourceType=["official_register","pharmacy","wholesaler","partner_api","manual"].includes(src.type)?src.type:"partner_api";
      const source=await rest("market_sources?on_conflict=name","POST",{
        name:src.name,source_type:sourceType,base_url:src.url,adapter:src.format||"json_feed",
        enabled:true,access_method:src.access_method||"public",terms_reviewed:true
      });
      sourceId=source[0]?.id;
      const run=await rest("market_ingestion_runs","POST",{source_id:sourceId,status:"running",metadata:{source:src.name}});
      runId=run[0]?.id;
      const response=await fetch(src.url,{
        headers:{"User-Agent":"ChilleraMarket/1.0 (+data contact required)","Accept":"application/json,text/csv"},
        signal:AbortSignal.timeout(25000),cache:"no-store"
      });
      if(!response.ok)throw new Error(`Source HTTP ${response.status}`);
      const body=await response.text();
      let records;
      if((response.headers.get("content-type")||"").includes("json")){
        const parsed=JSON.parse(body);records=Array.isArray(parsed)?parsed:parsed.records;
      } else if((response.headers.get("content-type")||"").includes("csv") || src.format==="csv"){
        records=parseCsv(body);
      } else throw new Error("Unsupported format. Supported feed types: JSON and CSV");
      if(!Array.isArray(records))throw new Error("Feed must contain an array or { records: [] }");
      let written=0;
      for(const raw of records){
        const item=normalizeRecord(raw);
        if(!item.canonical_name || !VALID_TYPES.has(item.product_type||"flower"))continue;
        const products=await rest("market_products?on_conflict=canonical_name,manufacturer,pack_size_g","POST",{
          canonical_name:item.canonical_name,manufacturer:item.manufacturer||null,brand:item.brand||null,
          product_type:item.product_type||"flower",thc_percent:item.thc_percent??null,cbd_percent:item.cbd_percent??null,
          pack_size_g:item.pack_size_g??null,registration_number:item.registration_number||null,
          source_url:src.url,source_name:src.name,verification_status:"unverified"
        });
        const productId=products[0]?.id;
        if(productId)written++;
        let pharmacyId=null;
        if(item.pharmacy?.name){
          const pharmacies=await rest("market_pharmacies?on_conflict=name,address","POST",{
            name:item.pharmacy.name,address:item.pharmacy.address||null,city:item.pharmacy.city||null,
            postal_code:item.pharmacy.postal_code||null,voivodeship:item.pharmacy.voivodeship||null,
            source_url:src.url,external_id:item.pharmacy.external_id||null,is_active:true
          });
          pharmacyId=pharmacies[0]?.id;
        }
        if(productId && pharmacyId && item.availability && VALID_STATUSES.has(item.availability.status)){
          await rest("market_availability","POST",{
            product_id:productId,pharmacy_id:pharmacyId,source_id:sourceId,status:item.availability.status,
            price_pln:item.availability.price_pln??null,quantity_g:item.availability.quantity_g??null,
            observed_at:item.availability.observed_at||new Date().toISOString(),
            expires_at:item.availability.expires_at||null,source_url:src.url,
            evidence:{feed_record_id:item.id||null},verification_status:"unverified"
          });
        }
        if(sourceType==="wholesaler" && productId && item.wholesale){
          await rest("market_wholesale_offers","POST",{
            product_id:productId,supplier_name:item.wholesale.supplier_name||src.name,
            price_net_pln:item.wholesale.price_net_pln??null,price_gross_pln:item.wholesale.price_gross_pln??null,
            quantity_g:item.wholesale.quantity_g??null,minimum_order_g:item.wholesale.minimum_order_g??null,
            valid_from:item.wholesale.valid_from||null,valid_until:item.wholesale.valid_until||null,
            source_id:sourceId,source_url:src.url,access_level:"b2b",verification_status:"unverified"
          });
        }
      }
      if(runId)await rest(`market_ingestion_runs?id=eq.${runId}`,"PATCH",{
        status:"success",records_seen:records.length,records_written:written,finished_at:new Date().toISOString()
      });
      if(sourceId)await rest(`market_sources?id=eq.${sourceId}`,"PATCH",{last_success_at:new Date().toISOString(),last_error:null});
      summary.push({source:src.name,status:"success",seen:records.length,written});
    }catch(error){
      if(runId)try{await rest(`market_ingestion_runs?id=eq.${runId}`,"PATCH",{status:"failed",error_message:String(error.message||error),finished_at:new Date().toISOString()});}catch{}
      if(sourceId)try{await rest(`market_sources?id=eq.${sourceId}`,"PATCH",{last_error:String(error.message||error)});}catch{}
      summary.push({source:src.name,status:"failed",error:String(error.message||error)});
    }
  }
  return res.status(200).json({
    ok:true,checked_at:new Date().toISOString(),configured_sources:configured.length,
    enabled_and_reviewed_sources:eligible.length,results:summary,
    note:"All imported records remain unverified until reviewed. Pharmacy stock and wholesale offers are never inferred from catalogue presence."
  });
}