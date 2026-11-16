import { processWebhook, type ICarrierProvider, type IWebhookStateStore } from '../../../packages/logistics-core/src/index.js';
export interface ShipmentLookup {findByProviderAndAwb(provider:string,awb:string):Promise<{shipmentId:string;status:import('../../../packages/logistics-core/src/index.js').ShipmentStatus;lastEventAtMs:number}|null>}
export interface WebhookAuditQueue {enqueue(payload:unknown):Promise<void>}
/** Queue consumer. The ingress handler should verify/queue raw bytes and respond 202; this worker performs state changes. */
export async function consumeCarrierWebhook(input:{provider:ICarrierProvider;rawBody:string;signature:string;webhookSecret:string;lookup:ShipmentLookup;stateStore:IWebhookStateStore;audit:WebhookAuditQueue}){
 if(!input.provider.verifyWebhook(input.rawBody,input.signature,input.webhookSecret))throw Object.assign(new Error('INVALID_WEBHOOK_SIGNATURE'),{statusCode:401});
 const event=input.provider.parseWebhook(JSON.parse(input.rawBody));
 const shipment=await input.lookup.findByProviderAndAwb(event.providerCode,event.awbNumber);
 if(!shipment){await input.audit.enqueue({type:'UNMATCHED_CARRIER_WEBHOOK',providerCode:event.providerCode,awbNumber:event.awbNumber});return{applied:false,reason:'SHIPMENT_NOT_FOUND' as const};}
 return processWebhook(input.stateStore,{shipmentId:shipment.shipmentId,currentStatus:shipment.status,lastEventAtMs:shipment.lastEventAtMs,event});
}
