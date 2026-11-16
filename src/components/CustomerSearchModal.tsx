import { useEffect, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { apiFetch } from '../lib/api';

export interface AssignableCustomer {
  _id: string;
  puid: string;
  name: string;
  email: string;
  mobileNumber?: string;
}

interface CustomerSearchModalProps {
  open: boolean;
  selected: AssignableCustomer[];
  onClose: () => void;
  onChange: (customers: AssignableCustomer[]) => void;
}

export function CustomerSearchModal({ open, selected, onClose, onChange }: CustomerSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AssignableCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setLoading(false);
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiFetch<{ customers: AssignableCustomer[] }>('/api/seller/customers/search?q=' + encodeURIComponent(query.trim()));
        if (!cancelled) setResults(data.customers || []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, query]);

  if (!open) return null;
  const toggle = (customer: AssignableCustomer) => {
    const exists = selected.some((item) => item._id === customer._id);
    onChange(exists ? selected.filter((item) => item._id !== customer._id) : [...selected, customer]);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Assign customers">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-xl space-y-4 overflow-y-auto overscroll-contain rounded-xl bg-white p-4 sm:p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <div><h3 className="text-lg font-semibold">Assign specific customers</h3><p className="text-xs text-[#78716C]">Search by name, PUID, email or mobile number.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-2 hover:bg-[#F5F5F4]"><X className="h-4 w-4"/></button>
        </div>
        <div className="flex items-center gap-2 rounded-md border px-3">
          <Search className="h-4 w-4 text-[#78716C]"/>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customer…" className="w-full py-3 text-sm outline-none"/>
        </div>
        {selected.length > 0 && <p className="text-xs text-[#57534E]">{selected.length} customer(s) selected</p>}
        {loading && <p className="text-xs text-[#78716C]">Searching…</p>}
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        <div className="max-h-72 overflow-y-auto divide-y">
          {results.map((customer) => {
            const active = selected.some((item) => item._id === customer._id);
            return <button type="button" key={customer._id} onClick={() => toggle(customer)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-[#FAF9F6] px-2">
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{customer.name}</span><span className="block truncate text-xs text-[#78716C]">{customer.mobileNumber || customer.email} · PUID {customer.puid}</span></span>
              <span className={active ? "rounded-full bg-[#881337] p-1 text-white" : "rounded-full border p-1 text-transparent"}><Check className="h-3 w-3"/></span>
            </button>;
          })}
          {!loading && query.trim().length >= 2 && results.length === 0 && !error && <p className="py-6 text-center text-xs text-[#78716C]">No matching customers.</p>}
        </div>
        <div className="flex justify-end"><button type="button" onClick={onClose} className="rounded-md bg-[#881337] px-4 py-2 text-xs font-semibold text-white">Done</button></div>
      </div>
    </div>
  );
}
