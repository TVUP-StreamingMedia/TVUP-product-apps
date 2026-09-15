
import React, { useState, useEffect } from 'react';
import { Idea, IdeaStatus, Level, MoSCoW, User, UserRole } from '@/types';
import { getConsensusScore, getVoteCount, hasUserVoted } from '@/utils/ideaUtils';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { formatToDDMMYYYY } from '../utils/dateUtils';
import { IdeaDetail, getMoSCoWFromScore, getMoSCoWColor } from './IdeaDetail';
import { db } from '../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { generateSeedPPT } from '../utils/generateSeedPPT';

interface SeedPanelProps {
  allIdeas: Idea[];
  onDeleteIdea: (id: string) => Promise<void>;
  onUpdateIdea?: (idea: Idea) => Promise<void>;
}

const SeedPanel: React.FC<SeedPanelProps> = ({ allIdeas, onDeleteIdea, onUpdateIdea }) => {
  const { lang, t } = useLanguage();
  const { users } = useAuth();
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [datePreset, setDatePreset] = useState<string>('last_30_days');
  const [dateFilter, setDateFilter] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - 30);
    return {
      start: start.toISOString().split('T')[0],
      end: now.toISOString().split('T')[0]
    };
  });
  const [isDirty, setIsDirty] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isDirty) {
          setShowCloseConfirm(true);
        } else {
          setSelectedIdea(null);
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isDirty, lang]);

  const filterByDate = (ideas: Idea[]) => {
    return ideas.filter(idea => {
      if (!dateFilter.start && !dateFilter.end) return true;
      const ideaDateStr = idea.date.split('T')[0];
      const start = dateFilter.start || '0000-00-00';
      const end = dateFilter.end || '9999-12-31';
      return ideaDateStr >= start && ideaDateStr <= end;
    });
  };

  const sortByDate = (a: Idea, b: Idea) => {
    const dateA = a.updatedAt || a.date;
    const dateB = b.updatedAt || b.date;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  };

  const handlePredefinedDateChange = (option: string) => {
    setDatePreset(option);
    if (!option) {
      setDateFilter({ start: '', end: '' });
      return;
    }

    const now = new Date();
    let start = new Date();
    let end = new Date();

    switch (option) {
      case 'last_week':
        start.setDate(now.getDate() - 7);
        break;
      case 'last_30_days':
        start.setDate(now.getDate() - 30);
        break;
      case 'last_month':
        start.setMonth(now.getMonth() - 1);
        break;
      case 'last_quarter':
        start.setMonth(now.getMonth() - 3);
        break;
      case 'last_year':
        start.setFullYear(now.getFullYear() - 1);
        break;
      case 'ytd':
        start = new Date(now.getFullYear(), 0, 1);
        break;
    }
    
    setDateFilter({
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    });
  };

  const approved = filterByDate(allIdeas.filter(i => i.status === IdeaStatus.APPROVED)).sort(sortByDate);
  const pending = filterByDate(allIdeas.filter(i => i.status === IdeaStatus.PENDING || i.status === IdeaStatus.REVIEWING)).sort(sortByDate);
  const rejected = filterByDate(allIdeas.filter(i => i.status === IdeaStatus.REJECTED)).sort(sortByDate);

  const handleUpdateIdea = async (updatedIdea: Idea) => {
    const score = getConsensusScore(updatedIdea, users);
    const voteCount = getVoteCount(updatedIdea, users);
    const finalIdea = { ...updatedIdea, consensusScore: score, voteCount };
    
    if (onUpdateIdea) {
      await onUpdateIdea(finalIdea);
    } else {
      await setDoc(doc(db, 'ideas', finalIdea.id), finalIdea);
    }
    
    if (selectedIdea?.id === finalIdea.id) {
      setSelectedIdea(finalIdea);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 relative">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">{t.nav.seedPanel}</h1>
          <p className="text-slate-500 font-medium mt-1">{lang === 'es' ? 'Visión global de todas las iniciativas' : 'Global overview of all initiatives'}</p>
        </div>

        {/* Date Filter Widget */}
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 flex-wrap">
          <div className="flex flex-col">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{lang === 'es' ? 'Rango' : 'Range'}</label>
            <select 
              value={datePreset}
              onChange={(e) => handlePredefinedDateChange(e.target.value)}
              className="text-xs font-bold text-slate-600 outline-none focus:text-orange-600 transition-colors bg-transparent cursor-pointer"
            >
              <option value="">{lang === 'es' ? 'Personalizado' : 'Custom'}</option>
              <option value="last_week">{lang === 'es' ? 'Última semana' : 'Last week'}</option>
              <option value="last_30_days">{lang === 'es' ? 'Últimos 30 días' : 'Last 30 days'}</option>
              <option value="last_month">{lang === 'es' ? 'Último mes' : 'Last month'}</option>
              <option value="last_quarter">{lang === 'es' ? 'Último trimestre' : 'Last quarter'}</option>
              <option value="last_year">{lang === 'es' ? 'Último año' : 'Last year'}</option>
              <option value="ytd">{lang === 'es' ? 'Desde inicio de año' : 'Year to date'}</option>
            </select>
          </div>
          <div className="w-px h-8 bg-slate-100 hidden sm:block" />
          <div className="flex flex-col">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{lang === 'es' ? 'Desde' : 'From'}</label>
            <input 
              type="date" 
              value={dateFilter.start}
              onChange={(e) => { setDateFilter(prev => ({ ...prev, start: e.target.value })); setDatePreset(''); }}
              className="text-xs font-bold text-slate-600 outline-none focus:text-orange-600 transition-colors"
            />
          </div>
          <div className="w-px h-8 bg-slate-100" />
          <div className="flex flex-col">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{lang === 'es' ? 'Hasta' : 'To'}</label>
            <input 
              type="date" 
              value={dateFilter.end}
              onChange={(e) => { setDateFilter(prev => ({ ...prev, end: e.target.value })); setDatePreset(''); }}
              className="text-xs font-bold text-slate-600 outline-none focus:text-orange-600 transition-colors"
            />
          </div>
          {(dateFilter.start || dateFilter.end) && (
            <button 
              onClick={() => { setDateFilter({ start: '', end: '' }); setDatePreset(''); }}
              className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Column 1: Approved */}
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-emerald-100 pb-4">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-600 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              {lang === 'es' ? 'APROBADAS' : 'APPROVED'}
            </h3>
            <span className="bg-emerald-50 text-emerald-600 text-[10px] font-black px-2 py-1 rounded-lg">{approved.length}</span>
          </div>
          <div className="space-y-4">
            {approved.map(idea => <SeedCard key={idea.id} idea={idea} users={users} onView={() => setSelectedIdea(idea)} />)}
            {approved.length === 0 && <EmptyState label={lang === 'es' ? 'Sin seeds aprobadas' : 'No approved seeds'} />}
          </div>
        </div>

        {/* Column 2: Pending */}
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-orange-100 pb-4">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-orange-600 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              {lang === 'es' ? 'PENDIENTES DE REVIEW' : 'PENDING REVIEW'}
            </h3>
            <span className="bg-orange-50 text-orange-600 text-[10px] font-black px-2 py-1 rounded-lg">{pending.length}</span>
          </div>
          <div className="space-y-4">
            {pending.map(idea => <SeedCard key={idea.id} idea={idea} users={users} onView={() => setSelectedIdea(idea)} />)}
            {pending.length === 0 && <EmptyState label={lang === 'es' ? 'Sin seeds pendientes' : 'No pending seeds'} />}
          </div>
        </div>

        {/* Column 3: Parking Lot */}
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-rose-100 pb-4">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-rose-600 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-rose-500" />
              {lang === 'es' ? 'PARKING LOT' : 'PARKING LOT'}
            </h3>
            <span className="bg-rose-50 text-rose-600 text-[10px] font-black px-2 py-1 rounded-lg">{rejected.length}</span>
          </div>
          <div className="space-y-4">
            {rejected.map(idea => <SeedCard key={idea.id} idea={idea} users={users} onView={() => setSelectedIdea(idea)} />)}
            {rejected.length === 0 && <EmptyState label={lang === 'es' ? 'Sin seeds en parking lot' : 'No seeds in parking lot'} />}
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedIdea && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-6xl rounded-[3rem] shadow-2xl relative overflow-hidden flex flex-col max-h-full">
            <button 
              onClick={() => {
                if (isDirty) {
                  setShowCloseConfirm(true);
                } else {
                  setSelectedIdea(null);
                }
              }}
              className="absolute top-8 right-8 z-[110] w-12 h-12 bg-white/80 backdrop-blur-md rounded-2xl flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-white shadow-xl transition-all"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="p-4 md:p-10 overflow-y-auto">
              <IdeaDetail 
                idea={selectedIdea} 
                users={users} 
                onDirtyChange={setIsDirty}
                onVote={async (vote) => {
                  const votes = selectedIdea.votes || [];
                  const newVotes = votes.filter(v => v.userId !== vote.userId);
                  await handleUpdateIdea({ ...selectedIdea, votes: [...newVotes, vote] });
                  setIsDirty(false);
                }} 
                onDeleteVote={async (userId) => {
                  const votes = selectedIdea.votes || [];
                  const newVotes = votes.filter(v => v.userId !== userId);
                  await handleUpdateIdea({ ...selectedIdea, votes: newVotes });
                }}
                onStatusChange={status => handleUpdateIdea({ ...selectedIdea, status, updatedAt: new Date().toISOString() })}
                onTypeChange={seedType => handleUpdateIdea({ ...selectedIdea, data: { ...selectedIdea.data, seedType }, updatedAt: new Date().toISOString() })}
                onDelete={async (id) => {
                  await onDeleteIdea(id);
                  setSelectedIdea(null);
                  setIsDirty(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
      {/* Close Confirmation Modal */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-10 text-center">
              <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-4">{lang === 'es' ? '¿Salir sin guardar?' : 'Exit without saving?'}</h3>
              <p className="text-slate-500 font-medium mb-8">
                {lang === 'es' ? 'Tienes cambios sin guardar. ¿Seguro que quieres salir y perder los cambios?' : 'You have unsaved changes. Are you sure you want to exit and lose them?'}
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => {
                    setSelectedIdea(null);
                    setIsDirty(false);
                    setShowCloseConfirm(false);
                  }} 
                  className="w-full py-4 bg-amber-500 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-amber-600 transition-all"
                >
                  {lang === 'es' ? 'Salir y perder cambios' : 'Exit and lose changes'}
                </button>
                <button 
                  onClick={() => setShowCloseConfirm(false)} 
                  className="w-full py-4 bg-slate-100 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all"
                >
                  {t.common.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SeedCard: React.FC<{ idea: Idea; users: User[]; onView: () => void }> = ({ idea, users, onView }) => {
  const { lang, t } = useLanguage();
  const { user } = useAuth();
  const score = getConsensusScore(idea, users);
  const voteCount = getVoteCount(idea, users);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const hasVoted = hasUserVoted(idea, user);

  const handleDownloadPPT = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setDownloadingId(idea.id);
      await generateSeedPPT(idea, users, lang);
    } catch (error) {
      console.error("Error generating PPT:", error);
      alert(lang === 'es' ? 'Error al generar PPT' : 'Error generating PPT');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-slate-200 transition-all group relative">
      <div className="flex justify-between items-start gap-4 mb-3">
        <div className="flex flex-col gap-1 pr-12">
          <div className="flex flex-wrap gap-2">
            {(user?.role?.toUpperCase() === 'ADMIN' || user?.role?.toUpperCase() === 'PRODUCT' || user?.role?.toUpperCase() === 'PRODUCT_TEAM') && (
              <span className={`text-[8px] font-black uppercase tracking-[0.2em] w-fit px-2 py-1 rounded-md shadow-sm ${hasVoted ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-orange-50 text-orange-600 border border-orange-100'}`}>
                {hasVoted ? (lang === 'es' ? 'Ya votado' : 'Voted') : (lang === 'es' ? 'Por votar' : 'To vote')}
              </span>
            )}
            {voteCount > 0 ? (
              <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md shrink-0 ${getMoSCoWColor(getMoSCoWFromScore(score))}`}>
                {getMoSCoWFromScore(score)}
              </span>
            ) : (
              <span className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md shrink-0 bg-slate-100 text-slate-400">
                {lang === 'es' ? 'SIN VALORAR' : 'UNASSESSED'}
              </span>
            )}
          </div>
          <h4 className="font-black text-slate-900 leading-tight group-hover:text-orange-600 transition-colors">{idea.data.seedName}</h4>
        </div>
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-900 text-white shrink-0 shadow-lg absolute top-5 right-5">
          <span className="text-sm font-black">{voteCount > 0 ? score : '-'}</span>
        </div>
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {user?.role?.toUpperCase() === 'ADMIN' && (
            <>
              <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[8px] font-black text-slate-500 uppercase">
                {idea.authorName.charAt(0)}
              </div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{idea.authorName}</span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-50">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                {formatToDDMMYYYY(idea.date, lang)}
              </span>
              <span className="text-slate-200">•</span>
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                {voteCount} {t.common.votes}
              </span>
              {idea.data.isClientRequest && (
                <span className="text-[7px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-0.5">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  {t.wizard.clientRequest}
                </span>
              )}
              {idea.data.isPilot && (
                <span className="text-[7px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-0.5">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  {t.wizard.pilot}
                </span>
              )}
              {idea.data.isLegalRequirement && (
                <span className="text-[7px] font-black text-rose-600 uppercase tracking-widest flex items-center gap-0.5">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                  {t.wizard.legalRequirement}
                </span>
              )}
            </div>
            {user?.role?.toUpperCase() === 'ADMIN' && idea.votes && idea.votes.length > 0 && (
              <div className="mt-2 text-[7px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                {lang === 'es' ? 'Votado por: ' : 'Voted by: '}
                {idea.votes.map(v => v.userName).join(', ')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPPT}
              disabled={downloadingId === idea.id}
              className="p-2 bg-slate-50 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 rounded-xl transition-all disabled:opacity-50"
              title={lang === 'es' ? 'Descargar PPT' : 'Download PPT'}
            >
              {downloadingId === idea.id ? (
                <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              )}
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onView(); }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-900 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            >
              {lang === 'es' ? 'VER' : 'VIEW'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ label: string }> = ({ label }) => (
  <div className="py-12 border-2 border-dashed border-slate-100 rounded-[2rem] flex flex-col items-center justify-center text-slate-300">
    <p className="text-xs font-black uppercase tracking-widest">{label}</p>
  </div>
);

export default SeedPanel;

