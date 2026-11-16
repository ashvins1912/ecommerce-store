import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { encryptField, decryptField } from './fieldEncryption.js';

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
  const credentials = Object.fromEntries(Object.entries(input.credentials).map(([k,v]) => [k, String(v).trim()]).filter(([,v]) => v));
  if (!Object.keys(credentials).length) throw Object.assign(new Error('CARRIER_CREDENTIALS_REQUIRED'), { statusCode: 400 });
  const encryptedCredentials = encryptField(JSON.stringify(credentials));
  const webhookSecret = encryptField(crypto.randomBytes(32).toString('hex'));
  return unwrap(await db().from('seller_carrier_configs').upsert({
    seller_id: input.sellerId, provider_id: input.providerId,
    encrypted_credentials: encryptedCredentials, webhook_secret: webhookSecret,
    priority_rank: input.priorityRank, is_active: true,
  }, { onConflict: 'seller_id,provider_id' }).select('id,provider_id,priority_rank,is_active').single());
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
  if (input.isDefault) await db().from('warehouses').update({ is_default: false }).eq('seller_id', input.sellerId);
  return unwrap(await db().from('warehouses').insert({
    seller_id:input.sellerId,warehouse_code:input.warehouseCode,name:input.name,contact_name:input.contactName,
    contact_phone:input.contactPhone,address_line1:input.addressLine1,address_line2:input.addressLine2 || null,
    locality:input.locality || null,city:input.city,state:input.state,postal_code:input.postalCode,
    country_code:input.countryCode || 'IN',is_default:input.isDefault,
  }).select('id,warehouse_code,name,contact_name,contact_phone,address_line1,address_line2,locality,city,state,postal_code,country_code,is_default,is_active').single());
}
export async function createShipmentIntent(input: {
  orderId:string; sellerId:string; carrierConfigId:string; warehouseId:string; codAmountMinor:number; currency:string;
  weightGrams:number; destinationPostalCode:string; destinationCountryCode:string; declaredValueMinor:number;
}) {
  const config = unwrap(await db().from('seller_carrier_configs').select('id,provider_id,priority_rank,logistics_providers(code,name,type)')
    .eq('id',input.carrierConfigId).eq('seller_id',input.sellerId).eq('is_active',true).single()) as any;
  const warehouse = unwrap(await db().from('warehouses').select('id').eq('id',input.warehouseId).eq('seller_id',input.sellerId).eq('is_active',true).single());
  const shipment = unwrap(await db().from('shipments').insert({
    order_id:input.orderId,seller_carrier_config_id:config.id,warehouse_id:(warehouse as any).id,
    normalized_status:10,cod_amount_minor:input.codAmountMinor,currency:input.currency,
  }).select('id,order_id,seller_carrier_config_id,warehouse_id,normalized_status,cod_amount_minor,currency,created_at').single()) as any;
  const job = unwrap(await db().from('logistics_jobs').insert({
    job_type:'CREATE_SHIPMENT',payload:{
      shipmentId:shipment.id,carrierConfigId:config.id,providerCode:config.logistics_providers.code,
      orderId:input.orderId,sellerId:input.sellerId,warehouseId:input.warehouseId,
      weightGrams:input.weightGrams,destinationPostalCode:input.destinationPostalCode,
      destinationCountryCode:input.destinationCountryCode,declaredValueMinor:input.declaredValueMinor,
      codAmountMinor:input.codAmountMinor,currency:input.currency,
    },status:'PENDING',attempts:0,max_attempts:5,
  }).select('id').single()) as any;
  return { shipment, jobId:job.id };
}
export async function listSellerShipments(sellerId:string) {
  const configs = unwrap(await db().from('seller_carrier_configs').select('id').eq('seller_id',sellerId)) as Array<{id:string}>;
  const ids = configs.map(x=>x.id);
  if (!ids.length) return [];
  return unwrap(await db().from('shipments').select('id,order_id,awb_number,normalized_status,label_url,cod_amount_minor,currency,estimated_delivery_at,created_at,seller_carrier_config_id,warehouses(name,postal_code),seller_carrier_configs(logistics_providers(code,name))')
    .in('seller_carrier_config_id',ids).order('created_at',{ascending:false}).limit(100));
}
export async function getShipmentForCustomer(orderId:string) {
  return unwrap(await db().from('shipments').select('id,order_id,normalized_status,estimated_delivery_at,created_at,shipment_tracking_events(status_code,location_code,event_timestamp)')
    .eq('order_id',orderId).order('created_at',{ascending:false}).limit(1).maybeSingle());
}
export async function getSellerCarrierSecret(configId:string,sellerId:string) {
  const row = unwrap(await db().from('seller_carrier_configs').select('id,provider_id,encrypted_credentials,webhook_secret,logistics_providers(code)')
    .eq('id',configId).eq('seller_id',sellerId).single()) as any;
  return { ...row, credentials:JSON.parse(decryptField(row.encrypted_credentials)), webhookSecret:decryptField(row.webhook_secret) };
}
export async function claimLogisticsJob() {
  return unwrap(await db().rpc('claim_logistics_job'));
}
export async function completeLogisticsJob(jobId:string,result:unknown) {
  return unwrap(await db().from('logistics_jobs').update({status:'COMPLETED',result,completed_at:new Date().toISOString()}).eq('id',jobId));
}
export async function failLogisticsJob(jobId:string,error:string,attempts:number,maxAttempts:number) {
  return unwrap(await db().from('logistics_jobs').update({
    status:attempts+1>=maxAttempts?'FAILED':'PENDING',attempts:attempts+1,last_error:error.slice(0,1000),
    available_at:new Date(Date.now()+Math.min(300000,1000*Math.pow(2,attempts))).toISOString(),
  }).eq('id',jobId));
}
export async function updateShipmentFromCarrier(input:{shipmentId:string;providerShipmentId:string;awbNumber:string;labelUrl?:string;statusCode:number}) {
  return unwrap(await db().from('shipments').update({
    provider_shipment_id:input.providerShipmentId,awb_number:input.awbNumber,label_url:input.labelUrl || null,
    normalized_status:input.statusCode,updated_at:new Date().toISOString(),
  }).eq('id',input.shipmentId));
}
export async function getCustomerTrackingEvents(orderId:string) {
  const shipment = await getShipmentForCustomer(orderId) as any;
  if (!shipment) return null;
  const events = unwrap(await db().from('shipment_tracking_events').select('status_code,location_code,event_timestamp')
    .eq('shipment_id',shipment.id).order('event_timestamp',{ascending:false}).limit(1)) as any[];
  return { statusCode:shipment.normalized_status,eta:shipment.estimated_delivery_at,latestCheckpoint:events[0] || null };
}

export async function getSellerWarehouse(sellerId:string,warehouseId:string) {
 return unwrap(await db().from('warehouses').select('id,name,postal_code,country_code').eq('seller_id',sellerId).eq('id',warehouseId).single());
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
