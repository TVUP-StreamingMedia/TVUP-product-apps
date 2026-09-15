
import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { UserRole } from '../types';

interface NavigationProps {
  currentView: 'dashboard' | 'wizard' | 'product' | 'admin' | 'seedPanel' | 'initiatives' | 'initiativePanel';
  onViewChange: (view: 'dashboard' | 'product' | 'admin' | 'seedPanel' | 'initiatives' | 'initiativePanel') => void;
}

const Navigation: React.FC<NavigationProps> = ({ currentView, onViewChange }) => {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const userRole = user?.role?.toUpperCase();
  const isProduct = userRole === 'PRODUCT' || userRole === 'PRODUCT_TEAM' || userRole === 'ADMIN';
  const isAdminOrProduct = userRole === 'PRODUCT' || userRole === 'PRODUCT_TEAM' || userRole === 'ADMIN';
  const isAdmin = userRole === 'ADMIN';
  const isCTO = userRole === 'CTO';

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getInitial = (name?: string) => {
    return name ? name.charAt(0).toUpperCase() : '?';
  };

  const handleNavClick = (view: 'dashboard' | 'product' | 'admin' | 'seedPanel' | 'initiatives' | 'initiativePanel') => {
    onViewChange(view);
    setIsMobileMenuOpen(false);
  };

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        {/* Left: Logo and Title */}
        <div className="flex items-center gap-4 cursor-pointer group" onClick={() => handleNavClick('dashboard')}>
          <img 
            src="https://d1xyy3yiuu5xkq.cloudfront.net/wp-content/uploads/2020/12/09091853/TVUp-Logo.png" 
            alt="TVUP Logo" 
            className="h-[42px] w-auto"
            referrerPolicy="no-referrer"
          />
          <div className="hidden sm:block h-6 w-px bg-slate-200"></div>
          <span className="hidden sm:block text-xl font-black text-slate-900 tracking-tight uppercase">Product Portal</span>
        </div>

        {/* Center: Main Navigation (Desktop) */}
        <div className="hidden xl:flex items-center gap-1">
          <NavItem active={currentView === 'dashboard'} onClick={() => handleNavClick('dashboard')} label={t.nav.mySeeds} />
          <NavItem active={currentView === 'initiatives'} onClick={() => handleNavClick('initiatives')} label={t.nav.myInitiatives} />
          {isProduct && <NavItem active={currentView === 'product'} onClick={() => handleNavClick('product')} label={t.nav.seedReview} />}
          {isAdminOrProduct && <NavItem active={currentView === 'seedPanel'} onClick={() => handleNavClick('seedPanel')} label={t.nav.seedPanel} />}
          {(isAdminOrProduct || isCTO) && <NavItem active={currentView === 'initiativePanel'} onClick={() => handleNavClick('initiativePanel')} label={t.nav.initiativePanel} />}
          {isAdmin && <NavItem active={currentView === 'admin'} onClick={() => handleNavClick('admin')} label={t.nav.adminPanel} />}
        </div>

        {/* Right: Language Selector, Profile Menu, and Mobile Toggle */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex bg-slate-100 rounded-xl p-1">
            <button onClick={() => setLang('en')} className={`px-2 sm:px-4 py-1.5 text-[10px] font-black rounded-lg transition-all ${lang === 'en' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-400'}`}>EN</button>
            <button onClick={() => setLang('es')} className={`px-2 sm:px-4 py-1.5 text-[10px] font-black rounded-lg transition-all ${lang === 'es' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-400'}`}>ES</button>
          </div>

          <div className="relative" ref={menuRef}>
            <button 
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl border-2 border-slate-100 overflow-hidden hover:border-orange-500 transition-all shadow-sm active:scale-95 flex items-center justify-center bg-[#E8673C] text-white font-black text-lg sm:text-xl"
            >
              {getInitial(user?.name)}
            </button>
            
            {isMenuOpen && (
              <div className="absolute right-0 mt-3 w-56 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="p-5 bg-slate-50 border-b border-slate-100">
                  <p className="font-black text-slate-900 text-sm leading-tight">{user?.name}</p>
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">{user?.role?.replace('_', ' ')}</p>
                </div>
                <div className="p-2">
                  <button 
                    onClick={logout}
                    className="w-full text-left px-4 py-3 text-xs font-black text-rose-500 hover:bg-rose-50 rounded-xl transition-all flex items-center gap-3"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    {t.auth.logout}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <div className="xl:hidden relative" ref={mobileMenuRef}>
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-slate-500 hover:text-slate-900 transition-colors rounded-xl hover:bg-slate-100"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {isMobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

            {isMobileMenuOpen && (
              <div className="absolute right-0 mt-3 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 flex flex-col p-2 gap-1 z-50">
                <MobileNavItem active={currentView === 'dashboard'} onClick={() => handleNavClick('dashboard')} label={t.nav.mySeeds} />
                <MobileNavItem active={currentView === 'initiatives'} onClick={() => handleNavClick('initiatives')} label={t.nav.myInitiatives} />
                {isProduct && <MobileNavItem active={currentView === 'product'} onClick={() => handleNavClick('product')} label={t.nav.seedReview} />}
                {isAdminOrProduct && <MobileNavItem active={currentView === 'seedPanel'} onClick={() => handleNavClick('seedPanel')} label={t.nav.seedPanel} />}
                {(isAdminOrProduct || isCTO) && <MobileNavItem active={currentView === 'initiativePanel'} onClick={() => handleNavClick('initiativePanel')} label={t.nav.initiativePanel} />}
                {isAdmin && <MobileNavItem active={currentView === 'admin'} onClick={() => handleNavClick('admin')} label={t.nav.adminPanel} />}
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

const NavItem: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button 
    onClick={onClick}
    className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
      active ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
    }`}
  >
    {label}
  </button>
);

const MobileNavItem: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button 
    onClick={onClick}
    className={`w-full text-left px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
      active ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
    }`}
  >
    {label}
  </button>
);

export default Navigation;
