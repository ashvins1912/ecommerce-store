import crypto from 'node:crypto';
import { verifyHmacSha256, type ICarrierProvider, type CarrierCredentials, type RateRequest, type RateQuote, type ShipmentRequest, type ShipmentResult, type TrackingCheckpoint, type WebhookEnvelope, type ReturnPickupRequest, type ReturnPickupResult } from '../../../logistics-core/src/index.js';
export interface HttpTransport { request<T>(url:string,init:{method:string;headers:Record<string,string>;body?:unknown}):Promise<T> }
export class ShadowfaxAdapter implements ICarrierProvider {
 readonly code='shadowfax'; readonly kind='DIRECT' as const;
 constructor(private http:HttpTransport,private baseUrl:string){}
 private headers(c:CarrierCredentials){const token=c.apiKey||c.token;if(!token)throw new Error('SHADOWFAX_CREDENTIAL_MISSING');return{'content-type':'application/json',Authorization:(c.authType==='bearer'?'Bearer ':'Token ')+token};}
 async validateCredentials(c:CarrierCredentials){
  await this.http.request(this.baseUrl+'/v1/clients/serviceability/?service=marketplace&pincodes=110001',{method:'GET',headers:this.headers(c)});
 }
 async checkServiceability(r:RateRequest,c:CarrierCredentials){
  const pins=[r.origin.postalCode,r.destination.postalCode].join(',');
  const rows=await this.http.request<Array<{code:number;services:string[]}>>(this.baseUrl+'/v1/clients/serviceability/?'+new URLSearchParams({service:'marketplace',pincodes:pins}),{method:'GET',headers:this.headers(c)});
  const available=new Map((Array.isArray(rows)?rows:[]).map(row=>[String(row.code),row.services||[]]));
  return [r.origin.postalCode,r.destination.postalCode].every(pin=>(available.get(pin)||[]).some(service=>['marketplace','regular','surface_mkt'].includes(service.toLowerCase())));
 }
 async getRates(r:RateRequest,c:CarrierCredentials):Promise<RateQuote[]>{
  // Shadowfax documents its rate calculator for prepaid clients only.
  if((r.codAmountMinor||0)>0)return [];
  const x=await this.http.request<{message:string;shipping_rate:string|null;gst:string|null}>(this.baseUrl+'/v1/clients/rate_calculator/',{method:'POST',headers:this.headers(c),body:{origin_pincode:Number(r.origin.postalCode),destination_pincode:Number(r.destination.postalCode),service:'forward',weight:r.weightGrams/1000}});
  if(x.message!=='Success'||x.shipping_rate==null)return [];
  const total=Number(x.shipping_rate)+Number(x.gst||0);
  if(!Number.isFinite(total)||total<0)return [];
  return [{providerCode:this.code,serviceCode:'Regular',amountMinor:Math.round(total*100),currency:r.currency,estimatedTransitHours:120,serviceable:true,codSupported:false,fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+15*60*1000).toISOString()}];
 }
 async createShipment(r:ShipmentRequest,c:CarrierCredentials):Promise<ShipmentResult>{
  if(r.declaredValueMinor>=5000000)throw new Error('SHADOWFAX_EWAY_BILL_AND_SELLER_GSTIN_REQUIRED_FOR_ORDERS_50000_PLUS');
  const origin=r.origin;if(!origin?.name||!origin.contact||!origin.addressLine1||!origin.city||!origin.postalCode)throw new Error('SHADOWFAX_PICKUP_ADDRESS_INCOMPLETE');
  const destination=r.destination;if(!destination.name||!destination.contact||!destination.addressLine1||!destination.city||!destination.postalCode)throw new Error('SHADOWFAX_DELIVERY_ADDRESS_INCOMPLETE');
  const body={
   customer_details:{name:destination.name,contact:destination.contact,address_line_1:destination.addressLine1,address2:destination.addressLine2||'',city:destination.city,pincode:Number(destination.postalCode),state:destination.state||''},
   order_details:{client_order_id:r.orderId,product_value:r.declaredValueMinor/100,payment_mode:r.codAmountMinor>0?'cod':'prepaid',cod_amount:r.codAmountMinor/100,order_service:'Regular',actual_weight:r.weightGrams/1000},
   pickup_details:{pickup_type:'seller',name:origin.name,contact:origin.contact,address_line_1:origin.addressLine1,city:origin.city,pincode:Number(origin.postalCode)},
   return_details:{return_type:'seller',name:origin.name,contact:origin.contact,address_line_1:origin.addressLine1,city:origin.city,pincode:Number(origin.postalCode)},
   product_details:(r.items||[]).map(item=>({sku_name:item.name,sku_id:item.sku,price:item.unitPrice,category:item.category||'General',additional_details:{quantity:item.quantity}})),
  };
  const x=await this.http.request<{message:string;data?:{id:number|string;awb_number:string;promised_delivery_date?:string};errors?:unknown}>(this.baseUrl+'/v3/clients/orders/',{method:'POST',headers:{...this.headers(c),'idempotency-key':r.idempotencyKey},body});
  if(x.message!=='Success'||!x.data?.awb_number)throw new Error('SHADOWFAX_ORDER_REJECTED:'+String(x.errors||x.message||'missing AWB'));
  return{providerCode:this.code,providerShipmentId:String(x.data.id),awbNumber:x.data.awb_number,estimatedDeliveryAt:x.data.promised_delivery_date?new Date(x.data.promised_delivery_date).toISOString():undefined,pickupScheduled:true,status:'CREATED'};
 }
 async createReturnPickup(r:ReturnPickupRequest,c:CarrierCredentials):Promise<ReturnPickupResult>{
  const pickup=r.customer,drop=r.returnTo;
  if(!pickup.name||!pickup.contact||!pickup.addressLine1||!pickup.city||!pickup.state||!pickup.postalCode)throw new Error('SHADOWFAX_RETURN_PICKUP_ADDRESS_INCOMPLETE');
  if(!drop.name||!drop.contact||!drop.addressLine1||!drop.city||!drop.postalCode)throw new Error('SHADOWFAX_RETURN_DESTINATION_INCOMPLETE');
  if(r.declaredValueMinor>=5000000)throw new Error('SHADOWFAX_RETURN_EWAY_BILL_REQUIRED_FOR_50000_PLUS');
  const pins=[pickup.postalCode,drop.postalCode].join(',');
  const [pickupRows,returnRows]=await Promise.all([
   this.http.request<Array<{code:number;services:string[]}>>(this.baseUrl+'/v1/clients/serviceability/?'+new URLSearchParams({service:'customer_pickup',pincodes:pins}),{method:'GET',headers:this.headers(c)}),
   this.http.request<Array<{code:number;services:string[]}>>(this.baseUrl+'/v1/clients/serviceability/?'+new URLSearchParams({service:'warehouse_return',pincodes:pins}),{method:'GET',headers:this.headers(c)}),
  ]);
  const pickupServices=new Map((Array.isArray(pickupRows)?pickupRows:[]).map(row=>[String(row.code),row.services||[]]));
  const returnServices=new Map((Array.isArray(returnRows)?returnRows:[]).map(row=>[String(row.code),row.services||[]]));
  const customerTiers=pickupServices.get(pickup.postalCode)||[];
  const returnTiers=returnServices.get(drop.postalCode)||[];
  const tierPairs=[['Regular','RTO'],['Surface','surface_RTO']];
  if(!tierPairs.some(([pickupTier,returnTier])=>customerTiers.includes(pickupTier)&&returnTiers.includes(returnTier)))throw new Error('SHADOWFAX_RETURN_PICKUP_NOT_SERVICEABLE');
  const response=await this.http.request<any>(this.baseUrl+'/v1/clients/pickup/orders/',{method:'POST',headers:{...this.headers(c),'idempotency-key':'return:'+r.orderId},body:{
   customer_details:{name:pickup.name.slice(0,100),contact:pickup.contact,address:[pickup.addressLine1,pickup.addressLine2].filter(Boolean).join(', '),city:pickup.city,pincode:Number(pickup.postalCode),state:pickup.state},
   return_details:{return_type:'origin',name:drop.name.slice(0,100),contact:drop.contact,address:[drop.addressLine1,drop.addressLine2].filter(Boolean).join(', '),city:drop.city,pincode:Number(drop.postalCode)},
   sku_details:r.items.map(item=>({sku_id:item.sku,sku_name:item.name,price:item.unitPrice,return_reason:r.reason,qc_required:false,category:item.category||'General',additional_details:{quantity_value:item.quantity}})),
   order_details:{client_order_id:r.orderId,price:r.declaredValueMinor/100,total_amount:r.declaredValueMinor/100,actual_weight:r.weightGrams/1000,pickup_type:'regular'},
  }});
  const data=response.data||response;
  const awb=data.awb_number||data.client_request_id||data.awb;
  if(response.message!=='Success'||!awb)throw new Error('SHADOWFAX_RETURN_PICKUP_REJECTED:'+String(response.errors||response.message||'missing AWB'));
  return{providerCode:this.code,providerShipmentId:String(data.id||data.client_order_id||r.orderId),awbNumber:String(awb),pickupScheduled:true,status:String(data.status||'NEW')};
 }
 async getTracking(awb:string,c:CarrierCredentials):Promise<TrackingCheckpoint[]>{
  const x=await this.http.request<any>(this.baseUrl+'/v4/clients/orders/'+encodeURIComponent(awb)+'/track/',{method:'GET',headers:this.headers(c)});
  const events=x.tracking_details||x.data?.tracking_details||[];
  return events.map((e:any)=>{const rawStatus=String(e.status||e.status_display||'');const mapped=status(rawStatus);const occurredAt=String(e.event_timestamp||e.timestamp||e.created_at||new Date().toISOString());return{status:mapped,statusCode:rawStatus,locationCode:e.current_location||e.location,occurredAt,eventHash:crypto.createHash('sha256').update(awb+':'+rawStatus+':'+occurredAt).digest('hex')};});
 }
 async cancelShipment(awb:string,c:CarrierCredentials){const x=await this.http.request<any>(this.baseUrl+'/v3/clients/orders/cancel/',{method:'POST',headers:this.headers(c),body:{request_id:awb,cancel_remarks:'Cancelled by seller'}});if(x.responseCode&&x.responseCode>=400)throw new Error('SHADOWFAX_CANCEL_FAILED:'+String(x.responseMsg||x.responseCode));}
 verifyWebhook(raw:string|Buffer,sig:string,secret:string){
  if(verifyHmacSha256(raw,sig,secret))return true;
  const a=Buffer.from(sig.trim()),b=Buffer.from(secret);
  return a.length===b.length&&a.length>0&&crypto.timingSafeEqual(a,b);
 }
 parseWebhook(payload:unknown):WebhookEnvelope{
  const p=payload as any;const awb=String(p?.awb_number||p?.awb||'');const at=String(p?.event_timestamp||p?.timestamp||'');const rawStatus=String(p?.status||p?.status_display||'');
  if(!awb||!at||!rawStatus)throw new Error('INVALID_SHADOWFAX_WEBHOOK');
  return{providerCode:this.code,awbNumber:awb,status:status(rawStatus),occurredAt:at,locationCode:p.current_location||p.location,eventHash:crypto.createHash('sha256').update(String(p.event_id||awb+':'+rawStatus+':'+at)).digest('hex'),raw:payload};
 }
}
function status(v:string):ShipmentResult['status']{
 const k=v.toLowerCase().trim().replace(/[ -]/g,'_');
 const m:Record<string,ShipmentResult['status']>={
  new:'CREATED',created:'CREATED',assigned_for_pickup:'MANIFESTED',assigned_for_seller_pickup:'MANIFESTED',ofp:'MANIFESTED',picked:'IN_TRANSIT',in_transit:'IN_TRANSIT',
  recd_at_rev_hub:'IN_TRANSIT',recd_at_fwd_hub:'IN_TRANSIT',recd_at_fwd_dc:'IN_TRANSIT',received_from_client_warehouse:'IN_TRANSIT',
  assigned_for_delivery:'OUT_FOR_DELIVERY',ofd:'OUT_FOR_DELIVERY',delivered:'DELIVERED',partially_delivered:'DELIVERED',
  nc:'NDR',na:'NDR',on_hold:'NDR',seller_not_contactable:'NDR',pickup_not_attempted:'NDR',reopen_ndr:'NDR',
  rts:'RTO_INITIATED',rts_in_process:'RTO_INITIATED',rto:'RTO_INITIATED',rts_d:'RTO_DELIVERED',rto_d:'RTO_DELIVERED',
  cancelled:'CANCELLED',cancelled_by_customer:'CANCELLED',cancelled_by_client:'CANCELLED',lost:'NDR',
 };
 if(!m[k])throw new Error('UNKNOWN_SHADOWFAX_STATUS:'+v);return m[k];
}
