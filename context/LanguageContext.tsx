
import React, { createContext, useContext } from 'react';
import { Language } from '../types';
import { translations } from '../translations';

export interface LanguageContextType {
  lang: Language;
  setLang: (l: Language) => void;
  t: typeof translations['en'];
}

export const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
};
