'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
  User, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  signInAnonymously,
  updateProfile
} from 'firebase/auth';
// Remove top-level Firebase import to prevent build-time errors
// import { auth } from '../lib/firebase';
import { clearGuestData } from '../lib/guest-storage';

// Check if we're in a build environment
const isBuildTime = process.env.NODE_ENV === 'production' && typeof window === 'undefined';

// Lazy Firebase auth import
let firebaseAuth: any = null;

const getFirebaseAuth = () => {
  if (isBuildTime) return null;
  if (!firebaseAuth) {
    const { getFirebaseAuth } = require('../lib/firebase');
    firebaseAuth = getFirebaseAuth();
  }
  return firebaseAuth;
};

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName: string) => Promise<void>;
  signInAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      setUser(user);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  };

  const signUp = async (email: string, password: string, firstName: string) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
      const user = userCredential.user;
      
      // Store firstName in user profile
      await updateProfile(user, {
        displayName: firstName
      });
    } catch (error) {
      console.error('Sign up error:', error);
      throw error;
    }
  };

  const signInAsGuest = async () => {
    try {
      await signInAnonymously(getFirebaseAuth());
    } catch (error) {
      console.error('Guest sign in error:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      // If user is anonymous, clear local guest data
      if (getFirebaseAuth()?.currentUser?.isAnonymous) {
        clearGuestData();
      }
      
      await signOut(getFirebaseAuth());
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  };

  const value = {
    user,
    loading,
    signIn,
    signUp,
    signInAsGuest,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
