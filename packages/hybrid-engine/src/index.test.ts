import test from "node:test";
import assert from "node:assert/strict";
import { aggregateInventoryLines, BloomHint, buildMerkleSnapshot, decorrelatedJitter, diffMerkleSnapshots, LRUKCache, rankCarriersHybrid, runSaga, SingleFlight, SlidingWindowCircuitBreaker } from "./index.js";

test("TOPSIS plus epsilon-greedy ranks serviceable carriers and explores deterministically",()=>{
 const candidates=[
  {id:"a",cost:100,transitHours:24,rtoRate:.05,sellerPriority:1,serviceable:true},
  {id:"b",cost:80,transitHours:36,rtoRate:.1,sellerPriority:2,serviceable:true},
  {id:"c",cost:1,transitHours:1,rtoRate:0,sellerPriority:0,serviceable:false},
 ];
 const weights={cost:.4,transit:.3,rto:.2,sellerPriority:.1};
 const feedback={a:{attempts:10,successful:9,rto:0},b:{attempts:10,successful:5,rto:3}};
 const baseline=rankCarriersHybrid(candidates,weights,feedback,{epsilon:0,random:()=>0});
 const result=rankCarriersHybrid(candidates,weights,feedback,{epsilon:1,random:()=>0});
 assert.equal(result.length,2); assert.equal(result[0].explored,true); assert.notEqual(result[0].id,baseline[0].id);
});
test("Bloom hint remembers inserted event IDs",()=>{const b=new BloomHint();b.add("evt-1");assert.equal(b.has("evt-1"),true);});
test("decorrelated jitter stays within cap",()=>{assert.equal(decorrelatedJitter(1000,100,2000,()=>1),2000);});
test("circuit breaker opens after sliding-window failures",async()=>{let now=100;const b=new SlidingWindowCircuitBreaker(2,1000,500,()=>now);await assert.rejects(()=>b.execute(async()=>{throw Error("x")}));await assert.rejects(()=>b.execute(async()=>{throw Error("x")}));await assert.rejects(()=>b.execute(async()=>1),/CIRCUIT_OPEN/);now=700;assert.equal(await b.execute(async()=>1),1);});
test("saga compensates completed steps in reverse order",async()=>{const calls:string[]=[];const ctx={};await assert.rejects(()=>runSaga(ctx,[{name:"a",run:async()=>{calls.push("a+")},compensate:async()=>{calls.push("a-")}},{name:"b",run:async()=>{throw Error("failed")},compensate:async()=>{calls.push("b-")}}]));assert.deepEqual(calls,["a+","a-"]);});

test("inventory lines aggregate product and variant quantities",()=>{
 const groups=aggregateInventoryLines([
  {productId:"p1",variantSku:"red-s",quantity:2},
  {productId:"p1",variantSku:"red-s",quantity:3},
  {productId:"p1",variantSku:"blue-m",quantity:1},
  {productId:"p2",quantity:4},
 ]);
 assert.deepEqual(groups,[
  {productId:"p1",quantity:6,variants:[{variantSku:"red-s",quantity:5},{variantSku:"blue-m",quantity:1}]},
  {productId:"p2",quantity:4,variants:[]},
 ]);
});
test("inventory aggregation rejects invalid quantities",()=>{
 assert.throws(()=>aggregateInventoryLines([{productId:"p1",quantity:0}]),/INVALID_INVENTORY_LINE/);
});

test("LRU-K evicts cold entries before established hot entries",()=>{
 let now=0;const cache=new LRUKCache<string>(2,2,()=>now);
 cache.set("hot","H",1000);cache.get("hot");
 cache.set("cold","C",1000);
 cache.get("hot");
 cache.set("new","N",1000);
 assert.equal(cache.get("hot"),"H");
 assert.equal(cache.get("cold"),undefined);
 assert.equal(cache.get("new"),"N");
 now=2000;assert.equal(cache.get("hot"),undefined);
});
test("single-flight coalesces concurrent loads by key",async()=>{
 const flight=new SingleFlight();let calls=0;
 const loader=async()=>{calls++;await Promise.resolve();return 42;};
 const [a,b]=await Promise.all([flight.run("same",loader),flight.run("same",loader)]);
 assert.equal(a,42);assert.equal(b,42);assert.equal(calls,1);
});
test("Merkle snapshots report added, changed and deleted records deterministically",()=>{
 const before=buildMerkleSnapshot([{id:"a",value:{x:1,y:2}},{id:"b",value:{x:2}}]);
 const after=buildMerkleSnapshot([{id:"a",value:{y:2,x:1}},{id:"b",value:{x:3}},{id:"c",value:{x:4}}]);
 assert.deepEqual(diffMerkleSnapshots(before,after),{added:["c"],updated:["b"],deleted:[]});
 assert.equal(before.root,buildMerkleSnapshot([{id:"b",value:{x:2}},{id:"a",value:{y:2,x:1}}]).root);
});
