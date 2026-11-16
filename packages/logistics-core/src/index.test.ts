import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, scoreCarriers, encryptCredentials, decryptCredentials, verifyHmacSha256 } from './index.js';
import crypto from 'node:crypto';

test('shipment transitions allow forward skips and repeated carrier scans but reject regression',()=>{
 assert.equal(canTransition('CREATED','IN_TRANSIT'),true);
 assert.equal(canTransition('IN_TRANSIT','DELIVERED'),true);
 assert.equal(canTransition('DELIVERED','IN_TRANSIT'),false);
 assert.equal(canTransition('IN_TRANSIT','IN_TRANSIT'),true);
 assert.equal(canTransition('RTO_INITIATED','RTO_DELIVERED'),true);
});

test('carrier scoring excludes unavailable services and prefers cheaper/faster services',()=>{
 const scored=scoreCarriers([
  {providerCode:'a',serviceCode:'slow',costMinor:900,estimatedTransitHours:96,historicalRtoRate:0.5,sellerPriority:100,serviceable:true,currency:'INR'},
  {providerCode:'b',serviceCode:'fast',costMinor:500,estimatedTransitHours:48,historicalRtoRate:0.5,sellerPriority:50,serviceable:true,currency:'INR'},
  {providerCode:'c',serviceCode:'blocked',costMinor:1,estimatedTransitHours:1,historicalRtoRate:0.1,sellerPriority:1,serviceable:false,currency:'INR'},
 ],{cost:0.45,transit:0.35,rto:0,priority:0.2});
 assert.equal(scored.length,2);assert.equal(scored[0].providerCode,'b');
});

test('credential envelopes encrypt, decrypt and reject tampering',()=>{
 const key=Buffer.alloc(32,7);const envelope=encryptCredentials('carrier-secret',key);
 assert.equal(decryptCredentials(envelope,key),'carrier-secret');
 const tampered=Buffer.from(envelope);tampered[tampered.length-1]^=1;
 assert.throws(()=>decryptCredentials(tampered,key));
});

test('webhook HMAC uses constant-time validated hex signature',()=>{
 const raw=Buffer.from('{"awb":"A1"}');const secret='secret';
 const signature=crypto.createHmac('sha256',secret).update(raw).digest('hex');
 assert.equal(verifyHmacSha256(raw,signature,secret),true);
 assert.equal(verifyHmacSha256(raw,signature,'wrong'),false);
 assert.equal(verifyHmacSha256(raw,'bad',secret),false);
});
