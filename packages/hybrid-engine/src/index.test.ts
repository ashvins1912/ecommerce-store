import test from "node:test";
import assert from "node:assert/strict";
import { BloomHint, decorrelatedJitter, rankCarriersHybrid, runSaga, SlidingWindowCircuitBreaker } from "./index.js";

test("TOPSIS plus epsilon-greedy ranks serviceable carriers and explores deterministically",()=>{
 const result=rankCarriersHybrid([
  {id:"a",cost:100,transitHours:24,rtoRate:.05,sellerPriority:1,serviceable:true},
  {id:"b",cost:80,transitHours:36,rtoRate:.1,sellerPriority:2,serviceable:true},
  {id:"c",cost:1,transitHours:1,rtoRate:0,sellerPriority:0,serviceable:false},
 ],{cost:.4,transit:.3,rto:.2,sellerPriority:.1},{a:{attempts:10,successful:9,rto:0},b:{attempts:10,successful:5,rto:3}},{epsilon:1,random:()=>0});
 assert.equal(result.length,2); assert.equal(result[0].id,"b"); assert.equal(result[0].explored,true);
});
test("Bloom hint remembers inserted event IDs",()=>{const b=new BloomHint();b.add("evt-1");assert.equal(b.has("evt-1"),true);});
test("decorrelated jitter stays within cap",()=>{assert.equal(decorrelatedJitter(1000,100,2000,()=>1),2000);});
test("circuit breaker opens after sliding-window failures",async()=>{let now=100;const b=new SlidingWindowCircuitBreaker(2,1000,500,()=>now);await assert.rejects(()=>b.execute(async()=>{throw Error("x")}));await assert.rejects(()=>b.execute(async()=>{throw Error("x")}));await assert.rejects(()=>b.execute(async()=>1),/CIRCUIT_OPEN/);now=700;assert.equal(await b.execute(async()=>1),1);});
test("saga compensates completed steps in reverse order",async()=>{const calls:string[]=[];const ctx={};await assert.rejects(()=>runSaga(ctx,[{name:"a",run:async()=>{calls.push("a+")},compensate:async()=>{calls.push("a-")}},{name:"b",run:async()=>{throw Error("failed")},compensate:async()=>{calls.push("b-")}}]));assert.deepEqual(calls,["a+","a-"]);});
