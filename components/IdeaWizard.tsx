
import React, { useState, useEffect } from 'react';
import { Idea, IdeaStatus, MoSCoW, Level, IdeaData, ImpactSection, SeedType, UserRole, User } from '../types';
import { auth } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { GoogleGenAI, Type } from "@google/genai";
import { Info } from 'lucide-react';

interface IdeaWizardProps {
  onCancel: () => void;
  onSubmit: (idea: Idea) => void;
  initialData?: Idea;
}

const getLevelValue = (level: Level): number => {
  switch (level) {
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 1;
  }
};

// Calculate average numeric value for an impact section (s1, s2, s3)
const getSectionScore = (section?: ImpactSection): number => {
  if (!section || !section.s1 || !section.s2 || !section.s3) return 0;
  return (getLevelValue(section.s1) + getLevelValue(section.s2) + getLevelValue(section.s3)) / 3;
};

const calculateFinalScore = (data: Partial<IdeaData>): number => {
  const scaleTo10 = (val: number) => (val - 1) * 4.5 + 1;

  if (data.seedType === 'Business') {
    if (!data.revenuePotential || !data.distributionPower || !data.marketValidation || !data.strategicPositioning) return 0;
    const rev = getSectionScore(data.revenuePotential);
    const dist = getSectionScore(data.distributionPower);
    const strat = getSectionScore(data.strategicPositioning);
    const mark = getSectionScore(data.marketValidation);
    
    if (rev === 0 && dist === 0 && strat === 0 && mark === 0) return 0;

    const cubicScore = Math.cbrt(0.35 * Math.pow(rev, 3) + 0.30 * Math.pow(dist, 3) + 0.25 * Math.pow(strat, 3) + 0.10 * Math.pow(mark, 3));
    return Math.round(scaleTo10(cubicScore) * 10) / 10;
  }

  if (!data.businessImpact || !data.engagement || !data.traction || !data.virality) return 0;
  const biz = getSectionScore(data.businessImpact);
  const eng = getSectionScore(data.engagement);
  const tra = getSectionScore(data.traction);
  const vir = getSectionScore(data.virality);
  
  if (biz === 0 && eng === 0 && tra === 0 && vir === 0) return 0;

  const cubicScore = Math.cbrt(0.3 * Math.pow(biz, 3) + 0.3 * Math.pow(eng, 3) + 0.2 * Math.pow(tra, 3) + 0.2 * Math.pow(vir, 3));
  return Math.round(scaleTo10(cubicScore) * 10) / 10;
};

const calculateMoSCoW = (score: number): MoSCoW => {
  if (score >= 8.0) return 'Must';
  if (score >= 6.5) return 'Should';
  if (score >= 5.0) return 'Could';
  return "Won't";
};

const getMoSCoWLabel = (m: MoSCoW, lang: string) => {
  if (m === 'Must') return lang === 'es' ? 'Must Have' : 'Must Have';
  if (m === 'Should') return lang === 'es' ? 'Should Have' : 'Should Have';
  if (m === 'Could') return lang === 'es' ? 'Could Have' : 'Could Have';
  return lang === 'es' ? "Won't Have (este ciclo)" : "Won't Have (this cycle)";
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

const getConsensusStats = (idea: Idea, users: User[]) => {
  const votes = idea.votes || [];
  
  if (users.length === 0 && idea.consensusScore !== undefined && idea.consensusScore > 0) {
    return {
      score: isNaN(idea.consensusScore) ? 0 : idea.consensusScore,
      count: idea.voteCount || 0
    };
  }

  const author = users.find(u => u.id === idea.userId);
  const isAuthorProduct = author?.role?.toUpperCase() === 'ADMIN' || author?.role?.toUpperCase() === 'PRODUCT' || author?.role?.toUpperCase() === 'PRODUCT_TEAM';

  const teamAssessments = votes.filter(v => {
    if (v.userId === idea.userId) return false;
    const voterRole = v.userRole || users.find(u => u.id === v.userId)?.role;
    return voterRole?.toUpperCase() === 'PRODUCT_TEAM' || voterRole?.toUpperCase() === 'ADMIN';
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

  const count = teamAssessments.length;

  if (isAuthorProduct) {
    teamAssessments.push({
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

  if (teamAssessments.length === 0) return { score: 0, count: 0 };

  const totalScore = teamAssessments.reduce((acc, assessment) => {
    const avgBiz = getLevelValue(assessment.businessImpact?.s1 || 'low') + getLevelValue(assessment.businessImpact?.s2 || 'low') + getLevelValue(assessment.businessImpact?.s3 || 'low');
    const avgEng = getLevelValue(assessment.engagement?.s1 || 'low') + getLevelValue(assessment.engagement?.s2 || 'low') + getLevelValue(assessment.engagement?.s3 || 'low');
    const avgTra = getLevelValue(assessment.traction?.s1 || 'low') + getLevelValue(assessment.traction?.s2 || 'low') + getLevelValue(assessment.traction?.s3 || 'low');
    const avgVir = getLevelValue(assessment.virality?.s1 || 'low') + getLevelValue(assessment.virality?.s2 || 'low') + getLevelValue(assessment.virality?.s3 || 'low');
    
    const biz = avgBiz / 3;
    const eng = avgEng / 3;
    const tra = avgTra / 3;
    const vir = avgVir / 3;

    let cubicScore = 0;
    if (idea.data.seedType === 'Business') {
      const rev = (getLevelValue(assessment.revenuePotential?.s1 || 'low') + getLevelValue(assessment.revenuePotential?.s2 || 'low') + getLevelValue(assessment.revenuePotential?.s3 || 'low')) / 3;
      const dist = (getLevelValue(assessment.distributionPower?.s1 || 'low') + getLevelValue(assessment.distributionPower?.s2 || 'low') + getLevelValue(assessment.distributionPower?.s3 || 'low')) / 3;
      const strat = (getLevelValue(assessment.strategicPositioning?.s1 || 'low') + getLevelValue(assessment.strategicPositioning?.s2 || 'low') + getLevelValue(assessment.strategicPositioning?.s3 || 'low')) / 3;
      const mark = (getLevelValue(assessment.marketValidation?.s1 || 'low') + getLevelValue(assessment.marketValidation?.s2 || 'low') + getLevelValue(assessment.marketValidation?.s3 || 'low')) / 3;
      cubicScore = Math.cbrt(0.35 * Math.pow(rev, 3) + 0.30 * Math.pow(dist, 3) + 0.25 * Math.pow(strat, 3) + 0.10 * Math.pow(mark, 3));
    } else {
      cubicScore = Math.cbrt(0.3 * Math.pow(biz, 3) + 0.3 * Math.pow(eng, 3) + 0.2 * Math.pow(tra, 3) + 0.2 * Math.pow(vir, 3));
    }
    return acc + cubicScore;
  }, 0);

  const avgCubic = totalScore / teamAssessments.length;
  const scaleTo10 = (val: number) => (val - 1) * 4.5 + 1;

  return {
    score: Math.round(scaleTo10(avgCubic) * 10) / 10,
    count: teamAssessments.length
  };
};

const IdeaWizard: React.FC<IdeaWizardProps> = ({ onCancel, onSubmit, initialData }) => {
  const { user, users } = useAuth();
  const { lang, t } = useLanguage();
  const [step, setStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const steps = t.wizard.steps;
  const totalSteps = steps.length;

  const defaultSection: ImpactSection = { s1: 'low', s2: 'low', s3: 'low' };

  const [formData, setFormData] = useState<IdeaData>(() => {
    const base = initialData?.data || {
      seedName: '',
      oneSentenceSummary: '',
      seedType: 'Product',
      businessUnit: [],
      isClientRequest: false,
      isLegalRequirement: false,
      isPilot: false,
      elevatorPitch: { problem: '', solution: '' },
      expectedBenefits: { endUser: '', forUs: '' },
      costOfNotDoing: '',
      businessImpact: { ...defaultSection },
      engagement: { ...defaultSection },
      traction: { ...defaultSection },
      virality: { ...defaultSection },
      revenuePotential: { ...defaultSection },
      distributionPower: { ...defaultSection },
      marketValidation: { ...defaultSection },
      strategicPositioning: { ...defaultSection },
      calculatedScore: 0,
      moscow: 'Could',
      swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
      technicalImpact: { ...defaultSection },
      feasibility: { ...defaultSection },
      scalability: { ...defaultSection },
      supportLinks: [],
    };
    // Ensure oneSentenceSummary exists for legacy data
    return {
      ...base,
      oneSentenceSummary: base.oneSentenceSummary || '',
      supportLinks: base.supportLinks || [],
      elevatorPitch: {
        problem: base.elevatorPitch?.problem || '',
        solution: base.elevatorPitch?.solution || '',
      },
      expectedBenefits: {
        endUser: base.expectedBenefits?.endUser || '',
        forUs: base.expectedBenefits?.forUs || '',
      }
    };
  });

  useEffect(() => {
    const score = calculateFinalScore(formData);
    const moscow = calculateMoSCoW(score);
    if (formData.calculatedScore !== score || formData.moscow !== moscow) {
      setFormData(prev => ({ ...prev, calculatedScore: score, moscow: moscow }));
    }
  }, [formData.businessImpact, formData.engagement, formData.traction, formData.virality, formData.revenuePotential, formData.distributionPower, formData.marketValidation, formData.strategicPositioning, formData.seedType]);

  const handleMagicFill = async () => {
    if (!formData.seedName) return;
    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Expert product strategist at TVUP. 
        Idea Name: "${formData.seedName}"
        Seed Summary: "${formData.oneSentenceSummary || ''}"
        Support Documentation/Links: ${formData.supportLinks?.filter(l => l.trim()).join(', ') || 'None provided'}
        
        Generate a complete proposal.
        CRITICAL LANGUAGE RULE: You MUST detect the language used in the Idea Name and Seed Summary fields above. Generate ALL the output content in that exact same language. If you cannot detect the language, default to ${lang === 'es' ? 'SPANISH' : 'ENGLISH'}.
        REQUIREMENT: Be extremely synthetic, concise, direct and executive. Use max 10-15 words per explanation. Focus on business value and impact.
        SWOT: Provide up to 5 concise points for each quadrant as an array of strings.
        CRITICAL SWOT RULES:
        1. Each SWOT phrase MUST be between 3 and 8 words long and MUST end with a period.
        2. "Strengths" MUST focus on the strengths of TVUP as a company (e.g., market position, technology, team), NOT the benefits of the idea itself.
        SCORING: You must return "low", "medium", or "high" for each of the sub-metrics.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              businessUnit: { type: Type.ARRAY, items: { type: Type.STRING }, description: "TVaaS, TCS, or Tivify" },
              problem: { type: Type.STRING },
              solution: { type: Type.STRING },
              benefitEndUser: { type: Type.STRING },
              benefitUs: { type: Type.STRING },
              costOfNotDoing: { type: Type.STRING },
              bi_s1: { type: Type.STRING }, bi_s2: { type: Type.STRING }, bi_s3: { type: Type.STRING },
              en_s1: { type: Type.STRING }, en_s2: { type: Type.STRING }, en_s3: { type: Type.STRING },
              tr_s1: { type: Type.STRING }, tr_s2: { type: Type.STRING }, tr_s3: { type: Type.STRING },
              vi_s1: { type: Type.STRING }, vi_s2: { type: Type.STRING }, vi_s3: { type: Type.STRING },
              swot_strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              swot_weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
              swot_opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
              swot_threats: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["problem", "solution", "benefitEndUser", "benefitUs", "costOfNotDoing", "bi_s1", "bi_s2", "bi_s3", "en_s1", "en_s2", "en_s3", "tr_s1", "tr_s2", "tr_s3", "vi_s1", "vi_s2", "vi_s3", "swot_strengths", "swot_weaknesses", "swot_opportunities", "swot_threats"]
          }
        }
      });
      let text = response.text || '{}';
      text = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
      const result = JSON.parse(text);
      const valLvl = (l: string): Level => (['low', 'medium', 'high'].includes(l) ? l : 'low') as Level;

      setFormData(prev => ({
        ...prev,
        businessUnit: Array.isArray(result.businessUnit) ? result.businessUnit : prev.businessUnit,
        elevatorPitch: { problem: result.problem, solution: result.solution },
        expectedBenefits: { endUser: result.benefitEndUser, forUs: result.benefitUs },
        costOfNotDoing: result.costOfNotDoing,
        businessImpact: { s1: valLvl(result.bi_s1), s2: valLvl(result.bi_s2), s3: valLvl(result.bi_s3) },
        engagement: { s1: valLvl(result.en_s1), s2: valLvl(result.en_s2), s3: valLvl(result.en_s3) },
        traction: { s1: valLvl(result.tr_s1), s2: valLvl(result.tr_s2), s3: valLvl(result.tr_s3) },
        virality: { s1: valLvl(result.vi_s1), s2: valLvl(result.vi_s2), s3: valLvl(result.vi_s3) },
        swot: {
          strengths: result.swot_strengths || [],
          weaknesses: result.swot_weaknesses || [],
          opportunities: result.swot_opportunities || [],
          threats: result.swot_threats || []
        }
      }));
    } catch (e: any) { 
      console.error(e);
      alert((lang === 'es' ? "Error con IA: " : "AI Error: ") + (e.message || "Unknown error")); 
    }
    finally { setIsGenerating(false); }
  };

  const handleSave = () => {
    onSubmit({ 
      id: initialData?.id || Date.now().toString(), 
      userId: initialData?.userId || user?.id || '', 
      authorName: initialData?.authorName || auth.currentUser?.displayName || user?.name || user?.email || 'Anonymous', 
      date: initialData?.date || new Date().toISOString().split('T')[0], 
      status: initialData?.status || IdeaStatus.PENDING, 
      data: formData, 
      votes: initialData?.votes || [] 
    });
  };

  const [isDirty, setIsDirty] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDirty) {
          setShowCloseConfirm(true);
        } else {
          onCancel();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, lang, onCancel]);

  const updateField = (path: string, value: any) => {
    setIsDirty(true);
    const keys = path.split('.');
    if (keys.length === 1) setFormData(prev => ({ ...prev, [keys[0] as keyof IdeaData]: value }));
    else if (keys.length === 2) setFormData(prev => ({ ...prev, [keys[0] as keyof IdeaData]: { ...(prev[keys[0] as keyof IdeaData] as any), [keys[1]]: value } }));
  };

  const buOptions = ['TVaaS', 'TCS', 'Tivify'];

  const MagicIcon = () => (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
      <path d="M5 3v4"/><path d="M3 5h4"/><path d="M21 17v4"/><path d="M19 19h4"/>
    </svg>
  );

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" style={{ colorScheme: 'light' }}>
      <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 p-8 text-white shrink-0">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-black">{initialData ? t.wizard.editIdea : t.wizard.newIdea}</h2>
            <span className="bg-orange-500 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">{t.wizard.step} {step} {t.wizard.of} {totalSteps}</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div className="bg-orange-500 h-full transition-all duration-500" style={{ width: `${(step / totalSteps) * 100}%` }} />
          </div>
          <div className="flex justify-between mt-4">
            {steps.map((s: string, i: number) => {
              const stepNum = i + 1;
              const isClickable = stepNum < step || (stepNum > step && formData.seedName);
              return (
                <button 
                  key={i} 
                  disabled={!isClickable && stepNum !== step}
                  onClick={() => setStep(stepNum)}
                  className={`px-3 py-2 text-[8px] font-black uppercase tracking-widest transition-all rounded-xl ${stepNum === step ? 'text-orange-500 bg-white/5' : isClickable ? 'text-slate-400 hover:text-white hover:bg-white/10' : 'text-slate-700 cursor-not-allowed'}`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-10">
          {step === 1 && (
          <div className="space-y-8 animate-in slide-in-from-right-4">
            <h3 className="text-lg font-black text-slate-800 border-b pb-2">{t.wizard.basicInfo}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="md:col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.wizard.ideaName}</label>
                <input type="text" value={formData.seedName || ''} onChange={e => updateField('seedName', e.target.value)} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold text-sm transition-all" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.wizard.oneSentenceSummary}</label>
                <textarea value={formData.oneSentenceSummary || ''} onChange={e => updateField('oneSentenceSummary', e.target.value)} rows={3} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold text-sm transition-all resize-none" placeholder={t.wizard.seedSummaryPlaceholder} />
              </div>

              <div className="md:col-span-2 flex justify-center">
                <button onClick={handleMagicFill} disabled={!formData.seedName || isGenerating} className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-orange-500 text-white font-black text-xs uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg disabled:opacity-40">
                  {isGenerating ? <span className="animate-spin text-lg">◌</span> : <MagicIcon />}
                  {isGenerating ? '...' : t.wizard.magicFill}
                </button>
              </div>

              <div className="md:col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.wizard.seedType}</label>
                <div className="flex gap-2">
                  <div className="flex-1 relative group">
                    <div className="absolute top-2 right-2 z-10">
                      <div className="relative group/tooltip">
                        <div className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-black text-slate-500 cursor-help hover:bg-orange-500 hover:text-white transition-colors">i</div>
                        <div className="absolute bottom-full right-0 mb-2 w-64 p-3 bg-slate-900 text-white text-[10px] font-medium rounded-xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all shadow-2xl pointer-events-none leading-relaxed">
                          {t.wizard.productSeedTooltip}
                          <div className="absolute top-full right-2 border-8 border-transparent border-t-slate-900"></div>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => updateField('seedType', 'Product')} className={`w-full py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all border-2 ${formData.seedType === 'Product' ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-100 text-slate-400'}`}>{t.wizard.productSeed}</button>
                  </div>
                  
                  <div className="flex-1 relative group">
                    <div className="absolute top-2 right-2 z-10">
                      <div className="relative group/tooltip">
                        <div className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-black text-slate-500 cursor-help hover:bg-orange-500 hover:text-white transition-colors">i</div>
                        <div className="absolute bottom-full right-0 mb-2 w-64 p-3 bg-slate-900 text-white text-[10px] font-medium rounded-xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all shadow-2xl pointer-events-none leading-relaxed">
                          {t.wizard.technicalSeedTooltip}
                          <div className="absolute top-full right-2 border-8 border-transparent border-t-slate-900"></div>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => updateField('seedType', 'Technical')} className={`w-full py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all border-2 ${formData.seedType === 'Technical' ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-100 text-slate-400'}`}>{t.wizard.technicalSeed}</button>
                  </div>

                  <div className="flex-1 relative group">
                    <div className="absolute top-2 right-2 z-10">
                      <div className="relative group/tooltip">
                        <div className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-black text-slate-500 cursor-help hover:bg-orange-500 hover:text-white transition-colors">i</div>
                        <div className="absolute bottom-full right-0 mb-2 w-64 p-3 bg-slate-900 text-white text-[10px] font-medium rounded-xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all shadow-2xl pointer-events-none leading-relaxed">
                          {t.wizard.businessSeedTooltip}
                          <div className="absolute top-full right-2 border-8 border-transparent border-t-slate-900"></div>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => updateField('seedType', 'Business')} className={`w-full py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all border-2 ${formData.seedType === 'Business' ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-100 text-slate-400'}`}>{t.wizard.businessSeed}</button>
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.wizard.businessUnit}</label>
                <div className="flex flex-wrap gap-2 mb-4">
                  {buOptions.map(bu => {
                    const isSelected = formData.businessUnit.includes(bu);
                    return (
                      <button
                        key={bu}
                        onClick={() => {
                          const next = isSelected 
                            ? formData.businessUnit.filter(i => i !== bu)
                            : [...formData.businessUnit, bu];
                          updateField('businessUnit', next);
                        }}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                          isSelected ? 'bg-slate-900 border-slate-900 text-white shadow-md' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'
                        }`}
                      >
                        {bu}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-6 mt-4">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="clientRequest" 
                      checked={formData.isClientRequest || false}
                      onChange={(e) => updateField('isClientRequest', e.target.checked)}
                      className="w-4 h-4 text-orange-500 rounded border-slate-300 focus:ring-orange-500 cursor-pointer"
                    />
                    <label htmlFor="clientRequest" className="text-sm font-bold text-slate-700 cursor-pointer">
                      {t.wizard.clientRequest}
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="legalRequirement" 
                      checked={formData.isLegalRequirement || false}
                      onChange={(e) => updateField('isLegalRequirement', e.target.checked)}
                      className="w-4 h-4 text-orange-500 rounded border-slate-300 focus:ring-orange-500 cursor-pointer"
                    />
                    <label htmlFor="legalRequirement" className="text-sm font-bold text-slate-700 cursor-pointer">
                      {t.wizard.legalRequirement}
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="pilot" 
                      checked={formData.isPilot || false}
                      onChange={(e) => updateField('isPilot', e.target.checked)}
                      className="w-4 h-4 text-orange-500 rounded border-slate-300 focus:ring-orange-500 cursor-pointer"
                    />
                    <label htmlFor="pilot" className="text-sm font-bold text-slate-700 cursor-pointer">
                      {t.wizard.pilot}
                    </label>
                  </div>
                </div>
                
                {formData.isClientRequest && (
                  <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <input 
                      type="text" 
                      placeholder={t.wizard.clientName}
                      value={formData.clientName || ''} 
                      onChange={e => updateField('clientName', e.target.value)} 
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold text-sm transition-all" 
                    />
                  </div>
                )}
              </div>

              <div className="md:col-span-2 space-y-4 pt-4">
                <div className="flex justify-between items-end border-b pb-2">
                  <h3 className="text-lg font-black text-slate-800">{t.wizard.supportDocs}</h3>
                </div>
                <p className="text-xs text-slate-500 font-medium">{t.wizard.supportDocsPlaceholder}</p>
                <div className="space-y-2">
                  {(formData.supportLinks || []).map((link, idx) => (
                    <div key={idx} className="flex gap-2 animate-in fade-in slide-in-from-left-2 duration-300">
                      <input 
                        type="url" 
                        value={link} 
                        onChange={(e) => {
                          const newLinks = [...(formData.supportLinks || [])];
                          newLinks[idx] = e.target.value;
                          updateField('supportLinks', newLinks);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                            const arr = formData.supportLinks || [];
                            if (link.trim() !== '' && idx === arr.length - 1) {
                              updateField('supportLinks', [...arr, '']);
                            }
                          }
                        }}
                        placeholder="https://..."
                        className="flex-1 px-4 py-2 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold text-sm transition-all"
                      />
                      <button 
                        onClick={() => {
                          const newLinks = (formData.supportLinks || []).filter((_, i) => i !== idx);
                          updateField('supportLinks', newLinks);
                        }}
                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                  <button 
                    onClick={() => updateField('supportLinks', [...(formData.supportLinks || []), ''])}
                    className="text-xs font-black text-orange-500 uppercase tracking-widest hover:text-orange-600 transition-all flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    {t.wizard.addItem}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-8 animate-in slide-in-from-right-4">
            <h3 className="text-lg font-black text-slate-800 border-b pb-2">{t.wizard.elevatorPitch}</h3>
            <Textarea label={t.wizard.problem} value={formData.elevatorPitch.problem} onChange={v => updateField('elevatorPitch.problem', v)} />
            <Textarea label={t.wizard.solution} value={formData.elevatorPitch.solution} onChange={v => updateField('elevatorPitch.solution', v)} />
          </div>
        )}
        {step === 3 && (
          <div className="space-y-8 animate-in slide-in-from-right-4">
            <h3 className="text-lg font-black text-slate-800 border-b pb-2">{t.wizard.benefits}</h3>
            <Textarea label={t.wizard.forUser} value={formData.expectedBenefits.endUser} onChange={v => updateField('expectedBenefits.endUser', v)} />
            <Textarea label={t.wizard.forUs} value={formData.expectedBenefits.forUs} onChange={v => updateField('expectedBenefits.forUs', v)} />
            <Textarea label={t.wizard.costNotDoing} value={formData.costOfNotDoing} onChange={v => updateField('costOfNotDoing', v)} />
          </div>
        )}
        {step === 4 && (
          <div className="space-y-8 animate-in slide-in-from-right-4">
            <h3 className="text-lg font-black text-slate-800 border-b pb-2">{t.wizard.swot}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <SWOTQuadrant 
                label={t.wizard.strengths} 
                items={formData.swot.strengths} 
                color="emerald" 
                onChange={items => setFormData(prev => ({ ...prev, swot: { ...prev.swot, strengths: items } }))}
              />
              <SWOTQuadrant 
                label={t.wizard.opportunities} 
                items={formData.swot.opportunities} 
                color="emerald" 
                onChange={items => setFormData(prev => ({ ...prev, swot: { ...prev.swot, opportunities: items } }))}
              />
              <SWOTQuadrant 
                label={t.wizard.weaknesses} 
                items={formData.swot.weaknesses} 
                color="orange" 
                onChange={items => setFormData(prev => ({ ...prev, swot: { ...prev.swot, weaknesses: items } }))}
              />
              <SWOTQuadrant 
                label={t.wizard.threats} 
                items={formData.swot.threats} 
                color="orange" 
                onChange={items => setFormData(prev => ({ ...prev, swot: { ...prev.swot, threats: items } }))}
              />
            </div>
          </div>
        )}
        {step === 5 && (
          <div className="space-y-8 animate-in slide-in-from-right-4">
            <div className="flex justify-between items-end border-b pb-4">
              <h3 className="text-lg font-black text-slate-800">{t.wizard.valoration}</h3>
              <div className="text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {user?.role?.toUpperCase() === 'USER' ? (lang === 'es' ? 'Tu Puntuación' : 'Your Score') : t.wizard.globalScore}
                </p>
                <p className="text-2xl font-black text-slate-900">{formData.calculatedScore}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-12">
              {formData.seedType === 'Product' && (
                <>
                  <ImpactBlock 
                    title={t.wizard.impactVectors.business.shortTitle} 
                    description={t.wizard.impactVectors.business.desc}
                    section={formData.businessImpact} 
                    labels={[t.wizard.impactVectors.business.s1, t.wizard.impactVectors.business.s2, t.wizard.impactVectors.business.s3]} 
                    descriptions={[t.wizard.impactVectors.business.s1Desc, t.wizard.impactVectors.business.s2Desc, t.wizard.impactVectors.business.s3Desc]}
                    onChange={val => updateField('businessImpact', val)} 
                  />
                  <ImpactBlock 
                    title={t.wizard.impactVectors.engagement.shortTitle} 
                    description={t.wizard.impactVectors.engagement.desc}
                    section={formData.engagement} 
                    labels={[t.wizard.impactVectors.engagement.s1, t.wizard.impactVectors.engagement.s2, t.wizard.impactVectors.engagement.s3]} 
                    descriptions={[t.wizard.impactVectors.engagement.s1Desc, t.wizard.impactVectors.engagement.s2Desc, t.wizard.impactVectors.engagement.s3Desc]}
                    onChange={val => updateField('engagement', val)} 
                  />
                  <ImpactBlock 
                    title={t.wizard.impactVectors.traction.shortTitle} 
                    description={t.wizard.impactVectors.traction.desc}
                    section={formData.traction} 
                    labels={[t.wizard.impactVectors.traction.s1, t.wizard.impactVectors.traction.s2, t.wizard.impactVectors.traction.s3]} 
                    descriptions={[t.wizard.impactVectors.traction.s1Desc, t.wizard.impactVectors.traction.s2Desc, t.wizard.impactVectors.traction.s3Desc]}
                    onChange={val => updateField('traction', val)} 
                  />
                  <ImpactBlock 
                    title={t.wizard.impactVectors.virality.shortTitle} 
                    description={t.wizard.impactVectors.virality.desc}
                    section={formData.virality} 
                    labels={[t.wizard.impactVectors.virality.s1, t.wizard.impactVectors.virality.s2, t.wizard.impactVectors.virality.s3]} 
                    descriptions={[t.wizard.impactVectors.virality.s1Desc, t.wizard.impactVectors.virality.s2Desc, t.wizard.impactVectors.virality.s3Desc]}
                    onChange={val => updateField('virality', val)} 
                  />
                </>
              )}
              {formData.seedType === 'Technical' && (
                <>
                  <ImpactBlock 
                    title={t.wizard.impactVectors.business.shortTitle} 
                    description={t.wizard.impactVectors.business.desc}
                    section={formData.businessImpact} 
                    labels={[t.wizard.impactVectors.business.s1, t.wizard.impactVectors.business.s2, t.wizard.impactVectors.business.s3]} 
                    descriptions={[t.wizard.impactVectors.business.s1Desc, t.wizard.impactVectors.business.s2Desc, t.wizard.impactVectors.business.s3Desc]}
                    onChange={val => updateField('businessImpact', val)} 
                  />
                  <ImpactBlock 
                    title={t.wizard.impactVectors.stability.shortTitle} 
                    description={t.wizard.impactVectors.stability.desc}
                    section={formData.engagement} 
                    labels={[t.wizard.impactVectors.stability.s1, t.wizard.impactVectors.stability.s2, t.wizard.impactVectors.stability.s3]} 
                    descriptions={[t.wizard.impactVectors.stability.s1Desc, t.wizard.impactVectors.stability.s2Desc, t.wizard.impactVectors.stability.s3Desc]}
                    onChange={val => updateField('engagement', val)} 
                  />
                  <ImpactBlock 
                    title={t.wizard.impactVectors.risk.shortTitle} 
                    description={t.wizard.impactVectors.risk.desc}
                    section={formData.traction} 
                    labels={[t.wizard.impactVectors.risk.s1, t.wizard.impactVectors.risk.s2, t.wizard.impactVectors.risk.s3]} 
                    descriptions={[t.wizard.impactVectors.risk.s1Desc, t.wizard.impactVectors.risk.s2Desc, t.wizard.impactVectors.risk.s3Desc]}
                    onChange={val => updateField('traction', val)} 
                  />
                  <ImpactBlock 
                    title={t.wizard.impactVectors.enablement.shortTitle} 
                    description={t.wizard.impactVectors.enablement.desc}
                    section={formData.virality} 
                    labels={[t.wizard.impactVectors.enablement.s1, t.wizard.impactVectors.enablement.s2, t.wizard.impactVectors.enablement.s3]} 
                    descriptions={[t.wizard.impactVectors.enablement.s1Desc, t.wizard.impactVectors.enablement.s2Desc, t.wizard.impactVectors.enablement.s3Desc]}
                    onChange={val => updateField('virality', val)} 
                  />
                </>
              )}
              {formData.seedType === 'Business' && (
                <>
                  <ImpactBlock 
                    title={t.wizard.impactVectors.revenuePotential.title} 
                    description={t.wizard.impactVectors.revenuePotential.desc}
                    section={formData.revenuePotential || defaultSection} 
                    labels={[t.wizard.impactVectors.revenuePotential.s1, t.wizard.impactVectors.revenuePotential.s2, t.wizard.impactVectors.revenuePotential.s3]} 
                    descriptions={[t.wizard.impactVectors.revenuePotential.s1Desc, t.wizard.impactVectors.revenuePotential.s2Desc, t.wizard.impactVectors.revenuePotential.s3Desc]}
                    onChange={val => updateField('revenuePotential', val)} 
                  />
                  <ImpactBlock 
                    title={t.wizard.impactVectors.distributionPower.title} 
                    description={t.wizard.impactVectors.distributionPower.desc}
                    section={formData.distributionPower || defaultSection} 
                    labels={[t.wizard.impactVectors.distributionPower.s1, t.wizard.impactVectors.distributionPower.s2, t.wizard.impactVectors.distributionPower.s3]} 
                    descriptions={[t.wizard.impactVectors.distributionPower.s1Desc, t.wizard.impactVectors.distributionPower.s2Desc, t.wizard.impactVectors.distributionPower.s3Desc]}
                    onChange={val => updateField('distributionPower', val)} 
                  />
                  <ImpactBlock 
                    title={t.wizard.impactVectors.strategicPositioning.title} 
                    description={t.wizard.impactVectors.strategicPositioning.desc}
                    section={formData.strategicPositioning || defaultSection} 
                    labels={[t.wizard.impactVectors.strategicPositioning.s1, t.wizard.impactVectors.strategicPositioning.s2, t.wizard.impactVectors.strategicPositioning.s3]} 
                    descriptions={[t.wizard.impactVectors.strategicPositioning.s1Desc, t.wizard.impactVectors.strategicPositioning.s2Desc, t.wizard.impactVectors.strategicPositioning.s3Desc]}
                    onChange={val => updateField('strategicPositioning', val)} 
                  />
                  <ImpactBlock 
                    title={t.wizard.impactVectors.marketValidation.title} 
                    description={t.wizard.impactVectors.marketValidation.desc}
                    section={formData.marketValidation || defaultSection} 
                    labels={[t.wizard.impactVectors.marketValidation.s1, t.wizard.impactVectors.marketValidation.s2, t.wizard.impactVectors.marketValidation.s3]} 
                    descriptions={[t.wizard.impactVectors.marketValidation.s1Desc, t.wizard.impactVectors.marketValidation.s2Desc, t.wizard.impactVectors.marketValidation.s3Desc]}
                    onChange={val => updateField('marketValidation', val)} 
                  />
                </>
              )}
            </div>
          </div>
        )}
        {step === 6 && (
          <div className="text-center py-6 animate-in slide-in-from-right-4">
            <h3 className="text-2xl font-black text-slate-900 mb-4 tracking-tight">{t.wizard.ready}</h3>
            <p className="max-w-xl mx-auto text-sm text-slate-500 mb-10">{t.wizard.seedSubmittedText}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="p-10 bg-slate-900 text-white rounded-[2.5rem] text-left shadow-2xl relative overflow-hidden">
                {user?.role?.toUpperCase() === 'USER' ? (
                  (initialData ? getConsensusStats(initialData, users).count : 0) > 0 ? (
                    <>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Avg. Score</p>
                      <div className="flex items-baseline gap-2 mt-4">
                        <span className="text-6xl font-black">{initialData ? getConsensusStats(initialData, users).score : 0}</span>
                        <span className="text-slate-500 font-bold text-lg">/ 10</span>
                      </div>
                      <div className="mt-10">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">MoSCoW</p>
                        <p className={`text-2xl font-black mt-2 ${getMoSCoWColor(calculateMoSCoW(initialData ? getConsensusStats(initialData, users).score : 0))}`}>
                          {getMoSCoWLabel(calculateMoSCoW(initialData ? getConsensusStats(initialData, users).score : 0), lang)}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                      <svg className="w-12 h-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm font-medium text-slate-300">
                        {lang === 'es' 
                          ? 'Valoración pendiente. El equipo de producto va a valorar tu iniciativa. Cuando esté valorada verás la puntuación que ha recibido.' 
                          : 'Pending valuation. The product team will evaluate your initiative. Once evaluated, you will see the score it has received.'}
                      </p>
                    </div>
                  )
                ) : (
                  <>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.wizard.globalScore}</p>
                    <div className="flex items-baseline gap-2 mt-4">
                      <span className="text-6xl font-black">{formData.calculatedScore}</span>
                      <span className="text-slate-500 font-bold text-lg">/ 10</span>
                    </div>
                    <div className="mt-10">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">MoSCoW</p>
                      <p className={`text-2xl font-black mt-2 ${getMoSCoWColor(formData.moscow)}`}>{getMoSCoWLabel(formData.moscow, lang)}</p>
                    </div>
                  </>
                )}
              </div>
              <div className="p-10 bg-slate-50 rounded-[2.5rem] text-left border border-slate-200">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-8">{t.wizard.scorecard}</p>
                <div className="space-y-5">
                  {formData.seedType === 'Business' ? (
                    <>
                      <SummaryItem 
                        label={t.wizard.impactVectors.revenuePotential.title} 
                        description={t.wizard.impactVectors.revenuePotential.desc}
                        value={getSectionScore(formData.revenuePotential)} 
                        weight="35%" 
                      />
                      <SummaryItem 
                        label={t.wizard.impactVectors.distributionPower.title} 
                        description={t.wizard.impactVectors.distributionPower.desc}
                        value={getSectionScore(formData.distributionPower)} 
                        weight="30%" 
                      />
                      <SummaryItem 
                        label={t.wizard.impactVectors.strategicPositioning.title} 
                        description={t.wizard.impactVectors.strategicPositioning.desc}
                        value={getSectionScore(formData.strategicPositioning)} 
                        weight="25%" 
                      />
                      <SummaryItem 
                        label={t.wizard.impactVectors.marketValidation.title} 
                        description={t.wizard.impactVectors.marketValidation.desc}
                        value={getSectionScore(formData.marketValidation)} 
                        weight="10%" 
                      />
                    </>
                  ) : (
                    <>
                      <SummaryItem 
                        label={t.wizard.impactVectors.business.shortTitle} 
                        description={t.wizard.impactVectors.business.desc}
                        value={getSectionScore(formData.businessImpact)} 
                        weight="40%" 
                      />
                      <SummaryItem 
                        label={formData.seedType === 'Technical' ? t.wizard.impactVectors.stability.shortTitle : t.wizard.impactVectors.engagement.shortTitle} 
                        description={formData.seedType === 'Technical' ? t.wizard.impactVectors.stability.desc : t.wizard.impactVectors.engagement.desc}
                        value={getSectionScore(formData.engagement)} 
                        weight="30%" 
                      />
                      <SummaryItem 
                        label={formData.seedType === 'Technical' ? t.wizard.impactVectors.risk.shortTitle : t.wizard.impactVectors.traction.shortTitle} 
                        description={formData.seedType === 'Technical' ? t.wizard.impactVectors.risk.desc : t.wizard.impactVectors.traction.desc}
                        value={getSectionScore(formData.traction)} 
                        weight="20%" 
                      />
                      <SummaryItem 
                        label={formData.seedType === 'Technical' ? t.wizard.impactVectors.enablement.shortTitle : t.wizard.impactVectors.virality.shortTitle} 
                        description={formData.seedType === 'Technical' ? t.wizard.impactVectors.enablement.desc : t.wizard.impactVectors.virality.desc}
                        value={getSectionScore(formData.virality)} 
                        weight="10%" 
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-8 border-t border-slate-100 flex justify-between bg-slate-50/50 shrink-0">
        <button 
          onClick={() => {
            if (isDirty) {
              setShowCloseConfirm(true);
            } else {
              onCancel();
            }
          }} 
          className="px-8 py-4 font-black text-xs uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors"
        >
          {t.wizard.cancel}
        </button>
        <div className="flex gap-4 items-center">
          {initialData && step < totalSteps && (
            <button 
              onClick={handleSave}
              title={t.wizard.saveChanges}
              className="p-4 bg-slate-100 text-slate-600 rounded-2xl hover:bg-slate-200 transition-all shadow-sm flex items-center justify-center"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            </button>
          )}
          {step > 1 && (
            <button onClick={() => setStep(step - 1)} className="px-8 py-4 font-black text-xs uppercase tracking-widest text-slate-700 hover:text-slate-900 transition-colors">{t.wizard.back}</button>
          )}
          {step < totalSteps ? (
            <button onClick={() => setStep(step + 1)} disabled={step === 1 && !formData.seedName} className="px-10 py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-slate-800 disabled:opacity-30 transition-all">{t.wizard.next}</button>
          ) : (
            <button onClick={handleSave} className="px-10 py-4 bg-orange-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-orange-700 transition-all">{initialData ? t.wizard.saveChanges : t.wizard.submit}</button>
          )}
        </div>
      </div>

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
                    onCancel();
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
  </div>
);
};

const ImpactBlock: React.FC<{ title: string; description?: string; section: ImpactSection; labels: string[]; descriptions?: string[]; onChange: (s: ImpactSection) => void }> = ({ title, description, section, labels, descriptions, onChange }) => {
  return (
    <div className="bg-slate-50 p-8 rounded-[2rem] border border-slate-100">
      <div className="flex items-center gap-2 mb-6 border-b border-slate-200 pb-2">
        <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">{title}</h4>
        {description && (
          <div className="group/tooltip relative inline-block">
            <Info className="w-3.5 h-3.5 text-slate-400 cursor-help hover:text-orange-500 transition-colors" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block w-64 p-3 bg-slate-900 text-white text-[10px] font-medium rounded-xl shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
              {description}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900"></div>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-6">
        <SubImpactRow label={labels[0]} description={descriptions?.[0]} value={section.s1} onChange={v => onChange({ ...section, s1: v })} />
        <SubImpactRow label={labels[1]} description={descriptions?.[1]} value={section.s2} onChange={v => onChange({ ...section, s2: v })} />
        <SubImpactRow label={labels[2]} description={descriptions?.[2]} value={section.s3} onChange={v => onChange({ ...section, s3: v })} />
      </div>
    </div>
  );
};

const SubImpactRow: React.FC<{ label: string; description?: string; value: Level; onChange: (v: Level) => void }> = ({ label, description, value, onChange }) => {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">{label}</span>
        {description && (
          <div className="group/tooltip relative inline-block">
            <Info className="w-3 h-3 text-slate-300 cursor-help hover:text-orange-500 transition-colors" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block w-64 p-3 bg-slate-900 text-white text-[10px] font-medium rounded-xl shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
              {description}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900"></div>
            </div>
          </div>
        )}
      </div>
      <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-100">
        {(['low', 'medium', 'high'] as Level[]).map(lvl => (
          <button key={lvl} onClick={() => onChange(lvl)} className={`px-4 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all ${value === lvl ? 'bg-orange-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>{t.wizard.levels[lvl]}</button>
        ))}
      </div>
    </div>
  );
};

const Textarea: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => {
  return (
    <div className="relative">
      <div className="flex justify-between items-center mb-2">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      </div>
      <textarea value={value || ''} onChange={e => onChange(e.target.value)} rows={3} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold text-sm transition-all resize-none" />
    </div>
  );
};

const SWOTQuadrant: React.FC<{ label: string; items: string[]; color: string; onChange: (v: string[]) => void }> = ({ label, items, color, onChange }) => {
  const { t } = useLanguage();
  const [newItem, setNewItem] = useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items]);

  const addItem = () => { if (newItem.trim()) { onChange([...items, newItem.trim()]); setNewItem(''); } };
  const removeItem = (idx: number) => { onChange(items.filter((_, i) => i !== idx)); };

  return (
    <div className={`p-6 rounded-2xl border flex flex-col h-full ${color === 'emerald' ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'}`}>
      <div className="flex justify-between items-center mb-4">
        <label className={`block text-[11px] font-black uppercase tracking-widest ${color === 'emerald' ? 'text-emerald-700' : 'text-orange-700'}`}>{label}</label>
      </div>
      <div ref={scrollRef} className="space-y-2 mb-4 flex-grow overflow-y-auto max-h-48 pr-1 custom-scrollbar">
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between gap-3 bg-white p-2.5 rounded-lg shadow-sm group">
            <span className="text-xs font-medium text-slate-700 leading-tight">{it}</span>
            <button onClick={() => removeItem(i)} className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all p-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input 
          type="text" 
          value={newItem} 
          onChange={e => setNewItem(e.target.value)} 
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder={t.wizard.addItem}
          className="flex-1 px-3 py-2 rounded-lg border-none focus:ring-2 focus:ring-orange-500 text-xs font-medium bg-white/70" 
        />
        <button onClick={addItem} className="px-3 bg-slate-900 text-white rounded-lg flex items-center justify-center hover:bg-slate-800 transition-all shadow-sm">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path d="M12 4v16m8-8H4" /></svg>
        </button>
      </div>
    </div>
  );
};

const SummaryItem: React.FC<{ label: string; description?: string; value: number; weight: string }> = ({ label, description, value, weight }) => {
  const { t } = useLanguage();
  const getLevelFromScore = (score: number): Level => {
    if (score >= 8) return 'high';
    if (score >= 5) return 'medium';
    return 'low';
  };
  const lvl = getLevelFromScore(value);
  return (
    <div className="flex justify-between items-center p-3 hover:bg-white hover:shadow-sm rounded-xl transition-all">
      <div className="flex items-center gap-2">
        <span className="font-black text-[10px] text-slate-500 uppercase tracking-widest">{label} <span className="text-[8px] font-bold opacity-30 ml-1">({weight})</span></span>
        {description && (
          <div className="group/tooltip relative inline-block">
            <Info className="w-3 h-3 text-slate-300 cursor-help hover:text-orange-500 transition-colors" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block w-48 p-2 bg-slate-900 text-white text-[9px] font-medium rounded-lg shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
              {description}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
            </div>
          </div>
        )}
      </div>
      <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${lvl === 'high' ? 'bg-emerald-50 text-emerald-600' : lvl === 'medium' ? 'bg-amber-50 text-amber-500' : 'bg-slate-100 text-slate-400'}`}>{t.wizard.levels[lvl]}</span>
    </div>
  );
};

export default IdeaWizard;