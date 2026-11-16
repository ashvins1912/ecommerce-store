import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { encryptField, decryptField } from './fieldEncryption.js';
import { getLogisticsRateCache, setLogisticsRateCache } from './redis.js';
import { CircuitBreaker, withTimeout, STATUS_CODE } from '../../../packages/logistics-core/src/index.js';
import { rankCarriersHybrid } from '../../../packages/hybrid-engine/src/index.js';
import { ShadowfaxAdapter } from '../../../packages/adapters/shadowfax/src/index.js';
import { ShiprocketAdapter } from '../../../packages/adapters/shiprocket/src/index.js';

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  const url = process.env.LOGISTICS_SUPABASE_URL?.trim();
  const key = process.env.LOGISTICS_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw Object.assign(new Error('LOGISTICS_POSTGRES_NOT_CONFIGURED'), { statusCode: 503 });
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return client;
}
function unwrap<T>(result: { data: T; error: any }): T {
  if (result.error) throw Object.assign(new Error(result.error.message || 'LOGISTICS_DATABASE_ERROR'), { statusCode: 502, cause: result.error });
  return result.data;
}
export function decryptLogisticsSecret(value: string): string { return decryptField(value); }
export function encryptLogisticsSecret(value: string): string { return encryptField(value); }

export async function listLogisticsProviders() {
  return unwrap(await db().from('logistics_providers').select('id,code,name,type,auth_schema_json').eq('is_active', true).order('name'));
}
export async function listSellerCarrierConfigs(sellerId: string) {
  return unwrap(await db().from('seller_carrier_configs')
    .select('id,provider_id,priority_rank,is_active,created_at,logistics_providers(code,name,type)')
    .eq('seller_id', sellerId).order('priority_rank'));
}
export async function saveSellerCarrierConfig(input: { sellerId: string; providerId: string; credentials: Record<string,string>; priorityRank: number }) {
  const provider = unwrap(await db().from('logistics_providers').select('code,auth_schema_json').eq('id',input.providerId).eq('is_active',true).single()) as any;
  const fields = Array.isArray(provider.auth_schema_json?.fields) ? provider.auth_schema_json.fields : [];
  const credentials = Object.fromEntries(Object.entries(input.credentials).map(([k,v]) => [k, String(v).trim()]).filter(([,v]) => v));
  const missing = fields.filter((field:any) => !credentials[field.name]);
  if (missing.length) throw Object.assign(new Error('CARRIER_CREDENTIALS_REQUIRED:'+missing.map((field:any)=>field.name).join(',')), { statusCode: 400 });
  if (!Object.keys(credentials).length) throw Object.assign(new Error('CARRIER_CREDENTIALS_REQUIRED'), { statusCode: 400 });
  await rateAdapter(provider.code).validateCredentials(credentials);
  const encryptedCredentials = encryptField(JSON.stringify(credentials));
  const webhookSecretPlain = crypto.randomBytes(32).toString('hex');
  const webhookSecret = encryptField(webhookSecretPlain);
  const carrier = unwrap(await db().from('seller_carrier_configs').upsert({
    seller_id: input.sellerId, provider_id: input.providerId,
    encrypted_credentials: encryptedCredentials, webhook_secret: webhookSecret,
    priority_rank: input.priorityRank, is_active: true,
  }, { onConflict: 'seller_id,provider_id' }).select('id,provider_id,priority_rank,is_active').single());
  return { ...(carrier as any), webhookSecret: webhookSecretPlain };
}
export async function setSellerCarrierActive(sellerId: string, configId: string, isActive: boolean) {
  return unwrap(await db().from('seller_carrier_configs').update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', configId).eq('seller_id', sellerId).select('id,is_active').maybeSingle());
}
export async function listSellerWarehouses(sellerId: string) {
  return unwrap(await db().from('warehouses').select('id,warehouse_code,name,contact_name,contact_phone,address_line1,address_line2,locality,city,state,postal_code,country_code,is_default,is_active')
    .eq('seller_id', sellerId).order('is_default', { ascending: false }).order('name'));
}
export async function createSellerWarehouse(input: {
  sellerId:string;warehouseCode:string;name:string;contactName:string;contactPhone:string;
  addressLine1:string;addressLine2?:string;locality?:string;city:string;state:string;postalCode:string;countryCode:string;isDefault:boolean;
}) {
 const rows=unwrap(await db().rpc('create_seller_warehouse',{
  p_seller_id:input.sellerId,
  p_warehouse:{warehouse_code:input.warehouseCode,name:input.name,contact_name:input.contactName,contact_phone:input.contactPhone,
   address_line1:input.addressLine1,address_line2:input.addressLine2||null,locality:input.locality||null,
   city:input.city,state:input.state,postal_code:input.postalCode,country_code:input.countryCode||'IN',is_default:input.isDefault},
 })) as any[];
 return rows[0];
}
export async function createShipmentIntent(input: {
 orderId:string;sellerId:string;carrierConfigId:string;warehouseId:string;codAmountMinor:number;currency:string;
 weightGrams:number;destinationPostalCode:string;destinationCountryCode:string;declaredValueMinor:number;serviceCode?:string;
 recipientName:string;recipientPhone:string;recipientEmail?:string;destinationAddressLine1:string;destinationAddressLine2?:string;
 destinationCity:string;destinationState:string;orderDate:string;
 items:Array<{name:string;sku:string;quantity:number;unitPrice:number}>;
}) {
 const result=unwrap(await db().rpc('create_shipment_intent',{
  p_order_id:input.orderId,p_seller_id:input.sellerId,p_carrier_config_id:input.carrierConfigId,p_warehouse_id:input.warehouseId,
  p_cod_amount_minor:input.codAmountMinor,p_currency:input.currency,
  p_payload:{
   orderId:input.orderId,sellerId:input.sellerId,carrierConfigId:input.carrierConfigId,warehouseId:input.warehouseId,
   weightGrams:input.weightGrams,destinationPostalCode:input.destinationPostalCode,destinationCountryCode:input.destinationCountryCode,
   declaredValueMinor:input.declaredValueMinor,serviceCode:input.serviceCode,codAmountMinor:input.codAmountMinor,currency:input.currency,
   recipientName:input.recipientName,recipientPhone:input.recipientPhone,recipientEmail:input.recipientEmail||'',
   destinationAddressLine1:input.destinationAddressLine1,destinationAddressLine2:input.destinationAddressLine2||'',
   destinationCity:input.destinationCity,destinationState:input.destinationState,orderDate:input.orderDate,items:input.items,
  },
 })) as any[];
 const row=result[0];
 return {shipmentId:row.shipment_id,jobId:row.job_id,duplicate:!row.created};
}
export async function listSellerShipments(sellerId:string) {
  const configs = unwrap(await db().from('seller_carrier_configs').select('id').eq('seller_id',sellerId)) as Array<{id:string}>;
  const ids = configs.map(x=>x.id);
  if (!ids.length) return [];
  return unwrap(await db().from('shipments').select('id,order_id,awb_number,normalized_status,booking_status,pickup_scheduled,manifest_url,label_url,cod_amount_minor,currency,estimated_delivery_at,created_at,seller_carrier_config_id,warehouses(name,postal_code),seller_carrier_configs(logistics_providers(code,name))')
    .in('seller_carrier_config_id',ids).order('created_at',{ascending:false}).limit(100));
}
export async function getShipmentForCustomer(orderId:string) {
  return unwrap(await db().from('shipments').select('id,order_id,awb_number,normalized_status,last_event_at,last_carrier_poll_at,estimated_delivery_at,created_at,seller_carrier_configs!inner(seller_id,encrypted_credentials,logistics_providers!inner(code))')
    .eq('order_id',orderId).order('created_at',{ascending:false}).limit(1).maybeSingle());
}
export async function getSellerCarrierSecret(configId:string,sellerId:string) {
  const row = unwrap(await db().from('seller_carrier_configs').select('id,provider_id,encrypted_credentials,webhook_secret,logistics_providers!inner(code,is_active)')
    .eq('id',configId).eq('seller_id',sellerId).eq('is_active',true).eq('logistics_providers.is_active',true).single()) as any;
  return { ...row, credentials:JSON.parse(decryptField(row.encrypted_credentials)), webhookSecret:decryptField(row.webhook_secret) };
}
export async function claimLogisticsJob() {
  return unwrap(await db().rpc('claim_logistics_job'));
}
export async function completeLogisticsJob(jobId:string,result:unknown) {
  return unwrap(await db().from('logistics_jobs').update({status:'COMPLETED',result,completed_at:new Date().toISOString(),locked_at:null}).eq('id',jobId));
}
export async function failLogisticsJob(jobId:string,error:string,attempts:number,maxAttempts:number) {
 const job=unwrap(await db().from('logistics_jobs').select('payload').eq('id',jobId).single()) as any;
 const final=attempts>=maxAttempts;
 const result=unwrap(await db().from('logistics_jobs').update({
  status:final?'FAILED':'PENDING',attempts,last_error:error.slice(0,1000),locked_at:null,
  available_at:new Date(Date.now()+Math.min(300000,1000*Math.pow(2,attempts))).toISOString(),
 }).eq('id',jobId));
 if(job?.payload?.shipmentId)await db().from('shipments').update({booking_status:final?'FAILED':'PENDING',updated_at:new Date().toISOString()}).eq('id',job.payload.shipmentId);
 return result;
}
export async function updateShipmentFromCarrier(input:{shipmentId:string;providerShipmentId:string;awbNumber:string;labelUrl?:string;manifestUrl?:string;estimatedDeliveryAt?:string;pickupScheduled?:boolean;statusCode:number}) {
  return unwrap(await db().from('shipments').update({
    provider_shipment_id:input.providerShipmentId,awb_number:input.awbNumber,label_url:input.labelUrl || null,manifest_url:input.manifestUrl || null,
    estimated_delivery_at:input.estimatedDeliveryAt || null,pickup_scheduled:input.pickupScheduled===true,booking_status:'BOOKED',normalized_status:input.statusCode,updated_at:new Date().toISOString(),
  }).eq('id',input.shipmentId));
}
export async function getCustomerTrackingEvents(orderId:string) {
  const shipment = await getShipmentForCustomer(orderId) as any;
  if (!shipment) return null;
  const events = unwrap(await db().from('shipment_tracking_events').select('status_code,location_code,event_timestamp')
    .eq('shipment_id',shipment.id).order('event_timestamp',{ascending:false}).limit(1)) as any[];
  return { statusCode:shipment.normalized_status,eta:shipment.estimated_delivery_at,latestCheckpoint:events[0] || null };
}

export async function refreshCarrierTrackingForOrder(orderId:string) {
 const shipment=await getShipmentForCustomer(orderId) as any;
 if(!shipment||!shipment.awb_number)return getCustomerTrackingEvents(orderId);
 const claimed=unwrap(await db().rpc('claim_carrier_tracking_poll',{p_shipment_id:shipment.id})) as boolean;
 if(!claimed)return getCustomerTrackingEvents(orderId);
 try{
  const provider=rateAdapter(shipment.seller_carrier_configs.logistics_providers.code);
  const credentials=JSON.parse(decryptField(shipment.seller_carrier_configs.encrypted_credentials));
  const checkpoints=await provider.getTracking(shipment.awb_number,credentials);
  let currentStatus=Number(shipment.normalized_status);
  let lastEventAt=shipment.last_event_at||null;
  const ordered=[...checkpoints].filter(event=>Number.isFinite(Date.parse(event.occurredAt))).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
  for(const event of ordered){
   const statusCode=STATUS_CODE[event.status];
   if(!statusCode)continue;
   const applied=await applyLogisticsWebhook({shipmentId:shipment.id,eventHash:event.eventHash,statusCode,locationCode:event.locationCode,eventTimestamp:event.occurredAt,expectedStatusCode:currentStatus,expectedLastEventAt:lastEventAt});
   if(applied){currentStatus=statusCode;lastEventAt=event.occurredAt;}
  }
 }catch(error){console.warn('Carrier tracking refresh failed; returning last webhook checkpoint:',error);}
 return getCustomerTrackingEvents(orderId);
}

export async function getSellerWarehouse(sellerId:string,warehouseId:string) {
 return unwrap(await db().from('warehouses').select('id,name,contact_name,contact_phone,address_line1,address_line2,city,state,postal_code,country_code').eq('seller_id',sellerId).eq('id',warehouseId).eq('is_active',true).single());
}
export async function getLogisticsJob(jobId:string) {
 return unwrap(await db().from('logistics_jobs').select('id,job_type,payload,attempts,max_attempts').eq('id',jobId).single());
}
export async function setShipmentStatusForSeller(input:{shipmentId:string;sellerId:string;statusCode:number}) {
 const configs=unwrap(await db().from('seller_carrier_configs').select('id').eq('seller_id',input.sellerId)) as Array<{id:string}>;
 const ids=configs.map(x=>x.id);if(!ids.length)return null;
 return unwrap(await db().from('shipments').update({normalized_status:input.statusCode,updated_at:new Date().toISOString()})
  .eq('id',input.shipmentId).in('seller_carrier_config_id',ids).select('id,normalized_status').maybeSingle());
}

export async function findShipmentForWebhook(providerCode:string,awbNumber:string) {
 const row=unwrap(await db().from('shipments').select('id,normalized_status,last_event_at,seller_carrier_configs!inner(id,webhook_secret,logistics_providers!inner(code))')
  .eq('awb_number',awbNumber).eq('seller_carrier_configs.logistics_providers.code',providerCode).maybeSingle()) as any;
 if(!row)return null;
 return {shipmentId:row.id,currentStatusCode:row.normalized_status,lastEventAt:row.last_event_at,webhookSecret:decryptField(row.seller_carrier_configs.webhook_secret)};
}
export async function applyLogisticsWebhook(input:{shipmentId:string;eventHash:string;statusCode:number;locationCode?:string;eventTimestamp:string;expectedStatusCode:number;expectedLastEventAt:string|null}) {
 const applied=unwrap(await db().rpc('apply_logistics_webhook',{
  p_shipment_id:input.shipmentId,p_event_hash:input.eventHash,p_status_code:input.statusCode,
  p_location_code:input.locationCode||null,p_event_timestamp:input.eventTimestamp,
  p_expected_status:input.expectedStatusCode,p_expected_last_event_at:input.expectedLastEventAt,
 })) as boolean;
 if(input.statusCode===50||input.statusCode===80){
  try{
   // SQL verifies that the exact event was accepted and deduplicates outcome increments.
   await db().rpc('record_carrier_outcome',{
    p_shipment_id:input.shipmentId,p_event_hash:input.eventHash,p_status_code:input.statusCode,
   });
  }catch(error){console.warn('Carrier outcome feedback write deferred:',(error as Error).message);}
 }
 return applied;
}

const quoteBreakers = new Map<string,CircuitBreaker>();
const carrierHttp = { async request<T>(url:string,init:{method:string;headers:Record<string,string>;body?:unknown}):Promise<T>{
 const response=await fetch(url,{method:init.method,headers:init.headers,signal:AbortSignal.timeout(15000),...(init.body===undefined?{}:{body:JSON.stringify(init.body)})});
 const raw=await response.text();let payload:any={};try{payload=raw?JSON.parse(raw):{};}catch{payload={message:raw};}
 if(!response.ok)throw new Error('CARRIER_HTTP_'+response.status+':'+String(payload.message||payload.error||'request failed'));
 return payload as T;
}};
function rateAdapter(code:string){
 if(code==='shiprocket'){const url=process.env.SHIPROCKET_API_BASE_URL||'https://apiv2.shiprocket.in';return new ShiprocketAdapter(carrierHttp,url);}
 if(code==='shadowfax'){const url=process.env.SHADOWFAX_API_BASE_URL||(process.env.NODE_ENV==='production'?'https://dale.shadowfax.in/api':'https://dale.staging.shadowfax.in/api');return new ShadowfaxAdapter(carrierHttp,url);}
 throw new Error('UNSUPPORTED_CARRIER:'+code);
}
export async function getSellerRateQuotes(input:{sellerId:string;destinationPostalCode:string;weightGrams:number;codAmountMinor:number;declaredValueMinor:number;currency:string}){
 const configs=unwrap(await db().from('seller_carrier_configs').select('id,priority_rank,updated_at,encrypted_credentials,logistics_providers!inner(code,is_active)')
  .eq('seller_id',input.sellerId).eq('is_active',true).eq('logistics_providers.is_active',true)) as any[];
 const warehouse=unwrap(await db().from('warehouses').select('id,postal_code,country_code').eq('seller_id',input.sellerId).eq('is_active',true).order('is_default',{ascending:false}).limit(1).maybeSingle()) as any;
 if(!warehouse||!configs.length)return [];

 const regionCode=input.destinationPostalCode.slice(0,3)||'GLOBAL';
 let feedbackRows:any[]=[];
 try{
  const feedbackCacheKey=`carrier-feedback:${input.sellerId}:${regionCode}`;
  const cachedFeedback=await getLogisticsRateCache<any[]>(feedbackCacheKey);
  if(cachedFeedback)feedbackRows=cachedFeedback;
  else{
   feedbackRows=unwrap(await db().from('carrier_performance_feedback')
    .select('provider_code,service_code,attempts,delivered_count,rto_count,updated_at')
    .eq('seller_id',input.sellerId).eq('region_code',regionCode)) as any[];
   await setLogisticsRateCache(feedbackCacheKey,feedbackRows,60);
  }
 }catch(error){
  // Backward-compatible rollout: until the SQL migration is applied, use a neutral prior.
  console.warn('Adaptive carrier feedback unavailable; using neutral prior:',(error as Error).message);
  feedbackRows=[];
 }
 const feedbackByService=new Map<string,any>();
 for(const row of feedbackRows)feedbackByService.set(`${row.provider_code}:${row.service_code}`,row);
 const feedbackVersion=crypto.createHash('sha256').update(JSON.stringify(feedbackRows.map(row=>[row.provider_code,row.service_code,row.attempts,row.delivered_count,row.rto_count,row.updated_at]))).digest('hex');
 const cacheKey='svc:'+crypto.createHash('sha256').update(JSON.stringify({
  origin:warehouse.postal_code,destination:input.destinationPostalCode,weightGrams:input.weightGrams,
  codAmountMinor:input.codAmountMinor,declaredValueMinor:input.declaredValueMinor,currency:input.currency,
  feedbackVersion,configs:configs.map(x=>[x.id,x.priority_rank,x.updated_at]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
 })).digest('hex');
 const cached=await getLogisticsRateCache<any[]>(cacheKey);if(cached)return cached;

 const settled=await Promise.allSettled(configs.map(async config=>{
  const providerCode=String(config.logistics_providers.code);
  const provider=rateAdapter(providerCode);
  const credentials=JSON.parse(decryptField(config.encrypted_credentials));
  let breaker=quoteBreakers.get(config.id);if(!breaker){breaker=new CircuitBreaker(3,15000);quoteBreakers.set(config.id,breaker);}
  const quotes=await breaker.execute(()=>withTimeout(provider.getRates({
   origin:{warehouseId:warehouse.id,postalCode:warehouse.postal_code,countryCode:warehouse.country_code||'IN'},
   destination:{warehouseId:'destination',postalCode:input.destinationPostalCode,countryCode:'IN'},
   weightGrams:input.weightGrams,codAmountMinor:input.codAmountMinor,declaredValueMinor:input.declaredValueMinor,currency:input.currency,
  },credentials),4500));
  return quotes.filter(quote=>quote.currency===input.currency).map(quote=>({
   id:`${config.id}:${quote.serviceCode}`,configId:config.id,priorityRank:config.priority_rank,providerCode,quote,
  }));
 }));
 const candidates=settled.flatMap(result=>result.status==='fulfilled'?result.value:[]);
 const banditFeedback:Record<string,{attempts:number;successful:number;rto:number}>={};
 const ranked=rankCarriersHybrid(candidates.map(candidate=>{
  const row=feedbackByService.get(`${candidate.providerCode}:${candidate.quote.serviceCode}`);
  const attempts=Number(row?.attempts||0),delivered=Number(row?.delivered_count||0),rto=Number(row?.rto_count||0);
  banditFeedback[candidate.id]={attempts,successful:delivered,rto};
  return {
   id:candidate.id,cost:candidate.quote.amountMinor,transitHours:candidate.quote.estimatedTransitHours,
   rtoRate:attempts>=5?rto/attempts:0.15,sellerPriority:Number(candidate.priorityRank||100),
   serviceable:candidate.quote.serviceable,
  };
 }),{cost:0.4,transit:0.3,rto:0.2,sellerPriority:0.1},banditFeedback,{
  epsilon:Math.max(0,Math.min(0.25,Number(process.env.CARRIER_EPSILON||0.08))),
 });
 const result=ranked.map(score=>{
  const match=candidates.find(candidate=>candidate.id===score.id);
  return {
   ...score,
   providerCode:match?.quote.providerCode,
   serviceCode:match?.quote.serviceCode,
   costMinor:match?.quote.amountMinor,
   estimatedTransitHours:match?.quote.estimatedTransitHours,
   currency:match?.quote.currency,
   score:score.selectionScore,
   carrierConfigId:match?.configId,
   quote:match?.quote,
  };
 });
 const earliestExpiry=result.reduce((min,x)=>Math.min(min,Date.parse(x.quote?.expiresAt||new Date(Date.now()+60000).toISOString())),Date.now()+86400000);
 await setLogisticsRateCache(cacheKey,result,Math.max(1,Math.min(86400,Math.floor((earliestExpiry-Date.now())/1000))));
 return result;
}
export async function retrySellerShipment(sellerId:string,shipmentId:string) {
 return unwrap(await db().rpc('retry_shipment_booking',{p_shipment_id:shipmentId,p_seller_id:sellerId}));
}
