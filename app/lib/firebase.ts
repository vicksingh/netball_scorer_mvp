import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';

// Check if we're in a build environment
const isBuildTime = process.env.NODE_ENV === 'production' && typeof window === 'undefined';

// Validate required environment variables only when not building
const validateFirebaseConfig = () => {
  // Skip validation completely during build time
  if (isBuildTime) {
    return false;
  }

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
    console.warn(
      `Missing required Firebase environment variables: ${missingVars.join(', ')}\n` +
      'Please create a .env.local file with the required Firebase configuration.'
    );
    return false;
  }

  return true;
};

// Global variables to track Firebase instances
let app: FirebaseApp | null = null;
let authInstance: any = null;
let dbInstance: any = null;
let analyticsInstance: any = null;
let isInitializing = false;

const initializeFirebase = (): { app: FirebaseApp | null; auth: any; db: any; analytics: any } => {
  // Prevent multiple simultaneous initializations
  if (isInitializing) {
    console.log('Firebase initialization already in progress, waiting...');
    return { app: null, auth: null, db: null, analytics: null };
  }

  // Check if Firebase is already initialized
  if (app && authInstance && dbInstance) {
    return { app, auth: authInstance, db: dbInstance, analytics: analyticsInstance };
  }

  // Skip initialization during build time
  if (isBuildTime) {
    console.log('Skipping Firebase initialization during build time');
    return { app: null, auth: null, db: null, analytics: null };
  }

  isInitializing = true;

  try {
    const isValid = validateFirebaseConfig();
    if (!isValid) {
      console.log('Firebase config validation failed, skipping initialization');
      isInitializing = false;
      return { app: null, auth: null, db: null, analytics: null };
    }

    const firebaseConfig = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
      measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
    };

    // Check for existing apps with the same config
    const existingApps = getApps();
    const existingApp = existingApps.find(existingApp => 
      existingApp.options.projectId === firebaseConfig.projectId &&
      existingApp.options.appId === firebaseConfig.appId
    );

    if (existingApp) {
      // Use existing app
      console.log('Using existing Firebase app');
      app = existingApp;
    } else {
      // Create new app with unique name to avoid conflicts
      try {
        const appName = `netball-scorer-${Date.now()}`;
        app = initializeApp(firebaseConfig, appName);
        console.log('Firebase app initialized successfully');
      } catch (error: any) {
        if (error.code === 'app/duplicate-app') {
          // Handle duplicate app error by using existing app
          console.log('Duplicate app detected, using existing app');
          const existingApps = getApps();
          if (existingApps.length > 0) {
            app = existingApps[0];
          } else {
            throw new Error('Failed to initialize Firebase: No existing apps found');
          }
        } else {
          throw error;
        }
      }
    }

    // Initialize services
    if (app) {
      try {
        authInstance = getAuth(app);
        dbInstance = getFirestore(app);
        
        // Initialize Analytics (only in browser environment)
        if (typeof window !== 'undefined' && !analyticsInstance) {
          try {
            analyticsInstance = getAnalytics(app);
          } catch (error) {
            console.log('Analytics not available:', error);
          }
        }
        
        console.log('Firebase services initialized successfully');
      } catch (error) {
        console.error('Failed to initialize Firebase services:', error);
        // Reset instances on failure
        app = null;
        authInstance = null;
        dbInstance = null;
        analyticsInstance = null;
      }
    }

    isInitializing = false;
    return { app, auth: authInstance, db: dbInstance, analytics: analyticsInstance };
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    isInitializing = false;
    // Reset instances on failure
    app = null;
    authInstance = null;
    dbInstance = null;
    analyticsInstance = null;
    return { app: null, auth: null, db: null, analytics: null };
  }
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

// Legacy exports for backward compatibility - but make them safe during build
export const auth = isBuildTime ? null : getFirebaseAuth();
export const db = isBuildTime ? null : getFirebaseDB();
export const analytics = isBuildTime ? null : getFirebaseAnalytics();

export default app;
