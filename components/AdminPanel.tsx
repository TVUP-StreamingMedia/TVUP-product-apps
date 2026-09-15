
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { UserRole, Idea } from '@/types';
import { getConsensusScore, getVoteCount } from '@/utils/ideaUtils';
import { collection, getDocs, doc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const AdminPanel: React.FC = () => {
  const { users, user: currentUser, createUser, deleteUser, updateUserRole } = useAuth();
  const { lang, t } = useLanguage();
  
  const [formData, setFormData] = useState({ name: '', email: '', password: '', role: UserRole.USER });
  const [loading, setLoading] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingUserName, setEditingUserName] = useState<string>('');
  const [editingUserEmailId, setEditingUserEmailId] = useState<string | null>(null);
  const [editingUserEmail, setEditingUserEmail] = useState<string>('');
  const [migrating, setMigrating] = useState(false);

  const handleMigrateVotes = async () => {
    if (!confirm(lang === 'es' ? '¿Seguro que quieres migrar los votos de EDITOR a PRODUCT_TEAM?' : 'Are you sure you want to migrate EDITOR votes to PRODUCT_TEAM?')) return;
    setMigrating(true);
    try {
      const ideasSnapshot = await getDocs(collection(db, 'ideas'));
      const ideas = ideasSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Idea));
      
      let updatedCount = 0;
      console.log(`Found ${ideas.length} ideas to check.`);
      for (const idea of ideas) {
        let modified = false;
        const newVotes = (idea.votes || []).map(v => {
          if (v.userRole?.toUpperCase() === 'EDITOR') {
            modified = true;
            return { ...v, userRole: UserRole.PRODUCT };
          }
          return v;
        });

        if (modified) {
          console.log(`Updating idea ${idea.id} (${idea.data.seedName})...`);
          const updatedIdea = { ...idea, votes: newVotes };
          const score = getConsensusScore(updatedIdea, users);
          const voteCount = getVoteCount(updatedIdea, users);
          await updateDoc(doc(db, 'ideas', idea.id), { 
            votes: newVotes,
            consensusScore: score,
            voteCount: voteCount
          });
          updatedCount++;
        }
      }
      console.log(`Migration finished. Updated ${updatedCount} ideas.`);
      alert(lang === 'es' ? `Migración completada. ${updatedCount} ideas actualizadas.` : `Migration completed. ${updatedCount} ideas updated.`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setMigrating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.password) return alert(lang === 'es' ? 'Rellena todo' : 'Fill all');
    setLoading(true);
    try {
      await createUser(formData);
      setFormData({ name: '', email: '', password: '', role: UserRole.USER });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (userToDelete) {
      try {
        await deleteUser(userToDelete);
      } catch (err: any) {
        alert(err.message);
      } finally {
        setUserToDelete(null);
      }
    }
  };

  const handleRoleChange = async (id: string, role: UserRole) => {
    try {
      await updateUserRole(id, role);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleNameSave = async (id: string) => {
    if (!editingUserName.trim()) return;
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      await updateDoc(doc(db, 'users', id), { name: editingUserName });
      setEditingUserId(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleEmailSave = async (id: string) => {
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      await updateDoc(doc(db, 'users', id), { notificationEmail: editingUserEmail.trim() || null });
      setEditingUserEmailId(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-12 animate-in fade-in duration-500">
      <div><h1 className="text-4xl font-black text-slate-900 tracking-tight">{t.admin.title}</h1><p className="text-slate-500 font-medium">{t.admin.subtitle}</p></div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-4 bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-100">
          <h2 className="text-xl font-black text-slate-900 mb-8 uppercase tracking-widest text-xs flex items-center gap-2">{t.admin.newAccount}</h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            <AdminInput label={t.admin.name} value={formData.name} onChange={v => setFormData({...formData, name: v})} />
            <AdminInput label={t.admin.email} value={formData.email} onChange={v => setFormData({...formData, email: v})} />
            <AdminInput label={t.admin.initPass} value={formData.password} onChange={v => setFormData({...formData, password: v})} />
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t.admin.initRole}</label>
              <select className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold bg-white text-sm transition-all" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
                <option value={UserRole.USER}>User</option>
                <option value={UserRole.PRODUCT}>Product Team</option>
                <option value={UserRole.CTO}>CTO</option>
                <option value={UserRole.ADMIN}>Admin</option>
              </select>
            </div>
            <button className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl hover:bg-slate-800 transition-all uppercase tracking-widest text-[10px] shadow-xl">{t.admin.addUser}</button>
          </form>

          <div className="mt-12 pt-12 border-t border-slate-100">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{lang === 'es' ? 'Mantenimiento' : 'Maintenance'}</h3>
            <button 
              onClick={handleMigrateVotes}
              disabled={migrating}
              className="w-full bg-orange-50 text-orange-600 font-black py-4 rounded-2xl hover:bg-orange-100 transition-all uppercase tracking-widest text-[10px] flex items-center justify-center gap-2"
            >
              {migrating ? (
                <div className="w-3 h-3 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              )}
              {lang === 'es' ? 'Migrar Votos EDITOR' : 'Migrate EDITOR Votes'}
            </button>
            <p className="text-[9px] text-slate-400 font-medium mt-2 text-center">
              {lang === 'es' ? 'Convierte votos de EDITOR a PRODUCT_TEAM y recalcula medias.' : 'Converts EDITOR votes to PRODUCT_TEAM and recalculates averages.'}
            </p>
          </div>
        </div>
        <div className="lg:col-span-8 bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-left">
            <thead><tr className="bg-slate-50/50 border-b border-slate-100"><th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.admin.userCol}</th><th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.admin.notificationEmailCol}</th><th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.admin.roleCol}</th><th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.admin.lastConnectionCol}</th><th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">{t.admin.actionsCol}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-5 flex items-center gap-4">
                    <img src={u.avatarUrl || u.avatar} className="w-10 h-10 rounded-full border-2 border-slate-100 shadow-sm object-cover" alt="" />
                    <div className="flex-1">
                      {editingUserId === u.id ? (
                        <div className="flex items-center gap-2">
                          <input 
                            type="text" 
                            value={editingUserName} 
                            onChange={(e) => setEditingUserName(e.target.value)}
                            className="px-2 py-1 text-sm font-black text-slate-900 border border-slate-300 rounded focus:outline-none focus:border-orange-500"
                            autoFocus
                          />
                          <button onClick={() => handleNameSave(u.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          </button>
                          <button onClick={() => setEditingUserId(null)} className="p-1 text-rose-600 hover:bg-rose-50 rounded">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 group">
                          <p className="font-black text-slate-900 text-sm flex items-center gap-2">
                            {u.name}
                            {u.provider === 'microsoft.com' && (
                              <svg className="w-3.5 h-3.5" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                                <title>Microsoft Account</title>
                                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                              </svg>
                            )}
                          </p>
                          <button 
                            onClick={() => {
                              setEditingUserId(u.id);
                              setEditingUserName(u.name);
                            }} 
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-orange-500 transition-all"
                            title={lang === 'es' ? 'Editar nombre' : 'Edit name'}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                        </div>
                      )}
                      <p className="text-[10px] text-slate-400 font-bold">{u.email}</p>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    {editingUserEmailId === u.id ? (
                      <div className="flex items-center gap-2">
                        <input 
                          type="email" 
                          value={editingUserEmail} 
                          onChange={(e) => setEditingUserEmail(e.target.value)}
                          className="px-2 py-1 text-sm font-black text-slate-900 border border-slate-300 rounded focus:outline-none focus:border-orange-500 w-full"
                          placeholder={u.email}
                          autoFocus
                        />
                        <button onClick={() => handleEmailSave(u.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        </button>
                        <button onClick={() => setEditingUserEmailId(null)} className="p-1 text-rose-600 hover:bg-rose-50 rounded">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <p className="font-black text-slate-900 text-sm">
                          {u.notificationEmail || <span className="text-slate-400 italic text-xs">({lang === 'es' ? 'Mismo que login' : 'Same as login'})</span>}
                        </p>
                        <button 
                          onClick={() => {
                            setEditingUserEmailId(u.id);
                            setEditingUserEmail(u.notificationEmail || '');
                          }} 
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-orange-500 transition-all"
                          title={lang === 'es' ? 'Editar email de notificaciones' : 'Edit notification email'}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    {u.id === currentUser?.id ? <span className="text-[10px] font-black uppercase text-orange-500">{u.role?.replace('_', ' ')}</span> : (
                      <select className="text-[10px] font-black uppercase bg-slate-100 px-3 py-1.5 rounded-lg border-none focus:ring-1 focus:ring-orange-500 cursor-pointer" value={u.role} onChange={e => handleRoleChange(u.id, e.target.value as UserRole)}>
                        <option value={UserRole.USER}>User</option>
                        <option value={UserRole.PRODUCT}>Product Team</option>
                        <option value={UserRole.CTO}>CTO</option>
                        <option value={UserRole.ADMIN}>Admin</option>
                      </select>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-bold text-slate-500">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                      }) : (lang === 'es' ? 'Nunca' : 'Never')}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right">{u.id !== currentUser?.id && <button onClick={() => setUserToDelete(u.id)} className="p-2 text-slate-300 hover:text-rose-500 transition-colors"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-10 text-center">
              <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-4">{lang === 'es' ? '¿Borrar usuario?' : 'Delete user?'}</h3>
              <p className="text-slate-500 font-medium mb-8">
                {lang === 'es' 
                  ? '¿Estás seguro que deseas eliminar este usuario? Sus ideas e iniciativas se mantendrán pero se desvincularán de su cuenta.' 
                  : 'Are you sure you want to delete this user? Their ideas and initiatives will be kept but unlinked from their account.'}
              </p>
              <div className="flex flex-col gap-3">
                <button onClick={confirmDelete} className="w-full py-4 bg-rose-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-xl hover:bg-rose-700 transition-all">
                  {lang === 'es' ? 'Sí, eliminar usuario' : 'Yes, delete user'}
                </button>
                <button onClick={() => setUserToDelete(null)} className="w-full py-4 bg-slate-100 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all">
                  {lang === 'es' ? 'Cancelar' : 'Cancel'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AdminInput: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</label><input className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-bold text-sm transition-all" value={value || ''} onChange={e => onChange(e.target.value)} /></div>
);

export default AdminPanel;
