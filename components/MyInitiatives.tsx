
import React, { useState, useEffect } from 'react';
import { InitiativeData, InitiativeStatus, UserRole, Idea, IdeaStatus } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { formatToDDMMYYYY } from '../utils/dateUtils';
import { StatusBadge } from './StatusBadge';
import { db } from '../firebase';
import { generateInitiativePPT } from '../utils/generateInitiativePPT';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  deleteDoc,
  doc
} from 'firebase/firestore';
import InitiativeWizard from './InitiativeWizard';

const MyInitiatives: React.FC = () => {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const [initiatives, setInitiatives] = useState<InitiativeData[]>([]);
  const [approvedSeeds, setApprovedSeeds] = useState<Idea[]>([]);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingInitiative, setEditingInitiative] = useState<InitiativeData | undefined>(undefined);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [initiativeToDelete, setInitiativeToDelete] = useState<InitiativeData | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownloadPPT = async (init: InitiativeData) => {
    try {
      setDownloadingId(init.id || null);
      await generateInitiativePPT(init);
    } catch (error) {
      console.error("Error generating PPT:", error);
      alert(lang === 'es' ? 'Error al generar PPT' : 'Error generating PPT');
    } finally {
      setDownloadingId(null);
    }
  };

  useEffect(() => {
    if (!user) return;

    const qInitiatives = query(
      collection(db, 'initiatives'),
      where('createdByUserId', '==', user.id),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeInitiatives = onSnapshot(qInitiatives, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as InitiativeData[];
      setInitiatives(data);
    });

    const qSeeds = query(
      collection(db, 'ideas'),
      where('userId', '==', user.id),
      where('status', '==', IdeaStatus.APPROVED)
    );

    const unsubscribeSeeds = onSnapshot(qSeeds, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Idea[];
      setApprovedSeeds(data);
    });

    return () => {
      unsubscribeInitiatives();
      unsubscribeSeeds();
    };
  }, [user]);

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'initiatives', id));
      setInitiativeToDelete(null);
    } catch (error) {
      console.error("Error deleting initiative:", error);
    }
  };

  // Filter approved seeds that don't have an initiative yet
  const uninitiatedSeeds = approvedSeeds.filter(seed => 
    !initiatives.some(init => init.seedId === seed.id)
  );

  // Combine initiatives and uninitiated seeds for display
  const displayItems = [
    ...uninitiatedSeeds.map(seed => ({
      isSeed: true,
      data: seed
    })),
    ...initiatives.map(init => ({
      isSeed: false,
      data: init
    }))
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t.initiatives.title}</h1>
          <p className="text-slate-500 font-medium">{t.initiatives.subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {displayItems.length === 0 ? (
          <div className="col-span-full py-24 text-center border-4 border-dashed border-slate-200 rounded-[3rem] bg-white">
            <h3 className="text-2xl font-black text-slate-800">{lang === 'es' ? 'No hay iniciativas aún' : 'No initiatives yet'}</h3>
            <p className="text-slate-400 mt-2 font-medium">{lang === 'es' ? 'Tus ideas aprobadas aparecerán aquí para que las completes.' : 'Your approved ideas will appear here for you to complete.'}</p>
          </div>
        ) : (
          displayItems.map((item, index) => {
            if (item.isSeed) {
              const seed = item.data as Idea;
              return (
                <div key={`seed-${seed.id}`} className="bg-white rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-2xl transition-all group flex flex-col h-full overflow-hidden border-b-4 border-b-slate-50 hover:border-b-orange-500">
                  <div className="p-8 flex-grow">
                    <div className="flex justify-between items-start mb-6">
                      <span className="text-[9px] uppercase font-black px-3 py-1.5 rounded-full tracking-widest shadow-sm bg-emerald-100 text-emerald-700">
                        {lang === 'es' ? 'SEMILLA APROBADA' : 'APPROVED SEED'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{formatToDDMMYYYY(seed.date, lang)}</span>
                    </div>
                    <h3 className="text-xl font-black text-slate-900 mb-3 group-hover:text-orange-600 transition-colors line-clamp-2 leading-tight" title={seed.data.seedName}>
                      {seed.data.seedName}
                    </h3>
                    <p className="text-sm text-slate-500 line-clamp-3 font-medium leading-relaxed" title={seed.data.oneSentenceSummary}>
                      {seed.data.oneSentenceSummary}
                    </p>
                  </div>
                  <div className="px-8 py-6 bg-slate-50/50 border-t border-slate-100 flex items-center justify-end">
                    <button
                      onClick={() => { 
                        setEditingInitiative({
                          seedId: seed.id!,
                          seedName: seed.data.seedName,
                          title: seed.data.seedName,
                          shortDescription: seed.data.oneSentenceSummary,
                          proponentName: seed.authorName,
                          businessUnits: seed.data.businessUnit || [],
                          elevatorPitchProblem: seed.data.elevatorPitch?.problem || '',
                          elevatorPitchSolution: seed.data.elevatorPitch?.solution || '',
                          expectedBenefitsEndUser: seed.data.expectedBenefits?.endUser || '',
                          expectedBenefitsUs: seed.data.expectedBenefits?.forUs || '',
                          costOfNotDoing: seed.data.costOfNotDoing || '',
                          strengths: seed.data.swot?.strengths || [],
                          weaknesses: seed.data.swot?.weaknesses || [],
                          opportunities: seed.data.swot?.opportunities || [],
                          threats: seed.data.swot?.threats || [],
                          status: 'draft',
                          createdByUserId: user!.id,
                          createdByUserName: user!.name,
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString()
                        } as InitiativeData); 
                        setIsReadOnly(false); 
                        setIsWizardOpen(true); 
                      }}
                      className="px-6 py-3 bg-orange-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-orange-700 transition-all shadow-md hover:-translate-y-0.5"
                    >
                      {lang === 'es' ? 'Completar' : 'Complete'}
                    </button>
                  </div>
                </div>
              );
            } else {
              const init = item.data as InitiativeData;
              return (
                <div key={`init-${init.id}`} className="bg-white rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-2xl transition-all group flex flex-col h-full overflow-hidden border-b-4 border-b-slate-50 hover:border-b-orange-500">
                  <div className="p-8 flex-grow">
                    <div className="flex justify-between items-start mb-6">
                      <StatusBadge status={init.status} />
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{formatToDDMMYYYY(init.createdAt, lang)}</span>
                    </div>
                    <h3 className="text-xl font-black text-slate-900 mb-3 group-hover:text-orange-600 transition-colors line-clamp-2 leading-tight" title={init.title}>
                      {init.title}
                    </h3>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Seed:</span>
                      <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest truncate max-w-[150px]" title={init.seedName}>{init.seedName}</span>
                    </div>
                    <p className="text-sm text-slate-500 line-clamp-3 font-medium leading-relaxed" title={init.shortDescription}>
                      {init.shortDescription}
                    </p>
                    
                    <div className="mt-6 pt-6 border-t border-slate-50 grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">NPV 3Y</p>
                        <p className="text-sm font-black text-slate-900">{new Intl.NumberFormat('de-DE').format(init.npv3Years)}€</p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Payback</p>
                        <p className="text-sm font-black text-slate-900">{init.payback}m</p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Strat. Score</p>
                        <p className="text-sm font-black text-slate-900">{init.strategicScore}</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-8 py-6 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownloadPPT(init)}
                        disabled={downloadingId === init.id}
                        className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-emerald-600 hover:border-emerald-500 transition-all shadow-sm disabled:opacity-50"
                        title={lang === 'es' ? 'Descargar PPT' : 'Download PPT'}
                      >
                        {downloadingId === init.id ? (
                          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        )}
                      </button>
                      <button 
                        onClick={() => { setEditingInitiative(init); setIsReadOnly(false); setIsWizardOpen(true); }}
                        className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-orange-600 hover:border-orange-500 transition-all shadow-sm"
                        title={lang === 'es' ? 'Editar' : 'Edit'}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button 
                        onClick={() => setInitiativeToDelete(init as any)}
                        className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-rose-600 hover:border-rose-500 transition-all shadow-sm"
                        title={lang === 'es' ? 'Eliminar' : 'Delete'}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                    <button
                      onClick={() => { setEditingInitiative(init); setIsReadOnly(false); setIsWizardOpen(true); }}
                      className="px-4 py-2 bg-slate-900 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all"
                    >
                      {lang === 'es' ? 'Editar' : 'Edit'}
                    </button>
                  </div>
                </div>
              );
            }
          })
        )}
      </div>

      {isWizardOpen && (
        <InitiativeWizard 
          onCancel={() => {
            setIsWizardOpen(false);
            setIsReadOnly(false);
          }} 
          initialData={editingInitiative} 
          readOnly={isReadOnly}
        />
      )}

      {initiativeToDelete && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-10 text-center">
              <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-4">{lang === 'es' ? '¿Eliminar iniciativa?' : 'Delete initiative?'}</h3>
              <p className="text-slate-500 font-medium mb-8">
                {lang === 'es' ? 'Esta acción no se puede deshacer.' : 'This action cannot be undone.'}
              </p>
              <div className="flex flex-col gap-3">
                <button onClick={() => handleDelete(initiativeToDelete.id!)} className="w-full py-4 bg-rose-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-rose-700 transition-all">
                  {t.common.delete}
                </button>
                <button onClick={() => setInitiativeToDelete(null)} className="w-full py-4 bg-slate-100 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all">
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

export default MyInitiatives;
