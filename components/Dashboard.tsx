
import React, { useState } from 'react';
import { Idea, IdeaStatus, Level, MoSCoW, ImpactSection, User, IdeaVote, UserRole } from '@/types';
import { getConsensusScore, getVoteCount } from '@/utils/ideaUtils';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { formatToDDMMYYYY } from '../utils/dateUtils';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts';
import { translations } from '../translations';
import { StatusBadge } from './StatusBadge';
import { generateSeedPPT } from '../utils/generateSeedPPT';

interface DashboardProps {
  ideas: Idea[];
  onNewIdea: () => void;
  onEditIdea: (idea: Idea) => void;
  onDeleteIdea: (id: string) => void;
}

const getLevelValue = (level: Level): number => {
  switch (level) {
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 1;
  }
};

// Helper to get average score of an impact section
const getSectionValue = (section?: ImpactSection): number => {
  if (!section || !section.s1 || !section.s2 || !section.s3) return 0;
  return (getLevelValue(section.s1) + getLevelValue(section.s2) + getLevelValue(section.s3)) / 3;
};

const getMoSCoWFromScore = (score: number): MoSCoW => {
  // Balanced thresholds for 0-10 scale to MoSCoW
  if (score >= 8.0) return 'Must';
  if (score >= 6.5) return 'Should';
  if (score >= 5.0) return 'Could';
  return "Won't";
};

const getMoSCoWColor = (moscow: MoSCoW): string => {
  switch (moscow) {
    case 'Must': return 'bg-emerald-600 text-white';
    case 'Should': return 'bg-emerald-300 text-emerald-900';
    case 'Could': return 'bg-amber-300 text-amber-900';
    case "Won't": return 'bg-rose-600 text-white';
    default: return 'bg-slate-500 text-white';
  }
};

const Dashboard: React.FC<DashboardProps> = ({ ideas, onNewIdea, onEditIdea, onDeleteIdea }) => {
  const { user, users } = useAuth();
  const { t, lang } = useLanguage();
  const [ideaToDelete, setIdeaToDelete] = useState<Idea | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownloadPPT = async (idea: Idea) => {
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
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t.dashboard.title}</h1>
          <p className="text-slate-500 font-medium">{t.dashboard.subtitle}</p>
        </div>
        <button 
          onClick={onNewIdea}
          className="flex items-center gap-2 bg-orange-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-700 transition-all shadow-xl hover:-translate-y-1"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          {t.dashboard.newIdeaBtn}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {ideas.length === 0 ? (
          <div className="col-span-full py-24 text-center border-4 border-dashed border-slate-200 rounded-[3rem] bg-white">
            <h3 className="text-2xl font-black text-slate-800">{t.dashboard.noIdeasTitle}</h3>
            <p className="text-slate-400 mt-2 font-medium">{t.dashboard.noIdeasSubtitle}</p>
          </div>
        ) : (
          ideas.map(idea => (
            <div key={idea.id} className="bg-white rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-2xl transition-all group flex flex-col h-full overflow-hidden border-b-4 border-b-slate-50 hover:border-b-orange-500">
              <div className="p-8 flex-grow">
                <div className="flex justify-between items-start mb-6">
                  <StatusBadge status={idea.status} />
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{formatToDDMMYYYY(idea.date, lang)}</span>
                  {getVoteCount(idea, users) > 0 && (
                    <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md shrink-0 ${getMoSCoWColor(getMoSCoWFromScore(getConsensusScore(idea, users)))}`}>
                      {getMoSCoWFromScore(getConsensusScore(idea, users))}
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-black text-slate-900 mb-3 group-hover:text-orange-600 transition-colors line-clamp-2 leading-tight" title={idea.data.seedName}>
                  {idea.data.seedName}
                </h3>
                <p className="text-sm text-slate-500 line-clamp-3 font-medium leading-relaxed" title={idea.data.oneSentenceSummary}>
                  {idea.data.oneSentenceSummary}
                </p>
                {getVoteCount(idea, users) > 0 && (
                  <div className="mt-6">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Avg. Score</span>
                      <span className="text-lg font-black text-slate-900">{getConsensusScore(idea, users)}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="bg-orange-500 h-2 rounded-full" style={{ width: `${getConsensusScore(idea, users) * 10}%` }}></div>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest">
                      {getVoteCount(idea, users)} {t.common.votes}
                    </p>
                  </div>
                )}
              </div>
              <div className="px-8 py-6 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
                <div>
                  {(idea.userId === user?.id || user?.role?.toUpperCase() === 'ADMIN') && (
                    <button onClick={() => setIdeaToDelete(idea)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-rose-600 hover:border-rose-500 transition-all shadow-sm">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                </div>
                {(idea.userId === user?.id || user?.role?.toUpperCase() === 'ADMIN') && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDownloadPPT(idea)}
                      disabled={downloadingId === idea.id}
                      className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-emerald-600 hover:border-emerald-500 transition-all shadow-sm disabled:opacity-50"
                      title={lang === 'es' ? 'Descargar PPT' : 'Download PPT'}
                    >
                      {downloadingId === idea.id ? (
                        <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      )}
                    </button>
                    {idea.userId === user?.id && (
                      <button onClick={() => onEditIdea(idea)} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-orange-600 hover:border-orange-500 transition-all shadow-sm">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {ideaToDelete && (
        <DeleteConfirmationModal 
          ideaName={ideaToDelete.data.seedName} 
          onConfirm={() => {
            onDeleteIdea(ideaToDelete.id);
            setIdeaToDelete(null);
          }} 
          onCancel={() => setIdeaToDelete(null)} 
        />
      )}
    </div>
  );
};

const DeleteConfirmationModal: React.FC<{ ideaName: string; onConfirm: () => void; onCancel: () => void }> = ({ ideaName, onConfirm, onCancel }) => {
  const { t } = useLanguage();
  const [question, ...rest] = t.dashboard.confirmDelete.split('?');
  const warning = rest.join('?').trim();

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="p-10 text-center">
          <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </div>
          <h3 className="text-2xl font-black text-slate-900 mb-4">{question}?</h3>
          <p className="text-slate-500 font-medium mb-8">
            {warning || "This action cannot be undone."}
          </p>
          <div className="flex flex-col gap-3">
            <button onClick={onConfirm} className="w-full py-4 bg-rose-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-rose-700 transition-all">
              {t.common.delete}
            </button>
            <button onClick={onCancel} className="w-full py-4 bg-slate-100 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all">
              {t.common.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
