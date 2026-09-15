import React, { useState, useEffect, createContext, useContext } from 'react';
import { User, UserRole, Idea, IdeaStatus, Language } from './types';
import { INITIAL_IDEAS } from './constants';
import Dashboard from './components/Dashboard';
import ProductPanel from './components/ProductPanel';
import SeedPanel from './components/SeedPanel';
import IdeaWizard from './components/IdeaWizard';
import Navigation from './components/Navigation';
import AdminPanel from './components/AdminPanel';
import { translations } from './translations';
import { AuthContext, useAuth } from './context/AuthContext';
import { LanguageContext, useLanguage } from './context/LanguageContext';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  updatePassword,
  updateProfile,
  sendPasswordResetEmail,
  OAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  getDocFromServer
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const MyInitiatives = React.lazy(() => import('./components/MyInitiatives'));
const InitiativePanel = React.lazy(() => import('./components/InitiativePanel'));

const normalizeRole = (role?: string): UserRole => {
  if (!role) return UserRole.USER;
  const upper = role.toUpperCase();
  if (upper === 'ADMIN') return UserRole.ADMIN;
  if (upper === 'CTO') return UserRole.CTO;
  if (upper === 'PRODUCT' || upper === 'PRODUCT_TEAM' || upper === 'EDITOR') return UserRole.PRODUCT;
  return UserRole.USER;
};

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>('en');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [userIdeas, setUserIdeas] = useState<Idea[]>([]);
  const [allIdeas, setAllIdeas] = useState<Idea[]>([]);
  const [view, setView] = useState<'dashboard' | 'wizard' | 'product' | 'admin' | 'seedPanel' | 'initiatives' | 'initiativePanel'>('dashboard');
  const [editingIdea, setEditingIdea] = useState<Idea | undefined>(undefined);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'info'} | null>(null);
  const [loading, setLoading] = useState(true);

  // Auth state listener
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
        // Skip logging for other errors, as this is simply a connection test.
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const userRef = doc(db, 'users', firebaseUser.uid);
          let userDoc = null;
          try {
            userDoc = await getDoc(userRef);
          } catch (readError) {
            console.error("Failed to read user doc on login:", readError);
          }
          
          if (userDoc && userDoc.exists()) {
            const existingData = userDoc.data() as User;
            const provider = firebaseUser.providerData[0]?.providerId || 'password';
            let updates: Partial<User> = {
              lastLogin: new Date().toISOString()
            };
            
            // Sync name from Auth if Firestore name is generic/missing
            if ((existingData.name === 'User' || !existingData.name) && firebaseUser.displayName) {
              updates.name = firebaseUser.displayName;
            }
            // Sync provider if missing
            if (!existingData.provider && provider) {
              updates.provider = provider;
            }

            if (Object.keys(updates).length > 0) {
              try {
                await updateDoc(userRef, updates);
                setCurrentUser({ ...existingData, ...updates, role: normalizeRole(existingData.role) });
              } catch (updateError) {
                console.error("Failed to update user doc lastLogin:", updateError);
                // Fallback: sign in without lastLogin update
                setCurrentUser({ ...existingData, role: normalizeRole(existingData.role) });
              }
            } else {
              setCurrentUser({ ...existingData, role: normalizeRole(existingData.role) });
            }
          } else {
            // User document doesn't exist for this UID.
            // Check if a user with this email already exists (e.g. from old email/pass login)
            const email = firebaseUser.email?.toLowerCase();
            let existingDataByEmail: User | null = null;
            let existingDocId: string | null = null;
            
            if (email) {
              try {
                const usersRef = collection(db, 'users');
                const q = query(usersRef, where('email', '==', email));
                const querySnapshot = await getDocs(q);
                
                if (!querySnapshot.empty) {
                  const oldDoc = querySnapshot.docs[0];
                  existingDataByEmail = oldDoc.data() as User;
                  existingDocId = oldDoc.id;
                }
              } catch (queryError) {
                console.error("Failed to query user by email:", queryError);
              }
            }

            if (existingDataByEmail && existingDocId) {
              // If we found an existing user by email, update their ID to match the new auth UID
              // and delete the old document to avoid duplicates.
              const provider = firebaseUser.providerData[0]?.providerId || 'password';
              const mergedUser: User = {
                ...existingDataByEmail,
                id: firebaseUser.uid,
                name: firebaseUser.displayName || existingDataByEmail.name || email?.split('@')[0] || 'User',
                avatar: existingDataByEmail.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${email || firebaseUser.uid}`,
                provider: existingDataByEmail.provider || provider,
                lastLogin: new Date().toISOString(),
                role: normalizeRole(existingDataByEmail.role)
              };
              
              try {
                await setDoc(userRef, mergedUser);
                if (existingDocId !== firebaseUser.uid) {
                  await deleteDoc(doc(db, 'users', existingDocId));
                }
              } catch (writeError) {
                console.error("Failed to write/delete merged user doc:", writeError);
              }
              
              setCurrentUser(mergedUser);
            } else {
              // Truly a brand new user
              const provider = firebaseUser.providerData[0]?.providerId || 'password';
              const newUser: User = {
                id: firebaseUser.uid,
                name: firebaseUser.displayName || email?.split('@')[0] || 'User',
                email: email || '',
                role: UserRole.USER,
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email || firebaseUser.uid}`,
                provider: provider,
                lastLogin: new Date().toISOString()
              };
              
              try {
                await setDoc(userRef, newUser);
              } catch (writeError) {
                console.error("Failed to create brand new user doc in Firestore:", writeError);
              }
              setCurrentUser(newUser);
            }
          }
        } else {
          setCurrentUser(null);
        }
      } catch (error) {
        console.error("Auth state change error:", error);
        if (firebaseUser) {
          const email = firebaseUser.email || '';
          setCurrentUser({
            id: firebaseUser.uid,
            name: firebaseUser.displayName || email.split('@')[0] || 'User',
            email: email,
            role: UserRole.USER,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email || firebaseUser.uid}`,
            lastLogin: new Date().toISOString()
          });
        } else {
          setCurrentUser(null);
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const isAdmin = currentUser?.role === UserRole.ADMIN || currentUser?.email === 'editorial.tvup@gmail.com';

  // Firestore listeners
  useEffect(() => {
    if (!currentUser) return;

    const userRole = currentUser.role?.toUpperCase();
    const isHardcodedAdmin = currentUser.email === 'editorial.tvup@gmail.com';

    // 1. Users Listener - Only for ADMIN/PRODUCT/CTO
    let usersUnsubscribe = () => {};
    if (isHardcodedAdmin || userRole === 'ADMIN' || userRole === 'PRODUCT_TEAM' || userRole === 'PRODUCT' || userRole === 'CTO') {
      usersUnsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
        const usersData = snapshot.docs.map(doc => {
          const data = doc.data() as User;
          return { ...data, role: normalizeRole(data.role) };
        });
        setUsers(usersData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      });
    }

    // 1. User Ideas Listener (My Seeds)
    // Always filters by userId for the user's own view, regardless of role
    const userIdeasQuery = query(collection(db, 'ideas'), where('userId', '==', currentUser.id));

    const userIdeasUnsubscribe = onSnapshot(userIdeasQuery, (snapshot) => {
      const ideasData = snapshot.docs.map(doc => doc.data() as Idea);
      // Sort by date desc on client
      const sortedIdeas = ideasData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setUserIdeas(sortedIdeas);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'ideas');
    });

    // 2. All Ideas Listener (Product Panel) - Only for ADMIN/PRODUCT
    let allIdeasUnsubscribe = () => {};
    if (userRole === 'ADMIN' || userRole === 'PRODUCT_TEAM' || userRole === 'PRODUCT') {
      const allIdeasQuery = query(collection(db, 'ideas'), orderBy('date', 'desc'));
      allIdeasUnsubscribe = onSnapshot(allIdeasQuery, (snapshot) => {
        const ideasData = snapshot.docs.map(doc => doc.data() as Idea);
        setAllIdeas(ideasData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'ideas_all');
      });
    }

    return () => {
      usersUnsubscribe();
      userIdeasUnsubscribe();
      allIdeasUnsubscribe();
    };
  }, [currentUser]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view') as any;
    const ideaIdParam = params.get('ideaId');
    if (viewParam && ['dashboard', 'wizard', 'product', 'admin', 'seedPanel', 'initiatives', 'initiativePanel'].includes(viewParam)) setView(viewParam);
    if (ideaIdParam) setSelectedIdeaId(ideaIdParam);
  }, []);

  const login = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const loginWithMicrosoft = async () => {
    const provider = new OAuthProvider('microsoft.com');
    provider.setCustomParameters({
      prompt: 'select_account',
      tenant: '732e6d6a-2cae-4a8c-a06b-aeadd5c13e2d' // Specific Azure Tenant ID
    });
    
    await signInWithPopup(auth, provider);
  };

  const register = async (name: string, email: string, pass: string) => {
    // 1. Create Auth user (Firebase Auth handles email uniqueness)
    const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = userCredential.user.uid;
    const lowerEmail = email.toLowerCase();

    // 2. Check if a user profile with this email already exists in Firestore
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', lowerEmail));
    const querySnapshot = await getDocs(q);
    
    let existingData = {};
    if (!querySnapshot.empty) {
      // Found existing document with this email
      const existingDoc = querySnapshot.docs[0];
      existingData = existingDoc.data();
      // If the existing doc has a different ID (not the UID), we'll eventually replace it
      if (existingDoc.id !== uid) {
        await deleteDoc(doc(db, 'users', existingDoc.id));
      }
    }

    const newUser: User = {
      role: UserRole.USER, // Default
      ...existingData, // Preserve existing role/data if found
      id: uid,
      name: name || (existingData as any).name || 'User',
      email: lowerEmail,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${lowerEmail}`
    };

    // 3. Save to Firestore using UID as document ID
    await setDoc(doc(db, 'users', uid), newUser);
  };

  const logout = async () => {
    await signOut(auth);
    setView('dashboard');
  };

  const changePassword = async (newPass: string) => {
    if (auth.currentUser) {
      await updatePassword(auth.currentUser, newPass);
      setToast({ message: translations[lang].auth.passChanged, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const createUser = async (userData: Omit<User, 'id' | 'avatar'>) => {
    // Note: This only creates the Firestore document. 
    // Real user creation in Auth would require Firebase Admin or a cloud function.
    // For this app, we'll assume "Admin creating user" just means adding to Firestore
    // or we can skip this if it's not strictly needed for the demo.
    // However, to keep it working, we'll just add to Firestore.
    const id = Math.random().toString(36).substr(2, 9);
    const newUser: User = { 
      ...userData, 
      id, 
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userData.email}` 
    };
    await setDoc(doc(db, 'users', id), newUser);
  };

  const deleteUser = async (userId: string) => {
    try {
      // 1. Update all ideas created by this user
      const ideasQuery = query(collection(db, 'ideas'), where('userId', '==', userId));
      const ideasSnapshot = await getDocs(ideasQuery);
      const ideaUpdates = ideasSnapshot.docs.map(docSnap => 
        updateDoc(doc(db, 'ideas', docSnap.id), {
          userId: 'deleted_user',
          authorName: lang === 'es' ? 'Usuario Eliminado' : 'Deleted User'
        })
      );

      // 2. Update all initiatives created by this user
      const initiativesQuery = query(collection(db, 'initiatives'), where('createdByUserId', '==', userId));
      const initiativesSnapshot = await getDocs(initiativesQuery);
      const initiativeUpdates = initiativesSnapshot.docs.map(docSnap => 
        updateDoc(doc(db, 'initiatives', docSnap.id), {
          createdByUserId: 'deleted_user',
          createdByUserName: lang === 'es' ? 'Usuario Eliminado' : 'Deleted User'
        })
      );

      await Promise.all([...ideaUpdates, ...initiativeUpdates]);

      // 3. Delete the user document
      await deleteDoc(doc(db, 'users', userId));
      
      setToast({ message: lang === 'es' ? 'Usuario eliminado correctamente' : 'User deleted successfully', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error("Error deleting user:", error);
      setToast({ message: lang === 'es' ? 'Error al eliminar usuario' : 'Error deleting user', type: 'info' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const updateUserRole = async (userId: string, newRole: UserRole) => {
    console.log(`Updating user ${userId} to role ${newRole}`);
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
      console.log('Update successful');
    } catch (error) {
      console.error('Error updating user role:', error);
      throw error;
    }
  };

  const updateAvatar = async (photoURL: string) => {
    if (currentUser && auth.currentUser) {
      const userRef = doc(db, 'users', currentUser.id);
      await updateDoc(userRef, { photoURL, avatarUrl: photoURL }); // Keep both for safety
      await updateProfile(auth.currentUser, { photoURL });
      setCurrentUser({ ...currentUser, photoURL, avatarUrl: photoURL });
      setToast({ message: lang === 'es' ? 'Avatar actualizado' : 'Avatar updated', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleAddIdea = async (newIdea: Idea) => {
    if (!auth.currentUser) return;
    const isNew = !editingIdea;
    const ideaWithUser = {
      ...newIdea,
      userId: newIdea.userId || auth.currentUser.uid, // Preserve original userId if editing
      consensusScore: newIdea.consensusScore || 0,
      voteCount: (newIdea.votes || []).length
    };
    await setDoc(doc(db, 'ideas', ideaWithUser.id), ideaWithUser);
    
    if (isNew) {
      const notificationEmails = users
        .filter(u => u.role === UserRole.ADMIN || u.role === UserRole.PRODUCT)
        .map(u => u.notificationEmail || u.email)
        .filter(Boolean);
        
      try {
        const res = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: notificationEmails, // Server will fallback to EMAIL_USER if this is empty
            subject: `Nuevo seed para revisión: ${newIdea.data.seedName}`,
            text: `¡Hola!\n\nSe ha presentado un nuevo seed para revisión en el portal.\n\n📌 Título: ${newIdea.data.seedName}\n👤 Proponente: ${newIdea.authorName}\n\nAccede a TVUP Product Portal para revisarlo y valorarlo:\n🔗 https://tvup-product-portal-1001657507820.us-west1.run.app/\n\nUn saludo.`
          })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.error('Failed to send new seed email:', res.status, errData);
        } else {
          console.log('New seed email sent successfully');
        }
      } catch (error) {
        console.error('Network error sending email notifications', error);
      }
    }
    
    setEditingIdea(undefined);
    setView('dashboard');
  };

  const handleUpdateIdea = async (updateIdea: Idea) => {
    if (!auth.currentUser) return;
    
    const oldIdea = allIdeas.find(i => i.id === updateIdea.id);
    const statusChanged = oldIdea && oldIdea.status !== updateIdea.status;
    
    const ideaWithUser = { ...updateIdea, userId: updateIdea.userId || auth.currentUser.uid };
    await setDoc(doc(db, 'ideas', ideaWithUser.id), ideaWithUser);

    if (statusChanged) {
      const author = users.find(u => u.id === updateIdea.userId);
      const targetEmail = author?.notificationEmail || author?.email;
      if (author && targetEmail) {
        let subject = '';
        let text = '';
        
        if (updateIdea.status === IdeaStatus.APPROVED) {
          subject = `Tu seed "${updateIdea.data.seedName}" ha sido aprobado 🎉`;
          text = `¡Hola ${author.name || 'Proponente'}!\n\n¡Buenas noticias! Tu seed "📌 ${updateIdea.data.seedName}" ha sido aprobado.\n\nAhora es el momento de dar el siguiente paso. Te animamos a completar todos los datos de la iniciativa para que el equipo pueda avanzar con ella. Recuerda que puedes encontrarla y editar todos sus detalles en la sección "My Initiatives" del portal.\n\nAccede directamente a la aplicación aquí:\n🔗 https://tvup-product-portal-1001657507820.us-west1.run.app/\n\n¡Gracias por tu aportación!\nUn saludo.`;
        } else if (updateIdea.status === IdeaStatus.REJECTED) {
          subject = `Actualización sobre tu seed "${updateIdea.data.seedName}"`;
          text = `¡Hola ${author.name || 'Proponente'}!\n\nTe escribimos para informarte sobre el estado de tu seed "📌 ${updateIdea.data.seedName}".\n\nPor el momento, esta propuesta no ha sido aprobada para entrar en el roadmap actual. Sin embargo, lo hemos movido al Parking Lot, donde se quedará guardado de forma segura para que podamos volver a valorarlo en el futuro cuando las prioridades cambien.\n\nPuedes seguir viendo el estado de todas tus propuestas en el portal:\n🔗 https://tvup-product-portal-1001657507820.us-west1.run.app/\n\n¡Gracias por compartir tus ideas con el equipo!\nUn saludo.`;
        }
        
        if (subject && text) {
          try {
            const res = await fetch('/api/send-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: [targetEmail],
                subject,
                text
              })
            });
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              console.error('Failed to send status update email:', res.status, errData);
            } else {
              console.log('Status update email sent successfully');
            }
          } catch (error) {
            console.error('Network error sending status update email', error);
          }
        }
      }
    }
  };

  const handleDeleteIdea = async (ideaId: string) => {
    try {
      await deleteDoc(doc(db, 'ideas', ideaId));
      setToast({ message: lang === 'es' ? 'Seed eliminado' : 'Seed deleted', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error("Delete error:", error);
      setToast({ message: lang === 'es' ? 'Error al eliminar' : 'Delete error', type: 'info' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: translations[lang] }}>
      <AuthContext.Provider value={{ user: currentUser, users, login, loginWithMicrosoft, register, logout, changePassword, createUser, deleteUser, updateUserRole, updateAvatar }}>
        {!currentUser ? (
          <AuthScreen />
        ) : (
          <div className="min-h-screen bg-slate-50 flex flex-col">
            <Navigation currentView={view} onViewChange={(v) => { setView(v); setEditingIdea(undefined); }} />
            {toast && (
              <div className="fixed top-24 right-4 z-[100] p-4 rounded-2xl shadow-xl border bg-white flex items-center gap-3 animate-in slide-in-from-right-10">
                <div className={`w-2 h-2 rounded-full ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-blue-500'}`}></div>
                <p className="text-sm font-bold">{toast.message}</p>
              </div>
            )}
            <main className="flex-1 container mx-auto px-4 py-8">
              <React.Suspense fallback={<div className="flex items-center justify-center p-20"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div></div>}>
                {view === 'dashboard' && <Dashboard ideas={userIdeas} onNewIdea={() => { setEditingIdea(undefined); setView('wizard'); }} onEditIdea={(idea) => { setEditingIdea(idea); setView('wizard'); }} onDeleteIdea={handleDeleteIdea} />}
                {view === 'initiatives' && <MyInitiatives />}
                {view === 'wizard' && <IdeaWizard onCancel={() => setView('dashboard')} onSubmit={handleAddIdea} initialData={editingIdea} />}
                {view === 'product' && (currentUser.role?.toUpperCase() === 'ADMIN' || currentUser.role?.toUpperCase() === 'PRODUCT_TEAM' || currentUser.role?.toUpperCase() === 'PRODUCT') && <ProductPanel allIdeas={allIdeas} onUpdateIdea={handleUpdateIdea} onDeleteIdea={handleDeleteIdea} initialSelectedId={selectedIdeaId || undefined} />}
                {view === 'seedPanel' && (currentUser.role?.toUpperCase() === 'ADMIN' || currentUser.role?.toUpperCase() === 'PRODUCT_TEAM' || currentUser.role?.toUpperCase() === 'PRODUCT') && (
                  <SeedPanel 
                    allIdeas={allIdeas} 
                    onDeleteIdea={handleDeleteIdea}
                    onUpdateIdea={handleUpdateIdea}
                  />
                )}
                {view === 'initiativePanel' && (currentUser.role?.toUpperCase() === 'ADMIN' || currentUser.role?.toUpperCase() === 'PRODUCT_TEAM' || currentUser.role?.toUpperCase() === 'PRODUCT' || currentUser.role?.toUpperCase() === 'CTO') && (
                  <InitiativePanel />
                )}
                {view === 'admin' && isAdmin && <AdminPanel />}
              </React.Suspense>
            </main>
          </div>
        )}
      </AuthContext.Provider>
    </LanguageContext.Provider>
  );
};

const AuthScreen: React.FC = () => {
  const { lang, setLang, t } = useLanguage();
  const { login, loginWithMicrosoft } = useAuth();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleForgotPassword = async () => {
    if (!email) {
      setError(t.auth.enterEmail);
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage(t.auth.resetEmailSent);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await loginWithMicrosoft();
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        console.error(err);
        if (err.code === 'auth/account-exists-with-different-credential') {
          setError(lang === 'es' 
            ? 'Ya existe una cuenta con este email. Inicia sesión con tu contraseña o cambia la configuración en Firebase (Authentication > Settings > Link accounts).' 
            : 'An account already exists with this email. Sign in with password or change Firebase settings (Authentication > Settings > Link accounts).');
        } else if (err.code === 'auth/invalid-credential' || err.message.includes('invalid_client')) {
          setError(lang === 'es' 
            ? 'Error de configuración: El Client Secret de Azure en Firebase es incorrecto. Debes usar el "Value", no el "Secret ID".' 
            : 'Configuration error: Azure Client Secret in Firebase is incorrect. Use the "Value", not the "Secret ID".');
        } else {
          setError(err.message);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, pass);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError(t.auth.invalidCreds);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 px-4">
      <div className="absolute top-8 right-8 flex bg-slate-800 rounded-xl p-1 shadow-2xl">
        <button onClick={() => setLang('en')} className={`px-4 py-1.5 text-xs font-black rounded-lg transition-all ${lang === 'en' ? 'bg-orange-500 text-white shadow-lg' : 'text-slate-400'}`}>EN</button>
        <button onClick={() => setLang('es')} className={`px-4 py-1.5 text-xs font-black rounded-lg transition-all ${lang === 'es' ? 'bg-orange-500 text-white shadow-lg' : 'text-slate-400'}`}>ES</button>
      </div>
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-10 space-y-8 border-t-8 border-orange-500">
        <div className="text-center">
          <div className="flex justify-center mb-8">
            <img 
              src="https://d1xyy3yiuu5xkq.cloudfront.net/wp-content/uploads/2020/12/09091853/TVUp-Logo.png" 
              alt="TVUP Logo" 
              className="h-[72px] w-auto"
              referrerPolicy="no-referrer"
            />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Product Portal</h1>
          <p className="text-slate-500 font-bold text-sm mt-1">From ideas to delivery</p>
        </div>

        <button 
          onClick={handleMicrosoftLogin} 
          disabled={loading} 
          className="w-full flex items-center justify-center gap-3 bg-[#00a4ef] text-white font-black py-4 rounded-xl hover:bg-[#008bc9] transition-all uppercase tracking-widest text-sm disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 21 21" fill="currentColor">
            <path d="M10 0H0v10h10V0zM21 0H11v10h10V0zM10 11H0v10h10V11zM21 11H11v10h10V11z"/>
          </svg>
          {lang === 'es' ? 'Iniciar con Microsoft 365' : 'Log in with Microsoft 365'}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200"></div>
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-4 text-slate-400 font-bold uppercase tracking-widest">{lang === 'es' ? 'O usa tu email' : 'Or use email'}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" placeholder={t.auth.emailPlaceholder} value={email} onChange={e => setEmail(e.target.value)} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-semibold" required disabled={loading} />
          <input type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)} className="w-full px-5 py-3 rounded-xl border border-slate-200 outline-none focus:border-orange-500 font-semibold" required disabled={loading} />
          
          <div className="text-right">
            <button 
              type="button" 
              onClick={handleForgotPassword} 
              className="text-xs font-bold text-slate-400 hover:text-orange-500 transition-colors"
              disabled={loading}
            >
              {t.auth.forgotPass}
            </button>
          </div>

          {error && <p className="text-rose-600 text-xs font-bold text-center">{error}</p>}
          {message && <p className="text-emerald-600 text-xs font-bold text-center">{message}</p>}
          
          <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white font-black py-4 rounded-xl hover:bg-slate-800 transition-all uppercase tracking-widest text-sm disabled:opacity-50">
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>{t.auth.loginBtn}</span>
              </div>
            ) : (
              t.auth.loginBtn
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default App;