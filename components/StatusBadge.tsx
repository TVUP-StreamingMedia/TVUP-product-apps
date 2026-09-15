
import React from 'react';
import { IdeaStatus, InitiativeStatus } from '../types';
import { useLanguage } from '../context/LanguageContext';

export const StatusBadge: React.FC<{ status: IdeaStatus | InitiativeStatus }> = ({ status }) => {
  const { t } = useLanguage();
  
  const styles: Record<string, string> = { 
    'draft': 'bg-slate-100 text-slate-600', 
    'pending': 'bg-amber-100 text-amber-700', 
    'submitted': 'bg-amber-100 text-amber-700', 
    'reviewing': 'bg-blue-100 text-blue-700', 
    'approved': 'bg-emerald-100 text-emerald-700', 
    'rejected': 'bg-rose-100 text-rose-700',
    'ready_for_roadmap': 'bg-indigo-100 text-indigo-700'
  };

  // Try to get translation from initiatives.status or product.status (for seeds)
  const normalizedStatus = status.toLowerCase();
  const label = (t.initiatives.status as any)[normalizedStatus] || (t.product as any)[normalizedStatus] || status;

  return <span className={`text-[9px] uppercase font-black px-3 py-1.5 rounded-full tracking-widest shadow-sm ${styles[normalizedStatus] || 'bg-slate-100 text-slate-600'}`}>{label}</span>;
};
