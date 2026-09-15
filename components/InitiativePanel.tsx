import React, { useState, useEffect } from 'react';
import { InitiativeData, InitiativeStatus, UserRole } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { db } from '../firebase';
import { collection, query, onSnapshot, doc, updateDoc, orderBy, deleteDoc } from 'firebase/firestore';
import { formatToDDMMYYYY } from '../utils/dateUtils';
import InitiativeWizard from './InitiativeWizard';
import { generateInitiativePPT } from '../utils/generateInitiativePPT';

const InitiativePanel: React.FC = () => {
  const { user } = useAuth();
  const { lang, t } = useLanguage();
  const userRole = user?.role?.toUpperCase();
  const isAdminOrProduct = userRole === 'ADMIN' || userRole === 'PRODUCT_TEAM' || userRole === 'PRODUCT';
  const isCTO = userRole === 'CTO';
  const [initiatives, setInitiatives] = useState<InitiativeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingInitiative, setViewingInitiative] = useState<InitiativeData | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
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
  const [initiativeToDelete, setInitiativeToDelete] = useState<InitiativeData | null>(null);
  const [showParkingLot, setShowParkingLot] = useState(false);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'initiatives'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as InitiativeData[];
      setInitiatives(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

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

  const filterByDate = (initiativesToFilter: InitiativeData[]) => {
    return initiativesToFilter.filter(init => {
      if (!dateFilter.start && !dateFilter.end) return true;
      const initDateStr = init.createdAt.split('T')[0];
      const start = dateFilter.start || '0000-00-00';
      const end = dateFilter.end || '9999-12-31';
      return initDateStr >= start && initDateStr <= end;
    });
  };

  const filteredInitiatives = filterByDate(initiatives);

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

  const handleStatusChange = async (id: string, newStatus: InitiativeStatus) => {
    try {
      await updateDoc(doc(db, 'initiatives', id), {
        status: newStatus,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const handleDeleteInitiative = async () => {
    if (!initiativeToDelete?.id) return;
    try {
      await deleteDoc(doc(db, 'initiatives', initiativeToDelete.id));
      setInitiativeToDelete(null);
    } catch (error) {
      console.error("Error deleting initiative:", error);
      alert(lang === 'es' ? 'Error al eliminar la iniciativa' : 'Error deleting initiative');
    }
  };

  const columns: { id: InitiativeStatus; title: string; colorClass: string; badgeClass: string }[] = [
    { id: 'ready_for_roadmap', title: lang === 'es' ? 'Lista para Roadmap' : 'Ready for Roadmap', colorClass: 'text-emerald-600', badgeClass: 'bg-emerald-100 text-emerald-700' },
    { id: 'submitted', title: lang === 'es' ? 'Pendiente de Revisión' : 'Pending Review', colorClass: 'text-yellow-600', badgeClass: 'bg-yellow-100 text-yellow-700' },
    { id: 'draft', title: lang === 'es' ? 'Borrador' : 'Draft', colorClass: 'text-slate-600', badgeClass: 'bg-slate-200 text-slate-700' }
  ];

  const renderInitiativeCard = (init: InitiativeData) => (
    <div key={init.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-all group">
      <div className="flex justify-between items-start mb-3">
        <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{formatToDDMMYYYY(init.createdAt, lang)}</span>
        <span className="text-[10px] font-black bg-slate-100 text-slate-600 px-2 py-1 rounded uppercase tracking-widest">{init.createdByUserName}</span>
      </div>
      
      <h3 className="font-black text-slate-900 mb-2 leading-tight group-hover:text-orange-600 transition-colors" title={init.title}>
        {init.title}
      </h3>
      
      <p className="text-xs text-slate-500 line-clamp-2 mb-4" title={init.shortDescription}>
        {init.shortDescription}
      </p>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div>
          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">NPV 3Y</p>
          <p className="text-xs font-black text-slate-900">{init.npv3Years ? `${new Intl.NumberFormat('de-DE').format(init.npv3Years)}€` : '-'}</p>
        </div>
        <div>
          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">PAYBACK</p>
          <p className="text-xs font-black text-slate-900">{init.payback ? `${init.payback}M` : '-'}</p>
        </div>
        <div>
          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">STRAT. SCORE</p>
          <p className="text-xs font-black text-orange-600">{init.strategicScore || '-'}</p>
        </div>
      </div>
      
      <div className="pt-4 border-t border-slate-50 flex gap-2 items-center">
        <div className="flex-1">
          <select 
            value={init.status}
            onChange={(e) => handleStatusChange(init.id, e.target.value as InitiativeStatus)}
            disabled={!isAdminOrProduct}
            className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl px-3 py-2 outline-none focus:border-orange-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="ready_for_roadmap">{lang === 'es' ? 'Lista para Roadmap' : 'Ready for Roadmap'}</option>
            <option value="submitted">{lang === 'es' ? 'Pendiente de Revisión' : 'Pending Review'}</option>
            <option value="draft">{lang === 'es' ? 'Borrador' : 'Draft'}</option>
            <option value="rejected">{lang === 'es' ? 'Parking Lot' : 'Parking Lot'}</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleDownloadPPT(init)}
            disabled={downloadingId === init.id}
            className="px-4 py-2 bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center"
            title={lang === 'es' ? 'Descargar PPT' : 'Download PPT'}
          >
            {downloadingId === init.id ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            )}
          </button>
          {(isAdminOrProduct || isCTO || user?.id === init.createdByUserId) && (
            <button
              onClick={() => {
                setViewingInitiative(init);
                setEditMode(true);
              }}
              className="px-4 py-2 bg-orange-500 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-orange-600 transition-all flex items-center justify-center"
              title={lang === 'es' ? 'Editar' : 'Edit'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            </button>
          )}
          <button
            onClick={() => {
              setViewingInitiative(init);
              setEditMode(false);
            }}
            className="px-4 py-2 bg-slate-900 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all flex items-center justify-center"
            title={lang === 'es' ? 'Ver detalles' : 'View details'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{lang === 'es' ? 'Panel de Iniciativas' : 'Initiative Panel'}</h1>
          <p className="text-slate-500 font-medium">{lang === 'es' ? 'Gestiona el estado de todas las iniciativas' : 'Manage the status of all initiatives'}</p>
        </div>

        {/* Date Filter Widget */}
        <div className="flex items-center gap-4 flex-wrap justify-end">
          <button 
            onClick={() => setShowParkingLot(!showParkingLot)}
            className={`flex items-center gap-2 px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-sm border ${
              showParkingLot 
                ? 'bg-rose-100 text-rose-700 border-rose-200' 
                : 'bg-white text-slate-600 border-slate-100 hover:bg-slate-50'
            }`}
          >
            <span className="text-base">🅿️</span>
            Parking Lot
          </button>

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
      </div>

      {showParkingLot ? (
        <div className="bg-slate-50 rounded-[2rem] p-8 border border-slate-100 min-h-[calc(100vh-250px)] animate-in fade-in duration-300">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-black tracking-tight text-rose-600">Parking Lot</h2>
            <span className="text-sm font-black px-4 py-1.5 rounded-full shadow-sm bg-rose-100 text-rose-700">
              {filteredInitiatives.filter(init => init.status === 'rejected').length}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredInitiatives.filter(init => init.status === 'rejected').map(init => renderInitiativeCard(init))}
          </div>
        </div>
      ) : (
        <div className="flex gap-6 overflow-x-auto pb-8 custom-scrollbar">
        {columns.map(column => {
          const columnInitiatives = filteredInitiatives.filter(init => init.status === column.id);
          
          return (
            <div key={column.id} className="w-[calc((100%-3rem)/3)] min-w-[350px] shrink-0 bg-slate-50 rounded-[2rem] p-6 border border-slate-100 flex flex-col h-[calc(100vh-250px)]">
              <div className="flex justify-between items-center mb-6">
                <h2 className={`text-xl font-black tracking-tight ${column.colorClass}`}>{column.title}</h2>
                <span className={`text-xs font-black px-3 py-1 rounded-full shadow-sm ${column.badgeClass}`}>
                  {columnInitiatives.length}
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                {columnInitiatives.map(init => (
                  <div key={init.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-all group">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{formatToDDMMYYYY(init.createdAt, lang)}</span>
                      <span className="text-[10px] font-black bg-slate-100 text-slate-600 px-2 py-1 rounded uppercase tracking-widest">{init.createdByUserName}</span>
                    </div>
                    
                    <h3 className="font-black text-slate-900 mb-2 leading-tight group-hover:text-orange-600 transition-colors" title={init.title}>
                      {init.title}
                    </h3>
                    
                    <p className="text-xs text-slate-500 line-clamp-2 mb-4" title={init.shortDescription}>
                      {init.shortDescription}
                    </p>

                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">NPV 3Y</p>
                        <p className="text-xs font-black text-slate-900">{init.npv3Years ? `${new Intl.NumberFormat('de-DE').format(init.npv3Years)}€` : '-'}</p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">PAYBACK</p>
                        <p className="text-xs font-black text-slate-900">{init.payback ? `${init.payback}M` : '-'}</p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">STRAT. SCORE</p>
                        <p className="text-xs font-black text-orange-600">{init.strategicScore || '-'}</p>
                      </div>
                    </div>
                    
                    <div className="pt-4 border-t border-slate-50 flex gap-2 items-center">
                      <div className="flex-1">
                        <select 
                          value={init.status}
                          onChange={(e) => handleStatusChange(init.id, e.target.value as InitiativeStatus)}
                          disabled={!isAdminOrProduct}
                          className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl px-3 py-2 outline-none focus:border-orange-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option value="ready_for_roadmap">{lang === 'es' ? 'Lista para Roadmap' : 'Ready for Roadmap'}</option>
                          <option value="submitted">{lang === 'es' ? 'Pendiente de Revisión' : 'Pending Review'}</option>
                          <option value="draft">{lang === 'es' ? 'Borrador' : 'Draft'}</option>
                          <option value="rejected">{lang === 'es' ? 'Parking Lot' : 'Parking Lot'}</option>
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDownloadPPT(init)}
                          disabled={downloadingId === init.id}
                          className="px-4 py-2 bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center"
                          title={lang === 'es' ? 'Descargar PPT' : 'Download PPT'}
                        >
                          {downloadingId === init.id ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          )}
                        </button>
                        {(isAdminOrProduct || isCTO || user?.id === init.createdByUserId) && (
                          <button
                            onClick={() => {
                              setViewingInitiative(init);
                              setEditMode(true);
                            }}
                            className="px-4 py-2 bg-orange-500 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-orange-600 transition-all flex items-center justify-center"
                            title={lang === 'es' ? 'Editar' : 'Edit'}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setViewingInitiative(init);
                            setEditMode(false);
                          }}
                          className="px-4 py-2 bg-slate-900 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all"
                        >
                          {lang === 'es' ? 'Ver' : 'View'}
                        </button>
                        {user?.role?.toUpperCase() === 'ADMIN' && (
                          <button
                            onClick={() => setInitiativeToDelete(init)}
                            className="px-4 py-2 bg-rose-100 text-rose-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-rose-200 transition-all flex items-center justify-center"
                            title={lang === 'es' ? 'Eliminar' : 'Delete'}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                
                {columnInitiatives.length === 0 && (
                  <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl">
                    <p className="text-slate-400 font-medium text-sm">{lang === 'es' ? 'No hay iniciativas' : 'No initiatives'}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {viewingInitiative && (
        <InitiativeWizard 
          onCancel={() => {
            setViewingInitiative(null);
            setEditMode(false);
          }} 
          initialData={viewingInitiative} 
          readOnly={!editMode}
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
                <button onClick={handleDeleteInitiative} className="w-full py-4 bg-rose-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-rose-700 transition-all">
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

export default InitiativePanel;
