import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';

// Check if we're in a build environment
const isBuildTime = process.env.NODE_ENV === 'production' && typeof window === 'undefined';

// Validate required environment variables only when not building
const validateFirebaseConfig = () => {
  const requiredEnvVars = {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const missingVars = Object.entries(requiredEnvVars)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required Firebase environment variables: ${missingVars.join(', ')}\n` +
      'Please create a .env.local file with the required Firebase configuration.'
    );
  }
};

// Only validate during runtime, not build time
if (!isBuildTime) {
  validateFirebaseConfig();
}

// Initialize Firebase only if we have the required config
let app: any = null;
let authInstance: any = null;
let dbInstance: any = null;
let analyticsInstance: any = null;

const initializeFirebase = () => {
  if (app) return { app, auth: authInstance, db: dbInstance, analytics: analyticsInstance };

  try {
    validateFirebaseConfig();
    
    const firebaseConfig = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
      measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
    };

    app = initializeApp(firebaseConfig);
    authInstance = getAuth(app);
    dbInstance = getFirestore(app);

    // Initialize Analytics (only in browser environment)
    if (typeof window !== 'undefined') {
      try {
        analyticsInstance = getAnalytics(app);
      } catch (error) {
        console.log('Analytics not available:', error);
      }
    }
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    // Return null values so the app can still function
    return { app: null, auth: null, db: null, analytics: null };
  }

  return { app, auth: authInstance, db: dbInstance, analytics: analyticsInstance };
};

// Export functions that initialize Firebase when called
export const getFirebaseAuth = () => {
  if (!authInstance) {
    const result = initializeFirebase();
    authInstance = result.auth;
  }
  return authInstance;
};

export const getFirebaseDB = () => {
  if (!dbInstance) {
    const result = initializeFirebase();
    dbInstance = result.db;
  }
  return dbInstance;
};

export const getFirebaseAnalytics = () => {
  if (!analyticsInstance) {
    const result = initializeFirebase();
    analyticsInstance = result.analytics;
  }
  return analyticsInstance;
};

// Legacy exports for backward compatibility
export const auth = getFirebaseAuth();
export const db = getFirebaseDB();
export const analytics = getFirebaseAnalytics();

export default app;
