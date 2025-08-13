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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Only initialize Firebase auth on the client side
    if (typeof window === 'undefined') return;
    
    const auth = getFirebaseAuth();
    if (!auth) {
      console.warn('Firebase auth not available - retrying in 500ms');
      // Retry after a delay in case Firebase is still initializing
      const retryTimer = setTimeout(() => {
        const retryAuth = getFirebaseAuth();
        if (retryAuth) {
          const unsubscribe = onAuthStateChanged(retryAuth, (user) => {
            setUser(user);
            setLoading(false);
          });
          return unsubscribe;
        } else {
          console.error('Firebase auth still not available after retry');
          setLoading(false);
        }
      }, 500);
      
      return () => clearTimeout(retryTimer);
    }

    // Add a small delay to ensure Firebase is fully initialized
    const timer = setTimeout(() => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        setUser(user);
        setLoading(false);
      });

      return unsubscribe;
    }, 100); // 100ms delay

    return () => clearTimeout(timer);
  }, []);

  // Don't render children until mounted to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-purple-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  const signIn = async (email: string, password: string) => {
    try {
      const auth = getFirebaseAuth();
      if (!auth) throw new Error('Firebase auth not available');
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  };

  const signUp = async (email: string, password: string, firstName: string) => {
    try {
      const auth = getFirebaseAuth();
      if (!auth) throw new Error('Firebase auth not available');
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
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
      const auth = getFirebaseAuth();
      if (!auth) throw new Error('Firebase auth not available');
      await signInAnonymously(auth);
    } catch (error) {
      console.error('Guest sign in error:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      const auth = getFirebaseAuth();
      if (!auth) throw new Error('Firebase auth not available');
      
      // If user is anonymous, clear local guest data
      if (auth.currentUser?.isAnonymous) {
        clearGuestData();
      }
      
      await signOut(auth);
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
