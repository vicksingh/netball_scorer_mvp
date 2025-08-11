"use client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { msToClock, nowMs, phaseDurationMs } from "../../lib/local-utils";
import { getPublicGame } from "../../lib/firebase-utils";
import { onSnapshot, doc, enableNetwork, disableNetwork } from 'firebase/firestore';
// Remove top-level Firebase import to prevent build-time errors
// import { db } from "../../lib/firebase";
import { loadGuestGame, loadHybridGuestGame } from "../../lib/guest-storage";

// Check if we're in a build environment
const isBuildTime = process.env.NODE_ENV === 'production' && typeof window === 'undefined';

// Lazy Firebase db import
let firebaseDb: any = null;

const getFirebaseDB = () => {
  if (isBuildTime) return null;
  if (!firebaseDb) {
    const { getFirebaseDB } = require('../../lib/firebase');
    firebaseDb = getFirebaseDB();
  }
  return firebaseDb;
};

export default function ViewGamePage() {
  const { id } = useParams<{id: string}>();
  const [game, setGame] = useState<any | null>(null);
  const [left, setLeft] = useState(0);
  const [gameNotFound, setGameNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
  const [updateSource, setUpdateSource] = useState<'firebase' | 'local' | 'hybrid'>('firebase');
  const [debugInfo, setDebugInfo] = useState<string>('');
  
  // Refs for cleanup and optimization
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const localPollingRef = useRef<NodeJS.Timeout | null>(null);
  const lastGameStateRef = useRef<any>(null);
  const isHybridGameRef = useRef<boolean>(false);

  useEffect(() => {
    if (!id) return;
    
    let isMounted = true;
    
    // Enhanced debugging function
    const addDebugInfo = (message: string) => {
      if (isMounted) {
        setDebugInfo(prev => prev + '\n' + new Date().toLocaleTimeString() + ': ' + message);
        console.log(`[DEBUG] ${message}`);
      }
    };
    
    addDebugInfo(`Starting game lookup for ID: ${id}`);
    
    // Function to update game state efficiently
    // Convert guest game data to the format expected by the view page
    const convertGuestGameToViewFormat = (guestGame: any) => {
      // Ensure the game has the expected structure
      if (!guestGame.state) {
        console.warn('Guest game missing state, creating default state');
        guestGame.state = {
          phase: { type: 'quarter', index: 1 },
          isRunning: false,
          phaseStartedAt: null,
          elapsedMs: 0,
          scores: { A: 0, B: 0 },
          quarterScores: { 1: { A: 0, B: 0 } },
          centrePass: 'A',
          lastGoal: null,
        };
      }
      
      // Ensure phase object exists
      if (!guestGame.state.phase) {
        console.warn('Guest game missing phase, creating default phase');
        guestGame.state.phase = { type: 'quarter', index: 1 };
      }
      
      return guestGame;
    };

    const updateGameState = (newGame: any, source: 'firebase' | 'local' | 'hybrid') => {
      if (!isMounted) return;
      
      // Convert guest games to expected format
      let processedGame = newGame;
      if (source === 'local' || source === 'hybrid') {
        processedGame = convertGuestGameToViewFormat(newGame);
      }
      
      // Only update if there are actual changes to prevent unnecessary re-renders
      if (JSON.stringify(processedGame) !== JSON.stringify(lastGameStateRef.current)) {
        setGame(processedGame);
        setLastUpdateTime(Date.now());
        setUpdateSource(source);
        lastGameStateRef.current = processedGame;
        addDebugInfo(`Game updated from ${source}: ${processedGame?.teamA?.name} vs ${processedGame?.teamB?.name}`);
      }
    };

    // First try to load from Firebase for real-time updates
    const loadGameFromFirebase = async () => {
      try {
        addDebugInfo(`Attempting to load game ${id} from Firebase...`);
        const loadedGame = await getPublicGame(id);
        if (loadedGame && isMounted) {
          addDebugInfo('Game loaded successfully from Firebase');
          updateGameState(loadedGame, 'firebase');
          setLoading(false);
          return; // Found in Firebase, no need to check local storage
        }
        
        addDebugInfo('Game not found in Firebase, checking local storage...');
        
        // If not found in Firebase, try local storage for guest games
        const hybridGuestGame = loadHybridGuestGame(id);
        addDebugInfo(`Hybrid guest game lookup result: ${hybridGuestGame ? 'Found' : 'Not found'}`);
        if (hybridGuestGame) {
          addDebugInfo(`Hybrid game sharePublic: ${hybridGuestGame.sharePublic}`);
        }
        
        if (hybridGuestGame && hybridGuestGame.sharePublic) {
          addDebugInfo('Found hybrid guest game in local storage');
          updateGameState(hybridGuestGame, 'hybrid');
          setLoading(false);
          isHybridGameRef.current = true;
          return; // Found in local storage
        }
        
        // Try regular guest game as fallback
        const guestGame = loadGuestGame(id);
        addDebugInfo(`Regular guest game lookup result: ${guestGame ? 'Found' : 'Not found'}`);
        if (guestGame) {
          addDebugInfo(`Guest game sharePublic: ${guestGame.sharePublic}`);
        }
        
        if (guestGame && guestGame.sharePublic) {
          addDebugInfo('Found regular guest game in local storage');
          updateGameState(guestGame, 'local');
          setLoading(false);
          return; // Found in local storage
        }
        
        // Game not found anywhere
        addDebugInfo('Game not found in Firebase or local storage');
        if (isMounted) {
          setGameNotFound(true);
          setLoading(false);
        }
      } catch (error) {
        addDebugInfo(`Error loading game from Firebase: ${error}`);
        console.error('Error loading game from Firebase:', error);
        
        // Log specific error details for debugging
        if (error instanceof Error) {
          if (error.message.includes('Target ID already exists')) {
            addDebugInfo('Firebase "Target ID already exists" error detected');
            console.error('Firebase "Target ID already exists" error detected. This usually means:');
            console.error('1. Multiple Firebase app instances are running');
            console.error('2. Firebase configuration conflict');
            console.error('3. Firebase app initialization issue');
            console.error('4. Firebase rules preventing access');
          } else if (error.message.includes('permission-denied')) {
            addDebugInfo('Firebase permission denied. Check security rules.');
            console.error('Firebase permission denied. Check security rules.');
          } else if (error.message.includes('not-found')) {
            addDebugInfo('Game document not found in Firebase.');
            console.error('Game document not found in Firebase.');
          }
        }
        
        addDebugInfo('Falling back to local storage due to Firebase error...');
        
        // Try local storage as fallback
        const hybridGuestGame = loadHybridGuestGame(id);
        if (hybridGuestGame && hybridGuestGame.sharePublic && isMounted) {
          addDebugInfo('Found hybrid guest game in local storage as fallback');
          updateGameState(hybridGuestGame, 'hybrid');
          setLoading(false);
          isHybridGameRef.current = true;
          return;
        }
        
        const guestGame = loadGuestGame(id);
        if (guestGame && guestGame.sharePublic && isMounted) {
          addDebugInfo('Found regular guest game in local storage as fallback');
          updateGameState(guestGame, 'local');
          setLoading(false);
          return;
        }
        
        addDebugInfo('Game not found in local storage either');
        if (isMounted) {
          setGameNotFound(true);
          setLoading(false);
        }
      }
    };

    // Load initial game data
    loadGameFromFirebase();

    // Set up real-time listener for live updates
    const setupRealTimeUpdates = () => {
      // Check if this is a hybrid guest game (stored both locally and in Firebase)
      const hybridGuestGame = loadHybridGuestGame(id);
      if (hybridGuestGame && hybridGuestGame.sharePublic) {
        isHybridGameRef.current = true;
        
        // For hybrid guest games, use Firebase real-time updates + local polling for immediate updates
        try {
          // Enable Firebase network for real-time updates
          enableNetwork(getFirebaseDB());
          
          unsubscribeRef.current = onSnapshot(doc(getFirebaseDB(), 'games', id), (doc) => {
            if (doc.exists() && isMounted) {
              const gameData = doc.data();
              if (gameData.sharePublic) {
                updateGameState(gameData, 'firebase');
              } else {
                setGameNotFound(true);
                setLoading(false);
              }
            } else if (isMounted) {
              setGameNotFound(true);
              setLoading(false);
            }
          }, (error) => {
            console.error('Real-time listener error for hybrid guest game:', error);
            // Fall back to local polling if Firebase fails
            setupLocalPolling();
          });
          
          // Also set up local polling for immediate updates (hybrid approach)
          setupLocalPolling(500); // Poll every 500ms for hybrid games
          
        } catch (error) {
          console.error('Failed to set up Firebase listener for hybrid game:', error);
          setupLocalPolling();
        }
        
      } else {
        // Check if this is a regular guest game (stored only locally)
        const guestGame = loadGuestGame(id);
        if (guestGame && guestGame.sharePublic) {
          // For regular guest games, set up local polling since we can't use Firebase real-time updates
          setupLocalPolling(1000); // Poll every second for updates
        } else {
          // For Firebase games, use real-time listener
          try {
            enableNetwork(getFirebaseDB());
            
            unsubscribeRef.current = onSnapshot(doc(getFirebaseDB(), 'games', id), (doc) => {
              if (doc.exists() && isMounted) {
                const gameData = doc.data();
                if (gameData.sharePublic) {
                  updateGameState(gameData, 'firebase');
                } else {
                  setGameNotFound(true);
                  setLoading(false);
                }
              } else if (isMounted) {
                setGameNotFound(true);
                setLoading(false);
              }
            }, (error) => {
              console.error('Real-time listener error:', error);
              if (isMounted) {
                setGameNotFound(true);
                setLoading(false);
              }
            });
          } catch (error) {
            console.error('Failed to set up Firebase listener:', error);
            if (isMounted) {
              setGameNotFound(true);
              setLoading(false);
            }
          }
        }
      }
    };

    // Set up local polling for immediate updates
    const setupLocalPolling = (intervalMs: number = 1000) => {
      localPollingRef.current = setInterval(() => {
        if (!isMounted) return;
        
        // Check for updates in local storage
        if (isHybridGameRef.current) {
          const updatedHybridGame = loadHybridGuestGame(id);
          if (updatedHybridGame) {
            updateGameState(updatedHybridGame, 'hybrid');
          }
        } else {
          const updatedGuestGame = loadGuestGame(id);
          if (updatedGuestGame) {
            updateGameState(updatedGuestGame, 'local');
          }
        }
      }, intervalMs);
    };

    // Initialize real-time updates
    setupRealTimeUpdates();

    // Cleanup function
    return () => {
      isMounted = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      if (localPollingRef.current) {
        clearInterval(localPollingRef.current);
        localPollingRef.current = null;
      }
      // Disable Firebase network when component unmounts
      disableNetwork(getFirebaseDB());
    };
  }, [id]);

  // Timer effect for countdown
  useEffect(() => {
    if (!game) return;
    
    const { state, settings } = game;
    const timerInterval = setInterval(() => {
      const duration = phaseDurationMs(state.phase, settings);
      const runningSince = state.isRunning && state.phaseStartedAt ? new Date(state.phaseStartedAt).getTime() : null;
      const elapsed = runningSince ? state.elapsedMs + (nowMs() - runningSince) : state.elapsedMs;
      setLeft(Math.max(0, duration - elapsed));
    }, 100); // Update timer more frequently for smoother countdown
    
    return () => clearInterval(timerInterval);
  }, [game?.state.phase, game?.state.isRunning, game?.state.phaseStartedAt, game?.state.elapsedMs]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          </div>
          <div className="text-xl font-semibold mb-2">Loading Game...</div>
          <div className="text-white/60 text-sm">Connecting to live score feed</div>
        </div>
      </div>
    );
  }

  if (gameNotFound) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div className="text-xl font-semibold mb-2">Game Not Found</div>
          <div className="text-white/60 text-sm mb-4">This game may be private or no longer available</div>
          <button
            onClick={() => window.location.href = '/'}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const { teamA, teamB, state } = game;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-800/90 to-slate-700/90 backdrop-blur-md border-b border-slate-600/30">
        <div className="max-w-[1140px] mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="relative">
              <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></div>
              <div className="absolute inset-0 w-3 h-3 bg-emerald-400 rounded-full animate-ping opacity-75"></div>
            </div>
            <div>
              <h1 className="text-white font-semibold text-lg tracking-wide">LIVE SCORE</h1>
              <p className="text-slate-300 text-xs">Spectator view • Real-time updates</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {/* Update Status Indicator */}
            <div className="flex items-center space-x-2 text-xs">
              <div className={`w-2 h-2 rounded-full ${
                updateSource === 'firebase' ? 'bg-green-400' : 
                updateSource === 'hybrid' ? 'bg-blue-400' : 'bg-yellow-400'
              }`}></div>
              <span className="text-slate-300">
                {updateSource === 'firebase' ? 'Firebase' : 
                 updateSource === 'hybrid' ? 'Hybrid' : 'Local'}
              </span>
            </div>
            <div className="text-slate-300 text-sm bg-slate-700/50 px-3 py-1 rounded-lg">
              {game && game.ownerId === 'guest' ? 'Guest Game' : 'View Only'}
            </div>
          </div>
        </div>
      </header>

      {/* Debug Info - Only show in development */}
      {process.env.NODE_ENV === 'development' && debugInfo && (
        <div className="max-w-[1140px] mx-auto px-4 py-4">
          <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4">
            <div className="flex items-center space-x-3 mb-2">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div className="text-red-200 text-sm font-semibold">DEBUG INFO</div>
              <button 
                onClick={() => {
                  console.log('=== MANUAL DEBUG TEST ===');
                  console.log('Current game ID:', id);
                  console.log('Current game state:', game);
                  console.log('Game not found state:', gameNotFound);
                  console.log('Loading state:', loading);
                  
                  // Test local storage directly
                  if (typeof window !== 'undefined') {
                    const hybridGame = localStorage.getItem(`hybrid_guest_game_${id}`);
                    const regularGame = localStorage.getItem(`guest_game_${id}`);
                    console.log('Direct localStorage check:');
                    console.log('Hybrid game:', hybridGame);
                    console.log('Regular game:', regularGame);
                    
                    if (hybridGame) {
                      const parsed = JSON.parse(hybridGame);
                      console.log('Parsed hybrid game:', parsed);
                      console.log('sharePublic:', parsed.sharePublic);
                      console.log('deviceId:', parsed.deviceId);
                    }
                    
                    if (regularGame) {
                      const parsed = JSON.parse(regularGame);
                      console.log('Parsed regular game:', parsed);
                      console.log('sharePublic:', parsed.sharePublic);
                      console.log('deviceId:', parsed.deviceId);
                    }
                  }
                }}
                className="ml-auto px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded transition-colors"
              >
                Test Debug
              </button>
            </div>
            <pre className="text-red-200 text-xs whitespace-pre-wrap font-mono bg-red-500/20 p-3 rounded-lg max-h-40 overflow-y-auto">
              {debugInfo}
            </pre>
          </div>
        </div>
      )}

      {/* Main Scoreboard */}
      <div className="max-w-[1140px] mx-auto px-4 py-6">
        {/* Update Source Banner */}
        {updateSource === 'hybrid' && (
          <div className="bg-blue-500/20 border border-blue-500/30 rounded-xl p-4 mb-6">
            <div className="flex items-center space-x-3">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <div className="text-blue-200 text-sm">
                <strong>Hybrid Mode:</strong> Real-time updates from Firebase + immediate local updates. 
                Updates are instant with no delay.
              </div>
            </div>
          </div>
        )}
        
        {updateSource === 'local' && (
          <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-xl p-4 mb-6">
            <div className="flex items-center space-x-3">
              <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-yellow-200 text-sm">
                <strong>Local Mode:</strong> This game is stored locally and updates every second. 
                Real-time updates may have a slight delay.
              </div>
            </div>
          </div>
        )}
        
        {/* Timer/Quarter Section */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 shadow-lg mb-4">
          <div className="text-center">
            <div className="text-white/60 text-sm font-medium uppercase tracking-wider mb-2">
              {state?.phase?.type === "quarter" ? `QUARTER ${state.phase.index || 1}` : 
               state?.phase?.type === "break" ? `BREAK ${state.phase.index || 1}` : "FULL TIME"}
            </div>
            <div className="text-6xl font-bold text-white tabular-nums leading-none">
              {msToClock(left)}
            </div>
            <div className="text-white/60 text-sm mt-2">
              {state?.isRunning ? "LIVE" : "PAUSED"}
            </div>
          </div>
        </div>

        {/* Scores */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 shadow-lg">
          <div className="grid grid-cols-2 items-center text-center gap-4">
            {/* Team A */}
            <div className="space-y-4">
              <div className="text-white/60 text-sm font-medium uppercase tracking-wider">{teamA?.name || 'Team A'}</div>
              <div className="text-5xl font-bold text-white leading-none">{state?.scores?.A || 0}</div>
            </div>

            {/* Team B */}
            <div className="space-y-4">
              <div className="text-white/60 text-sm font-medium uppercase tracking-wider">{teamB?.name || 'Team B'}</div>
              <div className="text-5xl font-bold text-white leading-none">{state?.scores?.B || 0}</div>
            </div>
          </div>
        </div>

        {/* Last Update Info */}
        <div className="text-center mt-4">
          <div className="text-slate-400 text-xs">
            Last updated: {lastUpdateTime ? new Date(lastUpdateTime).toLocaleTimeString() : 'Never'} • 
            Source: {updateSource === 'firebase' ? 'Firebase Real-time' : 
                    updateSource === 'hybrid' ? 'Hybrid (Firebase + Local)' : 'Local Storage'}
          </div>
        </div>
      </div>
    </div>
  );
}
