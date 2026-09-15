
import React, { useState, useEffect } from 'react';
import { Idea, IdeaStatus, User, Level, UserRole, MoSCoW } from '@/types';
import { getConsensusScore, getVoteCount, hasUserVoted } from '@/utils/ideaUtils';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { formatToDDMMYYYY } from '../utils/dateUtils';
import { IdeaDetail } from './IdeaDetail';
import { generateSeedPPT } from '../utils/generateSeedPPT';

interface ProductPanelProps {
  allIdeas: Idea[];
  onUpdateIdea: (idea: Idea) => Promise<void>;
  onDeleteIdea: (id: string) => Promise<void>;
  initialSelectedId?: string;
}

const getMoSCoWFromScore = (score: number): MoSCoW => {
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

const ProductPanel: React.FC<ProductPanelProps> = ({ allIdeas, onUpdateIdea, onDeleteIdea, initialSelectedId }) => {
  const { user, users } = useAuth();
  const { lang, t } = useLanguage();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId || null);

  const pendingIdeas = allIdeas.filter(i => i.status === IdeaStatus.PENDING || i.status === IdeaStatus.REVIEWING);
  const selectedIdea = allIdeas.find(i => i.id === selectedId);

  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);

  const handleUpdateIdeaWithScore = async (updatedIdea: Idea) => {
    const score = getConsensusScore(updatedIdea, users);
    const voteCount = getVoteCount(updatedIdea, users);
    await onUpdateIdea({ 
      ...updatedIdea, 
      consensusScore: score, 
      voteCount 
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-500">
      {/* Sidebar: Pending Review List */}
      <div className="lg:col-span-4 space-y-6">
        <div className="flex items-center justify-between border-b pb-4">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t.product.pendingReview}</h3>
          <span className="bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-1 rounded-lg">{pendingIdeas.length}</span>
        </div>
        
        <div className="space-y-3 max-h-[calc(100vh-250px)] overflow-y-auto pr-2">
          {pendingIdeas.map(idea => {
            const hasVoted = hasUserVoted(idea, user);
            return (
              <button
                key={idea.id}
                onClick={() => setSelectedId(idea.id)}
                className={`w-full text-left p-5 rounded-3xl border transition-all group relative ${
                  selectedId === idea.id 
                    ? 'bg-slate-900 border-slate-900 shadow-xl translate-x-2' 
                    : 'bg-white border-slate-100 hover:border-slate-200 hover:shadow-md'
                }`}
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="flex flex-col gap-1 pr-10">
                    {(user?.role?.toUpperCase() === 'ADMIN' || user?.role?.toUpperCase() === 'PRODUCT' || user?.role?.toUpperCase() === 'PRODUCT_TEAM') && (
                      <span className={`text-[8px] font-black uppercase tracking-[0.2em] w-fit px-2 py-1 rounded-md shadow-sm ${
                        hasVoted 
                          ? (selectedId === idea.id ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-600 border border-emerald-100') 
                          : (selectedId === idea.id ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-50 text-orange-600 border border-orange-100')
                      }`}>
                        {hasVoted ? (lang === 'es' ? 'Ya votado' : 'Voted') : (lang === 'es' ? 'Por votar' : 'To vote')}
                      </span>
                    )}
                    <h4 className={`font-black leading-tight ${selectedId === idea.id ? 'text-white' : 'text-slate-900'}`}>
                      {idea.data.seedName}
                    </h4>
                  </div>
                  {getVoteCount(idea, users) > 0 ? (
                    <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md shrink-0 ${getMoSCoWColor(getMoSCoWFromScore(getConsensusScore(idea, users)))}`}>
                      {getMoSCoWFromScore(getConsensusScore(idea, users))}
                    </span>
                  ) : (
                    <span className="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md shrink-0 bg-slate-100 text-slate-400">
                      {lang === 'es' ? 'SIN VALORAR' : 'UNASSESSED'}
                    </span>
                  )}
                </div>
              
              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-2">
                  {user?.role?.toUpperCase() === 'ADMIN' && (
                    <>
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black uppercase ${
                        selectedId === idea.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {idea.authorName.charAt(0)}
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${
                        selectedId === idea.id ? 'text-white/60' : 'text-slate-400'
                      }`}>
                        {idea.authorName}
                      </span>
                    </>
                  )}
                  <span className={`text-[8px] font-bold ${
                    selectedId === idea.id ? 'text-white/40' : 'text-slate-300'
                  }`}>
                    {formatToDDMMYYYY(idea.date, lang)}
                  </span>
                </div>

                <div className={`flex flex-col items-end ${selectedId === idea.id ? 'text-white' : 'text-slate-900'}`}>
                  <span className="text-[7px] font-black uppercase tracking-widest opacity-40 mb-0.5 whitespace-nowrap">Avg. Score</span>
                  <span className="text-sm font-black leading-none">{getVoteCount(idea, users) > 0 ? getConsensusScore(idea, users) : '-'}</span>
                  <span className={`text-[7px] font-bold uppercase tracking-widest mt-1 ${selectedId === idea.id ? 'text-white/60' : 'text-slate-400'}`}>
                    {getVoteCount(idea, users)} {t.common.votes}
                  </span>
                </div>
              </div>

              {/* Voters list for Admins */}
              {user?.role?.toUpperCase() === 'ADMIN' && idea.votes && idea.votes.length > 0 && (
                <div className={`mt-4 pt-3 border-t text-[8px] font-bold uppercase tracking-widest leading-relaxed ${
                  selectedId === idea.id ? 'border-white/10 text-white/40' : 'border-slate-50 text-slate-400'
                }`}>
                  {lang === 'es' ? 'Votado por: ' : 'Voted by: '}
                  {idea.votes.map(v => v.userName).join(', ')}
                </div>
              )}
            </button>
          );
        })}
        {pendingIdeas.length === 0 && (
            <div className="py-12 border-2 border-dashed border-slate-100 rounded-[2rem] flex flex-col items-center justify-center text-slate-300">
              <p className="text-xs font-black uppercase tracking-widest">{t.product.noPending}</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Content: Idea Detail */}
      <div className="lg:col-span-8">
        {selectedIdea ? <IdeaDetail idea={selectedIdea} users={users} onVote={async (vote) => {
          const votes = selectedIdea.votes || [];
          const newVotes = votes.filter(v => v.userId !== vote.userId);
          await handleUpdateIdeaWithScore({ ...selectedIdea, votes: [...newVotes, vote] });
        }} onDeleteVote={async (userId) => {
          const votes = selectedIdea.votes || [];
          const newVotes = votes.filter(v => v.userId !== userId);
          await handleUpdateIdeaWithScore({ ...selectedIdea, votes: newVotes });
        }} onStatusChange={status => handleUpdateIdeaWithScore({ ...selectedIdea, status, updatedAt: new Date().toISOString() })} 
        onTypeChange={seedType => handleUpdateIdeaWithScore({ ...selectedIdea, data: { ...selectedIdea.data, seedType }, updatedAt: new Date().toISOString() })}
        onDelete={async (id) => {
          await onDeleteIdea(id);
          setSelectedId(null);
        }} /> : (
          <div className="h-full flex flex-col items-center justify-center p-20 bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
            <h3 className="text-xl font-black text-slate-400 uppercase tracking-widest">{t.product.selectToReview}</h3>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductPanel;
