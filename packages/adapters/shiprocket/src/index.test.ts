import test from 'node:test';
import assert from 'node:assert/strict';
import { ShiprocketAdapter } from './index.js';
import type { ShipmentRequest } from '../../../logistics-core/src/index.js';

test('Shiprocket order flow creates order, assigns AWB, schedules pickup and produces artifacts',async()=>{
 const calls:string[]=[];
 const http={async request<T>(url:string,init:any):Promise<T>{
  calls.push(url);
  if(url.endsWith('/v1/external/auth/login'))return {token:'access-token'} as T;
  if(url.includes('/v1/external/orders?search='))return {data:[]} as T;
  if(url.endsWith('/orders/create/adhoc'))return {shipment_id:456} as T;
  if(url.endsWith('/courier/assign/awb'))return {response:{data:{awb_code:'SR123'}}} as T;
  if(url.endsWith('/courier/generate/pickup'))return {pickup_status:1} as T;
  if(url.endsWith('/manifests/generate'))return {manifest_url:'https://carrier.test/manifest.pdf'} as T;
  if(url.endsWith('/courier/generate/label'))return {label_url:'https://carrier.test/label.pdf'} as T;
  throw new Error('Unexpected URL '+url);
 }};
 const adapter=new ShiprocketAdapter(http,'https://shiprocket.test');
 const request:ShipmentRequest={
  orderId:'mongo-order-id',sellerId:'seller-1',warehouseId:'warehouse-1',
  quote:{providerCode:'shiprocket',serviceCode:'10',amountMinor:6000,currency:'INR',estimatedTransitHours:72,serviceable:true,codSupported:true,fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()},
  origin:{warehouseId:'warehouse-1',postalCode:'560001',countryCode:'IN',name:'Registered Pickup'},
  destination:{warehouseId:'d',postalCode:'110001',countryCode:'IN',name:'Buyer Name',contact:'+919999999999',email:'buyer@example.com',addressLine1:'House 1',city:'Delhi',state:'Delhi'},
  weightGrams:600,codAmountMinor:0,declaredValueMinor:100000,currency:'INR',idempotencyKey:'job-1',
  items:[{name:'Kurta',sku:'K1',quantity:1,unitPrice:1000}],
 };
 const result=await adapter.createShipment(request,{email:'seller@example.com',password:'password'});
 assert.equal(result.awbNumber,'SR123');assert.equal(result.pickupScheduled,true);
 assert.equal(result.manifestUrl,'https://carrier.test/manifest.pdf');
 assert.ok(calls.some(url=>url.endsWith('/courier/generate/pickup')));
 assert.ok(calls.some(url=>url.endsWith('/manifests/generate')));
});
