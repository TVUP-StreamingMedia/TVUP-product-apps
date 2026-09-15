
import React, { useState, useEffect } from 'react';
import { Idea, IdeaStatus, IdeaVote, Level, UserRole, MoSCoW, ImpactSection, User, SeedType } from '@/types';
import { getConsensusScore, getVoteCount, getLevelValue, hasUserVoted, calculateSingleScore, calculateCubicMean, scaleTo10 } from '@/utils/ideaUtils';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { formatToDDMMYYYY } from '../utils/dateUtils';
import { StatusBadge } from './StatusBadge';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { Trash2, Info } from 'lucide-react';

interface IdeaDetailProps {
  idea: Idea;
  users: User[];
  onVote: (v: IdeaVote) => void;
  onStatusChange: (s: IdeaStatus) => void;
  onTypeChange?: (t: SeedType) => void;
  onDelete?: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onDeleteVote?: (userId: string) => Promise<void>;
}

const calculateRawAvgSection = (sections: (ImpactSection | undefined)[]): number => {
  const validSections = sections.filter((s): s is ImpactSection => !!s && !!s.s1 && !!s.s2 && !!s.s3);
  if (validSections.length === 0) return 0;
  
  // Calculate the cubic mean for each individual assessment to reward high values
  const individualCubicMeans = validSections.map(s => 
    calculateCubicMean([getLevelValue(s.s1), getLevelValue(s.s2), getLevelValue(s.s3)])
  );
  
  // Average the individual cubic means
  return individualCubicMeans.reduce((a, b) => a + b, 0) / individualCubicMeans.length;
};

const calculateAvgSection = (sections: (ImpactSection | undefined)[]): number => {
  const raw = calculateRawAvgSection(sections);
  if (raw === 0) return 0;
  return scaleTo10(raw);
};

const calculateVoteScore = (vote: IdeaVote, seedType: string): number => {
  return calculateSingleScore(vote, seedType);
};

export const getMoSCoWFromScore = (score: number): MoSCoW => {
  if (score >= 8.0) return 'Must';
  if (score >= 6.5) return 'Should';
  if (score >= 5.0) return 'Could';
  return "Won't";
};

export const getMoSCoWColor = (moscow: MoSCoW): string => {
  switch (moscow) {
    case 'Must': return 'bg-emerald-600 text-white';
    case 'Should': return 'bg-emerald-300 text-emerald-900';
    case 'Could': return 'bg-amber-300 text-amber-900';
    case "Won't": return 'bg-rose-600 text-white';
    default: return 'bg-slate-500 text-white';
  }
};

export const IdeaDetail: React.FC<IdeaDetailProps> = ({ idea, users, onVote, onStatusChange, onTypeChange, onDelete, onDirtyChange, onDeleteVote }) => {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  
  const defSec: ImpactSection = { s1: 'low', s2: 'low', s3: 'low' };
  
  const [scores, setScores] = useState({
    businessImpact: { ...defSec },
    engagement: { ...defSec },
    traction: { ...defSec },
    virality: { ...defSec },
    revenuePotential: { ...defSec },
    distributionPower: { ...defSec },
    marketValidation: { ...defSec },
    strategicPositioning: { ...defSec },
  });

  const handleScoreChange = (section: keyof typeof scores, newSection: ImpactSection) => {
    setScores(prev => ({ ...prev, [section]: newSection }));
    if (onDirtyChange) onDirtyChange(true);
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [voteToDelete, setVoteToDelete] = useState<string | null>(null);

  useEffect(() => {
    const votes = idea.votes || [];
    const existingVote = votes.find(v => v.userId === user?.id);
    if (existingVote) {
      setScores({
        businessImpact: { ...existingVote.businessImpact || defSec },
        engagement: { ...existingVote.engagement || defSec },
        traction: { ...existingVote.traction || defSec },
        virality: { ...existingVote.virality || defSec },
        revenuePotential: { ...existingVote.revenuePotential || defSec },
        distributionPower: { ...existingVote.distributionPower || defSec },
        marketValidation: { ...existingVote.marketValidation || defSec },
        strategicPositioning: { ...existingVote.strategicPositioning || defSec },
      });
    } else if (idea.userId === user?.id) {
      setScores({
        businessImpact: { ...idea.data.businessImpact || defSec },
        engagement: { ...idea.data.engagement || defSec },
        traction: { ...idea.data.traction || defSec },
        virality: { ...idea.data.virality || defSec },
        revenuePotential: { ...idea.data.revenuePotential || defSec },
        distributionPower: { ...idea.data.distributionPower || defSec },
        marketValidation: { ...idea.data.marketValidation || defSec },
        strategicPositioning: { ...idea.data.strategicPositioning || defSec },
      });
    } else {
      setScores({
        businessImpact: { ...defSec },
        engagement: { ...defSec },
        traction: { ...defSec },
        virality: { ...defSec },
        revenuePotential: { ...defSec },
        distributionPower: { ...defSec },
        marketValidation: { ...defSec },
        strategicPositioning: { ...defSec },
      });
    }
  }, [idea.id, user?.id, idea.votes, idea.userId, idea.data]);

  const isOwner = idea.userId === user?.id;
  const hasVoted = hasUserVoted(idea, user);
  const roleUpper = user?.role?.toUpperCase();
  const isProduct = roleUpper === 'ADMIN' || roleUpper === 'PRODUCT_TEAM' || roleUpper === 'EDITOR';

  const handleVoteSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onVote({ 
        userId: user?.id || '', 
        userName: user?.name || '', 
        userRole: user?.role || UserRole.USER,
        ...scores,
        score: 0, 
        timestamp: new Date().toISOString()
      } as IdeaVote);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate Averages (Team Votes + Author if Admin/Product)
  const consensusScore = getConsensusScore(idea, users);
  const displayVoteCount = getVoteCount(idea, users);

  const author = users.find(u => u.id === idea.userId);
  const isAuthorProduct = author?.role?.toUpperCase() === 'ADMIN' || author?.role?.toUpperCase() === 'PRODUCT' || author?.role?.toUpperCase() === 'PRODUCT_TEAM';

  const isTechnical = idea.data.seedType === 'Technical';
  const isBusiness = idea.data.seedType === 'Business';

  let consensusVotes = idea.votes.filter(v => {
    const voterRole = v.userRole || users.find(u => u.id === v.userId)?.role;
    return voterRole?.toUpperCase() === 'ADMIN' || voterRole?.toUpperCase() === 'PRODUCT' || voterRole?.toUpperCase() === 'PRODUCT_TEAM' || voterRole?.toUpperCase() === 'EDITOR';
  }).map(v => ({
    businessImpact: v.businessImpact,
    engagement: v.engagement,
    traction: v.traction,
    virality: v.virality,
    revenuePotential: v.revenuePotential,
    distributionPower: v.distributionPower,
    marketValidation: v.marketValidation,
    strategicPositioning: v.strategicPositioning
  }));

  const authorHasVoted = idea.votes.some(v => v.userId === idea.userId);

  if (isAuthorProduct && !authorHasVoted) {
    consensusVotes.push({
      businessImpact: idea.data.businessImpact,
      engagement: idea.data.engagement,
      traction: idea.data.traction,
      virality: idea.data.virality,
      revenuePotential: idea.data.revenuePotential,
      distributionPower: idea.data.distributionPower,
      marketValidation: idea.data.marketValidation,
      strategicPositioning: idea.data.strategicPositioning
    });
  }

  const avgBiz = consensusVotes.length > 0 ? calculateAvgSection(consensusVotes.map(v => v.businessImpact)) : 0;
  const avgEng = consensusVotes.length > 0 ? calculateAvgSection(consensusVotes.map(v => v.engagement)) : 0;
  const avgTra = consensusVotes.length > 0 ? calculateAvgSection(consensusVotes.map(v => v.traction)) : 0;
  const avgVir = consensusVotes.length > 0 ? calculateAvgSection(consensusVotes.map(v => v.virality)) : 0;

  const avgRev = consensusVotes.length > 0 ? calculateAvgSection(consensusVotes.map(v => v.revenuePotential)) : 0;
  const avgDist = consensusVotes.length > 0 ? calculateAvgSection(consensusVotes.map(v => v.distributionPower)) : 0;
  const avgStrat = consensusVotes.length > 0 ? calculateAvgSection(consensusVotes.map(v => v.strategicPositioning)) : 0;
  const avgMark = consensusVotes.length > 0 ? calculateAvgSection(consensusVotes.map(v => v.marketValidation)) : 0;

  const propBiz = Math.round(calculateAvgSection([idea.data.businessImpact]) * 10) / 10;
  const propEng = Math.round(calculateAvgSection([idea.data.engagement]) * 10) / 10;
  const propTra = Math.round(calculateAvgSection([idea.data.traction]) * 10) / 10;
  const propVir = Math.round(calculateAvgSection([idea.data.virality]) * 10) / 10;

  const propRev = Math.round(calculateAvgSection([idea.data.revenuePotential]) * 10) / 10;
  const propDist = Math.round(calculateAvgSection([idea.data.distributionPower]) * 10) / 10;
  const propStrat = Math.round(calculateAvgSection([idea.data.strategicPositioning]) * 10) / 10;
  const propMark = Math.round(calculateAvgSection([idea.data.marketValidation]) * 10) / 10;

  const propTotal = calculateSingleScore({
    businessImpact: idea.data.businessImpact,
    engagement: idea.data.engagement,
    traction: idea.data.traction,
    virality: idea.data.virality,
    revenuePotential: idea.data.revenuePotential,
    distributionPower: idea.data.distributionPower,
    marketValidation: idea.data.marketValidation,
    strategicPositioning: idea.data.strategicPositioning
  }, idea.data.seedType);

  const userBiz = calculateAvgSection([scores.businessImpact]);
  const userEng = calculateAvgSection([scores.engagement]);
  const userTra = calculateAvgSection([scores.traction]);
  const userVir = calculateAvgSection([scores.virality]);

  const userRev = calculateAvgSection([scores.revenuePotential]);
  const userDist = calculateAvgSection([scores.distributionPower]);
  const userStrat = calculateAvgSection([scores.strategicPositioning]);
  const userMark = calculateAvgSection([scores.marketValidation]);

  const userTotal = calculateSingleScore(scores, idea.data.seedType);

  const chartData = isBusiness ? [
    { name: t.wizard.impactVectors.revenuePotential.title, value: Math.round(avgRev * 10) / 10 },
    { name: t.wizard.impactVectors.distributionPower.title, value: Math.round(avgDist * 10) / 10 },
    { name: t.wizard.impactVectors.strategicPositioning.title, value: Math.round(avgStrat * 10) / 10 },
    { name: t.wizard.impactVectors.marketValidation.title, value: Math.round(avgMark * 10) / 10 },
  ] : [
    { name: t.wizard.impactVectors.business.title, value: Math.round(avgBiz * 10) / 10 },
    { name: isTechnical ? t.wizard.impactVectors.stability.title : t.wizard.impactVectors.engagement.title, value: Math.round(avgEng * 10) / 10 },
    { name: isTechnical ? t.wizard.impactVectors.enablement.title : t.wizard.impactVectors.virality.title, value: Math.round(avgVir * 10) / 10 },
    { name: isTechnical ? t.wizard.impactVectors.risk.title : t.wizard.impactVectors.traction.title, value: Math.round(avgTra * 10) / 10 },
  ];

  return (
    <div className="space-y-8 animate-in slide-in-from-right-10 duration-500 max-h-[calc(100vh-180px)] overflow-y-auto pr-4">
      <div className="bg-white rounded-[3rem] border border-slate-100 overflow-hidden shadow-2xl">
        {/* 1. HEADER */}
        <div className="p-10 bg-slate-50/50 border-b">
          <div className="flex justify-between items-start mb-6">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={idea.status} />
                {displayVoteCount > 0 ? (
                  <span className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${getMoSCoWColor(getMoSCoWFromScore(consensusScore))}`}>
                    {getMoSCoWFromScore(consensusScore)}
                  </span>
                ) : (
                  <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full bg-slate-100 text-slate-400">
                    {lang === 'es' ? 'SIN VALORAR' : 'UNASSESSED'}
                  </span>
                )}
                {idea.data.isClientRequest && (
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-widest rounded-full flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    {t.wizard.clientRequest}{idea.data.clientName ? `: ${idea.data.clientName}` : ''}
                  </span>
                )}
                {idea.data.isPilot && (
                  <span className="px-3 py-1 bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest rounded-full flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    {t.wizard.pilot}
                  </span>
                )}
                {idea.data.isLegalRequirement && (
                  <span className="px-3 py-1 bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-widest rounded-full flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                    {t.wizard.legalRequirement}
                  </span>
                )}
                {(user?.role?.toUpperCase() === 'ADMIN' || user?.role?.toUpperCase() === 'PRODUCT' || user?.role?.toUpperCase() === 'PRODUCT_TEAM') && (
                  <span className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full shadow-sm border ${
                    hasVoted 
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                      : 'bg-orange-50 text-orange-600 border-orange-100'
                  }`}>
                    {hasVoted ? (lang === 'es' ? 'Ya votado' : 'Voted') : (lang === 'es' ? 'Por votar' : 'To vote')}
                  </span>
                )}
              </div>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">{idea.data.seedName}</h2>
              <div className="flex items-center gap-3">
                {user?.role?.toUpperCase() === 'ADMIN' && (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-black text-slate-500 uppercase">
                        {idea.authorName.charAt(0)}
                      </div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{idea.authorName}</span>
                    </div>
                    <span className="text-slate-300">•</span>
                  </>
                )}
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {formatToDDMMYYYY(idea.date, lang)}
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {displayVoteCount} {t.common.votes}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              {user?.role?.toUpperCase() === 'ADMIN' && (
                <button 
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-4 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-2xl transition-all"
                  title={lang === 'es' ? 'Eliminar Seed' : 'Delete Seed'}
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              )}
              {user?.role?.toUpperCase() === 'ADMIN' && (
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{lang === 'es' ? 'Tipo de Seed' : 'Seed Type'}</label>
                    <select
                      value={idea.data.seedType}
                      onChange={(e) => onTypeChange?.(e.target.value as any)}
                      className="px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-black text-[10px] uppercase tracking-widest outline-none focus:border-orange-500 transition-all shadow-sm cursor-pointer"
                    >
                      <option value="Product">{lang === 'es' ? 'Producto' : 'Product'}</option>
                      <option value="Technical">{lang === 'es' ? 'Técnico' : 'Technical'}</option>
                      <option value="Business">{lang === 'es' ? 'Negocio' : 'Business'}</option>
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{lang === 'es' ? 'Estado' : 'Status'}</label>
                    <select
                      value={idea.status}
                      onChange={(e) => onStatusChange(e.target.value as IdeaStatus)}
                      className="px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-black text-[10px] uppercase tracking-widest outline-none focus:border-orange-500 transition-all shadow-sm cursor-pointer"
                    >
                      {idea.status === IdeaStatus.DRAFT && <option value={IdeaStatus.DRAFT}>{lang === 'es' ? 'Borrador' : 'Draft'}</option>}
                      {idea.status === IdeaStatus.REVIEWING && <option value={IdeaStatus.REVIEWING}>{lang === 'es' ? 'En Revisión' : 'Reviewing'}</option>}
                      <option value={IdeaStatus.PENDING}>{lang === 'es' ? 'Pendiente de Revisión' : 'Pending Review'}</option>
                      <option value={IdeaStatus.APPROVED}>{lang === 'es' ? 'Aprobado' : 'Approved'}</option>
                      <option value={IdeaStatus.REJECTED}>{t.initiatives.status.rejected}</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
          <p className="text-base font-medium text-slate-600 leading-relaxed max-w-3xl italic">"{idea.data.oneSentenceSummary}"</p>
        </div>

        {/* 2. CONTENT GRID */}
        <div className="p-10 space-y-12">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <DetailCard title={t.wizard.problem} content={idea.data.elevatorPitch.problem} icon="problem" />
            <DetailCard title={t.wizard.solution} content={idea.data.elevatorPitch.solution} icon="solution" />
          </div>

          {/* Benefits */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <DetailCard title={t.wizard.forUser} content={idea.data.expectedBenefits.endUser} icon="user" />
            <DetailCard title={t.wizard.forUs} content={idea.data.expectedBenefits.forUs} icon="business" />
          </div>

          {/* Cost of not doing */}
          <DetailCard title={t.wizard.costNotDoing} content={idea.data.costOfNotDoing} icon="warning" />

          {/* SWOT Analysis */}
          <section className="space-y-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] border-b pb-2">SWOT Analysis</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SWOTBox title={t.wizard.strengths} items={idea.data.swot.strengths} type="emerald" />
            <SWOTBox title={t.wizard.opportunities} items={idea.data.swot.opportunities} type="emerald" />
            <SWOTBox title={t.wizard.weaknesses} items={idea.data.swot.weaknesses} type="orange" />
            <SWOTBox title={t.wizard.threats} items={idea.data.swot.threats} type="orange" />
          </div>
          </section>

          {/* Support Documentation */}
          {idea.data.supportLinks && idea.data.supportLinks.length > 0 && (
            <section className="space-y-6">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] border-b pb-2">{t.wizard.supportDocs}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {idea.data.supportLinks.filter(link => link.trim() !== '').map((link, idx) => (
                  <a 
                    key={idx} 
                    href={link.startsWith('http') ? link : `https://${link}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-slate-100 hover:border-orange-200 hover:bg-orange-50/30 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-orange-100 group-hover:text-orange-500 transition-all">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-700 truncate">{link}</p>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{lang === 'es' ? 'VER DOCUMENTO' : 'VIEW DOCUMENT'}</p>
                    </div>
                    <svg className="w-4 h-4 text-slate-300 group-hover:text-orange-400 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Proponent Valuation */}
          <section className="space-y-8 pt-12 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{lang === 'es' ? 'VALORACIÓN DEL PROPONENTE' : 'PROPONENT VALUATION'}</h4>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{lang === 'es' ? 'Puntuación Proponente' : 'Proponent Score'}</p>
                  {user?.role?.toUpperCase() === 'ADMIN' && (
                    <p className="text-[9px] font-bold text-slate-400">{idea.authorName}</p>
                  )}
                </div>
                <div className="w-16 h-16 rounded-full bg-slate-100 text-slate-900 flex items-center justify-center shadow-sm border-2 border-white shrink-0">
                  <span className="text-xl font-black">{propTotal}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {isBusiness ? (
                <>
                  <ProponentScoreItem 
                    label={t.wizard.impactVectors.revenuePotential.title} 
                    description={t.wizard.impactVectors.revenuePotential.desc}
                    value={propRev} 
                  />
                  <ProponentScoreItem 
                    label={t.wizard.impactVectors.distributionPower.title} 
                    description={t.wizard.impactVectors.distributionPower.desc}
                    value={propDist} 
                  />
                  <ProponentScoreItem 
                    label={t.wizard.impactVectors.strategicPositioning.title} 
                    description={t.wizard.impactVectors.strategicPositioning.desc}
                    value={propStrat} 
                  />
                  <ProponentScoreItem 
                    label={t.wizard.impactVectors.marketValidation.title} 
                    description={t.wizard.impactVectors.marketValidation.desc}
                    value={propMark} 
                  />
                </>
              ) : (
                <>
                  <ProponentScoreItem 
                    label={t.wizard.impactVectors.business.shortTitle} 
                    description={t.wizard.impactVectors.business.desc}
                    value={propBiz} 
                  />
                  <ProponentScoreItem 
                    label={isTechnical ? t.wizard.impactVectors.stability.shortTitle : t.wizard.impactVectors.engagement.shortTitle} 
                    description={isTechnical ? t.wizard.impactVectors.stability.desc : t.wizard.impactVectors.engagement.desc}
                    value={propEng} 
                  />
                  <ProponentScoreItem 
                    label={isTechnical ? t.wizard.impactVectors.enablement.shortTitle : t.wizard.impactVectors.virality.shortTitle} 
                    description={isTechnical ? t.wizard.impactVectors.enablement.desc : t.wizard.impactVectors.virality.desc}
                    value={propVir} 
                  />
                  <ProponentScoreItem 
                    label={isTechnical ? t.wizard.impactVectors.risk.shortTitle : t.wizard.impactVectors.traction.shortTitle} 
                    description={isTechnical ? t.wizard.impactVectors.risk.desc : t.wizard.impactVectors.traction.desc}
                    value={propTra} 
                  />
                </>
              )}
            </div>
          </section>

          {/* 3. PRODUCT TEAM AVERAGE (Always visible if not pending, or if votes exist) */}
          {(idea.status !== IdeaStatus.PENDING || idea.votes.length > 0 || isAuthorProduct) && (
            <section className="space-y-8 pt-12 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{lang === 'es' ? 'CONSENSO DEL EQUIPO' : 'TEAM CONSENSUS'}</h4>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Validation Score</p>
                    <p className="text-[9px] font-bold text-slate-400">{displayVoteCount} {displayVoteCount === 1 ? 'vote' : 'votes'}</p>
                  </div>
                  <div className="w-20 h-20 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-2xl border-4 border-white shrink-0">
                    <span className="text-2xl font-black">{displayVoteCount > 0 ? consensusScore : '-'}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col lg:flex-row gap-12 items-center">
                <div className="w-full h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ left: 40, right: 60, top: 20, bottom: 20 }}>
                      <XAxis type="number" domain={[0, 10]} hide />
                      <YAxis 
                        dataKey="name" 
                        type="category" 
                        axisLine={false} 
                        tickLine={false}
                        tick={{ fontSize: 11, fontWeight: 900, fill: '#64748b' }}
                        width={120}
                      />
                      <Bar dataKey="value" radius={[0, 12, 12, 0]} barSize={32}>
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.value >= 7 ? '#10b981' : entry.value >= 4 ? '#f59e0b' : '#94a3b8'} />
                        ))}
                        <LabelList dataKey="value" position="right" offset={15} className="fill-slate-900 font-black text-sm" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          )}

          {/* 3.5 INDIVIDUAL VOTES (Admin only) */}
          {user?.role?.toUpperCase() === 'ADMIN' && (idea.votes.length > 0 || isAuthorProduct) && (
            <section className="space-y-6 pt-12 border-t border-slate-100">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{lang === 'es' ? 'DETALLE DE VOTACIONES' : 'VOTING DETAILS'}</h4>
              <div className="space-y-4">
                {/* Author's assessment if Product/Admin and hasn't voted separately */}
                {isAuthorProduct && !idea.votes.find(v => v.userId === idea.userId) && (
                  <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-black text-slate-500 uppercase">
                          {idea.authorName.charAt(0)}
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-900 uppercase tracking-widest">{idea.authorName}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{lang === 'es' ? 'Autor (Valoración Inicial)' : 'Author (Initial Assessment)'}</p>
                        </div>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-md">
                        <span className="text-xs font-black">{propTotal}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {isBusiness ? (
                        <>
                          <IndividualScoreItem 
                            label={t.wizard.impactVectors.revenuePotential.title} 
                            description={t.wizard.impactVectors.revenuePotential.desc}
                            value={propRev} 
                          />
                          <IndividualScoreItem 
                            label={t.wizard.impactVectors.distributionPower.title} 
                            description={t.wizard.impactVectors.distributionPower.desc}
                            value={propDist} 
                          />
                          <IndividualScoreItem 
                            label={t.wizard.impactVectors.strategicPositioning.title} 
                            description={t.wizard.impactVectors.strategicPositioning.desc}
                            value={propStrat} 
                          />
                          <IndividualScoreItem 
                            label={t.wizard.impactVectors.marketValidation.title} 
                            description={t.wizard.impactVectors.marketValidation.desc}
                            value={propMark} 
                          />
                        </>
                      ) : (
                        <>
                          <IndividualScoreItem 
                            label={t.wizard.impactVectors.business.shortTitle} 
                            description={t.wizard.impactVectors.business.desc}
                            value={propBiz} 
                          />
                          <IndividualScoreItem 
                            label={isTechnical ? t.wizard.impactVectors.stability.shortTitle : t.wizard.impactVectors.engagement.shortTitle} 
                            description={isTechnical ? t.wizard.impactVectors.stability.desc : t.wizard.impactVectors.engagement.desc}
                            value={propEng} 
                          />
                          <IndividualScoreItem 
                            label={isTechnical ? t.wizard.impactVectors.enablement.shortTitle : t.wizard.impactVectors.virality.shortTitle} 
                            description={isTechnical ? t.wizard.impactVectors.enablement.desc : t.wizard.impactVectors.virality.desc}
                            value={propVir} 
                          />
                          <IndividualScoreItem 
                            label={isTechnical ? t.wizard.impactVectors.risk.shortTitle : t.wizard.impactVectors.traction.shortTitle} 
                            description={isTechnical ? t.wizard.impactVectors.risk.desc : t.wizard.impactVectors.traction.desc}
                            value={propTra} 
                          />
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* All other votes */}
                {[...idea.votes].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((vote, idx) => {
                  const voteScore = calculateVoteScore(vote, idea.data.seedType);
                  const isAuthor = vote.userId === idea.userId;
                  return (
                    <div key={idx} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative group">
                      <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-400 uppercase">
                            {vote.userName.charAt(0)}
                          </div>
                          <div>
                            <p className="text-xs font-black text-slate-900 uppercase tracking-widest">{vote.userName}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                              {vote.userRole} {isAuthor && (lang === 'es' ? '(Autor)' : '(Author)')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {onDeleteVote && (
                            <button 
                              onClick={() => setVoteToDelete(vote.userId)}
                              className="w-8 h-8 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-100"
                              title={lang === 'es' ? 'Eliminar voto' : 'Delete vote'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-md">
                            <span className="text-xs font-black">{voteScore}</span>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {isBusiness ? (
                          <>
                            <IndividualScoreItem 
                              label={t.wizard.impactVectors.revenuePotential.title} 
                              description={t.wizard.impactVectors.revenuePotential.desc}
                              value={calculateAvgSection([vote.revenuePotential])} 
                            />
                            <IndividualScoreItem 
                              label={t.wizard.impactVectors.distributionPower.title} 
                              description={t.wizard.impactVectors.distributionPower.desc}
                              value={calculateAvgSection([vote.distributionPower])} 
                            />
                            <IndividualScoreItem 
                              label={t.wizard.impactVectors.strategicPositioning.title} 
                              description={t.wizard.impactVectors.strategicPositioning.desc}
                              value={calculateAvgSection([vote.strategicPositioning])} 
                            />
                            <IndividualScoreItem 
                              label={t.wizard.impactVectors.marketValidation.title} 
                              description={t.wizard.impactVectors.marketValidation.desc}
                              value={calculateAvgSection([vote.marketValidation])} 
                            />
                          </>
                        ) : (
                          <>
                            <IndividualScoreItem 
                              label={t.wizard.impactVectors.business.shortTitle} 
                              description={t.wizard.impactVectors.business.desc}
                              value={calculateAvgSection([vote.businessImpact])} 
                            />
                            <IndividualScoreItem 
                              label={isTechnical ? t.wizard.impactVectors.stability.shortTitle : t.wizard.impactVectors.engagement.shortTitle} 
                              description={isTechnical ? t.wizard.impactVectors.stability.desc : t.wizard.impactVectors.engagement.desc}
                              value={calculateAvgSection([vote.engagement])} 
                            />
                            <IndividualScoreItem 
                              label={isTechnical ? t.wizard.impactVectors.enablement.shortTitle : t.wizard.impactVectors.virality.shortTitle} 
                              description={isTechnical ? t.wizard.impactVectors.enablement.desc : t.wizard.impactVectors.virality.desc}
                              value={calculateAvgSection([vote.virality])} 
                            />
                            <IndividualScoreItem 
                              label={isTechnical ? t.wizard.impactVectors.risk.shortTitle : t.wizard.impactVectors.traction.shortTitle} 
                              description={isTechnical ? t.wizard.impactVectors.risk.desc : t.wizard.impactVectors.traction.desc}
                              value={calculateAvgSection([vote.traction])} 
                            />
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 4. VOTING WIDGET (Only for Pending/Reviewing seeds) */}
          {(idea.status === IdeaStatus.PENDING || idea.status === IdeaStatus.REVIEWING) && (
            <section className="space-y-8 pt-12 border-t border-slate-100">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{lang === 'es' ? 'TU VALORACIÓN' : 'YOUR VALUATION'}</h4>
                  {(user?.role?.toUpperCase() === 'ADMIN' || user?.role?.toUpperCase() === 'PRODUCT' || user?.role?.toUpperCase() === 'PRODUCT_TEAM') && (
                    <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-500">
                      <div className="text-right">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{lang === 'es' ? 'Tu Puntuación' : 'Your Score'}</p>
                      </div>
                      <div className="w-12 h-12 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-lg border-2 border-white shrink-0">
                        <span className="text-sm font-black">{userTotal}</span>
                      </div>
                    </div>
                  )}
                </div>
                {hasVoted && (
                  <span className="px-4 py-2 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-full border border-emerald-100 flex items-center gap-2">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    {lang === 'es' ? 'Voto Registrado' : 'Vote Registered'}
                  </span>
                )}
              </div>

              {(!isOwner || isProduct) ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {isBusiness ? (
                      <>
                        <VoteSection 
                          title={t.wizard.impactVectors.revenuePotential.title} 
                          description={t.wizard.impactVectors.revenuePotential.desc}
                          descriptions={[t.wizard.impactVectors.revenuePotential.s1Desc, t.wizard.impactVectors.revenuePotential.s2Desc, t.wizard.impactVectors.revenuePotential.s3Desc]}
                          labels={[t.wizard.impactVectors.revenuePotential.s1, t.wizard.impactVectors.revenuePotential.s2, t.wizard.impactVectors.revenuePotential.s3]} 
                          section={scores.revenuePotential} 
                          onChange={(s) => handleScoreChange('revenuePotential', s)} 
                        />
                        <VoteSection 
                          title={t.wizard.impactVectors.distributionPower.title} 
                          description={t.wizard.impactVectors.distributionPower.desc}
                          descriptions={[t.wizard.impactVectors.distributionPower.s1Desc, t.wizard.impactVectors.distributionPower.s2Desc, t.wizard.impactVectors.distributionPower.s3Desc]}
                          labels={[t.wizard.impactVectors.distributionPower.s1, t.wizard.impactVectors.distributionPower.s2, t.wizard.impactVectors.distributionPower.s3]} 
                          section={scores.distributionPower} 
                          onChange={(s) => handleScoreChange('distributionPower', s)} 
                        />
                        <VoteSection 
                          title={t.wizard.impactVectors.strategicPositioning.title} 
                          description={t.wizard.impactVectors.strategicPositioning.desc}
                          descriptions={[t.wizard.impactVectors.strategicPositioning.s1Desc, t.wizard.impactVectors.strategicPositioning.s2Desc, t.wizard.impactVectors.strategicPositioning.s3Desc]}
                          labels={[t.wizard.impactVectors.strategicPositioning.s1, t.wizard.impactVectors.strategicPositioning.s2, t.wizard.impactVectors.strategicPositioning.s3]} 
                          section={scores.strategicPositioning} 
                          onChange={(s) => handleScoreChange('strategicPositioning', s)} 
                        />
                        <VoteSection 
                          title={t.wizard.impactVectors.marketValidation.title} 
                          description={t.wizard.impactVectors.marketValidation.desc}
                          descriptions={[t.wizard.impactVectors.marketValidation.s1Desc, t.wizard.impactVectors.marketValidation.s2Desc, t.wizard.impactVectors.marketValidation.s3Desc]}
                          labels={[t.wizard.impactVectors.marketValidation.s1, t.wizard.impactVectors.marketValidation.s2, t.wizard.impactVectors.marketValidation.s3]} 
                          section={scores.marketValidation} 
                          onChange={(s) => handleScoreChange('marketValidation', s)} 
                        />
                      </>
                    ) : (
                      <>
                        <VoteSection 
                          title={t.wizard.impactVectors.business.shortTitle} 
                          description={t.wizard.impactVectors.business.desc}
                          descriptions={[t.wizard.impactVectors.business.s1Desc, t.wizard.impactVectors.business.s2Desc, t.wizard.impactVectors.business.s3Desc]}
                          labels={[t.wizard.impactVectors.business.s1, t.wizard.impactVectors.business.s2, t.wizard.impactVectors.business.s3]} 
                          section={scores.businessImpact} 
                          onChange={(s) => handleScoreChange('businessImpact', s)} 
                        />
                        <VoteSection 
                          title={isTechnical ? t.wizard.impactVectors.stability.shortTitle : t.wizard.impactVectors.engagement.shortTitle} 
                          description={isTechnical ? t.wizard.impactVectors.stability.desc : t.wizard.impactVectors.engagement.desc}
                          descriptions={isTechnical 
                            ? [t.wizard.impactVectors.stability.s1Desc, t.wizard.impactVectors.stability.s2Desc, t.wizard.impactVectors.stability.s3Desc] 
                            : [t.wizard.impactVectors.engagement.s1Desc, t.wizard.impactVectors.engagement.s2Desc, t.wizard.impactVectors.engagement.s3Desc]
                          }
                          labels={isTechnical ? [t.wizard.impactVectors.stability.s1, t.wizard.impactVectors.stability.s2, t.wizard.impactVectors.stability.s3] : [t.wizard.impactVectors.engagement.s1, t.wizard.impactVectors.engagement.s2, t.wizard.impactVectors.engagement.s3]} 
                          section={scores.engagement} 
                          onChange={(s) => handleScoreChange('engagement', s)} 
                        />
                        <VoteSection 
                          title={isTechnical ? t.wizard.impactVectors.risk.shortTitle : t.wizard.impactVectors.traction.shortTitle} 
                          description={isTechnical ? t.wizard.impactVectors.risk.desc : t.wizard.impactVectors.traction.desc}
                          descriptions={isTechnical 
                            ? [t.wizard.impactVectors.risk.s1Desc, t.wizard.impactVectors.risk.s2Desc, t.wizard.impactVectors.risk.s3Desc] 
                            : [t.wizard.impactVectors.traction.s1Desc, t.wizard.impactVectors.traction.s2Desc, t.wizard.impactVectors.traction.s3Desc]
                          }
                          labels={isTechnical ? [t.wizard.impactVectors.risk.s1, t.wizard.impactVectors.risk.s2, t.wizard.impactVectors.risk.s3] : [t.wizard.impactVectors.traction.s1, t.wizard.impactVectors.traction.s2, t.wizard.impactVectors.traction.s3]} 
                          section={scores.traction} 
                          onChange={(s) => handleScoreChange('traction', s)} 
                        />
                        <VoteSection 
                          title={isTechnical ? t.wizard.impactVectors.enablement.shortTitle : t.wizard.impactVectors.virality.shortTitle} 
                          description={isTechnical ? t.wizard.impactVectors.enablement.desc : t.wizard.impactVectors.virality.desc}
                          descriptions={isTechnical 
                            ? [t.wizard.impactVectors.enablement.s1Desc, t.wizard.impactVectors.enablement.s2Desc, t.wizard.impactVectors.enablement.s3Desc] 
                            : [t.wizard.impactVectors.virality.s1Desc, t.wizard.impactVectors.virality.s2Desc, t.wizard.impactVectors.virality.s3Desc]
                          }
                          labels={isTechnical ? [t.wizard.impactVectors.enablement.s1, t.wizard.impactVectors.enablement.s2, t.wizard.impactVectors.enablement.s3] : [t.wizard.impactVectors.virality.s1, t.wizard.impactVectors.virality.s2, t.wizard.impactVectors.virality.s3]} 
                          section={scores.virality} 
                          onChange={(s) => handleScoreChange('virality', s)} 
                        />
                      </>
                    )}
                  </div>

                  <div className="flex justify-center pt-8">
                    <button 
                      onClick={handleVoteSubmit}
                      disabled={isSubmitting}
                      className="px-12 py-5 bg-slate-900 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest hover:bg-slate-800 transition-all shadow-2xl disabled:opacity-50 flex items-center gap-3"
                    >
                      {isSubmitting ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      )}
                      {hasVoted ? (lang === 'es' ? 'ACTUALIZAR VOTO' : 'UPDATE VOTE') : (lang === 'es' ? 'ENVIAR VALORACIÓN' : 'SUBMIT VALUATION')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="bg-orange-50 p-6 rounded-2xl border border-orange-100 text-center">
                  <p className="text-orange-600 font-black uppercase tracking-widest text-[10px] mb-2">
                    {lang === 'es' ? 'No puedes votar en tu propia idea' : 'You cannot vote on your own idea'}
                  </p>
                  <p className="text-orange-500 text-xs font-medium">
                    {isProduct 
                      ? (lang === 'es' ? 'Tu valoración inicial ya se contabiliza automáticamente en la puntuación global.' : 'Your initial assessment is already automatically counted in the global score.')
                      : (lang === 'es' ? 'Como usuario, tu valoración inicial no computa en la media de consenso.' : 'As a user, your initial assessment does not count towards the consensus average.')
                    }
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-10 text-center">
              <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-4">{lang === 'es' ? '¿Borrar Seed?' : 'Delete Seed?'}</h3>
              <p className="text-slate-500 font-medium mb-8">
                {t.dashboard.confirmDelete.split('?')[1]?.trim() || (lang === 'es' ? 'Esta acción no se puede deshacer.' : 'This action cannot be undone.')}
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => {
                    onDelete?.(idea.id);
                    setShowDeleteConfirm(false);
                  }} 
                  className="w-full py-4 bg-rose-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-rose-700 transition-all"
                >
                  {t.common.delete}
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(false)} 
                  className="w-full py-4 bg-slate-100 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all"
                >
                  {t.common.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Vote Confirmation Modal */}
      {voteToDelete && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-10 text-center">
              <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-4">{lang === 'es' ? '¿Eliminar voto?' : 'Delete vote?'}</h3>
              <p className="text-slate-500 font-medium mb-8">
                {lang === 'es' ? 'Esta acción no se puede deshacer. La puntuación media se recalculará automáticamente.' : 'This action cannot be undone. The average score will be recalculated automatically.'}
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => {
                    if (onDeleteVote) {
                      onDeleteVote(voteToDelete);
                    }
                    setVoteToDelete(null);
                  }} 
                  className="w-full py-4 bg-rose-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-rose-700 transition-all"
                >
                  {t.common.delete}
                </button>
                <button 
                  onClick={() => setVoteToDelete(null)} 
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

const DetailCard: React.FC<{ title: string; content: string; icon: string }> = ({ title, content, icon }) => (
  <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
    <div className="flex items-center gap-3 mb-3">
      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
        {icon === 'problem' && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
        {icon === 'solution' && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>}
        {icon === 'user' && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}
        {icon === 'business' && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
        {icon === 'warning' && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
      </div>
      <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</h5>
    </div>
    <p className="text-base font-medium text-slate-600 leading-relaxed">{content}</p>
  </div>
);

const ProponentScoreItem: React.FC<{ label: string; description?: string; value: number }> = ({ label, description, value }) => (
  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col items-center text-center">
    <div className="flex items-center gap-1 mb-2">
      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest line-clamp-1" title={label}>{label}</span>
      {description && (
        <div className="group/tooltip relative inline-block">
          <Info className="w-2.5 h-2.5 text-slate-300 cursor-help hover:text-orange-500 transition-colors" />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block w-40 p-2 bg-slate-900 text-white text-[8px] font-medium rounded-lg shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
            {description}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
          </div>
        </div>
      )}
    </div>
    <span className="text-lg font-black text-slate-900">{value}</span>
  </div>
);

const IndividualScoreItem: React.FC<{ label: string; description?: string; value: number }> = ({ label, description, value }) => (
  <div className="bg-slate-50/50 p-3 rounded-xl border border-slate-100 flex flex-col items-center text-center">
    <div className="flex items-center gap-1 mb-1">
      <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest line-clamp-1" title={label}>{label}</span>
      {description && (
        <div className="group/tooltip relative inline-block">
          <Info className="w-2.5 h-2.5 text-slate-300 cursor-help hover:text-orange-500 transition-colors" />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block w-40 p-2 bg-slate-900 text-white text-[8px] font-medium rounded-lg shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
            {description}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
          </div>
        </div>
      )}
    </div>
    <span className="text-sm font-black text-slate-700">{value.toFixed(1)}</span>
  </div>
);

const SWOTBox: React.FC<{ title: string; items: string[]; type: 'emerald' | 'orange' }> = ({ title, items, type }) => (
  <div className={`p-6 rounded-2xl border ${type === 'emerald' ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'}`}>
    <h5 className={`text-[10px] font-black uppercase tracking-widest mb-4 ${type === 'emerald' ? 'text-emerald-700' : 'text-orange-700'}`}>{title}</h5>
          <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${type === 'emerald' ? 'bg-emerald-400' : 'bg-orange-400'}`} />
          <span className="text-base font-normal text-slate-600 leading-tight">{it}</span>
        </div>
      ))}
    </div>
  </div>
);

const VoteSection: React.FC<{ title: string; description?: string; descriptions?: string[]; labels: string[]; section: ImpactSection; onChange: (s: ImpactSection) => void }> = ({ title, description, descriptions, labels, section, onChange }) => {
  const { t, lang } = useLanguage();
  
  const Row = ({ l, d, v, onC }: { l: string, d?: string, v: Level, onC: (val: Level) => void }) => (
    <div className="flex justify-between items-center gap-4">
      <div className="flex items-center gap-1 flex-1">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight line-clamp-1" title={l}>{l}</span>
        {d && (
          <div className="group/tooltip relative inline-block">
            <Info className="w-2.5 h-2.5 text-slate-300 cursor-help hover:text-orange-500 transition-colors" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block w-40 p-2 bg-slate-900 text-white text-[8px] font-medium rounded-lg shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
              {d}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
            </div>
          </div>
        )}
      </div>
      <div className="flex bg-white rounded-lg border p-0.5 shadow-sm">
        {(['low', 'medium', 'high'] as Level[]).map(lvl => (
          <button 
            key={lvl} 
            onClick={() => onC(lvl)} 
            className={`px-3 py-1.5 rounded-md text-[8px] font-black uppercase transition-all ${v === lvl ? 'bg-orange-500 text-white shadow-md' : 'text-slate-300 hover:text-slate-500'}`}
          >
            {t.wizard.levels[lvl]}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 shadow-sm">
      <div className="flex items-center gap-2 mb-6 border-b pb-2">
        <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</h5>
        {description && (
          <div className="group/tooltip relative inline-block">
            <Info className="w-3 h-3 text-slate-300 cursor-help hover:text-orange-500 transition-colors" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block w-56 p-2.5 bg-slate-900 text-white text-[9px] font-medium rounded-xl shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
              {description}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-6 border-transparent border-t-slate-900"></div>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-4">
        <Row l={labels[0]} d={descriptions?.[0]} v={section.s1} onC={(v) => onChange({...section, s1: v})} />
        <Row l={labels[1]} d={descriptions?.[1]} v={section.s2} onC={(v) => onChange({...section, s2: v})} />
        <Row l={labels[2]} d={descriptions?.[2]} v={section.s3} onC={(v) => onChange({...section, s3: v})} />
      </div>
    </div>
  );
};
