
import React, { createContext, useContext } from 'react';
import { User, UserRole } from '../types';

export interface AuthContextType {
  user: User | null;
  users: User[];
  login: (email: string, pass: string) => Promise<void>;
  loginWithMicrosoft: () => Promise<void>;
  register: (name: string, email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (newPass: string) => Promise<void>;
  createUser: (userData: Omit<User, 'id' | 'avatar'>) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  updateUserRole: (userId: string, newRole: UserRole) => Promise<void>;
  updateAvatar: (avatarUrl: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
