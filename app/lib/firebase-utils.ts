import { 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  collection, 
  query, 
  where, 
  orderBy, 
  deleteDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  enableNetwork,
  disableNetwork
} from 'firebase/firestore';
// Remove top-level Firebase imports to prevent build-time errors
// import { db, auth } from './firebase';
import { 
  saveGuestGame, 
  loadGuestGame, 
  updateGuestGame, 
  deleteGuestGame, 
  getGuestGamesList,
  getCompletedGuestGames,
  GuestGame,
  GuestGameSummary,
  saveLocalGame,
  loadLocalGame,
  updateLocalGame,
  deleteLocalGame,
  getLocalGamesList,
  getCompletedLocalGames,
  LocalGame,
  saveSyncQueue,
  getSyncQueue,
  clearSyncQueue,
  saveHybridGuestGame,
  loadHybridGuestGame,
  updateHybridGuestGame,
  deleteHybridGuestGame,
  getHybridGuestGamesList,
  upgradeGuestGameToHybrid,
  HybridGuestGame,
  getDeviceId
} from './guest-storage';

// Check if we're in a build environment
const isBuildTime = process.env.NODE_ENV === 'production' && typeof window === 'undefined';

// Lazy Firebase imports
let firebaseDb: any = null;
let firebaseAuth: any = null;

const getFirebaseDB = () => {
  if (isBuildTime) return null;
  if (!firebaseDb) {
    try {
      const { getFirebaseDB } = require('./firebase');
      firebaseDb = getFirebaseDB();
    } catch (error) {
      console.warn('Failed to load Firebase DB:', error);
      return null;
    }
  }
  return firebaseDb;
};

const getFirebaseAuth = () => {
  if (isBuildTime) return null;
  if (!firebaseAuth) {
    try {
      const { getFirebaseAuth } = require('./firebase');
      firebaseAuth = getFirebaseAuth();
    } catch (error) {
      console.warn('Failed to load Firebase Auth:', error);
      return null;
    }
  }
  return firebaseAuth;
};

// Types
export interface Game {
  id: string;
  shortId: string;
  createdAt: Timestamp;
  ownerId: string;
  ownerEmail: string;
  sharePublic: boolean;
  isPubliclyViewable?: boolean; // Added for Firebase rules compatibility
  teamA: { name: string };
  teamB: { name: string };
  location: string;
  settings: {
    numQuarters: number;
    quarterDurationSec: number;
    breakDurationsSec: number[];
    matchType: "standard" | "carnival";
  };
  state: {
    phase: { type: string; index: number };
    isRunning: boolean;
    phaseStartedAt: string | null;
    elapsedMs: number;
    scores: { A: number; B: number };
    quarterScores: { [key: number]: { A: number; B: number } };
    centrePass: "A" | "B";
    lastGoal: any;
  };
  lastSyncedAt?: number; // Local timestamp of last successful sync
  version?: number; // For conflict resolution
}

export interface GameSummary {
  id: string;
  shortId: string;
  teamA: string;
  teamB: string;
  createdAt: Timestamp;
  location: string;
  ownerId: string;
  ownerEmail: string;
}

// Network status tracking
let isOnline = navigator.onLine;
let isFirebaseConnected = true;

// Listen for network changes
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline = true;
    console.log('Network: Online - attempting to sync pending changes');
    syncPendingChanges();
  });
  
  window.addEventListener('offline', () => {
    isOnline = false;
    console.log('Network: Offline - changes will be queued for sync');
  });
}

// Check Firebase connectivity
async function checkFirebaseConnection(): Promise<boolean> {
  try {
    if (!isOnline) return false;
    
    // Allow both authenticated users AND anonymous users to connect to Firebase
    // Anonymous users need Firebase access for public game sharing
    if (!getFirebaseAuth()?.currentUser) {
      // Only log in development mode
      if (process.env.NODE_ENV === 'development') {
        console.log('Firebase connection check skipped: No auth user');
      }
      isFirebaseConnected = false;
      return false;
    }
    
    const db = getFirebaseDB();
    if (!db) {
      console.warn('Firebase connection check failed: Database not available');
      isFirebaseConnected = false;
      return false;
    }
    
    // Only log in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log('Testing Firebase connection...');
    }
    
    // Try a simple Firebase operation with timeout
    // Use a read-only operation since anonymous users can't write to test collections
    const testDoc = doc(db, '_test_connection', 'test');
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firebase connection timeout')), 5000)
    );
    
    // For anonymous users, just test if we can read from Firebase
    // For authenticated users, test full read/write access
    const currentUser = getFirebaseAuth()?.currentUser;
    let testPromise;
    
    if (currentUser?.isAnonymous) {
      // Anonymous users: just test if we can connect to Firebase
      testPromise = getDoc(testDoc).catch(() => {
        // Ignore errors for anonymous users - just testing connectivity
        return null;
      });
    } else {
      // Authenticated users: test full read/write access
      testPromise = Promise.all([
        setDoc(testDoc, { timestamp: serverTimestamp() }, { merge: true }),
        deleteDoc(testDoc)
      ]);
    }
    
    await Promise.race([testPromise, timeoutPromise]);
    
    // Only log in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log('Firebase connection test successful');
    }
    isFirebaseConnected = true;
    return true;
  } catch (error) {
    // Only log as warning if it's a permissions issue, otherwise as info
    if (error instanceof Error && (error.message.includes('Missing') || error.message.includes('insufficient permissions'))) {
      console.info('Firebase connection check: Permissions issue (checking if this is expected)');
    } else {
      console.warn('Firebase connection check failed:', error);
    }
    isFirebaseConnected = false;
    return false;
  }
}

// Test Firebase connection with detailed error reporting
export async function testFirebaseConnection(): Promise<boolean> {
  try {
    // Only log in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log('Testing Firebase connection...');
    }
    
    if (!isOnline) {
      // Only log in development mode
      if (process.env.NODE_ENV === 'development') {
        console.log('Firebase connection test skipped: Offline');
      }
      return false;
    }
    
    // Allow guest users to connect to Firebase for public game sharing
    if (!getFirebaseAuth()?.currentUser) {
      // Only log in development mode
      if (process.env.NODE_ENV === 'development') {
        console.log('Firebase connection test skipped: No auth user');
      }
      return false;
    }
    
    const db = getFirebaseDB();
    if (!db) {
      // Only log in development mode
      if (process.env.NODE_ENV === 'development') {
        console.log('Firebase connection test failed: Database not available');
      }
      return false;
    }
    
    // Try a simple Firebase operation
    // Use a read-only operation since anonymous users can't write to test collections
    const testDoc = doc(db, '_test_connection', 'test');
    const currentUser = getFirebaseAuth()?.currentUser;
    
    if (currentUser?.isAnonymous) {
      // Anonymous users: just test if we can connect to Firebase
      await getDoc(testDoc).catch(() => {
        // Ignore errors for anonymous users - just testing connectivity
        return null;
      });
    } else {
      // Authenticated users: test full read/write access
      await setDoc(testDoc, { timestamp: serverTimestamp() }, { merge: true });
      await deleteDoc(testDoc);
    }
    
    // Only log in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log('Firebase connection test successful');
    }
    return true;
  } catch (error) {
    console.error('Firebase connection test failed:', error);
    
    // Log specific error details for debugging (only for unexpected errors)
    if (error instanceof Error) {
      if (error.message.includes('Target ID already exists')) {
        console.warn('Firebase "Target ID already exists" error. This indicates:');
        console.warn('1. Multiple Firebase app instances are running');
        console.warn('2. Firebase configuration conflict');
        console.warn('3. Firebase app initialization issue');
        console.warn('4. Firebase rules preventing access');
      } else if (error.message.includes('Missing') || error.message.includes('insufficient permissions')) {
        // Don't log this as error for guest users - it's expected
        console.info('Firebase permissions issue (expected for guest users)');
      } else if (error.message.includes('400')) {
        console.warn('Firebase Bad Request (400) - check request format and permissions');
      } else if (error.message.includes('permission-denied')) {
        console.warn('Firebase permission denied - check security rules');
      }
    }
    
    return false;
  }
}

// Sync pending changes when back online
async function syncPendingChanges() {
  if (!getFirebaseAuth()?.currentUser || getFirebaseAuth()?.currentUser.isAnonymous) return;
  
  try {
    const pendingChanges = getSyncQueue();
    if (pendingChanges.length === 0) return;
    
    // Only log in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log(`Syncing ${pendingChanges.length} pending changes...`);
    }
    
    for (const change of pendingChanges) {
      try {
        if (change.type === 'update') {
          await updateDoc(doc(getFirebaseDB(), 'games', change.gameId), {
            ...change.updates,
            lastSyncedAt: serverTimestamp(),
            version: (change.version || 0) + 1,
          });
        } else if (change.type === 'create') {
          await setDoc(doc(getFirebaseDB(), 'games', change.gameId), {
            ...change.gameData,
            lastSyncedAt: serverTimestamp(),
            version: 1,
          });
        }
        
        // Update local game with sync timestamp
        updateLocalGame(change.gameId, { 
          lastSyncedAt: Date.now(),
          version: (change.version || 0) + 1 
        });
        
        console.log(`Synced change for game ${change.gameId}`);
      } catch (error) {
        console.error(`Failed to sync change for game ${change.gameId}:`, error);
        // Keep in queue for retry
        continue;
      }
    }
    
    // Clear successfully synced changes
    clearSyncQueue();
    console.log('Sync completed successfully');
    
  } catch (error) {
    console.error('Error during sync:', error);
  }
}

// Create a new game
export async function createGame(gameData: Omit<Game, 'id' | 'createdAt' | 'ownerId' | 'ownerEmail'>): Promise<string> {
  try {
    console.log('=== CREATE GAME DEBUG ===');
    console.log('Game data received:', gameData);
    console.log('sharePublic flag:', gameData.sharePublic);
    console.log('User auth state:', getFirebaseAuth()?.currentUser);
    console.log('Is user anonymous:', getFirebaseAuth()?.currentUser?.isAnonymous);
    
    // Skip Firebase operations during build time
    if (isBuildTime) {
      console.log('Skipping Firebase operations during build time');
      // Return a mock ID for build time
      return 'build-time-mock-id';
    }

    if (!getFirebaseAuth()?.currentUser) {
      throw new Error('User must be authenticated to create a game');
    }

    const gameId = Date.now().toString();
    console.log('Generated game ID:', gameId);
    
    // Check if user is anonymous (guest)
    if (getFirebaseAuth()?.currentUser.isAnonymous) {
      console.log('Creating game for ANONYMOUS user');
      // Get device ID first for all guest games
      const deviceId = getDeviceId();
      
      // For guest users: Create hybrid game (local + Firebase) if sharing is enabled
      if (gameData.sharePublic) {
        console.log('Creating HYBRID guest game (local + Firebase sync)');
        
        // Create hybrid guest game
        const hybridGuestGame: HybridGuestGame = {
          ...gameData,
          id: gameId,
          createdAt: Date.now(),
          deviceId: deviceId, // Set device ID immediately
          firebaseId: gameId, // Use the same ID for Firebase
          lastSyncedAt: Date.now(),
          version: 1,
          sharePublic: true,
        };
        
        console.log('Hybrid guest game object:', hybridGuestGame);
        
        // Save locally first
        saveHybridGuestGame(hybridGuestGame);
        console.log('Hybrid guest game saved locally');
        
        // For PUBLIC guest games, try to save to Firebase immediately
        // This ensures the game can be accessed from share links immediately
        try {
          const firebaseConnected = await checkFirebaseConnection();
          console.log('Firebase connection status for public guest game:', firebaseConnected);
          
          if (firebaseConnected) {
            console.log('Saving public guest game to Firebase immediately...');
            const firebaseGame = {
              ...gameData,
              id: gameId,
              createdAt: serverTimestamp() as Timestamp, // Use server timestamp for Firebase
              ownerId: `guest_${deviceId}`,
              ownerEmail: 'guest@local',
              deviceId: deviceId,
              sharePublic: true,
              isPubliclyViewable: true, // Add this field for Firebase rules compatibility
              lastSyncedAt: Date.now(),
              version: 1,
            };
            
            await setDoc(doc(getFirebaseDB(), 'games', gameId), firebaseGame);
            console.log('Public guest game saved to Firebase successfully');
            
            // Update local game with sync confirmation
            updateHybridGuestGame(gameId, { lastSyncedAt: Date.now() });
          } else {
            console.log('Firebase not connected, queuing public guest game for sync');
            // Queue for sync when online
            const firebaseGame = {
              ...gameData,
              id: gameId,
              createdAt: Date.now(),
              ownerId: `guest_${deviceId}`,
              ownerEmail: 'guest@local',
              deviceId: deviceId,
              sharePublic: true,
              lastSyncedAt: Date.now(),
              version: 1,
            };
            
            saveSyncQueue({
              type: 'create',
              gameId,
              gameData: firebaseGame,
              timestamp: Date.now(),
              version: 1,
            });
          }
        } catch (error) {
          console.warn('Failed to save public guest game to Firebase immediately:', error);
          // Queue for sync when online
          const firebaseGame = {
            ...gameData,
            id: gameId,
            createdAt: Date.now(),
            ownerId: `guest_${deviceId}`,
            ownerEmail: 'guest@local',
            deviceId: deviceId,
            sharePublic: true,
            lastSyncedAt: Date.now(),
            version: 1,
          };
          
          saveSyncQueue({
            type: 'create',
            gameId,
            gameData: firebaseGame,
            timestamp: Date.now(),
            version: 1,
          });
        }
        
        console.log('Game queued for Firebase sync');
        // Only log in development mode
        if (process.env.NODE_ENV === 'development') {
          console.log('Hybrid guest game created locally, queued for Firebase sync');
        }
      } else {
        console.log('Creating REGULAR local-only guest game');
        // Regular local-only guest game
        const guestGame: GuestGame = {
          ...gameData,
          id: gameId,
          createdAt: Date.now(),
          deviceId: deviceId, // Use the device ID we already got
          sharePublic: false,
        };
        
        console.log('Guest game object:', guestGame);
        saveGuestGame(guestGame);
        console.log('Guest game saved locally');
      }
      
      console.log('=== END CREATE GAME DEBUG ===');
      return gameId;
    } else {
      console.log('Creating game for REGISTERED user');
      // For registered users: Save BOTH locally AND to Firebase
      const game: Game = {
        ...gameData,
        id: gameId,
        createdAt: serverTimestamp() as Timestamp,
        ownerId: getFirebaseAuth()?.currentUser.uid,
        ownerEmail: getFirebaseAuth()?.currentUser.email || 'unknown',
        isPubliclyViewable: gameData.sharePublic, // Add this field for Firebase rules compatibility
        lastSyncedAt: Date.now(),
        version: 1,
      };

      console.log('Registered user game object:', game);

      // Always save locally first for immediate access
      const localGame = {
        ...gameData,
        id: gameId,
        createdAt: Date.now(),
        ownerId: getFirebaseAuth()?.currentUser.uid,
        ownerEmail: getFirebaseAuth()?.currentUser.email || 'unknown',
        lastSyncedAt: Date.now(),
        version: 1,
      };
      
      console.log('Local game object:', localGame);
      saveLocalGame(localGame);
      console.log('Game saved locally');

      // Try to save to Firebase (cloud backup)
      try {
        const firebaseConnected = await checkFirebaseConnection();
        console.log('Firebase connection status:', firebaseConnected);
        
        if (firebaseConnected) {
          console.log('Saving game to Firebase...');
          await setDoc(doc(getFirebaseDB(), 'games', gameId), game);
          
          // Also save to games collection for easy querying
          const gameSummary: GameSummary = {
            id: gameId,
            shortId: gameData.shortId,
            teamA: gameData.teamA.name,
            teamB: gameData.teamB.name,
            createdAt: game.createdAt,
            location: gameData.location,
            ownerId: game.ownerId,
            ownerEmail: game.ownerEmail,
          };
          
          await setDoc(doc(getFirebaseDB(), 'games', gameId), gameSummary, { merge: true });
          
          // Update local game with sync confirmation
          updateLocalGame(gameId, { lastSyncedAt: Date.now() });
          console.log('Game created and synced to Firebase');
        } else {
          console.log('Firebase not connected, queuing for sync');
          // Queue for sync when online
          saveSyncQueue({
            type: 'create',
            gameId,
            gameData: game,
            timestamp: Date.now(),
            version: 1,
          });
          console.log('Game created locally, queued for Firebase sync');
        }
      } catch (error) {
        console.warn('Failed to save to Firebase, continuing with local storage only:', error);
        // Continue with local storage only - don't fail the game creation
        // Queue for sync when online
        saveSyncQueue({
          type: 'create',
          gameId,
          gameData: game,
          timestamp: Date.now(),
          version: 1,
        });
      }
      
      console.log('=== END CREATE GAME DEBUG ===');
      return gameId;
    }
  } catch (error) {
    console.error('Error creating game:', error);
    // Don't throw error, return a fallback ID and continue
    const fallbackId = `fallback_${Date.now()}`;
    console.log('Using fallback game ID:', fallbackId);
    return fallbackId;
  }
}

// Load a game by ID
export async function loadGame(gameId: string): Promise<Game | null> {
  try {
    // Skip Firebase operations during build time
    if (isBuildTime) {
      console.log('Skipping Firebase operations during build time');
      return null;
    }

    // Check if user is anonymous (guest)
    if (getFirebaseAuth()?.currentUser?.isAnonymous) {
      // For guest users: Try hybrid guest game first, then regular guest game
      let hybridGame = loadHybridGuestGame(gameId);
      
      if (hybridGame) {
        // Convert HybridGuestGame to Game format for compatibility
        return {
          ...hybridGame,
          createdAt: { toDate: () => new Date(hybridGame.createdAt) } as any,
          ownerId: `guest_${hybridGame.deviceId}`,
          ownerEmail: 'guest@local',
          sharePublic: hybridGame.sharePublic || false,
        } as Game;
      }
      
      // Try regular guest game
      const guestGame = loadGuestGame(gameId);
      if (guestGame) {
        // Convert GuestGame to Game format for compatibility
        return {
          ...guestGame,
          createdAt: { toDate: () => new Date(guestGame.createdAt) } as any,
          ownerId: 'guest',
          ownerEmail: 'guest@local',
          sharePublic: guestGame.sharePublic || false,
        } as Game;
      }
      
      return null;
    } else {
      // For registered users: Try local storage first, then Firebase
      let localGame = loadLocalGame(gameId);
      
      if (localGame) {
        // Convert LocalGame to Game format for compatibility
        const gameWithTimestamp = {
          ...localGame,
          createdAt: { toDate: () => new Date(localGame.createdAt) } as any,
        } as Game;
        
        // Try to sync with Firebase in the background
        try {
          const firebaseConnected = await checkFirebaseConnection();
          if (firebaseConnected) {
            const gameRef = doc(getFirebaseDB(), 'games', gameId);
            const gameDoc = await getDoc(gameRef);
            
            if (gameDoc.exists()) {
              const firebaseGame = gameDoc.data() as Game;
              
              // Check if Firebase has newer version
              if (firebaseGame.version && firebaseGame.version > (localGame.version || 0)) {
                console.log('Firebase has newer version, updating local game');
                // Update local game with Firebase data
                const updatedLocalGame = {
                  ...firebaseGame,
                  createdAt: Date.now(), // Convert Timestamp to number for local storage
                  lastSyncedAt: Date.now(),
                };
                updateLocalGame(gameId, updatedLocalGame);
                
                // Return Firebase game
                return firebaseGame;
              } else {
                // Local game is up to date or newer
                console.log('Local game is up to date');
                return gameWithTimestamp;
              }
            } else {
              // Game doesn't exist in Firebase, return local game
              console.log('Game not found in Firebase, using local game');
              return gameWithTimestamp;
            }
          } else {
            // Firebase not connected, return local game
            console.log('Firebase not connected, using local game');
            return gameWithTimestamp;
          }
        } catch (error) {
          console.warn('Failed to sync with Firebase, using local game:', error);
          return gameWithTimestamp;
        }
      }
      
      // Game not found locally, try Firebase
      try {
        const firebaseConnected = await checkFirebaseConnection();
        if (firebaseConnected) {
          const gameRef = doc(getFirebaseDB(), 'games', gameId);
          const gameDoc = await getDoc(gameRef);
          
          if (gameDoc.exists()) {
            const firebaseGame = gameDoc.data() as Game;
            
            // Save to local storage for future access
            const localGame = {
              ...firebaseGame,
              createdAt: Date.now(), // Convert Timestamp to number for local storage
              lastSyncedAt: Date.now(),
            };
            saveLocalGame(localGame);
            
            console.log('Game loaded from Firebase and saved locally');
            return firebaseGame;
          }
        }
      } catch (error) {
        console.warn('Failed to load from Firebase:', error);
      }
      
      return null;
    }
  } catch (error) {
    console.error('Error loading game:', error);
    // Try to load from local storage as fallback
    try {
      if (getFirebaseAuth()?.currentUser?.isAnonymous) {
        const fallbackGame = loadHybridGuestGame(gameId) || loadGuestGame(gameId);
        if (fallbackGame) {
          console.log('Using fallback local game after load error');
          return {
            ...fallbackGame,
            createdAt: { toDate: () => new Date(fallbackGame.createdAt) } as any,
            ownerId: fallbackGame.deviceId ? `guest_${fallbackGame.deviceId}` : 'guest',
            ownerEmail: 'guest@local',
            sharePublic: fallbackGame.sharePublic || false,
          } as Game;
        }
      } else {
        const fallbackGame = loadLocalGame(gameId);
        if (fallbackGame) {
          console.log('Using fallback local game after load error');
          return {
            ...fallbackGame,
            createdAt: { toDate: () => new Date(fallbackGame.createdAt) } as any,
          } as Game;
        }
      }
    } catch (fallbackError) {
      console.warn('Failed to load fallback game:', fallbackError);
    }
    return null;
  }
}

// Update a game
export async function updateGame(gameId: string, updates: Partial<Game>): Promise<Game | null> {
  try {
    // Check if user is anonymous (guest)
    if (getFirebaseAuth()?.currentUser?.isAnonymous) {
      // First try to update hybrid guest game
      let hybridGuestGame = loadHybridGuestGame(gameId);
      
      if (hybridGuestGame) {
        // This is a hybrid guest game - update locally and sync with Firebase
        const newVersion = (hybridGuestGame.version || 1) + 1;
        
        // Convert Game updates to HybridGuestGame updates
        const { lastSyncedAt, version, sharePublic, ...guestUpdates } = updates;
        const guestUpdateData: Partial<HybridGuestGame> = {
          ...guestUpdates,
          version: newVersion,
          lastSyncedAt: Date.now(),
          createdAt: updates.createdAt ? (updates.createdAt as any).toDate?.() ? (updates.createdAt as any).toDate().getTime() : Date.now() : undefined,
        };
        
        // Update locally first for immediate response
        const updatedHybridGame = updateHybridGuestGame(gameId, guestUpdateData);
        if (!updatedHybridGame) return null;
        
        // Try to update Firebase for real-time sharing
        try {
          const firebaseConnected = await checkFirebaseConnection();
          if (firebaseConnected) {
            const gameRef = doc(getFirebaseDB(), 'games', gameId);
            await updateDoc(gameRef, {
              ...updates,
              lastSyncedAt: serverTimestamp(),
              version: newVersion,
            });
            
            // Update local game with sync confirmation
            updateHybridGuestGame(gameId, { lastSyncedAt: Date.now() });
            console.log('Hybrid guest game updated and synced to Firebase');
          } else {
            // Queue for sync when online
            saveSyncQueue({
              type: 'update',
              gameId,
              updates: updates,
              timestamp: Date.now(),
              version: newVersion,
            });
            // Only log in development mode
            if (process.env.NODE_ENV === 'development') {
              console.log('Hybrid guest game updated locally, queued for Firebase sync');
            }
          }
        } catch (error) {
          console.warn('Failed to update Firebase for hybrid guest game, continuing with local storage only:', error);
          // Continue with local storage only - don't fail the update
          // Queue for sync when online
          saveSyncQueue({
            type: 'update',
            gameId,
            updates: updates,
            timestamp: Date.now(),
            version: newVersion,
          });
        }
        
        // Return updated hybrid guest game
        return {
          ...updatedHybridGame,
          createdAt: { toDate: () => new Date(updatedHybridGame.createdAt) } as any,
          ownerId: `guest_${updatedHybridGame.deviceId}`,
          ownerEmail: 'guest@local',
          sharePublic: true,
        } as Game;
      }
      
      // Try regular guest game
      const guestGame = loadGuestGame(gameId);
      if (guestGame) {
        // Convert Game updates to GuestGame updates, excluding Firebase-specific fields
        const { lastSyncedAt, version, sharePublic, ...guestUpdates } = updates;
        
        // Convert Timestamp to number for GuestGame
        const guestUpdateData: Partial<GuestGame> = {
          ...guestUpdates,
          createdAt: updates.createdAt ? (updates.createdAt as any).toDate?.() ? (updates.createdAt as any).toDate().getTime() : Date.now() : undefined,
        };
        
        const updatedGame = updateGuestGame(gameId, guestUpdateData);
        if (updatedGame) {
          // Convert back to Game format for compatibility
          return {
            ...updatedGame,
            createdAt: { toDate: () => new Date(updatedGame.createdAt) } as any,
            ownerId: 'guest',
            ownerEmail: 'guest@local',
            sharePublic: updatedGame.sharePublic || false,
          } as Game;
        }
        return null;
      }
      
      return null;
    } else {
      // For registered users: Update locally first, then Firebase
      const localGame = loadLocalGame(gameId);
      if (!localGame) return null;
      
      // Increment version for conflict resolution
      const newVersion = (localGame.version || 0) + 1;
      
      // Convert Game updates to LocalGame updates, excluding Firebase-specific fields
      const { lastSyncedAt, ...localUpdates } = updates;
      const localUpdateData: Partial<LocalGame> = {
        ...localUpdates,
        version: newVersion,
        lastSyncedAt: Date.now(),
        // Convert Timestamp to number for LocalGame
        createdAt: updates.createdAt ? (updates.createdAt as any).toDate?.() ? (updates.createdAt as any).toDate().getTime() : Date.now() : undefined,
      };
      
      // Update locally for immediate response
      const updatedLocalGame = updateLocalGame(gameId, localUpdateData);
      if (!updatedLocalGame) return null;
      
      // Try to update Firebase
      try {
        const firebaseConnected = await checkFirebaseConnection();
        if (firebaseConnected) {
          const gameRef = doc(getFirebaseDB(), 'games', gameId);
          await updateDoc(gameRef, {
            ...updates,
            lastSyncedAt: serverTimestamp(),
            version: newVersion,
          });
          
          // Only log in development mode
          if (process.env.NODE_ENV === 'development') {
            console.log('Game updated and synced to Firebase');
          }
        } else {
          // Queue for sync when online
          saveSyncQueue({
            type: 'update',
            gameId,
            updates: updates,
            timestamp: Date.now(),
            version: newVersion,
          });
          console.log('Game updated locally, queued for Firebase sync');
        }
      } catch (error) {
        console.warn('Failed to update Firebase, continuing with local storage only:', error);
        // Continue with local storage only - don't fail the update
        // Queue for sync when online
        saveSyncQueue({
          type: 'update',
          gameId,
          updates: updates,
          timestamp: Date.now(),
          version: newVersion,
        });
      }
      
      // Return updated local game
      return {
        ...updatedLocalGame,
        createdAt: { toDate: () => new Date(updatedLocalGame.createdAt) } as any,
      } as Game;
    }
  } catch (error) {
    console.error('Error updating game:', error);
    // Don't return null, try to return the current game state if possible
    try {
      // Try to load the current game state as fallback
      const currentGame = await loadGame(gameId);
      if (currentGame) {
        console.log('Returning current game state as fallback after update error');
        return currentGame;
      }
    } catch (fallbackError) {
      console.warn('Failed to load fallback game state:', fallbackError);
    }
    return null;
  }
}

// Get all games for a user
export async function getUserGames(): Promise<GameSummary[]> {
  if (!getFirebaseAuth()?.currentUser) {
    return [];
  }

  try {
    // Check if user is anonymous (guest)
    if (getFirebaseAuth()?.currentUser.isAnonymous) {
      const guestGames = getGuestGamesList();
      // Convert GuestGameSummary to GameSummary format for compatibility
      return guestGames.map(game => ({
        ...game,
        createdAt: { toDate: () => new Date(game.createdAt) } as any,
        ownerId: 'guest',
        ownerEmail: 'guest@local',
      }));
    } else {
      // For registered users: Get from local storage first, then sync with Firebase
      let localGames = getLocalGamesList();
      
      // Try to get from Firebase to ensure we have the latest data
      try {
        const gamesQuery = query(
          collection(getFirebaseDB(), 'games'),
          where('ownerId', '==', getFirebaseAuth()?.currentUser.uid),
          orderBy('createdAt', 'desc')
        );
        
        const querySnapshot = await getDocs(gamesQuery);
        const firebaseGames = querySnapshot.docs.map(doc => doc.data() as GameSummary);
        
        // Merge local and Firebase games, prioritizing Firebase data
        const mergedGames = firebaseGames.map(fbGame => {
          const localGame = localGames.find(lg => lg.id === fbGame.id);
          if (localGame) {
            // Update local game with Firebase data
            const updatedLocalGame = {
              ...localGame,
              ...fbGame,
              createdAt: fbGame.createdAt?.toDate?.() ? fbGame.createdAt.toDate().getTime() : Date.now(),
              // Convert team names from strings to objects
              teamA: { name: fbGame.teamA },
              teamB: { name: fbGame.teamB },
            };
            updateLocalGame(fbGame.id, updatedLocalGame);
            return updatedLocalGame;
          } else {
            // New game from Firebase, save locally
            // We need to construct a proper LocalGame object
            // Since we only have GameSummary, we'll need to load the full game or create a minimal one
            const newLocalGame: LocalGame = {
              id: fbGame.id,
              shortId: fbGame.shortId,
              createdAt: fbGame.createdAt?.toDate?.() ? fbGame.createdAt.toDate().getTime() : Date.now(),
              ownerId: fbGame.ownerId,
              ownerEmail: fbGame.ownerEmail,
              teamA: { name: fbGame.teamA },
              teamB: { name: fbGame.teamB },
              location: fbGame.location,
              sharePublic: false, // Default value
              settings: {
                numQuarters: 4,
                quarterDurationSec: 900,
                breakDurationsSec: [180, 180, 180],
                matchType: "standard",
              },
              state: {
                phase: { type: "fulltime", index: 4 },
                isRunning: false,
                phaseStartedAt: null,
                elapsedMs: 0,
                scores: { A: 0, B: 0 },
                quarterScores: { 1: { A: 0, B: 0 }, 2: { A: 0, B: 0 }, 3: { A: 0, B: 0 }, 4: { A: 0, B: 0 } },
                centrePass: "A",
                lastGoal: null,
              },
            };
            saveLocalGame(newLocalGame);
            return newLocalGame;
          }
        });
        
        // Convert to GameSummary format
        return mergedGames.map(game => ({
          id: game.id,
          shortId: game.shortId,
          teamA: game.teamA.name,
          teamB: game.teamB.name,
          createdAt: { toDate: () => new Date(game.createdAt) } as any,
          location: game.location,
          ownerId: game.ownerId,
          ownerEmail: game.ownerEmail,
        }));
      } catch (firebaseError) {
        console.warn('Firebase sync failed, using local data only:', firebaseError);
        // If Firebase fails, use local data
        return localGames.map(game => ({
          ...game,
          createdAt: { toDate: () => new Date(game.createdAt) } as any,
          ownerId: getFirebaseAuth()?.currentUser.uid,
          ownerEmail: getFirebaseAuth()?.currentUser.email || 'unknown',
        }));
      }
    }
  } catch (error) {
    console.error('Error loading user games:', error);
    return [];
  }
}

// Get public games (for sharing)
export async function getPublicGame(gameId: string): Promise<Game | null> {
  try {
    console.log(`=== GET PUBLIC GAME DEBUG ===`);
    console.log(`Attempting to load public game: ${gameId}`);
    
    // First try to get from Firebase
    const db = getFirebaseDB();
    console.log('Firebase DB available:', !!db);
    
    if (!db) {
      console.warn('Firebase database not available, checking local storage only');
      // Fall back to local storage check
      const hybridGuestGame = loadHybridGuestGame(gameId);
      console.log('Hybrid guest game from local storage:', hybridGuestGame);
      if (hybridGuestGame && hybridGuestGame.sharePublic) {
        console.log('Found hybrid guest game in local storage');
        // Convert HybridGuestGame to Game format for compatibility
        return {
          ...hybridGuestGame,
          createdAt: { toDate: () => new Date(hybridGuestGame.createdAt) } as any,
          ownerId: `guest_${hybridGuestGame.deviceId}`,
          ownerEmail: 'guest@local',
          sharePublic: true,
        } as Game;
      }
      
      const guestGame = loadGuestGame(gameId);
      console.log('Regular guest game from local storage:', guestGame);
      if (guestGame && guestGame.sharePublic) {
        console.log('Found guest game in local storage');
        // Convert GuestGame to Game format for compatibility
        return {
          ...guestGame,
          createdAt: { toDate: () => new Date(guestGame.createdAt) } as any,
          ownerId: 'guest',
          ownerEmail: 'guest@local',
          sharePublic: true,
        } as Game;
      }
      
      console.log('No games found in local storage');
      console.log(`=== END GET PUBLIC GAME DEBUG ===`);
      return null;
    }
    
    console.log('Firebase database available, attempting to fetch game document');
    
    let gameDoc: any;
    try {
      gameDoc = await getDoc(doc(db, 'games', gameId));
      console.log('Firebase document exists:', gameDoc.exists());
    } catch (error) {
      console.warn('Firebase fetch failed, attempting to reconnect and retry:', error);
      
      // Try to reconnect to Firebase
      try {
        await enableNetwork(db);
        console.log('Firebase network re-enabled, retrying fetch...');
        gameDoc = await getDoc(doc(db, 'games', gameId));
        console.log('Firebase document exists (after reconnect):', gameDoc.exists());
      } catch (retryError) {
        console.error('Firebase reconnect failed, falling back to local storage:', retryError);
        // Continue with local storage fallback
        gameDoc = { exists: () => false };
      }
    }
    
    if (gameDoc.exists()) {
        const game = gameDoc.data() as Game;
        console.log('Game document found in Firebase:', { 
          id: game.id, 
          sharePublic: game.sharePublic, 
          isPubliclyViewable: game.isPubliclyViewable,
          ownerId: game.ownerId,
          teamA: game.teamA?.name,
          teamB: game.teamB?.name
        });
        
        // Check both sharePublic and isPubliclyViewable for compatibility
        if (game.sharePublic || game.isPubliclyViewable) {
          console.log('Game is public, returning Firebase data');
          console.log(`=== END GET PUBLIC GAME DEBUG ===`);
          return game;
        } else {
          console.log('Game found but is not public');
          console.log(`=== END GET PUBLIC GAME DEBUG ===`);
          return null;
        }
      } else {
      console.log('Game document not found in Firebase, checking local storage');
    }
    
    // If not found in Firebase, check if it's a hybrid guest game in local storage
    // This allows guest users to share games with others on the same device
    const hybridGuestGame = loadHybridGuestGame(gameId);
    console.log('Hybrid guest game from local storage (Firebase fallback):', hybridGuestGame);
    if (hybridGuestGame && hybridGuestGame.sharePublic) {
      console.log('Found hybrid guest game in local storage');
      // Convert HybridGuestGame to Game format for compatibility
      return {
        ...hybridGuestGame,
        createdAt: { toDate: () => new Date(hybridGuestGame.createdAt) } as any,
        ownerId: `guest_${hybridGuestGame.deviceId}`,
        ownerEmail: 'guest@local',
        sharePublic: true,
      } as Game;
    }
    
    // Try regular guest game as final fallback
    const guestGame = loadGuestGame(gameId);
    console.log('Regular guest game from local storage (Firebase fallback):', guestGame);
    if (guestGame && guestGame.sharePublic) {
      console.log('Found regular guest game in local storage');
      // Convert GuestGame to Game format for compatibility
      return {
        ...guestGame,
        createdAt: { toDate: () => new Date(guestGame.createdAt) } as any,
        ownerId: 'guest',
        ownerEmail: 'guest@local',
        sharePublic: true,
      } as Game;
    }
    
    console.log('Game not found in Firebase or local storage');
    console.log(`=== END GET PUBLIC GAME DEBUG ===`);
    return null;
  } catch (error) {
    console.error('Error loading public game:', error);
    
    // Log specific error details for debugging
    if (error instanceof Error) {
      if (error.message.includes('Target ID already exists')) {
        console.error('Firebase "Target ID already exists" error detected. This usually means:');
        console.error('1. Multiple Firebase app instances are running');
        console.error('2. Firebase configuration conflict');
        console.error('3. Firebase app initialization issue');
        console.error('4. Firebase rules preventing access');
      } else if (error.message.includes('permission-denied')) {
        console.error('Firebase permission denied. Check security rules.');
      } else if (error.message.includes('not-found')) {
        console.error('Game document not found in Firebase.');
      }
    }
    
    console.log(`=== END GET PUBLIC GAME DEBUG ===`);
    return null;
  }
}

// Delete a game
export async function deleteGame(gameId: string): Promise<boolean> {
  if (!getFirebaseAuth()?.currentUser) {
    return false;
  }

  try {
    // Check if user is anonymous (guest)
    if (getFirebaseAuth()?.currentUser.isAnonymous) {
      // Check if user owns the game (for guest, this means it exists in their local storage)
      const game = loadGuestGame(gameId);
      if (game) {
        return deleteGuestGame(gameId);
      }
      return false;
    } else {
      // For registered users: Delete from BOTH local storage AND Firebase
      // Check if user owns the game in Firebase
      const game = await loadGame(gameId);
      if (!game || game.ownerId !== getFirebaseAuth()?.currentUser.uid) {
        return false;
      }

      // Delete from Firebase
      await deleteDoc(doc(getFirebaseDB(), 'games', gameId));
      
      // Delete from local storage
      deleteLocalGame(gameId);
      
      return true;
    }
  } catch (error) {
    console.error('Error deleting game:', error);
    return false;
  }
}

// Get completed games
export async function getCompletedGames(): Promise<GameSummary[]> {
  // Skip Firebase operations during build time
  if (isBuildTime) {
    console.log('Skipping Firebase operations during build time');
    return [];
  }

  if (!getFirebaseAuth()?.currentUser) {
    return [];
  }

  try {
    // Check if user is anonymous (guest)
    if (getFirebaseAuth()?.currentUser.isAnonymous) {
      const completedGuestGames = getCompletedGuestGames();
      // Convert GuestGameSummary to GameSummary format for compatibility
      return completedGuestGames.map(game => ({
        ...game,
        createdAt: { toDate: () => new Date(game.createdAt) } as any,
        ownerId: 'guest',
        ownerEmail: 'guest@local',
      }));
    } else {
      // For registered users: Get from local storage first
      const completedLocalGames = getCompletedLocalGames();
      
      // Convert to GameSummary format
      return completedLocalGames.map(game => ({
        ...game,
        createdAt: { toDate: () => new Date(game.createdAt) } as any,
        ownerId: getFirebaseAuth()?.currentUser.uid,
        ownerEmail: getFirebaseAuth()?.currentUser.email || 'unknown',
      }));
    }
  } catch (error) {
    console.error('Error loading completed games:', error);
    return [];
  }
}
