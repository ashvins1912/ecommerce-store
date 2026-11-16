import { ShiprocketAdapter } from '../../../packages/adapters/shiprocket/src/index.js';
import { ShadowfaxAdapter } from '../../../packages/adapters/shadowfax/src/index.js';
import type { HttpTransport } from '../../../packages/adapters/shadowfax/src/index.js';
import { claimLogisticsJob, completeLogisticsJob, failLogisticsJob, getLogisticsJob, getSellerCarrierSecret, getSellerWarehouse, updateShipmentFromCarrier } from '../../../src/server/services/logistics.js';
import type { ICarrierProvider, ShipmentRequest } from '../../../packages/logistics-core/src/index.js';

const transport: HttpTransport = {
 async request<T>(url:string,init:{method:string;headers:Record<string,string>;body?:unknown}):Promise<T>{
  const response=await fetch(url,{method:init.method,headers:init.headers,...(init.body===undefined?{}:{body:JSON.stringify(init.body)})});
  const text=await response.text();let payload:any={};try{payload=text?JSON.parse(text):{};}catch{payload={message:text};}
  if(!response.ok)throw new Error('CARRIER_HTTP_'+response.status+':'+String(payload.message||payload.error||'request failed'));
  return payload as T;
 }
};
function adapter(code:string):ICarrierProvider{
 if(code==='shiprocket'){const url=process.env.SHIPROCKET_API_BASE_URL;if(!url)throw new Error('SHIPROCKET_API_BASE_URL_NOT_CONFIGURED');return new ShiprocketAdapter(transport,url);}
 if(code==='shadowfax'){const url=process.env.SHADOWFAX_API_BASE_URL;if(!url)throw new Error('SHADOWFAX_API_BASE_URL_NOT_CONFIGURED');return new ShadowfaxAdapter(transport,url);}
 throw new Error('UNSUPPORTED_CARRIER:'+code);
}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function processJob(job:any){
 const p=job.payload;
 if(job.job_type!=='CREATE_SHIPMENT')throw new Error('UNSUPPORTED_LOGISTICS_JOB:'+job.job_type);
 const config=await getSellerCarrierSecret(p.carrierConfigId,p.sellerId);
 const provider=adapter(config.logistics_providers.code);
 const warehouse=await getSellerWarehouse(p.sellerId,p.warehouseId) as any;
 const request:ShipmentRequest={
  orderId:p.orderId,sellerId:p.sellerId,warehouseId:p.warehouseId,
  quote:{providerCode:provider.code,serviceCode:p.serviceCode||'default',amountMinor:0,currency:p.currency||'INR',estimatedTransitHours:120,serviceable:true,codSupported:true,fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()},
  destination:{warehouseId:'destination',postalCode:p.destinationPostalCode,countryCode:p.destinationCountryCode||'IN'},
  weightGrams:p.weightGrams,codAmountMinor:p.codAmountMinor,declaredValueMinor:p.declaredValueMinor,currency:p.currency||'INR',
  idempotencyKey:'logistics-job:'+job.id,
 };
 const result=await provider.createShipment(request,config.credentials);
 await updateShipmentFromCarrier({shipmentId:p.shipmentId,providerShipmentId:result.providerShipmentId,awbNumber:result.awbNumber,labelUrl:result.labelUrl,statusCode:10});
 return {shipmentId:p.shipmentId,providerCode:provider.code,awbNumber:result.awbNumber,labelUrl:result.labelUrl};
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
   catch(error){await failLogisticsJob(job.id,error instanceof Error?error.message:String(error),Number(job.attempts||0),Number(job.max_attempts||5));}
  }catch(error){console.error('Logistics queue poll failed:',error);await delay(Math.max(pollMs,5000));}
 }
}
if (process.env.RUN_LOGISTICS_WORKER === '1') void runLogisticsWorker();
