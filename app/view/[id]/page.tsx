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
  
  // Refs for cleanup and optimization
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const localPollingRef = useRef<NodeJS.Timeout | null>(null);
  const lastGameStateRef = useRef<any>(null);
  const isHybridGameRef = useRef<boolean>(false);

  useEffect(() => {
    if (!id) return;
    
    let isMounted = true;
    
    // Function to update game state efficiently
    const updateGameState = (newGame: any, source: 'firebase' | 'local' | 'hybrid') => {
      if (!isMounted) return;
      
      // Only update if there are actual changes to prevent unnecessary re-renders
      if (JSON.stringify(newGame) !== JSON.stringify(lastGameStateRef.current)) {
        setGame(newGame);
        setLastUpdateTime(Date.now());
        setUpdateSource(source);
        lastGameStateRef.current = newGame;
        console.log(`Game updated from ${source}:`, newGame);
      }
    };

    // First try to load from Firebase for real-time updates
    const loadGameFromFirebase = async () => {
      try {
        const loadedGame = await getPublicGame(id);
        if (loadedGame && isMounted) {
          updateGameState(loadedGame, 'firebase');
          setLoading(false);
          return; // Found in Firebase, no need to check local storage
        }
        
        // If not found in Firebase, try local storage for guest games
        const hybridGuestGame = loadHybridGuestGame(id);
        if (hybridGuestGame && hybridGuestGame.sharePublic) {
          updateGameState(hybridGuestGame, 'hybrid');
          setLoading(false);
          isHybridGameRef.current = true;
          return; // Found in local storage
        }
        
        // Try regular guest game as fallback
        const guestGame = loadGuestGame(id);
        if (guestGame && guestGame.sharePublic) {
          updateGameState(guestGame, 'local');
          setLoading(false);
          return; // Found in local storage
        }
        
        // Game not found anywhere
        if (isMounted) {
          setGameNotFound(true);
          setLoading(false);
        }
      } catch (error) {
        console.error('Error loading game from Firebase:', error);
        
        // Try local storage as fallback
        const hybridGuestGame = loadHybridGuestGame(id);
        if (hybridGuestGame && hybridGuestGame.sharePublic && isMounted) {
          updateGameState(hybridGuestGame, 'hybrid');
          setLoading(false);
          isHybridGameRef.current = true;
          return;
        }
        
        const guestGame = loadGuestGame(id);
        if (guestGame && guestGame.sharePublic && isMounted) {
          updateGameState(guestGame, 'local');
          setLoading(false);
          return;
        }
        
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
              {state.phase.type === "quarter" ? `QUARTER ${state.phase.index}` : 
               state.phase.type === "break" ? `BREAK ${state.phase.index}` : "FULL TIME"}
            </div>
            <div className="text-6xl font-bold text-white tabular-nums leading-none">
              {msToClock(left)}
            </div>
            <div className="text-white/60 text-sm mt-2">
              {state.isRunning ? "LIVE" : "PAUSED"}
            </div>
          </div>
        </div>

        {/* Scores */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 shadow-lg">
          <div className="grid grid-cols-2 items-center text-center gap-4">
            {/* Team A */}
            <div className="space-y-4">
              <div className="text-white/60 text-sm font-medium uppercase tracking-wider">{teamA.name}</div>
              <div className="text-5xl font-bold text-white leading-none">{state.scores.A}</div>
            </div>

            {/* Team B */}
            <div className="space-y-4">
              <div className="text-white/60 text-sm font-medium uppercase tracking-wider">{teamB.name}</div>
              <div className="text-5xl font-bold text-white leading-none">{state.scores.B}</div>
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
