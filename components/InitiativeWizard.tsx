
import React, { useState, useEffect } from 'react';
import { 
  InitiativeData, 
  InitiativeStatus, 
  Idea, 
  IdeaStatus, 
  Language,
  UserRole
} from '../types';
import { GoogleGenAI, Type } from "@google/genai";
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { db } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc,
  doc,
  updateDoc
} from 'firebase/firestore';
import { StatusBadge } from './StatusBadge';

interface InitiativeWizardProps {
  onCancel: () => void;
  initialData?: InitiativeData;
  readOnly?: boolean;
}

const InitiativeWizard: React.FC<InitiativeWizardProps> = ({ onCancel, initialData, readOnly = false }) => {
  const { user } = useAuth();
  const { lang, t } = useLanguage();
  const [step, setStep] = useState(0);

  const [formData, setFormData] = useState<Omit<InitiativeData, 'id'>>(() => {
    if (initialData) {
      const { id, ...rest } = initialData;
      return {
        ...rest,
        strengths: rest.strengths || [],
        weaknesses: rest.weaknesses || [],
        opportunities: rest.opportunities || [],
        threats: rest.threats || [],
        businessUnits: rest.businessUnits || [],
        supportLinks: rest.supportLinks || []
      };
    }
    return {
      seedId: '',
      seedName: '',
      createdByUserId: user?.id || '',
      createdByUserName: user?.name || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'draft',
      title: '',
      shortDescription: '',
      proponentName: user?.name || '',
      sponsorName: '',
      collaborators: '',
      involvedAreas: '',
      businessUnits: [],
      elevatorPitchProblem: '',
      elevatorPitchSolution: '',
      expectedBenefitsEndUser: '',
      expectedBenefitsInternalClients: '',
      expectedBenefitsUs: '',
      costOfNotDoing: '',
      strengths: [],
      opportunities: [],
      weaknesses: [],
      threats: [],
      developmentCosts: 0,
      developmentCostsExplanation: '',
      operationalCosts: 0,
      operationalCostsExplanation: '',
      npv3Years: 0,
      npvExplanation: '',
      payback: 0,
      paybackExplanation: '',
      economicExplanation: '',
      strategicFitOverall: 0,
      financialScore: 0,
      clientScore: 0,
      internalScore: 0,
      learningScore: 0,
      strategicScore: 0,
      requiresCfoAnalysis: false,
      cfoAnalysis: '',
      supportLinks: []
    };
  });

  useEffect(() => {
    if (user && !formData.createdByUserId) {
      setFormData(prev => ({
        ...prev,
        createdByUserId: user.id,
        createdByUserName: user.name,
        proponentName: prev.proponentName || user.name
      }));
    }
  }, [user]);

  const [isMagicPromptOpen, setIsMagicPromptOpen] = useState(false);
  const [isRoadmapConfirmOpen, setIsRoadmapConfirmOpen] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);

  const performMagicFill = async (overwrite: boolean) => {
    if (!formData.seedName) return;
    setMagicLoading(true);
    setIsMagicPromptOpen(false);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Based on this seed:
        Name: ${formData.seedName}
        Summary: ${formData.shortDescription || ''}
        Problem: ${formData.elevatorPitchProblem || ''}
        Solution: ${formData.elevatorPitchSolution || ''}
        Support Documentation/Links: ${formData.supportLinks?.filter(l => l.trim()).join(', ') || 'None provided'}
        
        Generate a detailed innovation initiative in JSON format with these fields.
        REQUIREMENT: Be extremely synthetic, concise, direct and executive. Use max 10-15 words per explanation. Focus on business value and impact.
        CRITICAL LANGUAGE RULE: You MUST detect the language used in the Name and Summary fields above. Generate ALL the output content in that exact same language. If you cannot detect the language, default to ${lang === 'es' ? 'Spanish' : 'English'}.
        CRITICAL SWOT RULES:
        1. Each SWOT phrase (strengths, weaknesses, opportunities, threats) MUST be between 3 and 8 words long and MUST end with a period.
        2. "Strengths" MUST focus on the strengths of TVUP as a company (e.g., market position, technology, team), NOT the benefits of the initiative itself.
        
        - elevatorPitchProblem: Key highlights of the problem.
        - elevatorPitchSolution: Key highlights of the solution.
        - expectedBenefitsEndUser: Detailed benefits for the user.
        - expectedBenefitsInternalClients: Detailed benefits for internal stakeholders.
        - expectedBenefitsUs: Detailed business benefits.
        - costOfNotDoing: What happens if we don't do this.
        - strengths: Array of up to 5 concise strengths.
        - weaknesses: Array of up to 5 concise weaknesses.
        - opportunities: Array of up to 5 concise opportunities.
        - threats: Array of up to 5 concise threats.
        - economicExplanation: A logical, synthetic explanation for development costs, operational costs, and ROI.
        
        Return ONLY valid JSON.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              elevatorPitchProblem: { type: Type.STRING },
              elevatorPitchSolution: { type: Type.STRING },
              expectedBenefitsEndUser: { type: Type.STRING },
              expectedBenefitsInternalClients: { type: Type.STRING },
              expectedBenefitsUs: { type: Type.STRING },
              costOfNotDoing: { type: Type.STRING },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
              opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
              threats: { type: Type.ARRAY, items: { type: Type.STRING } },
              economicExplanation: { type: Type.STRING }
            }
          }
        }
      });

      let text = response.text || '{}';
      text = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
      const result = JSON.parse(text);
      
      setFormData(prev => {
        const updated = { ...prev };
        Object.keys(result).forEach(key => {
          const field = key as keyof typeof result;
          if (overwrite || !prev[field as keyof Omit<InitiativeData, 'id'>]) {
            (updated as any)[field] = result[field];
          }
        });
        return updated;
      });
    } catch (error: any) {
      console.error("Magic fill error:", error);
      alert((lang === 'es' ? "Error con IA: " : "AI Error: ") + (error.message || "Unknown error"));
    } finally {
      setMagicLoading(false);
    }
  };

  const handleMagicFillClick = () => {
    const hasData = formData.shortDescription || formData.elevatorPitchProblem || (formData.strengths && formData.strengths.length > 0);
    if (hasData) {
      setIsMagicPromptOpen(true);
    } else {
      performMagicFill(true);
    }
  };

  useEffect(() => {
    const totalCost = Number(formData.developmentCosts) + Number(formData.operationalCosts);
    const requiresCfo = totalCost > 50000;
    if (formData.requiresCfoAnalysis !== requiresCfo) {
      updateField('requiresCfoAnalysis', requiresCfo);
    }
  }, [formData.developmentCosts, formData.operationalCosts, formData.requiresCfoAnalysis]);

  useEffect(() => {
    const score = Number(formData.financialScore) + Number(formData.clientScore) + Number(formData.internalScore) + Number(formData.learningScore);
    const roundedScore = Math.round(score * 10) / 10;
    if (formData.strategicScore !== roundedScore) {
      updateField('strategicScore', roundedScore);
    }
  }, [formData.financialScore, formData.clientScore, formData.internalScore, formData.learningScore, formData.strategicScore]);

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

  const updateField = (field: keyof Omit<InitiativeData, 'id'>, value: any) => {
    setIsDirty(true);
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleListUpdate = (field: 'strengths' | 'opportunities' | 'weaknesses' | 'threats' | 'businessUnits', index: number, value: string) => {
    const newList = [...formData[field]];
    newList[index] = value;
    updateField(field, newList);
  };

  const addListItem = (field: 'strengths' | 'opportunities' | 'weaknesses' | 'threats' | 'businessUnits') => {
    updateField(field, [...formData[field], '']);
  };

  const removeListItem = (field: 'strengths' | 'opportunities' | 'weaknesses' | 'threats' | 'businessUnits', index: number) => {
    updateField(field, formData[field].filter((_, i) => i !== index));
  };

  const formatNumber = (val: number | string): string => {
    if (val === undefined || val === null || val === '') return '';
    const cleanVal = typeof val === 'string' ? val.replace(/\./g, '') : val.toString();
    const num = parseFloat(cleanVal);
    if (isNaN(num)) return '';
    return new Intl.NumberFormat('de-DE').format(num);
  };

  const MagicIcon = () => (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
      <path d="M5 3v4"/><path d="M3 5h4"/><path d="M21 17v4"/><path d="M19 19h4"/>
    </svg>
  );

  const parseFormattedNumber = (val: string): number => {
    const clean = val.replace(/\./g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  };

  const isOwner = user?.id === formData.createdByUserId;
  const isAdmin = user?.role === UserRole.ADMIN;
  const isProduct = user?.role === UserRole.PRODUCT;
  const isCTO = user?.role === UserRole.CTO;

  const canEditAll = !readOnly && (isAdmin || isProduct || isOwner);
  const canEditCosts = !readOnly && (isAdmin || isProduct || isOwner || isCTO);

  const handleSubmit = async () => {
    if (!user) {
      console.error("No user logged in");
      return;
    }

    // If user is Editor, Admin or CTO, ask if it's ready for roadmap
    const isProductOrAdmin = user.role === UserRole.ADMIN || user.role === UserRole.PRODUCT || user.role === UserRole.CTO;
    if (isProductOrAdmin) {
      setIsRoadmapConfirmOpen(true);
    } else {
      await saveInitiative('submitted');
    }
  };

  const saveInitiative = async (finalStatus?: InitiativeStatus) => {
    try {
      const now = new Date().toISOString();
      const statusToSet = finalStatus || formData.status;
      
      if (initialData?.id) {
        // Update existing initiative
        await updateDoc(doc(db, 'initiatives', initialData.id), {
          ...formData,
          status: statusToSet,
          updatedAt: now
        });
      } else {
        // Create new initiative
        const finalData = {
          ...formData,
          status: statusToSet,
          createdByUserId: user!.id,
          createdByUserName: user!.name,
          createdAt: now,
          updatedAt: now
        };
        await addDoc(collection(db, 'initiatives'), finalData);
      }
      onCancel();
    } catch (error) {
      console.error("Error saving initiative:", error);
    }
  };

  const steps = t.initiatives.steps;
  const totalSteps = steps.length;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" style={{ colorScheme: 'light' }}>
      <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 p-8 text-white shrink-0">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-black">{initialData ? (lang === 'es' ? 'Editar Iniciativa' : 'Edit Initiative') : (lang === 'es' ? 'Nueva Iniciativa' : 'New Initiative')}</h2>
            <span className="bg-orange-500 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">{t.wizard.step} {step + 1} {t.wizard.of} {totalSteps}</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div className="bg-orange-500 h-full transition-all duration-500" style={{ width: `${((step + 1) / totalSteps) * 100}%` }} />
          </div>
          <div className="flex justify-between mt-4">
            {steps.map((s: string, i: number) => {
              const isClickable = true;
              return (
                <button 
                  key={i} 
                  disabled={!isClickable && i !== step}
                  onClick={() => setStep(i)}
                  className={`px-3 py-2 text-[8px] font-black uppercase tracking-widest transition-all rounded-xl ${i === step ? 'text-orange-500 bg-white/5' : isClickable ? 'text-slate-400 hover:text-white hover:bg-white/10' : 'text-slate-600 cursor-not-allowed'}`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-10">
          {step === 0 && (
            <div className="space-y-8 animate-in slide-in-from-right-4">
              <h3 className="text-lg font-black text-slate-800 border-b pb-2">{steps[0]}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.title}</label>
                  <input type="text" value={formData.title} onChange={e => updateField('title', e.target.value)} disabled={!canEditAll} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all text-sm disabled:bg-slate-50" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.shortDescription}</label>
                  {!canEditAll ? (
                    <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[5rem]">
                      {formData.shortDescription}
                    </div>
                  ) : (
                    <textarea value={formData.shortDescription} onChange={e => updateField('shortDescription', e.target.value)} rows={3} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                  )}
                </div>
                {canEditAll && (
                  <div className="md:col-span-2 flex justify-center mt-2">
                    <button 
                      onClick={handleMagicFillClick}
                      disabled={magicLoading}
                      className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-orange-500 text-white font-black text-xs uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg disabled:opacity-40"
                    >
                      {magicLoading ? (
                        <span className="animate-spin text-lg">◌</span>
                      ) : (
                        <MagicIcon />
                      )}
                      {magicLoading ? '...' : t.initiatives.magicFill.button}
                    </button>
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.proponent}</label>
                  <input type="text" value={formData.proponentName} onChange={e => updateField('proponentName', e.target.value)} disabled={!canEditAll} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all text-sm disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.sponsor}</label>
                  <input type="text" value={formData.sponsorName} onChange={e => updateField('sponsorName', e.target.value)} disabled={!canEditAll} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all text-sm disabled:bg-slate-50" />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.collaborators}</label>
                  {!canEditAll ? (
                    <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[3rem]">
                      {formData.collaborators}
                    </div>
                  ) : (
                    <textarea value={formData.collaborators} onChange={e => updateField('collaborators', e.target.value)} rows={2} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.involvedAreas}</label>
                  {!canEditAll ? (
                    <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[3rem]">
                      {formData.involvedAreas}
                    </div>
                  ) : (
                    <textarea value={formData.involvedAreas} onChange={e => updateField('involvedAreas', e.target.value)} rows={2} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                  )}
                </div>

                {/* Business Units */}
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t.initiatives.fields.businessUnits}</label>
                  <div className="flex flex-wrap gap-2">
                    {['TVaaS', 'TCS', 'Tivify'].map(bu => (
                      <button
                        key={bu}
                        disabled={!canEditAll}
                        onClick={() => {
                          const current = formData.businessUnits;
                          if (current.includes(bu)) {
                            updateField('businessUnits', current.filter(item => item !== bu));
                          } else {
                            updateField('businessUnits', [...current, bu]);
                          }
                        }}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                          formData.businessUnits.includes(bu)
                            ? 'bg-slate-900 border-slate-900 text-white shadow-lg'
                            : 'bg-white border-slate-100 text-slate-400 hover:border-orange-500 hover:text-orange-600'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {bu}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.problem}</label>
                  {!canEditAll ? (
                    <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[5rem]">
                      {formData.elevatorPitchProblem}
                    </div>
                  ) : (
                    <textarea value={formData.elevatorPitchProblem} onChange={e => updateField('elevatorPitchProblem', e.target.value)} rows={3} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.solution}</label>
                  {!canEditAll ? (
                    <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[5rem]">
                      {formData.elevatorPitchSolution}
                    </div>
                  ) : (
                    <textarea value={formData.elevatorPitchSolution} onChange={e => updateField('elevatorPitchSolution', e.target.value)} rows={3} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.benefitsUser}</label>
                  {!canEditAll ? (
                    <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[5rem]">
                      {formData.expectedBenefitsEndUser}
                    </div>
                  ) : (
                    <textarea value={formData.expectedBenefitsEndUser} onChange={e => updateField('expectedBenefitsEndUser', e.target.value)} rows={3} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.benefitsInternal}</label>
                  {!canEditAll ? (
                    <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[5rem]">
                      {formData.expectedBenefitsInternalClients}
                    </div>
                  ) : (
                    <textarea value={formData.expectedBenefitsInternalClients} onChange={e => updateField('expectedBenefitsInternalClients', e.target.value)} rows={3} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.benefitsUs}</label>
                  {!canEditAll ? (
                    <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[5rem]">
                      {formData.expectedBenefitsUs}
                    </div>
                  ) : (
                    <textarea value={formData.expectedBenefitsUs} onChange={e => updateField('expectedBenefitsUs', e.target.value)} rows={3} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.costNotDoing}</label>
                  {!canEditAll ? (
                    <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[5rem]">
                      {formData.costOfNotDoing}
                    </div>
                  ) : (
                    <textarea value={formData.costOfNotDoing} onChange={e => updateField('costOfNotDoing', e.target.value)} rows={3} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
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
                          disabled={!canEditAll}
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
                          className="flex-1 px-4 py-2 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold text-sm transition-all disabled:bg-slate-50"
                        />
                        {canEditAll && (
                          <button 
                            onClick={() => {
                              const newLinks = (formData.supportLinks || []).filter((_, i) => i !== idx);
                              updateField('supportLinks', newLinks);
                            }}
                            className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        )}
                      </div>
                    ))}
                    {canEditAll && (
                      <button 
                        onClick={() => updateField('supportLinks', [...(formData.supportLinks || []), ''])}
                        className="text-xs font-black text-orange-500 uppercase tracking-widest hover:text-orange-600 transition-all flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        {t.wizard.addItem}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-8 animate-in slide-in-from-right-4">
              <h3 className="text-lg font-black text-slate-800 border-b pb-2">{steps[1]}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SWOTQuadrant 
                  label={t.initiatives.fields.strengths} 
                  items={formData.strengths} 
                  color="emerald" 
                  onChange={items => updateField('strengths', items)}
                  readOnly={!canEditAll}
                />
                <SWOTQuadrant 
                  label={t.initiatives.fields.opportunities} 
                  items={formData.opportunities} 
                  color="emerald" 
                  onChange={items => updateField('opportunities', items)}
                  readOnly={!canEditAll}
                />
                <SWOTQuadrant 
                  label={t.initiatives.fields.weaknesses} 
                  items={formData.weaknesses} 
                  color="orange" 
                  onChange={items => updateField('weaknesses', items)}
                  readOnly={!canEditAll}
                />
                <SWOTQuadrant 
                  label={t.initiatives.fields.threats} 
                  items={formData.threats} 
                  color="orange" 
                  onChange={items => updateField('threats', items)}
                  readOnly={!canEditAll}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in slide-in-from-right-4">
              <h3 className="text-lg font-black text-slate-800 border-b pb-2">{steps[2]}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.devCosts}</label>
                    <input type="text" value={formatNumber(formData.developmentCosts)} onChange={e => updateField('developmentCosts', parseFormattedNumber(e.target.value))} disabled={!canEditCosts} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all text-sm disabled:bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.devCostsExplanation}</label>
                    {!canEditCosts ? (
                      <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[3rem]">
                        {formData.developmentCostsExplanation || '-'}
                      </div>
                    ) : (
                      <textarea value={formData.developmentCostsExplanation} onChange={e => updateField('developmentCostsExplanation', e.target.value)} rows={2} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.opCosts}</label>
                    <input type="text" value={formatNumber(formData.operationalCosts)} onChange={e => updateField('operationalCosts', parseFormattedNumber(e.target.value))} disabled={!canEditCosts} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all text-sm disabled:bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.opCostsExplanation}</label>
                    {!canEditCosts ? (
                      <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[3rem]">
                        {formData.operationalCostsExplanation || '-'}
                      </div>
                    ) : (
                      <textarea value={formData.operationalCostsExplanation} onChange={e => updateField('operationalCostsExplanation', e.target.value)} rows={2} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.npv}</label>
                    <input type="text" value={formatNumber(formData.npv3Years)} onChange={e => updateField('npv3Years', parseFormattedNumber(e.target.value))} disabled={!canEditAll} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all text-sm disabled:bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.npvExplanation}</label>
                    {!canEditAll ? (
                      <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[3rem]">
                        {formData.npvExplanation || '-'}
                      </div>
                    ) : (
                      <textarea value={formData.npvExplanation} onChange={e => updateField('npvExplanation', e.target.value)} rows={2} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.payback}</label>
                    <input type="text" value={formatNumber(formData.payback)} onChange={e => updateField('payback', parseFormattedNumber(e.target.value))} disabled={!canEditAll} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all text-sm disabled:bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.paybackExplanation}</label>
                    {!canEditAll ? (
                      <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[3rem]">
                        {formData.paybackExplanation || '-'}
                      </div>
                    ) : (
                      <textarea value={formData.paybackExplanation} onChange={e => updateField('paybackExplanation', e.target.value)} rows={2} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                    )}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.initiatives.fields.economicExplanation}</label>
                  {!canEditAll ? (
                    <div className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm whitespace-pre-wrap min-h-[5rem]">
                      {formData.economicExplanation || '-'}
                    </div>
                  ) : (
                    <textarea value={formData.economicExplanation} onChange={e => updateField('economicExplanation', e.target.value)} rows={4} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold transition-all resize-none text-sm" />
                  )}
                </div>

                {formData.requiresCfoAnalysis && (
                  <div className="md:col-span-2 p-6 bg-rose-50 border-2 border-rose-100 rounded-2xl flex items-center gap-4 animate-in zoom-in-95">
                    <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center shrink-0">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    </div>
                    <div>
                      <p className="text-sm font-black text-rose-900 uppercase tracking-tight">Requiere Análisis del CFO</p>
                      <p className="text-xs text-rose-600 font-bold">El coste total de la iniciativa supera los 50.000 euros.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-8 animate-in slide-in-from-right-4">
              <h3 className="text-lg font-black text-slate-800 border-b pb-2">{steps[3]}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {user?.role?.toUpperCase() !== 'PRODUCT' && user?.role?.toUpperCase() !== 'ADMIN' && (
                  <div className="md:col-span-2 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3 text-amber-700">
                    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <p className="text-[10px] font-bold">{t.initiatives.fields.productTeamWarning}</p>
                  </div>
                )}

                {[
                  { key: 'financialScore', label: t.initiatives.fields.financialScore },
                  { key: 'clientScore', label: t.initiatives.fields.clientScore },
                  { key: 'internalScore', label: t.initiatives.fields.internalScore },
                  { key: 'learningScore', label: t.initiatives.fields.learningScore }
                ].map(field => (
                  <div key={field.key} className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">{field.label}</label>
                    <input 
                      type="number" 
                      value={formData[field.key as keyof InitiativeData] as number} 
                      onChange={e => updateField(field.key as any, e.target.value)} 
                      disabled={readOnly || user?.role?.toUpperCase() !== 'ADMIN'}
                      className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none focus:border-orange-500 font-bold text-sm disabled:bg-slate-100 disabled:cursor-not-allowed" 
                    />
                  </div>
                ))}

                <div className="md:col-span-2 p-8 bg-slate-900 rounded-[2rem] flex items-center justify-between text-white shadow-xl">
                  <div>
                    <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1">{t.initiatives.fields.strategicScore}</p>
                    <div className="flex gap-4 mt-2">
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-black">Financial</p>
                        <p className="text-xs font-black">{formData.financialScore}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-black">Client</p>
                        <p className="text-xs font-black">{formData.clientScore}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-black">Internal</p>
                        <p className="text-xs font-black">{formData.internalScore}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-500 uppercase font-black">Learning</p>
                        <p className="text-xs font-black">{formData.learningScore}</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-4xl font-black tracking-tighter">
                    {(Number(formData.financialScore) + Number(formData.clientScore) + Number(formData.internalScore) + Number(formData.learningScore)).toFixed(1)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-8 animate-in slide-in-from-right-4">
              <h3 className="text-lg font-black text-slate-800 border-b pb-2">{steps[4]}</h3>
              <div className="space-y-6">
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{t.initiatives.steps[1]}</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><p className="font-black text-slate-900">{t.initiatives.fields.title}:</p><p className="text-slate-600">{formData.title}</p></div>
                    <div><p className="font-black text-slate-900">Seed:</p><p className="text-slate-600">{formData.seedName}</p></div>
                    <div><p className="font-black text-slate-900">{t.initiatives.fields.proponent}:</p><p className="text-slate-600">{formData.proponentName}</p></div>
                    <div><p className="font-black text-slate-900">{t.initiatives.fields.sponsor}:</p><p className="text-slate-600">{formData.sponsorName}</p></div>
                  </div>
                </div>

                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{t.initiatives.steps[3]}</h4>
                  <div className="grid grid-cols-2 gap-6 text-sm">
                    <div>
                      <p className="font-black text-slate-900">{t.initiatives.fields.devCosts}:</p>
                      <p className="text-slate-600">{formatNumber(formData.developmentCosts)} €</p>
                      {formData.developmentCostsExplanation && <p className="text-[10px] text-slate-400 mt-1 italic">{formData.developmentCostsExplanation}</p>}
                    </div>
                    <div>
                      <p className="font-black text-slate-900">{t.initiatives.fields.opCosts}:</p>
                      <p className="text-slate-600">{formatNumber(formData.operationalCosts)} €</p>
                      {formData.operationalCostsExplanation && <p className="text-[10px] text-slate-400 mt-1 italic">{formData.operationalCostsExplanation}</p>}
                    </div>
                    <div>
                      <p className="font-black text-slate-900">{t.initiatives.fields.npv}:</p>
                      <p className="text-slate-600">{formatNumber(formData.npv3Years)} €</p>
                      {formData.npvExplanation && <p className="text-[10px] text-slate-400 mt-1 italic">{formData.npvExplanation}</p>}
                    </div>
                    <div>
                      <p className="font-black text-slate-900">{t.initiatives.fields.payback}:</p>
                      <p className="text-slate-600">{formatNumber(formData.payback)} meses</p>
                      {formData.paybackExplanation && <p className="text-[10px] text-slate-400 mt-1 italic">{formData.paybackExplanation}</p>}
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{t.initiatives.steps[4]}</h4>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div className="text-center"><p className="font-black text-slate-900">Fin.</p><p className="text-slate-600">{formData.financialScore}</p></div>
                    <div className="text-center"><p className="font-black text-slate-900">Cli.</p><p className="text-slate-600">{formData.clientScore}</p></div>
                    <div className="text-center"><p className="font-black text-slate-900">Int.</p><p className="text-slate-600">{formData.internalScore}</p></div>
                    <div className="text-center"><p className="font-black text-slate-900">Lea.</p><p className="text-slate-600">{formData.learningScore}</p></div>
                    <div className="col-span-4 mt-2 pt-2 border-t border-slate-200 flex justify-between items-center">
                      <p className="font-black text-slate-900">{t.initiatives.fields.strategicScore}:</p>
                      <p className="text-xl font-black text-orange-600">{formData.strategicScore}</p>
                    </div>
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
            {initialData && step < totalSteps - 1 && (
              <button 
                onClick={() => handleSubmit()}
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
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} className="px-8 py-4 font-black text-xs uppercase tracking-widest text-slate-700 hover:text-slate-900 transition-colors">{t.wizard.back}</button>
            )}
            {step < totalSteps - 1 ? (
              <button onClick={() => setStep(step + 1)} className="px-10 py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-slate-800 transition-all">{t.wizard.next}</button>
            ) : !readOnly ? (
              <button onClick={handleSubmit} className="px-10 py-4 bg-orange-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-orange-700 transition-all">{initialData ? t.wizard.saveChanges : t.wizard.submitInitiative}</button>
            ) : null}
          </div>
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

      {/* Magic Fill Prompt */}
      {isMagicPromptOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-10 text-center">
              <div className="w-20 h-20 bg-orange-50 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-4">{t.initiatives.magicFill.promptTitle}</h3>
              <p className="text-slate-500 font-medium mb-8">
                {t.initiatives.magicFill.promptText}
              </p>
              <div className="flex flex-col gap-3">
                <button onClick={() => performMagicFill(false)} className="w-full py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-slate-800 transition-all">
                  {t.initiatives.magicFill.fillEmpty}
                </button>
                <button onClick={() => performMagicFill(true)} className="w-full py-4 bg-orange-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-orange-700 transition-all">
                  {t.initiatives.magicFill.overwrite}
                </button>
                <button onClick={() => setIsMagicPromptOpen(false)} className="w-full py-4 bg-slate-100 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all">
                  {t.initiatives.magicFill.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Roadmap Confirmation Prompt */}
      {isRoadmapConfirmOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-10 text-center">
              <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-4">{t.initiatives.roadmapConfirm.title}</h3>
              <p className="text-slate-500 font-medium mb-8">
                {t.initiatives.roadmapConfirm.text}
              </p>
              <div className="flex flex-col gap-3">
                <button onClick={() => saveInitiative('ready_for_roadmap')} className="w-full py-4 bg-emerald-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-emerald-700 transition-all">
                  {t.initiatives.roadmapConfirm.yes}
                </button>
                <button onClick={() => saveInitiative()} className="w-full py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-slate-800 transition-all">
                  {t.initiatives.roadmapConfirm.no}
                </button>
                <button onClick={() => setIsRoadmapConfirmOpen(false)} className="w-full py-4 bg-slate-100 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all">
                  {t.initiatives.magicFill.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SWOTQuadrant: React.FC<{ label: string; items: string[]; color: string; onChange: (v: string[]) => void; readOnly?: boolean }> = ({ label, items, color, onChange, readOnly }) => {
  const { t } = useLanguage();
  const [newItem, setNewItem] = useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items]);

  const addItem = () => { if (newItem.trim() && !readOnly) { onChange([...items, newItem.trim()]); setNewItem(''); } };
  const removeItem = (idx: number) => { if (!readOnly) { onChange(items.filter((_, i) => i !== idx)); } };

  return (
    <div className={`p-6 rounded-2xl border flex flex-col h-full ${color === 'emerald' ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'}`}>
      <div className="flex justify-between items-center mb-4">
        <label className={`block text-[11px] font-black uppercase tracking-widest ${color === 'emerald' ? 'text-emerald-700' : 'text-orange-700'}`}>{label}</label>
      </div>
      <div ref={scrollRef} className="space-y-2 mb-4 flex-grow overflow-y-auto max-h-48 pr-1 custom-scrollbar">
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between gap-3 bg-white p-2.5 rounded-lg shadow-sm group">
            <span className="text-xs font-medium text-slate-700 leading-tight">{it}</span>
            {!readOnly && (
              <button onClick={() => removeItem(i)} className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all p-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
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
      )}
    </div>
  );
};

export default InitiativeWizard;
