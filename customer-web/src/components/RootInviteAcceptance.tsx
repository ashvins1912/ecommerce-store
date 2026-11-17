import { useEffect, useState } from 'react';
import type { User } from '../shared/types';
import { apiFetch, setClientSessionTokens } from '../lib/api';

type InviteInfo={email:string;role:'ADMIN'|'SELLER'|'PROVIDER';expiresAt:string};
type Props={user:User|null;onRequireAuth:()=>void;onAccepted:(user:User)=>void};
export function RootInviteAcceptance({user,onRequireAuth,onAccepted}:Props){
  const token=new URLSearchParams(window.location.search).get('rootInvite')||'';
  const [invite,setInvite]=useState<InviteInfo|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [storeName,setStoreName]=useState('');
  const [description,setDescription]=useState('');
  const [whatsappNumber,setWhatsappNumber]=useState('');
  const [businessName,setBusinessName]=useState('');
  const [contactPerson,setContactPerson]=useState('');
  const [mobile,setMobile]=useState('');
  const [whatsapp,setWhatsapp]=useState('');
  const [warehouseAddress,setWarehouseAddress]=useState('');
  const [taxId,setTaxId]=useState('');
  const [settlementDetails,setSettlementDetails]=useState('');
  useEffect(()=>{if(!token)return;apiFetch<InviteInfo>('/api/root/invites/validate?token='+encodeURIComponent(token)).then(setInvite).catch(e=>setError((e as Error).message));},[token]);
  if(!token||!user)return null;
  const close=()=>{const url=new URL(window.location.href);url.searchParams.delete('rootInvite');window.history.replaceState({},'',url.toString());setInvite(null);};
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(!user){onRequireAuth();return;}if(user.email.toLowerCase()!==invite?.email.toLowerCase()){setError('Sign in using the email address this invitation was issued to.');return;}setBusy(true);setError('');try{await apiFetch('/api/root/invites/accept',{method:'POST',body:JSON.stringify({token,storeName,description,whatsappNumber,businessName,contactPerson,mobile,whatsapp,warehouseAddress,taxId,settlementDetails})});const session=await apiFetch<any>('/api/auth/me');setClientSessionTokens(session.accessToken,session.csrfToken);onAccepted(session.user);close();}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  return <div className="fixed inset-0 z-[160] flex items-center justify-center overflow-y-auto bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="root-invite-heading"><form onSubmit={submit} className="my-6 max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-3"><div><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-900">Private role invitation</span><h2 id="root-invite-heading" className="mt-3 text-xl font-semibold">Join Kala & Karat</h2>{invite&&<p className="mt-1 text-xs text-stone-500">Invited as {invite.role} · {invite.email} · expires {new Date(invite.expiresAt).toLocaleDateString()}</p>}</div><button type="button" onClick={close} aria-label="Close invitation" className="rounded border px-2 py-1">×</button></div>
  {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
  {!invite&&!error?<p className="text-sm text-stone-500">Validating invitation…</p>:null}
  {invite&&!user&&<div className="space-y-3"><p className="text-sm text-stone-700">Sign in or create a customer account using <strong>{invite.email}</strong>. The invitation is applied only after the email matches.</p><button type="button" onClick={onRequireAuth} className="w-full rounded-lg bg-stone-900 px-4 py-3 text-sm font-semibold text-white">Sign in / create account</button></div>}
  {invite&&user&&user.email.toLowerCase()!==invite.email.toLowerCase()&&<div className="space-y-2"><p className="text-sm text-red-800">You are signed in as {user.email}. Sign out and sign in using {invite.email} to accept this invitation.</p><button type="button" onClick={onRequireAuth} className="rounded-lg border px-3 py-2 text-xs">Switch account</button></div>}
  {invite&&user&&user.email.toLowerCase()===invite.email.toLowerCase()&&<div className="space-y-3">
    {invite.role==='SELLER'&&<><label className="block text-xs font-semibold">Store / business name<input required minLength={2} value={storeName} onChange={e=>setStoreName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"/></label><label className="block text-xs font-semibold">Store description<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={1000} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"/></label><label className="block text-xs font-semibold">WhatsApp number (verification remains pending)<input value={whatsappNumber} onChange={e=>setWhatsappNumber(e.target.value)} placeholder="+91…" className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"/></label><p className="text-[11px] text-stone-500">Seller listing and sensitive actions remain restricted until the normal WhatsApp verification is completed.</p></>}
    {invite.role==='PROVIDER'&&<><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Business name<input required value={businessName} onChange={e=>setBusinessName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"/></label><label className="text-xs font-semibold">Contact person<input required value={contactPerson} onChange={e=>setContactPerson(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"/></label><label className="text-xs font-semibold">Mobile<input required value={mobile} onChange={e=>setMobile(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"/></label><label className="text-xs font-semibold">WhatsApp<input value={whatsapp} onChange={e=>setWhatsapp(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"/></label></div><label className="block text-xs font-semibold">Warehouse address<textarea required minLength={8} value={warehouseAddress} onChange={e=>setWarehouseAddress(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"/></label><label className="block text-xs font-semibold">Tax / GST identifier<input required value={taxId} onChange={e=>setTaxId(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"/></label><label className="block text-xs font-semibold">Settlement / bank details<input required value={settlementDetails} onChange={e=>setSettlementDetails(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"/></label><p className="text-[11px] text-stone-500">Tax and settlement details are encrypted at rest. Provider onboarding starts in pending KYC status.</p></>}
    {invite.role==='ADMIN'&&<p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">This invitation grants the standard administrator role, not root-superuser access.</p>}
    <button disabled={busy} className="w-full rounded-lg bg-stone-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy?'Activating…':'Accept invitation'}</button>
  </div>}
  <p className="text-[10px] leading-4 text-stone-400">One-time invitation. Role changes are recorded in the platform audit trail. Root access can never be granted through this link.</p>
  </form></div>;
}
