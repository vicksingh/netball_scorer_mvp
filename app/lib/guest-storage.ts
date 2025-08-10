// Guest user local storage utilities
// This handles saving and loading guest user data locally on the device

// Check if we're in a browser environment
const isClient = typeof window !== 'undefined';

export interface GuestGame {
  id: string;
  shortId: string;
  createdAt: number; // Unix timestamp
  deviceId: string;
  teamA: { name: string };
  teamB: { name: string };
  location: string;
  sharePublic: boolean; // Added for hybrid functionality
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
  lastSyncedAt?: number; // Added for hybrid functionality
  version?: number; // Added for hybrid functionality
  firebaseId?: string; // Added to track Firebase document ID
}

// New interface for hybrid guest games that exist in both local storage and Firebase
export interface HybridGuestGame extends GuestGame {
  firebaseId: string;
  lastSyncedAt: number;
  version: number;
}

export interface LocalGame {
  id: string;
  shortId: string;
  createdAt: number; // Unix timestamp
  ownerId: string;
  ownerEmail: string;
  teamA: { name: string };
  teamB: { name: string };
  location: string;
  sharePublic: boolean;
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

export interface GuestGameSummary {
  id: string;
  shortId: string;
  teamA: string;
  teamB: string;
  createdAt: number;
  location: string;
  deviceId: string;
}

export interface LocalGameSummary {
  id: string;
  shortId: string;
  teamA: string;
  teamB: string;
  createdAt: number;
  location: string;
  ownerId: string;
  ownerEmail: string;
}

// Sync queue interfaces for offline support
export interface SyncQueueItem {
  type: 'create' | 'update';
  gameId: string;
  timestamp: number;
  version: number;
  gameData?: any; // For create operations
  updates?: any; // For update operations
}

// Generate a unique device ID for this browser/device
function getDeviceId(): string {
  if (!isClient) {
    return 'guest_device_id_placeholder'; // Placeholder for server-side
  }
  let deviceId = localStorage.getItem('guest_device_id');
  if (!deviceId) {
    // Create a unique device ID based on browser fingerprint and timestamp
    const fingerprint = navigator.userAgent + navigator.language + screen.width + screen.height;
    deviceId = 'guest_' + btoa(fingerprint + Date.now()).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
    localStorage.setItem('guest_device_id', deviceId);
  }
  return deviceId;
}

// ===== GUEST USER FUNCTIONS =====

// Save a guest game to local storage
export function saveGuestGame(game: GuestGame): void {
  if (!isClient) {
    return; // Exit if not in a browser environment
  }
  try {
    const deviceId = getDeviceId();
    const gameWithDevice = { ...game, deviceId };
    
    // Check if this should be a hybrid game (if sharePublic is true)
    if (game.sharePublic) {
      // This will be upgraded to hybrid when synced to Firebase
      localStorage.setItem(`guest_game_${game.id}`, JSON.stringify(gameWithDevice));
    } else {
      // Regular local-only guest game
      localStorage.setItem(`guest_game_${game.id}`, JSON.stringify(gameWithDevice));
    }
    
    // Save to games list for easy access
    const gamesList = getGuestGamesList();
    const existingIndex = gamesList.findIndex(g => g.id === game.id);
    
    if (existingIndex >= 0) {
      gamesList[existingIndex] = {
        id: game.id,
        shortId: game.shortId,
        teamA: game.teamA.name,
        teamB: game.teamB.name,
        createdAt: game.createdAt,
        location: game.location,
        deviceId: gameWithDevice.deviceId,
      };
    } else {
      gamesList.unshift({
        id: game.id,
        shortId: game.shortId,
        teamA: game.teamA.name,
        teamB: game.teamB.name,
        createdAt: game.createdAt,
        location: game.location,
        deviceId: gameWithDevice.deviceId,
      });
    }
    
    // Keep only the last 50 games to prevent storage bloat
    if (gamesList.length > 50) {
      gamesList.splice(50);
    }
    
    localStorage.setItem('guest_games_list', JSON.stringify(gamesList));
  } catch (error) {
    console.error('Error saving guest game:', error);
  }
}

// Upgrade a regular guest game to hybrid (called after Firebase sync)
export function upgradeGuestGameToHybrid(gameId: string, firebaseId: string): boolean {
  if (!isClient) {
    return false; // Exit if not in a browser environment
  }
  try {
    const guestGame = loadGuestGame(gameId);
    if (guestGame) {
      // Convert to hybrid
      const hybridGame = convertToHybridGuestGame(guestGame, firebaseId);
      saveHybridGuestGame(hybridGame);
      
      // Remove from regular guest games
      deleteGuestGame(gameId);
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error upgrading guest game to hybrid:', error);
    return false;
  }
}

// Load a specific guest game from local storage
export function loadGuestGame(gameId: string): GuestGame | null {
  if (!isClient) {
    return null; // Exit if not in a browser environment
  }
  try {
    const saved = localStorage.getItem(`guest_game_${gameId}`);
    if (saved) {
      const game = JSON.parse(saved) as GuestGame;
      // Verify this game belongs to the current device
      if (game.deviceId === getDeviceId()) {
        return game;
      }
    }
    return null;
  } catch (error) {
    console.error('Error loading guest game:', error);
    return null;
  }
}

// Get all guest games for the current device
export function getGuestGamesList(): GuestGameSummary[] {
  if (!isClient) {
    return []; // Exit if not in a browser environment
  }
  try {
    const saved = localStorage.getItem('guest_games_list');
    if (saved) {
      const games = JSON.parse(saved) as GuestGameSummary[];
      // Filter to only show games from current device
      return games.filter(game => game.deviceId === getDeviceId());
    }
    return [];
  } catch (error) {
    console.error('Error loading guest games list:', error);
    return [];
  }
}

// Update a guest game in local storage
export function updateGuestGame(gameId: string, updates: Partial<GuestGame>): GuestGame | null {
  if (!isClient) {
    return null; // Exit if not in a browser environment
  }
  try {
    const game = loadGuestGame(gameId);
    if (game) {
      const updatedGame = { 
        ...game, 
        ...updates,
        // Deep merge for nested objects
        state: updates.state ? { ...game.state, ...updates.state } : game.state
      };
      saveGuestGame(updatedGame);
      return updatedGame;
    }
    return null;
  } catch (error) {
    console.error('Error updating guest game:', error);
    return null;
  }
}

// Delete a guest game from local storage
export function deleteGuestGame(gameId: string): boolean {
  if (!isClient) {
    return false; // Exit if not in a browser environment
  }
  try {
    // Remove from games list
    const gamesList = getGuestGamesList();
    const filteredGames = gamesList.filter(g => g.id !== gameId);
    localStorage.setItem('guest_games_list', JSON.stringify(filteredGames));
    
    // Remove the full game data
    localStorage.removeItem(`guest_game_${gameId}`);
    
    return true;
  } catch (error) {
    console.error('Error deleting guest game:', error);
    return false;
  }
}

// Get completed guest games
export function getCompletedGuestGames(): GuestGameSummary[] {
  if (!isClient) {
    return []; // Exit if not in a browser environment
  }
  try {
    const games = getGuestGamesList();
    return games.filter(game => {
      const fullGame = loadGuestGame(game.id);
      return fullGame?.state.phase.type === 'fulltime';
    });
  } catch (error) {
    console.error('Error getting completed guest games:', error);
    return [];
  }
}

// ===== REGISTERED USER LOCAL STORAGE FUNCTIONS =====

// Save a local game for registered users
export function saveLocalGame(game: LocalGame): void {
  if (!isClient) {
    return; // Exit if not in a browser environment
  }
  try {
    // Save the full game
    localStorage.setItem(`local_game_${game.id}`, JSON.stringify(game));
    
    // Save to games list for easy access
    const gamesList = getLocalGamesList();
    const existingIndex = gamesList.findIndex(g => g.id === game.id);
    
    if (existingIndex >= 0) {
      gamesList[existingIndex] = {
        id: game.id,
        shortId: game.shortId,
        teamA: game.teamA.name,
        teamB: game.teamB.name,
        createdAt: game.createdAt,
        location: game.location,
        ownerId: game.ownerId,
        ownerEmail: game.ownerEmail,
      };
    } else {
      gamesList.unshift({
        id: game.id,
        shortId: game.shortId,
        teamA: game.teamA.name,
        teamB: game.teamB.name,
        createdAt: game.createdAt,
        location: game.location,
        ownerId: game.ownerId,
        ownerEmail: game.ownerEmail,
      });
    }
    
    // Keep only the last 100 games to prevent storage bloat
    if (gamesList.length > 100) {
      gamesList.splice(100);
    }
    
    localStorage.setItem('local_games_list', JSON.stringify(gamesList));
  } catch (error) {
    console.error('Error saving local game:', error);
  }
}

// Load a specific local game
export function loadLocalGame(gameId: string): LocalGame | null {
  if (!isClient) {
    return null; // Exit if not in a browser environment
  }
  try {
    const saved = localStorage.getItem(`local_game_${gameId}`);
    if (saved) {
      return JSON.parse(saved) as LocalGame;
    }
    return null;
  } catch (error) {
    console.error('Error loading local game:', error);
    return null;
  }
}

// Get all local games for registered users
export function getLocalGamesList(): LocalGameSummary[] {
  if (!isClient) {
    return []; // Exit if not in a browser environment
  }
  try {
    const saved = localStorage.getItem('local_games_list');
    if (saved) {
      return JSON.parse(saved) as LocalGameSummary[];
    }
    return [];
  } catch (error) {
    console.error('Error loading local games list:', error);
    return [];
  }
}

// Update a local game
export function updateLocalGame(gameId: string, updates: Partial<LocalGame>): LocalGame | null {
  if (!isClient) {
    return null; // Exit if not in a browser environment
  }
  try {
    const game = loadLocalGame(gameId);
    if (game) {
      const updatedGame = { 
        ...game, 
        ...updates,
        // Deep merge for nested objects
        state: updates.state ? { ...game.state, ...updates.state } : game.state
      };
      saveLocalGame(updatedGame);
      return updatedGame;
    }
    return null;
  } catch (error) {
    console.error('Error updating local game:', error);
    return null;
  }
}

// Delete a local game
export function deleteLocalGame(gameId: string): boolean {
  if (!isClient) {
    return false; // Exit if not in a browser environment
  }
  try {
    // Remove from games list
    const gamesList = getLocalGamesList();
    const filteredGames = gamesList.filter(g => g.id !== gameId);
    localStorage.setItem('local_games_list', JSON.stringify(filteredGames));
    
    // Remove the full game data
    localStorage.removeItem(`local_game_${gameId}`);
    
    return true;
  } catch (error) {
    console.error('Error deleting local game:', error);
    return false;
  }
}

// Get completed local games
export function getCompletedLocalGames(): LocalGameSummary[] {
  if (!isClient) {
    return []; // Exit if not in a browser environment
  }
  try {
    const games = getLocalGamesList();
    return games.filter(game => {
      const fullGame = loadLocalGame(game.id);
      return fullGame?.state.phase.type === 'fulltime';
    });
  } catch (error) {
    console.error('Error getting completed local games:', error);
    return [];
  }
}

// ===== HYBRID GUEST GAME FUNCTIONS =====

// Save a hybrid guest game (both locally and prepare for Firebase sync)
export function saveHybridGuestGame(game: HybridGuestGame): void {
  if (!isClient) {
    return; // Exit if not in a browser environment
  }
  try {
    const deviceId = getDeviceId();
    const gameWithDevice = { ...game, deviceId };
    
    // Debug logging
    console.log('saveHybridGuestGame - Saving:', {
      gameId: game.id,
      hasState: !!game.state,
      stateKeys: game.state ? Object.keys(game.state) : 'NO STATE',
      isRunning: game.state?.isRunning,
      phase: game.state?.phase
    });
    
    // Save the full game locally
    localStorage.setItem(`hybrid_guest_game_${game.id}`, JSON.stringify(gameWithDevice));
    
    // Save to hybrid games list for easy access
    const gamesList = getHybridGuestGamesList();
    const existingIndex = gamesList.findIndex(g => g.id === game.id);
    
    if (existingIndex >= 0) {
      gamesList[existingIndex] = {
        id: game.id,
        shortId: game.shortId,
        teamA: game.teamA.name,
        teamB: game.teamB.name,
        createdAt: game.createdAt,
        location: game.location,
        deviceId: gameWithDevice.deviceId,
        firebaseId: game.firebaseId,
        lastSyncedAt: game.lastSyncedAt,
        version: game.version,
      };
    } else {
      gamesList.unshift({
        id: game.id,
        shortId: game.shortId,
        teamA: game.teamA.name,
        teamB: game.teamB.name,
        createdAt: game.createdAt,
        location: game.location,
        deviceId: gameWithDevice.deviceId,
        firebaseId: game.firebaseId,
        lastSyncedAt: game.lastSyncedAt,
        version: game.version,
      });
    }
    
    // Keep only the last 50 games to prevent storage bloat
    if (gamesList.length > 50) {
      gamesList.splice(50);
    }
    
    localStorage.setItem('hybrid_guest_games_list', JSON.stringify(gamesList));
  } catch (error) {
    console.error('Error saving hybrid guest game:', error);
  }
}

// Load a hybrid guest game from local storage
export function loadHybridGuestGame(gameId: string): HybridGuestGame | null {
  if (!isClient) {
    return null; // Exit if not in a browser environment
  }
  try {
    const saved = localStorage.getItem(`hybrid_guest_game_${gameId}`);
    if (saved) {
      const game = JSON.parse(saved) as HybridGuestGame;
      // Verify this game belongs to the current device
      if (game.deviceId === getDeviceId()) {
        return game;
      }
    }
    return null;
  } catch (error) {
    console.error('Error loading hybrid guest game:', error);
    return null;
  }
}

// Get all hybrid guest games for the current device
export function getHybridGuestGamesList(): (GuestGameSummary & { firebaseId: string; lastSyncedAt: number; version: number })[] {
  if (!isClient) {
    return []; // Exit if not in a browser environment
  }
  try {
    const saved = localStorage.getItem('hybrid_guest_games_list');
    if (saved) {
      const games = JSON.parse(saved) as (GuestGameSummary & { firebaseId: string; lastSyncedAt: number; version: number })[];
      // Filter to only show games from current device
      return games.filter(game => game.deviceId === getDeviceId());
    }
    return [];
  } catch (error) {
    console.error('Error loading hybrid guest games list:', error);
    return [];
  }
}

// Update a hybrid guest game
export function updateHybridGuestGame(gameId: string, updates: Partial<HybridGuestGame>): HybridGuestGame | null {
  if (!isClient) {
    return null; // Exit if not in a browser environment
  }
  try {
    const game = loadHybridGuestGame(gameId);
    if (game) {
      // Ensure we have a valid state object before proceeding
      if (!game.state) {
        console.error('Cannot update game: missing state object');
        return null;
      }
      
      const updatedGame = { 
        ...game, 
        ...updates,
        // Simple deep merge for state updates
        state: updates.state ? { 
          ...game.state, 
          ...updates.state
        } : game.state,
        // Increment version for conflict resolution
        version: (game.version || 1) + 1,
        // Update last synced timestamp
        lastSyncedAt: Date.now(),
      };
      
      // Debug logging
      console.log('updateHybridGuestGame - Input:', {
        gameId,
        updates,
        hasState: !!updates.state,
        stateKeys: updates.state ? Object.keys(updates.state) : 'NO STATE'
      });
      
      console.log('updateHybridGuestGame - Result:', {
        hasGame: !!updatedGame,
        hasState: !!updatedGame.state,
        stateKeys: updatedGame.state ? Object.keys(updatedGame.state) : 'NO STATE',
        isRunning: updatedGame.state?.isRunning,
        phase: updatedGame.state?.phase
      });
      
      // Validate the updated state before saving
      if (!updatedGame.state || typeof updatedGame.state !== 'object') {
        console.error('Invalid state after update, reverting to original game');
        return game;
      }
      
      saveHybridGuestGame(updatedGame);
      return updatedGame;
    }
    return null;
  } catch (error) {
    console.error('Error updating hybrid guest game:', error);
    return null;
  }
}

// Delete a hybrid guest game
export function deleteHybridGuestGame(gameId: string): boolean {
  if (!isClient) {
    return false; // Exit if not in a browser environment
  }
  try {
    // Remove from games list
    const gamesList = getHybridGuestGamesList();
    const filteredGames = gamesList.filter(g => g.id !== gameId);
    localStorage.setItem('hybrid_guest_games_list', JSON.stringify(filteredGames));
    
    // Remove the full game data
    localStorage.removeItem(`hybrid_guest_game_${gameId}`);
    
    return true;
  } catch (error) {
    console.error('Error deleting hybrid guest game:', error);
    return false;
  }
}

// Convert a regular guest game to a hybrid guest game
export function convertToHybridGuestGame(guestGame: GuestGame, firebaseId: string): HybridGuestGame {
  return {
    ...guestGame,
    firebaseId,
    lastSyncedAt: Date.now(),
    version: 1,
    sharePublic: guestGame.sharePublic || false,
  };
}

// Check if a guest game is hybrid (exists in both local storage and Firebase)
export function isHybridGuestGame(gameId: string): boolean {
  if (!isClient) {
    return false; // Exit if not in a browser environment
  }
  return loadHybridGuestGame(gameId) !== null;
}

// Get sync status for hybrid guest games
export function getHybridGuestGameSyncStatus(gameId: string): { isSynced: boolean; lastSyncedAt: number | null; version: number } {
  if (!isClient) {
    return { isSynced: false, lastSyncedAt: null, version: 0 }; // Exit if not in a browser environment
  }
  const game = loadHybridGuestGame(gameId);
  if (!game) {
    return { isSynced: false, lastSyncedAt: null, version: 0 };
  }
  
  return {
    isSynced: game.lastSyncedAt && (Date.now() - game.lastSyncedAt < 60000), // Synced within last minute
    lastSyncedAt: game.lastSyncedAt || null,
    version: game.version || 1,
  };
}

// ===== UTILITY FUNCTIONS =====

// Clear all guest data for the current device
export function clearGuestData(): void {
  if (!isClient) {
    return; // Exit if not in a browser environment
  }
  try {
    const deviceId = getDeviceId();
    const gamesList = getGuestGamesList();
    
    // Remove all game data
    gamesList.forEach(game => {
      localStorage.removeItem(`guest_game_${game.id}`);
    });
    
    // Remove games list
    localStorage.removeItem('guest_games_list');
    
    // Keep the device ID so future guest sessions are consistent
    // localStorage.removeItem('guest_device_id'); // Uncomment if you want to clear device ID too
  } catch (error) {
    console.error('Error clearing guest data:', error);
  }
}

// Clear all local data for registered users
export function clearLocalData(): void {
  if (!isClient) {
    return; // Exit if not in a browser environment
  }
  try {
    const gamesList = getLocalGamesList();
    
    // Remove all game data
    gamesList.forEach(game => {
      localStorage.removeItem(`local_game_${game.id}`);
    });
    
    // Remove games list
    localStorage.removeItem('local_games_list');
  } catch (error) {
    console.error('Error clearing local data:', error);
  }
}

// Check if guest has any saved games
export function hasGuestGames(): boolean {
  if (!isClient) {
    return false; // Exit if not in a browser environment
  }
  return getGuestGamesList().length > 0;
}

// Check if registered user has any saved local games
export function hasLocalGames(): boolean {
  if (!isClient) {
    return false; // Exit if not in a browser environment
  }
  return getLocalGamesList().length > 0;
}

// Migrate any existing games from old localStorage format
export function migrateExistingGames(): void {
  if (!isClient) {
    return; // Exit if not in a browser environment
  }
  try {
    // Check if there are any games stored in the old format
    const keys = Object.keys(localStorage);
    const oldGameKeys = keys.filter(key => key.startsWith('game_') && !key.startsWith('guest_game_') && !key.startsWith('local_game_'));
    
    if (oldGameKeys.length > 0) {
      console.log(`Found ${oldGameKeys.length} existing games to migrate`);
      
      oldGameKeys.forEach(key => {
        try {
          const gameData = JSON.parse(localStorage.getItem(key) || '{}');
          if (gameData.id && gameData.teamA && gameData.teamB) {
            // Check if it's a guest game or registered user game
            if (gameData.ownerId && gameData.ownerId !== 'guest') {
              // Registered user game
              const localGame: LocalGame = {
                ...gameData,
                createdAt: gameData.createdAt || Date.now(),
                sharePublic: gameData.sharePublic || false,
              };
              saveLocalGame(localGame);
            } else {
              // Guest game
              const guestGame: GuestGame = {
                ...gameData,
                createdAt: gameData.createdAt || Date.now(),
                deviceId: getDeviceId(),
              };
              saveGuestGame(guestGame);
            }
            
            // Remove old format
            localStorage.removeItem(key);
            console.log(`Migrated game: ${gameData.id}`);
          }
        } catch (error) {
          console.error(`Error migrating game from key ${key}:`, error);
        }
      });
    }
  } catch (error) {
    console.error('Error during game migration:', error);
  }
}

// Get guest user info
export function getGuestUserInfo() {
  if (!isClient) {
    return {
      deviceId: 'guest_device_id_placeholder',
      isGuest: true,
      hasGames: false,
      gamesCount: 0,
    };
  }
  
  // Try to migrate any existing games first
  migrateExistingGames();
  
  return {
    deviceId: getDeviceId(),
    isGuest: true,
    hasGames: hasGuestGames(),
    gamesCount: getGuestGamesList().length,
  };
}

// Get registered user info
export function getRegisteredUserInfo() {
  if (!isClient) {
    return {
      hasLocalGames: false,
      localGamesCount: 0,
    };
  }
  
  // Try to migrate any existing games first
  migrateExistingGames();
  
  return {
    hasLocalGames: hasLocalGames(),
    localGamesCount: getLocalGamesList().length,
  };
}

// ===== SYNC QUEUE FUNCTIONS =====

// Save a sync queue item for offline changes
export function saveSyncQueue(item: SyncQueueItem): void {
  if (!isClient) {
    return; // Exit if not in a browser environment
  }
  try {
    const queue = getSyncQueue();
    
    // Remove any existing items for the same game to avoid duplicates
    const filteredQueue = queue.filter(q => q.gameId !== item.gameId);
    
    // Add new item
    filteredQueue.push(item);
    
    // Sort by timestamp (oldest first)
    filteredQueue.sort((a, b) => a.timestamp - b.timestamp);
    
    // Keep only the last 100 items to prevent storage bloat
    if (filteredQueue.length > 100) {
      filteredQueue.splice(0, filteredQueue.length - 100);
    }
    
    localStorage.setItem('sync_queue', JSON.stringify(filteredQueue));
  } catch (error) {
    console.error('Error saving sync queue item:', error);
  }
}

// Get all pending sync queue items
export function getSyncQueue(): SyncQueueItem[] {
  if (!isClient) {
    return []; // Exit if not in a browser environment
  }
  try {
    const saved = localStorage.getItem('sync_queue');
    if (saved) {
      return JSON.parse(saved) as SyncQueueItem[];
    }
    return [];
  } catch (error) {
    console.error('Error loading sync queue:', error);
    return [];
  }
}

// Clear the sync queue (after successful sync)
export function clearSyncQueue(): void {
  if (!isClient) {
    return; // Exit if not in a browser environment
  }
  try {
    localStorage.removeItem('sync_queue');
  } catch (error) {
    console.error('Error clearing sync queue:', error);
  }
}

// Remove a specific sync queue item
export function removeSyncQueueItem(gameId: string): void {
  if (!isClient) {
    return; // Exit if not in a browser environment
  }
  try {
    const queue = getSyncQueue();
    const filteredQueue = queue.filter(q => q.gameId !== gameId);
    localStorage.setItem('sync_queue', JSON.stringify(filteredQueue));
  } catch (error) {
    console.error('Error removing sync queue item:', error);
  }
}

// Get sync queue status
export function getSyncQueueStatus() {
  if (!isClient) {
    return { pendingCount: 0, hasPendingChanges: false, oldestPending: null, newestPending: null }; // Exit if not in a browser environment
  }
  const queue = getSyncQueue();
  return {
    pendingCount: queue.length,
    hasPendingChanges: queue.length > 0,
    oldestPending: queue.length > 0 ? queue[0] : null,
    newestPending: queue.length > 0 ? queue[queue.length - 1] : null,
  };
}
