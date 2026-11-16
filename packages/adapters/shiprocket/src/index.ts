import crypto from 'node:crypto';
import { verifyHmacSha256, type ICarrierProvider, type CarrierCredentials, type RateRequest, type RateQuote, type ShipmentRequest, type ShipmentResult, type TrackingCheckpoint, type WebhookEnvelope } from '../../../logistics-core/src/index.js';
interface HttpTransport {request<T>(url:string,init:{method:string;headers:Record<string,string>;body?:unknown}):Promise<T>}
export class ShiprocketAdapter implements ICarrierProvider {
 readonly code='shiprocket'; readonly kind='AGGREGATOR' as const;
 private tokens=new Map<string,{value:string;expiresAt:number}>();
 constructor(private http:HttpTransport,private baseUrl:string){}
 private async headers(c:CarrierCredentials){
  if(!c.email||!c.password)throw new Error('SHIPROCKET_CREDENTIALS_MISSING');
  const key=crypto.createHash('sha256').update(c.email+'\\0'+c.password).digest('hex');let token=this.tokens.get(key);
  if(!token||token.expiresAt<Date.now()+30000){
   const x=await this.http.request<{token:string}>(this.baseUrl+'/v1/external/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:{email:c.email,password:c.password}});
   if(!x.token)throw new Error('SHIPROCKET_AUTH_FAILED');token={value:x.token,expiresAt:Date.now()+9*60*60*1000};this.tokens.set(key,token);
  }
  return{'content-type':'application/json',Authorization:'Bearer '+token.value};
 }
 async validateCredentials(c:CarrierCredentials){await this.headers(c);}
 async checkServiceability(r:RateRequest,c:CarrierCredentials){
  const query=new URLSearchParams({pickup_postcode:r.origin.postalCode,delivery_postcode:r.destination.postalCode,weight:String(r.weightGrams/1000),cod:String((r.codAmountMinor||0)>0?1:0),declared_value:String((r.declaredValueMinor||0)/100)});
  const x=await this.http.request<any>(this.baseUrl+'/v1/external/courier/serviceability?'+query,{method:'GET',headers:await this.headers(c)});
  return Boolean(x.data?.available_courier_companies?.length);
 }
 async getRates(r:RateRequest,c:CarrierCredentials):Promise<RateQuote[]>{
  const query=new URLSearchParams({pickup_postcode:r.origin.postalCode,delivery_postcode:r.destination.postalCode,weight:String(r.weightGrams/1000),cod:String((r.codAmountMinor||0)>0?1:0),declared_value:String((r.declaredValueMinor||0)/100)});
  const x=await this.http.request<any>(this.baseUrl+'/v1/external/courier/serviceability?'+query,{method:'GET',headers:await this.headers(c)});
  return(x.data?.available_courier_companies||[]).filter((v:any)=>Number.isFinite(Number(v.rate))).map((v:any)=>({
   providerCode:this.code,serviceCode:String(v.courier_company_id),amountMinor:Math.round(Number(v.rate)*100),currency:r.currency,
   estimatedTransitHours:Math.max(1,Number(v.estimated_delivery_days||5))*24,serviceable:true,codSupported:Boolean(v.cod),
   fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+15*60*1000).toISOString(),
  }));
 }
 async createShipment(r:ShipmentRequest,c:CarrierCredentials):Promise<ShipmentResult>{
  const o=r.origin,d=r.destination;
  if(!o?.name||!o.postalCode)throw new Error('SHIPROCKET_PICKUP_LOCATION_REQUIRED');
  if(!d.name||!d.contact||!d.addressLine1||!d.city||!d.state||!d.postalCode||!d.email)throw new Error('SHIPROCKET_DELIVERY_DETAILS_INCOMPLETE');
  const [firstName,...lastParts]=d.name.trim().split(/\\s+/);const lastName=lastParts.join(' ')||'Customer';
  const phone=d.contact.replace(/\\D/g,'');const pin=Number(d.postalCode);
  if(!/^\\d{10}$/.test(phone)||!/^\\d{6}$/.test(String(pin)))throw new Error('SHIPROCKET_PHONE_OR_PINCODE_INVALID');
  const orderId=r.orderId.slice(0,50);
  const headers=await this.headers(c);
  const created=await this.http.request<any>(this.baseUrl+'/v1/external/orders/create/adhoc',{method:'POST',headers,body:{
   order_id:orderId,order_date:(r.orderDate||new Date().toISOString()).slice(0,10),pickup_location:o.name,
   billing_customer_name:firstName,billing_last_name:lastName,billing_address:d.addressLine1,billing_address_2:d.addressLine2||'',
   billing_city:d.city,billing_pincode:pin,billing_state:d.state,billing_country:'India',billing_email:d.email,billing_phone:Number(phone),
   shipping_is_billing:true,order_items:(r.items||[]).map(item=>({name:item.name,sku:item.sku,units:item.quantity,selling_price:Math.round(item.unitPrice)})),
   payment_method:r.codAmountMinor>0?'COD':'Prepaid',sub_total:Math.round(r.declaredValueMinor/100),weight:r.weightGrams/1000,
   length:10,breadth:10,height:10,
  }});
  const shipmentId=created.shipment_id||created.data?.shipment_id;
  if(!shipmentId)throw new Error('SHIPROCKET_ORDER_CREATE_FAILED:'+String(created.message||created.errors||'shipment id missing'));
  const assigned=await this.http.request<any>(this.baseUrl+'/v1/external/courier/assign/awb',{method:'POST',headers,body:{shipment_id:shipmentId,courier_id:Number(r.quote.serviceCode)}});
  const awb=assigned.response?.data?.awb_code||assigned.awb_code||assigned.data?.awb_code;
  if(!awb)throw new Error('SHIPROCKET_AWB_ASSIGN_FAILED:'+String(assigned.message||assigned.response?.message||'AWB missing'));
  let labelUrl:string|undefined;
  try{
   const label=await this.http.request<any>(this.baseUrl+'/v1/external/courier/generate/label',{method:'POST',headers,body:{shipment_id:[shipmentId]}});
   labelUrl=label.label_url||label.response?.label_url||label.data?.label_url;
  }catch{/* Label can be generated later from the Shiprocket panel. */}
  return{providerCode:this.code,providerShipmentId:String(shipmentId),awbNumber:String(awb),labelUrl,estimatedDeliveryAt:new Date(Date.now()+r.quote.estimatedTransitHours*3600000).toISOString(),status:'CREATED'};
 }
 async getTracking(awb:string,c:CarrierCredentials):Promise<TrackingCheckpoint[]>{
  const x=await this.http.request<any>(this.baseUrl+'/v1/external/courier/track/awb/'+encodeURIComponent(awb),{method:'GET',headers:await this.headers(c)});
  const activities=x.tracking_data?.shipment_track_activities||[];
  if(activities.length)return activities.map((e:any)=>{const raw=String(e['sr-status-label']||e.activity||e.status||'');const occurredAt=String(e.date||e.timestamp||new Date().toISOString());return{status:status(raw),statusCode:raw,occurredAt,locationCode:e.location,eventHash:crypto.createHash('sha256').update(awb+':'+raw+':'+occurredAt).digest('hex')};});
  const current=x.tracking_data?.shipment_track?.[0]?.current_status||x.tracking_data?.track_status;
  if(!current)return [];
  const occurredAt=String(x.tracking_data?.shipment_track?.[0]?.delivered_date||new Date().toISOString());
  return[{status:status(String(current)),statusCode:String(current),occurredAt,eventHash:crypto.createHash('sha256').update(awb+':'+current+':'+occurredAt).digest('hex')}];
 }
 async cancelShipment(awb:string,c:CarrierCredentials){
  const x=await this.http.request<any>(this.baseUrl+'/v1/external/orders/cancel/shipment/awbs',{method:'POST',headers:await this.headers(c),body:{awbs:[awb]}});
  if(x.status===false||x.status_code>=400)throw new Error('SHIPROCKET_CANCEL_FAILED:'+String(x.message||'request rejected'));
 }
 verifyWebhook(raw:string|Buffer,sig:string,secret:string){
  if(verifyHmacSha256(raw,sig,secret))return true;const a=Buffer.from(sig.trim()),b=Buffer.from(secret);
  return a.length===b.length&&a.length>0&&crypto.timingSafeEqual(a,b);
 }
 parseWebhook(payload:unknown):WebhookEnvelope{
  const p=payload as any;const awb=String(p?.awb||p?.awb_code||p?.awb_number||'');
  const rawStatus=String(p?.current_status||p?.status||'');const at=String(p?.current_timestamp||p?.date||p?.etd||'');
  if(!awb||!rawStatus||!at)throw new Error('INVALID_SHIPROCKET_WEBHOOK');
  return{providerCode:this.code,awbNumber:awb,status:status(rawStatus),occurredAt:at,locationCode:p.location||p.current_location,
   eventHash:crypto.createHash('sha256').update(String(p.event_id||awb+':'+rawStatus+':'+at)).digest('hex'),raw:payload};
 }
}
function status(v:string):ShipmentResult['status']{
 const k=v.toUpperCase().trim().replace(/[ -]/g,'_');
 const m:Record<string,ShipmentResult['status']>={
  NEW:'CREATED',CREATED:'CREATED',PICKUP_SCHEDULED:'MANIFESTED',PICKUP_BOOKED:'MANIFESTED',PICKED_UP:'IN_TRANSIT',SHIPPED:'IN_TRANSIT',IN_TRANSIT:'IN_TRANSIT',
  REACHED_AT_DESTINATION_HUB:'IN_TRANSIT',REACHED_WAREHOUSE:'IN_TRANSIT',OUT_FOR_DELIVERY:'OUT_FOR_DELIVERY',OFD:'OUT_FOR_DELIVERY',DELIVERED:'DELIVERED',
  UNDELIVERED:'NDR',NDR:'NDR',PICKUP_EXCEPTION:'NDR',PICKUP_ERROR:'NDR',RTO:'RTO_INITIATED',RTO_INITIATED:'RTO_INITIATED',RTO_IN_TRANSIT:'RTO_INITIATED',
  RTO_DELIVERED:'RTO_DELIVERED',RTO_ACKNOWLEDGED:'RTO_DELIVERED',CANCELLED:'CANCELLED',CANCELED:'CANCELLED',CANCELLED_BEFORE_DISPATCHED:'CANCELLED',LOST:'NDR',DAMAGED:'NDR',
 };
 if(!m[k])throw new Error('UNKNOWN_SHIPROCKET_STATUS:'+v);return m[k];
}
