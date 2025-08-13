import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';

const isBrowser = typeof window !== 'undefined';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

let appInstance: FirebaseApp | null = null;
let authInstance: any = null;
let dbInstance: any = null;
let analyticsInstance: any = null;

function envConfigPresent(): boolean {
  const required = [
    firebaseConfig.apiKey,
    firebaseConfig.authDomain,
    firebaseConfig.projectId,
    firebaseConfig.storageBucket,
    firebaseConfig.messagingSenderId,
    firebaseConfig.appId,
  ];
  const ok = required.every(Boolean);
  if (!ok) {
    console.warn('Firebase env not fully set. Skipping initialization.');
  }
  return ok;
}

function ensureApp(): FirebaseApp | null {
  if (appInstance) return appInstance;
  if (!envConfigPresent()) return null;
  try {
    appInstance = getApps().length ? getApp() : initializeApp(firebaseConfig);
    return appInstance;
  } catch (e) {
    console.error('Failed to initialize Firebase app:', e);
    return null;
  }
}

export const getFirebaseAuth = () => {
  const app = ensureApp();
  if (!app) return null;
  if (!authInstance) authInstance = getAuth(app);
  return authInstance;
};

export const getFirebaseDB = () => {
  const app = ensureApp();
  if (!app) return null;
  if (!dbInstance) dbInstance = getFirestore(app);
  return dbInstance;
};

export const getFirebaseAnalytics = () => {
  if (!isBrowser) return null;
  const app = ensureApp();
  if (!app) return null;
  if (!analyticsInstance) {
    try {
      analyticsInstance = getAnalytics(app);
    } catch (e) {
      // Analytics may be unavailable in some environments
      console.log('Analytics not available:', e);
      return null;
    }
  }
  return analyticsInstance;
};

// Convenience exports (lazy)
export const auth = getFirebaseAuth();
export const db = getFirebaseDB();
export const analytics = getFirebaseAnalytics();

export default appInstance;
