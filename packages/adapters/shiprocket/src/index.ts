import crypto from 'node:crypto';
import { verifyHmacSha256, type ICarrierProvider, type CarrierCredentials, type RateRequest, type RateQuote, type ShipmentRequest, type ShipmentResult, type TrackingCheckpoint, type WebhookEnvelope, type ReturnPickupRequest, type ReturnPickupResult } from '../../../logistics-core/src/index.js';
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
  const x=await this.http.request<any>(this.baseUrl+'/v1/external/courier/courierListWithCounts?'+query,{method:'GET',headers:await this.headers(c)});
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
 private async findExistingOrder(orderId:string,headers:Record<string,string>):Promise<{shipmentId:string;awb?:string;pickupScheduled:boolean}|null>{
  try{
   const response=await this.http.request<any>(this.baseUrl+'/v1/external/orders?'+new URLSearchParams({filter_by:'channel_order_id',filter:orderId}),{method:'GET',headers});
   const rows=Array.isArray(response.data)?response.data:Array.isArray(response.data?.data)?response.data.data:Array.isArray(response.orders)?response.orders:[];
   const order=rows.find((row:any)=>String(row.channel_order_id||row.order_id||row.channel_order_number||'')===orderId);
   if(!order)return null;
   const shipment=Array.isArray(order.shipments)?order.shipments[0]:order.shipment||{};
   const shipmentId=shipment.id||shipment.shipment_id||order.shipment_id;
   if(!shipmentId)return null;
   const statusCode=Number(shipment.status_code||shipment.status||order.status_code||order.status||0);
   return{shipmentId:String(shipmentId),awb:shipment.awb||shipment.awb_code||shipment.awb_number||order.awb_code,pickupScheduled:statusCode>=3};
  }catch{return null;}
 }
 async createShipment(r:ShipmentRequest,c:CarrierCredentials):Promise<ShipmentResult>{
  const o=r.origin,d=r.destination;
  if(!o?.name||!o.postalCode)throw new Error('SHIPROCKET_PICKUP_LOCATION_REQUIRED');
  if(!d.name||!d.contact||!d.addressLine1||!d.city||!d.state||!d.postalCode||!d.email)throw new Error('SHIPROCKET_DELIVERY_DETAILS_INCOMPLETE');
  const [firstName,...lastParts]=d.name.trim().split(/\s+/);const lastName=lastParts.join(' ')||'Customer';
  const phoneDigits=d.contact.replace(/\D/g,'');const phone=phoneDigits.length===12&&phoneDigits.startsWith('91')?phoneDigits.slice(2):phoneDigits;const pin=Number(d.postalCode);
  if(!/^\d{10}$/.test(phone)||!/^\d{6}$/.test(String(pin)))throw new Error('SHIPROCKET_PHONE_OR_PINCODE_INVALID');
  const orderId=r.orderId.slice(0,50);const headers=await this.headers(c);
  let existing=await this.findExistingOrder(orderId,headers);
  let shipmentId=existing?.shipmentId;let awb=existing?.awb;let pickupScheduled=existing?.pickupScheduled===true;
  if(!shipmentId){
   try{
    const created=await this.http.request<any>(this.baseUrl+'/v1/external/orders/create/adhoc',{method:'POST',headers,body:{
     order_id:orderId,order_date:(r.orderDate||new Date().toISOString()).slice(0,10),pickup_location:o.name,
     billing_customer_name:firstName,billing_last_name:lastName,billing_address:d.addressLine1,billing_address_2:d.addressLine2||'',
     billing_city:d.city,billing_pincode:pin,billing_state:d.state,billing_country:'India',billing_email:d.email,billing_phone:Number(phone),
     shipping_is_billing:true,shipping_customer_name:d.name,shipping_phone:Number(phone),shipping_address:d.addressLine1,shipping_address_2:d.addressLine2||'',shipping_city:d.city,shipping_state:d.state,shipping_country:'India',shipping_pincode:pin,shipping_email:d.email,order_items:(r.items||[]).map(item=>({name:item.name,sku:item.sku,units:item.quantity,selling_price:Math.round(item.unitPrice)})),
     payment_method:r.codAmountMinor>0?'COD':'Prepaid',sub_total:Math.round(r.declaredValueMinor/100),weight:r.weightGrams/1000,
     length:10,breadth:10,height:10,
    }});
    shipmentId=created.shipment_id||created.data?.shipment_id;
    awb=created.awb_code||created.data?.awb_code;
   }catch(error){
    // Shiprocket order creation is keyed by external order_id. Reconcile after timeouts/duplicate responses before retrying creation.
    existing=await this.findExistingOrder(orderId,headers);shipmentId=existing?.shipmentId;awb=existing?.awb;
    if(!shipmentId)throw new Error('SHIPROCKET_CREATE_RECONCILIATION_REQUIRED:'+String(error instanceof Error?error.message:error));
   }
  }
  if(!shipmentId){
   existing=await this.findExistingOrder(orderId,headers);shipmentId=existing?.shipmentId;awb=existing?.awb;
  }
  if(!shipmentId)throw new Error('SHIPROCKET_ORDER_CREATE_FAILED:shipment id missing');
  if(!awb){
   const assigned=await this.http.request<any>(this.baseUrl+'/v1/external/courier/assign/awb',{method:'POST',headers,body:{shipment_id:Number(shipmentId),courier_id:Number(r.quote.serviceCode)}});
   awb=assigned.response?.data?.awb_code||assigned.awb_code||assigned.data?.awb_code;
   if(!awb)throw new Error('SHIPROCKET_AWB_ASSIGN_FAILED:'+String(assigned.message||assigned.response?.message||'AWB missing'));
  }
  if(!pickupScheduled){
   const pickup=await this.http.request<any>(this.baseUrl+'/v1/external/courier/generate/pickup',{method:'POST',headers,body:{shipment_id:Number(shipmentId)}});
   if(pickup.status===false||String(pickup.status).toLowerCase()==='false'||pickup.pickup_status===0||Number(pickup.status_code)>=400)throw new Error('SHIPROCKET_PICKUP_SCHEDULE_FAILED:'+String(pickup.message||pickup.response||'pickup rejected'));
   pickupScheduled=true;
  }
  let manifestUrl:string|undefined;
  try{
   const manifest=await this.http.request<any>(this.baseUrl+'/v1/external/manifests/generate',{method:'POST',headers,body:{shipment_id:[Number(shipmentId)]}});
   manifestUrl=manifest.manifest_url||manifest.url||manifest.response?.manifest_url||manifest.data?.manifest_url;
  }catch{/* Manifest can be generated from the Shiprocket panel after pickup is accepted. */}
  let labelUrl:string|undefined;
  try{
   const label=await this.http.request<any>(this.baseUrl+'/v1/external/courier/generate/label',{method:'POST',headers,body:{shipment_id:[Number(shipmentId)]}});
   labelUrl=label.label_url||label.response?.label_url||label.data?.label_url;
  }catch{/* Label can be generated later from the Shiprocket panel. */}
  return{providerCode:this.code,providerShipmentId:String(shipmentId),awbNumber:String(awb),labelUrl,manifestUrl,pickupScheduled,estimatedDeliveryAt:new Date(Date.now()+r.quote.estimatedTransitHours*3600000).toISOString(),status:'CREATED'};
 }
 async createReturnPickup(r:ReturnPickupRequest,c:CarrierCredentials):Promise<ReturnPickupResult>{
  const pickup=r.customer,drop=r.returnTo;
  if(!pickup.name||!pickup.contact||!pickup.addressLine1||!pickup.city||!pickup.state||!pickup.postalCode)throw new Error('SHIPROCKET_RETURN_PICKUP_ADDRESS_INCOMPLETE');
  if(!drop.name||!drop.contact||!drop.addressLine1||!drop.city||!drop.state||!drop.postalCode)throw new Error('SHIPROCKET_RETURN_DESTINATION_INCOMPLETE');
  const phone=(value:string)=>{const digits=value.replace(/\\D/g,'');return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits;};
  const pickupPhone=phone(pickup.contact),dropPhone=phone(drop.contact);
  if(!/^\\d{10}$/.test(pickupPhone)||!/^\\d{10}$/.test(dropPhone)||!/^\\d{6}$/.test(pickup.postalCode)||!/^\\d{6}$/.test(drop.postalCode))throw new Error('SHIPROCKET_RETURN_PHONE_OR_PINCODE_INVALID');
  const headers=await this.headers(c);
  const params=new URLSearchParams({pickup_postcode:pickup.postalCode,delivery_postcode:drop.postalCode,weight:String(r.weightGrams/1000),cod:'0',declared_value:String(r.declaredValueMinor/100),is_return:'1'});
  const serviceability=await this.http.request<any>(this.baseUrl+'/v1/external/courier/serviceability?'+params,{method:'GET',headers});
  const couriers=(serviceability.data?.available_courier_companies||[]).filter((row:any)=>Number.isFinite(Number(row.rate)));
  const selected=couriers.sort((a:any,b:any)=>Number(a.rate)-Number(b.rate))[0];
  if(!selected)throw new Error('SHIPROCKET_RETURN_PICKUP_NOT_SERVICEABLE');
  const orderId=r.orderId.slice(0,50);
  const created=await this.http.request<any>(this.baseUrl+'/v1/external/orders/create/return',{method:'POST',headers,body:{
   order_id:orderId,order_date:(r.orderDate||new Date().toISOString()).slice(0,10),payment_method:'Prepaid',sub_total:Math.round(r.declaredValueMinor/100),
   pickup_customer_name:pickup.name,pickup_address:pickup.addressLine1,pickup_address_2:pickup.addressLine2||'',pickup_city:pickup.city,pickup_state:pickup.state,pickup_country:'India',pickup_pincode:Number(pickup.postalCode),pickup_email:pickup.email||r.email||'',pickup_phone:Number(pickupPhone),
   shipping_customer_name:drop.name,shipping_address:drop.addressLine1,shipping_address_2:drop.addressLine2||'',shipping_city:drop.city,shipping_state:drop.state,shipping_country:'India',shipping_pincode:Number(drop.postalCode),shipping_phone:Number(dropPhone),shipping_email:drop.email||r.email||'',
   order_items:r.items.map(item=>({name:item.name,sku:item.sku,units:item.quantity,selling_price:Math.round(item.unitPrice)})),
   weight:r.weightGrams/1000,length:10,breadth:10,height:10,
  }});
  let shipmentId=created.shipment_id||created.data?.shipment_id;
  let awb=created.awb_code||created.data?.awb_code;
  if(!shipmentId)throw new Error('SHIPROCKET_RETURN_ORDER_CREATE_FAILED:'+String(created.message||'shipment id missing'));
  if(!awb){
   const assigned=await this.http.request<any>(this.baseUrl+'/v1/external/courier/assign/awb',{method:'POST',headers,body:{shipment_id:Number(shipmentId),courier_id:Number(selected.courier_company_id)}});
   awb=assigned.response?.data?.awb_code||assigned.awb_code||assigned.data?.awb_code;
   if(!awb)throw new Error('SHIPROCKET_RETURN_AWB_ASSIGN_FAILED:'+String(assigned.message||'AWB missing'));
  }
  const pickupResult=await this.http.request<any>(this.baseUrl+'/v1/external/courier/generate/pickup',{method:'POST',headers,body:{shipment_id:Number(shipmentId)}});
  if(pickupResult.status===false)throw new Error('SHIPROCKET_RETURN_PICKUP_SCHEDULING_FAILED:'+String(pickupResult.message||'pickup rejected'));
  let labelUrl:string|undefined;
  try{
   const label=await this.http.request<any>(this.baseUrl+'/v1/external/courier/generate/label',{method:'POST',headers,body:{shipment_id:[Number(shipmentId)]}});
   labelUrl=label.label_url||label.response?.data?.label_url||label.data?.label_url;
  }catch{/* Label can be regenerated later from the Shiprocket panel. */}
  return{providerCode:this.code,providerShipmentId:String(shipmentId),awbNumber:String(awb),labelUrl,pickupScheduled:true,status:'CREATED'};
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
  NEW:'CREATED',CREATED:'CREATED',PICKUP_SCHEDULED:'MANIFESTED',PICKUP_BOOKED:'MANIFESTED',PICKUP_GENERATED:'MANIFESTED',PICKUP_QUEUED:'MANIFESTED',OUT_FOR_PICKUP:'MANIFESTED',
  PICKED_UP:'IN_TRANSIT',SHIPPED:'IN_TRANSIT',IN_TRANSIT:'IN_TRANSIT',REACHED_AT_DESTINATION:'IN_TRANSIT',REACHED_AT_DESTINATION_HUB:'IN_TRANSIT',REACHED_WAREHOUSE:'IN_TRANSIT',HANDED_OVER_TO_COURIER:'IN_TRANSIT',MISROUTED:'IN_TRANSIT',
  OUT_FOR_DELIVERY:'OUT_FOR_DELIVERY',OFD:'OUT_FOR_DELIVERY',DELIVERED:'DELIVERED',
  UNDELIVERED:'NDR',NDR:'NDR',PICKUP_EXCEPTION:'NDR',PICKUP_ERROR:'NDR',DELAYED:'NDR',LOST:'NDR',DAMAGED:'NDR',DESTROYED:'NDR',QC_FAILED:'NDR',
  RTO:'RTO_INITIATED',RTO_INITIATED:'RTO_INITIATED',RTO_IN_TRANSIT:'RTO_INITIATED',RTO_NDR:'RTO_INITIATED',RTO_OFD:'RTO_INITIATED',
  RTO_DELIVERED:'RTO_DELIVERED',RTO_ACKNOWLEDGED:'RTO_DELIVERED',CANCELLED:'CANCELLED',CANCELED:'CANCELLED',CANCELLED_BEFORE_DISPATCHED:'CANCELLED',CANCELLED_BEFORE_DISPATCH:'CANCELLED',
 };
 if(!m[k])throw new Error('UNKNOWN_SHIPROCKET_STATUS:'+v);return m[k];
}
