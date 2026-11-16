export type CarrierArm = { id: string; cost: number; transitHours: number; rtoRate: number; sellerPriority: number; serviceable: boolean };
export type CarrierWeights = { cost: number; transit: number; rto: number; sellerPriority: number };
export type CarrierFeedback = { attempts: number; successful: number; rto: number };
export type RankedCarrier = CarrierArm & { topsisScore: number; selectionScore: number; explored: boolean };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** TOPSIS ranks candidates; epsilon-greedy adds controlled exploration using observed delivery feedback. */
export function rankCarriersHybrid(
  candidates: readonly CarrierArm[],
  weights: CarrierWeights,
  feedback: Readonly<Record<string, CarrierFeedback>>,
  options: { epsilon?: number; random?: () => number } = {},
): RankedCarrier[] {
  const eligible = candidates.filter(c => c.serviceable && c.cost >= 0 && c.transitHours >= 0 && c.rtoRate >= 0 && c.rtoRate <= 1);
  const sum = weights.cost + weights.transit + weights.rto + weights.sellerPriority;
  if (!Number.isFinite(sum) || sum <= 0 || Object.values(weights).some(v => !Number.isFinite(v) || v < 0)) throw new Error("INVALID_CARRIER_WEIGHTS");
  if (!eligible.length) return [];
  const epsilon = clamp01(options.epsilon ?? 0.08), random = options.random ?? Math.random;
  const criteria: Array<{ key: keyof CarrierWeights; value: (c: CarrierArm) => number; benefit: boolean }> = [
    { key: "cost", value: c => c.cost, benefit: false },
    { key: "transit", value: c => c.transitHours, benefit: false },
    { key: "rto", value: c => c.rtoRate, benefit: false },
    { key: "sellerPriority", value: c => c.sellerPriority, benefit: false },
  ];
  const norms = criteria.map(k => Math.sqrt(eligible.reduce((s,c)=>s+k.value(c)**2,0)) || 1);
  const weighted = eligible.map(c => criteria.map((k,i)=>k.value(c)/norms[i]*weights[k.key]/sum));
  const idealBest = criteria.map((k,i)=>k.benefit?Math.max(...weighted.map(v=>v[i])):Math.min(...weighted.map(v=>v[i])));
  const idealWorst = criteria.map((k,i)=>k.benefit?Math.min(...weighted.map(v=>v[i])):Math.max(...weighted.map(v=>v[i])));
  const ranked = eligible.map((c,index)=>{
    const dBest=Math.sqrt(weighted[index].reduce((s,v,i)=>s+(v-idealBest[i])**2,0));
    const dWorst=Math.sqrt(weighted[index].reduce((s,v,i)=>s+(v-idealWorst[i])**2,0));
    const topsisScore=dWorst/(dBest+dWorst||1);
    const f=feedback[c.id]||{attempts:0,successful:0,rto:0};
    const reward=f.attempts>0?clamp01((f.successful-f.rto)/f.attempts):0.5;
    return {...c,topsisScore,selectionScore:0.75*topsisScore+0.25*reward,explored:false};
  }).sort((a,b)=>b.selectionScore-a.selectionScore||a.id.localeCompare(b.id));
  if(ranked.length>1 && random()<epsilon){
    const pool=ranked.slice(1);
    const chosen=pool[Math.floor(random()*pool.length)];
    return [{...chosen,explored:true},...ranked.filter(x=>x.id!==chosen.id)];
  }
  return ranked;
}

/** Redis EVAL script: fixed-window token bucket, atomic across app replicas. */
export const TOKEN_BUCKET_LUA = `
local key=KEYS[1]
local now=tonumber(ARGV[1]); local capacity=tonumber(ARGV[2])
local refill=tonumber(ARGV[3]); local cost=tonumber(ARGV[4])
local ttl=tonumber(ARGV[5])
local state=redis.call('HMGET',key,'tokens','updated')
local tokens=tonumber(state[1]) or capacity
local updated=tonumber(state[2]) or now
tokens=math.min(capacity,tokens+math.max(0,now-updated)*refill)
local allowed=0
if tokens>=cost then tokens=tokens-cost; allowed=1 end
redis.call('HSET',key,'tokens',tokens,'updated',now)
redis.call('EXPIRE',key,ttl)
return {allowed,tokens}
`;

/** Redis EVAL lease: decrement only when enough stock remains; lease auto-expires. */
export const INVENTORY_LEASE_LUA = `
local stockKey=KEYS[1]; local leaseKey=KEYS[2]
local quantity=tonumber(ARGV[1]); local leaseId=ARGV[2]; local ttl=tonumber(ARGV[3])
if redis.call('EXISTS',leaseKey)==1 then return {'REPLAY',redis.call('GET',leaseKey)} end
local stock=tonumber(redis.call('GET',stockKey) or '-1')
if stock<quantity then return {'INSUFFICIENT',stock} end
local remaining=redis.call('DECRBY',stockKey,quantity)
redis.call('SET',leaseKey,quantity..':'..remaining,'EX',ttl,'NX')
return {'RESERVED',remaining}
`;

/** Bloom filter is a hint only. A positive MUST still be checked against durable idempotency storage. */
export class BloomHint {
  private bits: Uint8Array;
  constructor(sizeBits=8192, private hashes=5) { if(sizeBits<8||hashes<1)throw new Error("INVALID_BLOOM_CONFIG"); this.bits=new Uint8Array(Math.ceil(sizeBits/8)); }
  private positions(value:string):number[]{let h1=2166136261,h2=0x9e3779b9;for(let i=0;i<value.length;i++){h1=Math.imul(h1^value.charCodeAt(i),16777619);h2=Math.imul(h2^value.charCodeAt(i),2246822519);}return Array.from({length:this.hashes},(_,i)=>Math.abs((h1+i*h2)>>>0)%(this.bits.length*8));}
  has(value:string):boolean{return this.positions(value).every(p=>(this.bits[p>>3]&(1<<(p&7)))!==0);}
  add(value:string):void{for(const p of this.positions(value))this.bits[p>>3]|=1<<(p&7);}
}

/** Decorrelated jitter: random delay in [base, min(cap, previous*3)]. */
export function decorrelatedJitter(previousMs:number, baseMs=250, capMs=30000, random=Math.random):number {
  if(previousMs<0||baseMs<1||capMs<baseMs)throw new Error("INVALID_RETRY_CONFIG");
  return Math.floor(Math.min(capMs,baseMs+random()*(Math.max(baseMs,previousMs*3)-baseMs)));
}

export class SlidingWindowCircuitBreaker {
  private failures:number[]=[];
  private openedUntil=0;
  constructor(private threshold=5,private windowMs=30000,private cooldownMs=15000,private now=()=>Date.now()){}
  async execute<T>(operation:()=>Promise<T>):Promise<T>{
    const t=this.now();
    if(t<this.openedUntil)throw new Error("CIRCUIT_OPEN");
    this.failures=this.failures.filter(x=>t-x<=this.windowMs);
    try{const result=await operation();this.failures=[];this.openedUntil=0;return result;}
    catch(error){this.failures.push(t);if(this.failures.length>=this.threshold)this.openedUntil=t+this.cooldownMs;throw error;}
  }
}

export interface InventoryLeaseStore {
  reserveAtomic(input:{tenantId:string;sku:string;quantity:number;leaseId:string;ttlSeconds:number}):Promise<"RESERVED"|"INSUFFICIENT"|"REPLAY">;
  commit(input:{leaseId:string;orderId:string}):Promise<void>;
  release(input:{leaseId:string}):Promise<void>;
}
export interface CheckoutStep<T> { name:string; run(context:T):Promise<void>; compensate(context:T):Promise<void> }
/** Orchestrated saga. Compensation runs in reverse order and never masks the original failure. */
export async function runSaga<T>(context:T,steps:readonly CheckoutStep<T>[]):Promise<void>{
  const completed:CheckoutStep<T>[]=[];
  try{for(const step of steps){await step.run(context);completed.push(step);}}
  catch(error){for(const step of completed.reverse()){try{await step.compensate(context);}catch{/* persist compensation failure to an outbox in the concrete adapter */}}throw error;}
}

export type InventoryLine = { productId: string; variantSku?: string; quantity: number };
export type InventoryReservationGroup = { productId: string; quantity: number; variants: Array<{ variantSku: string; quantity: number }> };

/** Coalesces duplicate cart lines so each SKU is conditionally reserved once per checkout. */
export function aggregateInventoryLines(lines: readonly InventoryLine[]): InventoryReservationGroup[] {
  const products = new Map<string, { quantity: number; variants: Map<string, number> }>();
  for (const line of lines) {
    if (!line.productId || !Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new Error("INVALID_INVENTORY_LINE");
    const current = products.get(line.productId) || { quantity: 0, variants: new Map<string, number>() };
    current.quantity += line.quantity;
    if (line.variantSku) current.variants.set(line.variantSku, (current.variants.get(line.variantSku) || 0) + line.quantity);
    products.set(line.productId, current);
  }
  return [...products.entries()].map(([productId, value]) => ({
    productId, quantity: value.quantity,
    variants: [...value.variants.entries()].map(([variantSku, quantity]) => ({ variantSku, quantity })),
  }));
}
