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
import { db, auth } from './firebase';
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
  HybridGuestGame
} from './guest-storage';

// Types
export interface Game {
  id: string;
  shortId: string;
  createdAt: Timestamp;
  ownerId: string;
  ownerEmail: string;
  sharePublic: boolean;
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
    
    // Try a simple Firebase operation
    const testDoc = doc(db, '_test_connection', 'test');
    await setDoc(testDoc, { timestamp: serverTimestamp() }, { merge: true });
    await deleteDoc(testDoc);
    isFirebaseConnected = true;
    return true;
  } catch (error) {
    console.warn('Firebase connection check failed:', error);
    isFirebaseConnected = false;
    return false;
  }
}

// Sync pending changes when back online
async function syncPendingChanges() {
  if (!auth.currentUser || auth.currentUser.isAnonymous) return;
  
  try {
    const pendingChanges = getSyncQueue();
    if (pendingChanges.length === 0) return;
    
    console.log(`Syncing ${pendingChanges.length} pending changes...`);
    
    for (const change of pendingChanges) {
      try {
        if (change.type === 'update') {
          await updateDoc(doc(db, 'games', change.gameId), {
            ...change.updates,
            lastSyncedAt: serverTimestamp(),
            version: (change.version || 0) + 1,
          });
        } else if (change.type === 'create') {
          await setDoc(doc(db, 'games', change.gameId), {
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
  if (!auth.currentUser) {
    throw new Error('User must be authenticated to create a game');
  }

  const gameId = Date.now().toString();
  
  // Check if user is anonymous (guest)
  if (auth.currentUser.isAnonymous) {
    // For guest users: Create hybrid game (local + Firebase) if sharing is enabled
    if (gameData.sharePublic) {
      // Create hybrid guest game
      const hybridGuestGame: HybridGuestGame = {
        ...gameData,
        id: gameId,
        createdAt: Date.now(),
        deviceId: '', // Will be set by saveHybridGuestGame
        firebaseId: gameId, // Use the same ID for Firebase
        lastSyncedAt: Date.now(),
        version: 1,
        sharePublic: true,
      };
      
      // Save locally first
      saveHybridGuestGame(hybridGuestGame);
      
      // Try to save to Firebase for real-time sharing
      try {
        const firebaseConnected = await checkFirebaseConnection();
        if (firebaseConnected) {
          // Create Firebase document with device ID as owner
          const firebaseGame = {
            ...gameData,
            id: gameId,
            createdAt: serverTimestamp() as Timestamp,
            ownerId: `guest_${hybridGuestGame.deviceId}`, // Use device ID as owner
            ownerEmail: 'guest@local',
            deviceId: hybridGuestGame.deviceId,
            sharePublic: true,
            lastSyncedAt: Date.now(),
            version: 1,
          };
          
          await setDoc(doc(db, 'games', gameId), firebaseGame);
          
          // Update local game with sync confirmation
          updateHybridGuestGame(gameId, { lastSyncedAt: Date.now() });
          console.log('Hybrid guest game created and synced to Firebase');
        } else {
          // Queue for sync when online
          const firebaseGame = {
            ...gameData,
            id: gameId,
            createdAt: Date.now(),
            ownerId: `guest_${hybridGuestGame.deviceId}`,
            ownerEmail: 'guest@local',
            deviceId: hybridGuestGame.deviceId,
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
          console.log('Hybrid guest game created locally, queued for Firebase sync');
        }
      } catch (error) {
        console.warn('Failed to save to Firebase, queuing for sync:', error);
        // Queue for sync when online
        const firebaseGame = {
          ...gameData,
          id: gameId,
          createdAt: Date.now(),
          ownerId: `guest_${hybridGuestGame.deviceId}`,
          ownerEmail: 'guest@local',
          deviceId: hybridGuestGame.deviceId,
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
    } else {
      // Regular local-only guest game
      const guestGame: GuestGame = {
        ...gameData,
        id: gameId,
        createdAt: Date.now(),
        deviceId: '', // Will be set by saveGuestGame
        sharePublic: false,
      };
      
      saveGuestGame(guestGame);
    }
    
    return gameId;
  } else {
    // For registered users: Save BOTH locally AND to Firebase
    const game: Game = {
      ...gameData,
      id: gameId,
      createdAt: serverTimestamp() as Timestamp,
      ownerId: auth.currentUser.uid,
      ownerEmail: auth.currentUser.email || 'unknown',
      lastSyncedAt: Date.now(),
      version: 1,
    };

    // Always save locally first for immediate access
    const localGame = {
      ...gameData,
      id: gameId,
      createdAt: Date.now(),
      ownerId: auth.currentUser.uid,
      ownerEmail: auth.currentUser.email || 'unknown',
      lastSyncedAt: Date.now(),
      version: 1,
    };
    
    saveLocalGame(localGame);

    // Try to save to Firebase (cloud backup)
    try {
      const firebaseConnected = await checkFirebaseConnection();
      if (firebaseConnected) {
        await setDoc(doc(db, 'games', gameId), game);
        
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
        
        await setDoc(doc(db, 'games', gameId), gameSummary, { merge: true });
        
        // Update local game with sync confirmation
        updateLocalGame(gameId, { lastSyncedAt: Date.now() });
        console.log('Game created and synced to Firebase');
      } else {
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
      console.warn('Failed to save to Firebase, queuing for sync:', error);
      // Queue for sync when online
      saveSyncQueue({
        type: 'create',
        gameId,
        gameData: game,
        timestamp: Date.now(),
        version: 1,
      });
    }
    
    return gameId;
  }
}

// Load a specific game
export async function loadGame(gameId: string): Promise<Game | null> {
  try {
    // Check if user is anonymous (guest)
    if (auth.currentUser?.isAnonymous) {
      // First try to load hybrid guest game
      let hybridGuestGame = loadHybridGuestGame(gameId);
      
      if (hybridGuestGame) {
        // This is a hybrid guest game - try to sync with Firebase
        const shouldSync = isOnline && isFirebaseConnected && 
          (!hybridGuestGame.lastSyncedAt || Date.now() - hybridGuestGame.lastSyncedAt > 30000); // Sync if >30s old
        
        if (shouldSync) {
          try {
            const firebaseGame = await getDoc(doc(db, 'games', gameId));
            if (firebaseGame.exists()) {
              const fbData = firebaseGame.data() as Game;
              
              // Conflict resolution: use the more recent version
              if (fbData.version && (!hybridGuestGame.version || fbData.version > hybridGuestGame.version)) {
                console.log('Firebase has newer version, updating local hybrid guest game');
                const updatedLocalGame: HybridGuestGame = {
                  ...fbData,
                  createdAt: fbData.createdAt?.toDate?.() ? fbData.createdAt.toDate().getTime() : Date.now(),
                  lastSyncedAt: Date.now(),
                  deviceId: hybridGuestGame.deviceId, // Preserve device ID
                  firebaseId: gameId,
                  version: fbData.version || 1,
                };
                updateHybridGuestGame(gameId, updatedLocalGame);
                return fbData;
              } else if (hybridGuestGame.version && (!fbData.version || hybridGuestGame.version > fbData.version)) {
                console.log('Local hybrid guest game has newer version, updating Firebase');
                // Queue local changes for sync
                saveSyncQueue({
                  type: 'update',
                  gameId,
                  updates: hybridGuestGame,
                  timestamp: Date.now(),
                  version: hybridGuestGame.version,
                });
              }
            }
          } catch (error) {
            console.warn('Firebase sync failed for hybrid guest game, using local data:', error);
          }
        }
        
        // Convert HybridGuestGame to Game format for compatibility
        return {
          ...hybridGuestGame,
          createdAt: { toDate: () => new Date(hybridGuestGame.createdAt) } as any,
          ownerId: `guest_${hybridGuestGame.deviceId}`,
          ownerEmail: 'guest@local',
          sharePublic: true,
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
      // For registered users: Try local first, then Firebase
      let game = loadLocalGame(gameId);
      
      if (game) {
        // Convert local game to Game format
        const localGame: Game = {
          ...game,
          createdAt: { toDate: () => new Date(game.createdAt) } as any,
        };
        
        // Check if we should try to sync with Firebase
        const shouldSync = isOnline && isFirebaseConnected && 
          (!game.lastSyncedAt || Date.now() - game.lastSyncedAt > 30000); // Sync if >30s old
        
        if (shouldSync) {
          try {
            const firebaseGame = await getDoc(doc(db, 'games', gameId));
            if (firebaseGame.exists()) {
              const fbData = firebaseGame.data() as Game;
              
              // Conflict resolution: use the more recent version
              if (fbData.version && (!game.version || fbData.version > game.version)) {
                console.log('Firebase has newer version, updating local game');
                const updatedLocalGame = {
                  ...fbData,
                  createdAt: fbData.createdAt?.toDate?.() ? fbData.createdAt.toDate().getTime() : Date.now(),
                  lastSyncedAt: Date.now(),
                };
                saveLocalGame(updatedLocalGame);
                return fbData;
              } else if (game.version && (!fbData.version || game.version > fbData.version)) {
                console.log('Local has newer version, updating Firebase');
                // Queue local changes for sync
                saveSyncQueue({
                  type: 'update',
                  gameId,
                  updates: game,
                  timestamp: Date.now(),
                  version: game.version,
                });
              }
            }
          } catch (error) {
            console.warn('Firebase sync failed, using local data:', error);
          }
        }
        
        return localGame;
      }
      
      // If not found locally, try Firebase
      try {
        const gameDoc = await getDoc(doc(db, 'games', gameId));
        if (gameDoc.exists()) {
          const firebaseGame = gameDoc.data() as Game;
          
          // Save to local storage for future fast access
          const localGame = {
            ...firebaseGame,
            createdAt: firebaseGame.createdAt?.toDate?.() ? firebaseGame.createdAt.toDate().getTime() : Date.now(),
            lastSyncedAt: Date.now(),
            version: firebaseGame.version || 1,
          };
          saveLocalGame(localGame);
          
          return firebaseGame;
        }
      } catch (error) {
        console.warn('Failed to load from Firebase:', error);
      }
      
      return null;
    }
  } catch (error) {
    console.error('Error loading game:', error);
    return null;
  }
}

// Update a game
export async function updateGame(gameId: string, updates: Partial<Game>): Promise<Game | null> {
  try {
    // Check if user is anonymous (guest)
    if (auth.currentUser?.isAnonymous) {
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
            const gameRef = doc(db, 'games', gameId);
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
            console.log('Hybrid guest game updated locally, queued for Firebase sync');
          }
        } catch (error) {
          console.warn('Failed to update Firebase for hybrid guest game, queuing for sync:', error);
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
          const gameRef = doc(db, 'games', gameId);
          await updateDoc(gameRef, {
            ...updates,
            lastSyncedAt: serverTimestamp(),
            version: newVersion,
          });
          
          console.log('Game updated and synced to Firebase');
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
        console.warn('Failed to update Firebase, queuing for sync:', error);
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
    return null;
  }
}

// Get all games for a user
export async function getUserGames(): Promise<GameSummary[]> {
  if (!auth.currentUser) {
    return [];
  }

  try {
    // Check if user is anonymous (guest)
    if (auth.currentUser.isAnonymous) {
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
          collection(db, 'games'),
          where('ownerId', '==', auth.currentUser.uid),
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
          ownerId: auth.currentUser.uid,
          ownerEmail: auth.currentUser.email || 'unknown',
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
    // First try to get from Firebase
    const gameDoc = await getDoc(doc(db, 'games', gameId));
    if (gameDoc.exists()) {
      const game = gameDoc.data() as Game;
      if (game.sharePublic) {
        return game;
      }
    }
    
    // If not found in Firebase, check if it's a hybrid guest game in local storage
    // This allows guest users to share games with others on the same device
    const hybridGuestGame = loadHybridGuestGame(gameId);
    if (hybridGuestGame && hybridGuestGame.sharePublic) {
      // Convert HybridGuestGame to Game format for compatibility
      return {
        ...hybridGuestGame,
        createdAt: { toDate: () => new Date(hybridGuestGame.createdAt) } as any,
        ownerId: `guest_${hybridGuestGame.deviceId}`,
        ownerEmail: 'guest@local',
        sharePublic: true,
      } as Game;
    }
    
    return null;
  } catch (error) {
    console.error('Error loading public game:', error);
    return null;
  }
}

// Delete a game
export async function deleteGame(gameId: string): Promise<boolean> {
  if (!auth.currentUser) {
    return false;
  }

  try {
    // Check if user is anonymous (guest)
    if (auth.currentUser.isAnonymous) {
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
      if (!game || game.ownerId !== auth.currentUser.uid) {
        return false;
      }

      // Delete from Firebase
      await deleteDoc(doc(db, 'games', gameId));
      
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
  if (!auth.currentUser) {
    return [];
  }

  try {
    // Check if user is anonymous (guest)
    if (auth.currentUser.isAnonymous) {
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
        ownerId: auth.currentUser.uid,
        ownerEmail: auth.currentUser.email || 'unknown',
      }));
    }
  } catch (error) {
    console.error('Error loading completed games:', error);
    return [];
  }
}
