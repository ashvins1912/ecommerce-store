import test from 'node:test';
import assert from 'node:assert/strict';
import { ShadowfaxAdapter } from './index.js';
import type { ShipmentRequest } from '../../../logistics-core/src/index.js';

test('Shadowfax adapter sends documented forward-order payload and maps webhook scan',async()=>{
 let captured:any;
 const http={async request<T>(url:string,init:any):Promise<T>{
  captured={url,init};return {message:'Success',data:{id:123,awb_number:'SF123',promised_delivery_date:'2026-12-01T12:00:00Z'}} as T;
 }};
 const adapter=new ShadowfaxAdapter(http,'https://shadowfax.test/api');
 const request:ShipmentRequest={
  orderId:'order-123',sellerId:'seller-1',warehouseId:'warehouse-1',
  quote:{providerCode:'shadowfax',serviceCode:'Regular',amountMinor:5000,currency:'INR',estimatedTransitHours:120,serviceable:true,codSupported:true,fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()},
  origin:{warehouseId:'warehouse-1',postalCode:'560001',countryCode:'IN',name:'Seller Store',contact:'+919999999999',addressLine1:'Pickup Road',city:'Bengaluru'},
  destination:{warehouseId:'destination',postalCode:'560002',countryCode:'IN',name:'Buyer Name',contact:'+918888888888',addressLine1:'Delivery Road',city:'Bengaluru',state:'Karnataka'},
  weightGrams:700,codAmountMinor:10000,declaredValueMinor:10000,currency:'INR',idempotencyKey:'job-1',
  items:[{name:'Kurta',sku:'K-1',quantity:1,unitPrice:100}],
 };
 const result=await adapter.createShipment(request,{apiKey:'token'});
 assert.equal(result.awbNumber,'SF123');assert.equal(result.pickupScheduled,true);
 assert.equal(captured.init.headers.Authorization,'Token token');
 assert.equal(captured.init.body.order_details.payment_mode,'cod');
 assert.equal(captured.init.body.customer_details.pincode,560002);
 const event=adapter.parseWebhook({awb_number:'SF123',event_timestamp:'2026-11-16T10:00:00Z',status:'ofd',current_location:'BLR'});
 assert.equal(event.status,'OUT_FOR_DELIVERY');assert.equal(event.awbNumber,'SF123');
});

test('Shadowfax prepaid rate calculator returns a GST-inclusive INR quote',async()=>{
 const http={async request<T>():Promise<T>{return {message:'Success',shipping_rate:'40.00',gst:'7.20'} as T;}};
 const adapter=new ShadowfaxAdapter(http,'https://shadowfax.test/api');
 const quotes=await adapter.getRates({origin:{warehouseId:'w',postalCode:'560001',countryCode:'IN'},destination:{warehouseId:'d',postalCode:'110001',countryCode:'IN'},weightGrams:500,codAmountMinor:0,declaredValueMinor:50000,currency:'INR'},{apiKey:'token'});
 assert.equal(quotes[0].amountMinor,4720);assert.equal(quotes[0].codSupported,false);
});
