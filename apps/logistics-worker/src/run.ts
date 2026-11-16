import { ShiprocketAdapter } from '../../../packages/adapters/shiprocket/src/index.js';
import { ShadowfaxAdapter } from '../../../packages/adapters/shadowfax/src/index.js';
import type { HttpTransport } from '../../../packages/adapters/shadowfax/src/index.js';
import { claimLogisticsJob, completeLogisticsJob, failLogisticsJob, getSellerCarrierSecret, getSellerWarehouse, updateShipmentFromCarrier, decryptLogisticsSecret } from '../../../src/server/services/logistics.js';
import type { ICarrierProvider, RateQuote, ShipmentRequest } from '../../../packages/logistics-core/src/index.js';
import { initDatabase } from '../../../src/server/services/store.js';
import { SellerPrivacySettingsModel } from '../../../src/server/models/schemas.js';
import { authorizeCarrierDisclosure } from '../../../src/server/services/privacy.js';

const transport: HttpTransport = {
 async request<T>(url:string,init:{method:string;headers:Record<string,string>;body?:unknown}):Promise<T>{
  const response=await fetch(url,{method:init.method,headers:init.headers,signal:AbortSignal.timeout(15000),...(init.body===undefined?{}:{body:JSON.stringify(init.body)})});
  const raw=await response.text();let payload:any={};try{payload=raw?JSON.parse(raw):{};}catch{payload={message:raw};}
  if(!response.ok)throw new Error('CARRIER_HTTP_'+response.status+':'+String(payload.message||payload.error||'request failed'));
  return payload as T;
 }
};
function adapter(code:string):ICarrierProvider{
 if(code==='shiprocket')return new ShiprocketAdapter(transport,process.env.SHIPROCKET_API_BASE_URL||'https://apiv2.shiprocket.in');
 if(code==='shadowfax')return new ShadowfaxAdapter(transport,process.env.SHADOWFAX_API_BASE_URL||(process.env.NODE_ENV==='production'?'https://dale.shadowfax.in/api':'https://dale.staging.shadowfax.in/api'));
 throw new Error('UNSUPPORTED_CARRIER:'+code);
}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function processJob(job:any){
 const p=job.payload;
 if(job.job_type!=='CREATE_SHIPMENT')throw new Error('UNSUPPORTED_LOGISTICS_JOB:'+job.job_type);
 if(!p.disclosureAuthorizedAt||!Array.isArray(p.disclosureFields)||!p.customerDisclosureCiphertext)throw new Error('CARRIER_DISCLOSURE_AUTHORIZATION_MISSING');
 let deliveryData:any;
 try{deliveryData=JSON.parse(decryptLogisticsSecret(p.customerDisclosureCiphertext));}catch{throw new Error('CARRIER_DISCLOSURE_PAYLOAD_DECRYPTION_FAILED');}
 const settings=await SellerPrivacySettingsModel.findOne({sellerId:String(p.sellerId)}).lean();
 const authorization=authorizeCarrierDisclosure(settings?.carrierDisclosure, String(p.carrierCode||'').toLowerCase(), deliveryData.recipientEmail);
 if(!authorization.allowed)throw new Error('CARRIER_DISCLOSURE_AUTHORIZATION_REVOKED_OR_INCOMPLETE');
 const authorizedFields=[...authorization.fields].sort();
 const queuedFields=[...p.disclosureFields].sort();
 if(authorizedFields.join('|')!==queuedFields.join('|'))throw new Error('CARRIER_DISCLOSURE_SCOPE_CHANGED_AFTER_QUEUE');
 if(!deliveryData.recipientName||!deliveryData.recipientPhone||!deliveryData.destinationAddressLine1||!deliveryData.destinationCity||!deliveryData.destinationState||!deliveryData.destinationPostalCode)throw new Error('CARRIER_DELIVERY_FIELDS_MISSING');
 const config=await getSellerCarrierSecret(p.carrierConfigId,p.sellerId);
 const provider=adapter(config.logistics_providers.code);
 if(provider.code!==String(p.carrierCode||'').toLowerCase())throw new Error('CARRIER_PROVIDER_MISMATCH');
 const warehouse=await getSellerWarehouse(p.sellerId,p.warehouseId) as any;
 const rateRequest={
  origin:{warehouseId:p.warehouseId,postalCode:warehouse.postal_code,countryCode:warehouse.country_code||'IN'},
  destination:{warehouseId:'destination',postalCode:deliveryData.destinationPostalCode,countryCode:p.destinationCountryCode||'IN'},
  weightGrams:p.weightGrams,codAmountMinor:p.codAmountMinor,declaredValueMinor:p.declaredValueMinor,currency:p.currency||'INR',
 };
 let quotes:RateQuote[]=await provider.getRates(rateRequest,config.credentials);
 let quote=quotes.filter(q=>q.serviceable&&Date.parse(q.expiresAt)>Date.now()&&(!p.serviceCode||q.serviceCode===p.serviceCode))
  .sort((a,b)=>a.amountMinor-b.amountMinor||a.estimatedTransitHours-b.estimatedTransitHours)[0];
 if(!quote&&p.codAmountMinor>0&&provider.code==='shadowfax'){
  const serviceable=await provider.checkServiceability(rateRequest,config.credentials);
  if(serviceable)quote={providerCode:provider.code,serviceCode:p.serviceCode||'Regular',amountMinor:0,currency:p.currency||'INR',estimatedTransitHours:120,serviceable:true,codSupported:true,fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
 }
 if(!quote)throw new Error('NO_VALID_CARRIER_SERVICE_QUOTE');
 if(p.codAmountMinor>0&&!quote.codSupported)throw new Error('SELECTED_CARRIER_SERVICE_DOES_NOT_SUPPORT_COD');
 if(provider.code==='shiprocket'&&!deliveryData.recipientEmail)throw new Error('SHIPROCKET_CUSTOMER_EMAIL_REQUIRED');
 const request:ShipmentRequest={
  orderId:p.orderId,sellerId:p.sellerId,warehouseId:p.warehouseId,quote,
  origin:{warehouseId:p.warehouseId,postalCode:warehouse.postal_code,countryCode:warehouse.country_code||'IN',name:warehouse.name,contact:warehouse.contact_phone,addressLine1:warehouse.address_line1,addressLine2:warehouse.address_line2||'',city:warehouse.city,state:warehouse.state},
  destination:{warehouseId:'destination',postalCode:deliveryData.destinationPostalCode,countryCode:p.destinationCountryCode||'IN',name:deliveryData.recipientName,contact:deliveryData.recipientPhone,email:deliveryData.recipientEmail||'',addressLine1:deliveryData.destinationAddressLine1,addressLine2:deliveryData.destinationAddressLine2||'',city:deliveryData.destinationCity,state:deliveryData.destinationState},
  weightGrams:p.weightGrams,codAmountMinor:p.codAmountMinor,declaredValueMinor:p.declaredValueMinor,currency:p.currency||'INR',
  idempotencyKey:'logistics-job:'+job.id,orderDate:p.orderDate,
  items:p.items||[],
 };
 // Re-read the seller policy after rate lookup and immediately before the external carrier call.
 const dispatchSettings=await SellerPrivacySettingsModel.findOne({sellerId:String(p.sellerId)}).lean();
 const dispatchAuthorization=authorizeCarrierDisclosure(dispatchSettings?.carrierDisclosure, String(p.carrierCode||'').toLowerCase(), deliveryData.recipientEmail);
 if(!dispatchAuthorization.allowed)throw new Error('CARRIER_DISCLOSURE_AUTHORIZATION_REVOKED_BEFORE_DISPATCH');
 if([...dispatchAuthorization.fields].sort().join('|')!==queuedFields.join('|'))throw new Error('CARRIER_DISCLOSURE_SCOPE_CHANGED_BEFORE_DISPATCH');
 const result=await provider.createShipment(request,config.credentials);
 if(!result.providerShipmentId||!result.awbNumber)throw new Error('CARRIER_RESPONSE_MISSING_SHIPMENT_ID_OR_AWB');
 await updateShipmentFromCarrier({shipmentId:p.shipmentId,providerShipmentId:result.providerShipmentId,awbNumber:result.awbNumber,labelUrl:result.labelUrl,manifestUrl:result.manifestUrl,estimatedDeliveryAt:result.estimatedDeliveryAt,pickupScheduled:result.pickupScheduled,statusCode:10});
 return {shipmentId:p.shipmentId,providerCode:provider.code,awbNumber:result.awbNumber,labelUrl:result.labelUrl,manifestUrl:result.manifestUrl,pickupScheduled:result.pickupScheduled,estimatedDeliveryAt:result.estimatedDeliveryAt};
}
export async function runLogisticsWorker(){
 const pollMs=Math.max(500,Number(process.env.LOGISTICS_WORKER_POLL_MS||1500));
 console.log('Logistics worker started; polling PostgreSQL job queue.');
 for(;;){
  try{
   const claimed=await claimLogisticsJob();
   const job=Array.isArray(claimed)?claimed[0]:claimed;
   if(!job){await delay(pollMs);continue;}
   try{const result=await processJob(job);await completeLogisticsJob(job.id,result);}
   catch(error){const message=error instanceof Error?error.message:String(error);console.error('Logistics job failed:',job.id,message);await failLogisticsJob(job.id,message,Number(job.attempts||0),Number(job.max_attempts||5));}
  }catch(error){console.error('Logistics queue poll failed:',error);await delay(Math.max(pollMs,5000));}
 }
}
if (process.env.RUN_LOGISTICS_WORKER === '1') {
 void (async () => {
  const db=await initDatabase();
  if(db.mode!=='mongodb' && process.env.NODE_ENV==='production') throw new Error('PRODUCTION_PRIVACY_POLICY_DATABASE_REQUIRED');
  await runLogisticsWorker();
 })();
}
