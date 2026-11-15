import type { InputHTMLAttributes, ReactNode } from 'react';
export function FormField({label,hint,children}:{label:string;hint?:string;children:ReactNode}){return <label className="grid gap-1.5 text-sm font-medium text-stone-800"><span>{label}</span>{children}{hint&&<span className="text-xs font-normal text-stone-500">{hint}</span>}</label>}
export type SharedInputProps=InputHTMLAttributes<HTMLInputElement>;
