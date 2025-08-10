"use client";
import { useEffect, useRef, useState, Suspense, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../contexts/AuthContext";
import { loadGame, updateGame } from "../../lib/firebase-utils";
import { msToClock, nowMs, phaseDurationMs, nextPhase } from "../../lib/local-utils";
import { loadGuestGame, loadHybridGuestGame, updateHybridGuestGame, isHybridGuestGame } from "../../lib/guest-storage";

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

// Custom hook for phase timer
type TimerState = {
  remainingMs: number;
  isExpired: boolean;
};

function usePhaseTimer({
  isRunning,
  phaseStartedAt,
  elapsedMs,
  phaseDurationMs,
}: {
  isRunning: boolean;
  phaseStartedAt: string | null;
  elapsedMs: number;
  phaseDurationMs: number;
}): TimerState {
  const [remainingMs, setRemainingMs] = useState(phaseDurationMs);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const updateRemaining = () => {
      const now = Date.now();
      let totalElapsed = elapsedMs;
      if (isRunning && phaseStartedAt) {
        const startedAt = new Date(phaseStartedAt).getTime();
        totalElapsed = elapsedMs + Math.max(0, now - startedAt);
      }
      const remaining = Math.max(0, phaseDurationMs - totalElapsed);
      setRemainingMs(remaining);
      setIsExpired(remaining === 0);
    };

    // Initial run
    updateRemaining();

    // While running, keep updating every second
    if (isRunning && phaseStartedAt) {
      interval = setInterval(updateRemaining, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, phaseStartedAt, phaseDurationMs, elapsedMs]);

  return { remainingMs, isExpired };
}

function GamePageContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [game, setGame] = useState<any | null>(null);
  const [left, setLeft] = useState(0);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error'>('synced');
  const [lastSyncTime, setLastSyncTime] = useState<number>(Date.now());
  const [showWinnerOverlay, setShowWinnerOverlay] = useState(false);
  const [showGameEndedBanner, setShowGameEndedBanner] = useState(false);
  
  // Refs for debounced sync
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSyncRef = useRef<any>(null);

  // Redirect if not authenticated
  if (!loading && !user) {
    router.push('/');
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  useEffect(() => {
    // Load game from Firebase
    const loadGameData = async () => {
      try {
        const loadedGame = await loadGame(id);
        console.log('Loading game for ID:', id, 'Found game:', loadedGame);
        if (loadedGame) {
          // Check if user owns the game
          if (user?.isAnonymous) {
            // For guest users, if we can load the game from local storage, they own it
            setGame(loadedGame);
          } else if (loadedGame.ownerId !== user?.uid) {
            // For registered users, check if they own the game
            router.push(`/view/${id}`);
            return;
          } else {
            setGame(loadedGame);
          }
        } else {
          console.error('No game found for ID:', id);
          router.push('/');
        }
      } catch (error) {
        console.error('Error loading game:', error);
        router.push('/');
      }
    };

    if (user) {
      loadGameData();
    }
  }, [id, user, router]);

  // Handle page visibility changes (when user returns to tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!game || document.hidden) return;
      
      // When page becomes visible again, just reload the game state
      const loadGameData = async () => {
        try {
          const loadedGame = await loadGame(id);
          if (loadedGame) {
            // Check if user owns the game
            if (user?.isAnonymous) {
              // For guest users, if we can load the game from local storage, they own it
              setGame(loadedGame);
            } else if (loadedGame.ownerId !== user?.uid) {
              // For registered users, check if they own the game
              router.push(`/view/${id}`);
              return;
            } else {
              setGame(loadedGame);
            }
          }
        } catch (error) {
          console.error('Error reloading game:', error);
          router.push('/');
        }
      };

      if (user) {
        loadGameData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [game, id, user, router]);

  // Periodic sync check for hybrid games
  useEffect(() => {
    if (!game || !user?.isAnonymous || !isHybridGuestGame(id)) return;

    const syncInterval = setInterval(async () => {
      try {
        setSyncStatus('syncing');
        await updateGame(id, { state: game.state });
        setSyncStatus('synced');
        setLastSyncTime(Date.now());
        console.log('Periodic sync completed for hybrid game');
      } catch (error) {
        console.warn('Periodic sync failed:', error);
        setSyncStatus('error');
      }
    }, 30000); // Sync every 30 seconds

    return () => clearInterval(syncInterval);
  }, [game, id, user?.isAnonymous]);

  // Cleanup sync timeout on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  // Use the custom timer hook with better null safety
  const { remainingMs, isExpired } = usePhaseTimer({
    isRunning: game?.state?.isRunning || false,
    phaseStartedAt: game?.state?.phaseStartedAt || null,
    elapsedMs: game?.state?.elapsedMs || 0,
    phaseDurationMs: (game?.state?.phase && game?.settings) ? phaseDurationMs(game.state.phase, game.settings) : 0,
  });

  // Guard to avoid auto-advancing on initial mount
  const justMounted = useRef(true);

  // Handle phase expiration with initial-mount guard and grace period
  useEffect(() => {
    // Skip auto-advance on first render after mount/navigation
    if (justMounted.current) {
      justMounted.current = false;
      return;
    }

    if (isExpired && game?.state?.isRunning && game?.state?.phaseStartedAt) {
      // Use zero grace for final quarter so it advances immediately
      const isFinalQuarter =
        game.state.phase?.type === "quarter" &&
        game.state.phase?.index === game.settings?.numQuarters;
      const graceMs = isFinalQuarter ? 0 : 5000; // 5s grace otherwise
      const startedAt = new Date(game.state.phaseStartedAt).getTime();
      const elapsed = Date.now() - startedAt;
      const expectedDuration = (game?.state?.phase && game?.settings) ? phaseDurationMs(game.state.phase, game.settings) : 0;

      if (elapsed >= expectedDuration + graceMs) {
        console.log('Phase expired (after grace), advancing to next phase');
        // We'll handle phase advancement in a separate effect after advancePhase is defined
      }
    }
  }, [isExpired, game?.state?.isRunning, game?.state?.phaseStartedAt, game?.state?.phase, game?.settings]);

  // Run winner overlay and confetti when game reaches full time
  // Note: This must be defined BEFORE any conditional returns to keep hook order stable
  useEffect(() => {
    if (!game) return;
    if (game.state?.phase?.type === "fulltime") {
      setShowGameEndedBanner(true);
      // Delay 3 seconds before showing winner overlay
      const timeoutId = window.setTimeout(() => {
        setShowWinnerOverlay(true);
        // Lightweight confetti animation without deps
        const durationMs = 2500;
        const canvas = document.createElement('canvas');
        canvas.style.position = 'fixed';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '40';
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const colors = ['#ef4444', '#10b981', '#60a5fa', '#f59e0b', '#a78bfa', '#f472b6', '#34d399'];
        const count = 160;
        const particles = Array.from({ length: count }).map(() => ({
          x: Math.random() * canvas.width,
          y: -20 - Math.random() * 100,
          size: 4 + Math.random() * 6,
          speed: 2 + Math.random() * 3,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * 360,
          rotationSpeed: (Math.random() - 0.5) * 12,
          sway: Math.random() * 1.5 + 0.5,
        }));
        const start = performance.now();
        const draw = (now: number) => {
          const elapsed = now - start;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          particles.forEach((p) => {
            p.y += p.speed;
            p.x += Math.sin((p.y + p.rotation) / 20) * p.sway;
            p.rotation += p.rotationSpeed;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
          });
          if (elapsed < durationMs) {
            requestAnimationFrame(draw);
          } else {
            document.body.removeChild(canvas);
          }
        };
        requestAnimationFrame(draw);
      }, 3000);
      return () => window.clearTimeout(timeoutId);
    }
  }, [game?.state?.phase?.type]);

  if (!game) return <div>Loading…</div>;
  
  // Safety check for game state
  if (!game.state || !game.state.phase) {
    console.error('Game state is missing or incomplete:', game);
    
    // Try to recover by reloading the game
    if (user) {
      setTimeout(() => {
        // Reload the game data
        const reloadGame = async () => {
          try {
            const loadedGame = await loadGame(id);
            if (loadedGame && loadedGame.state && loadedGame.state.phase) {
              setGame(loadedGame);
            }
          } catch (error) {
            console.error('Failed to reload game:', error);
          }
        };
        reloadGame();
      }, 1000);
    }
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <div className="text-white text-xl mb-2">Game Data Error</div>
          <div className="text-white/60 text-sm mb-4">The game data appears to be corrupted or incomplete.</div>
          <div className="text-white/40 text-xs mb-4">Attempting to reload...</div>
          <button 
            onClick={() => window.location.href = '/new'} 
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
          >
            Start New Game
          </button>
        </div>
      </div>
    );
  }
  
  const { teamA, teamB, state, settings } = game;
  const leadingTeamName = (state?.scores?.A || 0) > (state?.scores?.B || 0) ? (teamA?.name || 'Team A') : (teamB?.name || 'Team B');
  const winnerText = (state?.scores?.A || 0) === (state?.scores?.B || 0) ? "IT'S A DRAW" : `${leadingTeamName} WINS!`;
  const isDraw = (state?.scores?.A || 0) === (state?.scores?.B || 0);
  const winMargin = Math.abs((state?.scores?.A || 0) - (state?.scores?.B || 0));
  const bannerText = isDraw ? "It's a draw" : `${leadingTeamName} won by ${winMargin}`;

  console.log('Current game state:', { 
    gameId: id,
    phase: state?.phase, 
    isRunning: state?.isRunning,
    scores: state?.scores,
    centrePass: state?.centrePass,
    settings: settings,
    elapsedMs: state?.elapsedMs,
    phaseStartedAt: state?.phaseStartedAt
  });

  // Debounced sync function to prevent too many Firebase calls during rapid scoring
  const debouncedSync = (gameId: string, updates: any) => {
    // Clear any pending sync
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    
    // Store the latest updates
    pendingSyncRef.current = updates;
    
    // Set a new timeout for sync
    syncTimeoutRef.current = setTimeout(async () => {
      if (pendingSyncRef.current) {
        try {
          setSyncStatus('syncing');
          await updateGame(gameId, pendingSyncRef.current);
          setSyncStatus('synced');
          setLastSyncTime(Date.now());
          console.log('Debounced sync completed');
          pendingSyncRef.current = null;
        } catch (error) {
          console.warn('Debounced sync failed:', error);
          setSyncStatus('error');
        }
      }
    }, 2000); // Wait 2 seconds after last update before syncing
  };

  // Manual sync function for hybrid games
  const manualSync = async () => {
    if (!game || !user?.isAnonymous || !isHybridGuestGame(id)) return;
    
    try {
      setSyncStatus('syncing');
      await updateGame(id, { state: game.state });
      setSyncStatus('synced');
      setLastSyncTime(Date.now());
      console.log('Manual sync completed');
    } catch (error) {
      console.warn('Manual sync failed:', error);
      setSyncStatus('error');
    }
  };

  // Optimized update function for immediate local updates + background Firebase sync
  const updateGameOptimized = async (gameId: string, updates: any) => {
    // Immediately update local state for instant UI response
    let updatedGame = null;
    
    if (user?.isAnonymous && isHybridGuestGame(gameId)) {
      // For hybrid guest games: immediate local update + debounced Firebase sync
      updatedGame = updateHybridGuestGame(gameId, updates);
      
      // Use debounced sync for Firebase updates
      if (updatedGame) {
        debouncedSync(gameId, updates);
      }
    } else if (user?.isAnonymous) {
      // For regular guest games: immediate local update only
      updatedGame = loadGuestGame(gameId);
      if (updatedGame) {
        const mergedGame = { 
          ...updatedGame, 
          // Only merge specific fields, not the entire updates object
          ...(updates.state && { state: { ...updatedGame.state, ...updates.state } }),
          ...(updates.teamA && { teamA: updates.teamA }),
          ...(updates.teamB && { teamB: updates.teamB }),
          ...(updates.settings && { settings: updates.settings }),
          ...(updates.sharePublic !== undefined && { sharePublic: updates.sharePublic }),
          ...(updates.location !== undefined && { location: updates.location }),
        };
        // Use the hybrid update method if available, otherwise fall back to local
        if (typeof updateHybridGuestGame === 'function') {
          updatedGame = updateHybridGuestGame(gameId, mergedGame);
        } else {
          // Fallback to local storage
          localStorage.setItem(`guest_game_${gameId}`, JSON.stringify(mergedGame));
          updatedGame = mergedGame;
        }
      }
    } else {
      // For registered users: immediate local update + background Firebase sync
      updatedGame = { 
        ...game, 
        // Only merge specific fields, not the entire updates object
        ...(updates.state && { state: { ...game.state, ...updates.state } }),
        ...(updates.teamA && { teamA: updates.teamA }),
        ...(updates.teamB && { teamB: updates.teamB }),
        ...(updates.settings && { settings: updates.settings }),
        ...(updates.sharePublic !== undefined && { sharePublic: updates.sharePublic }),
        ...(updates.location !== undefined && { location: updates.location }),
      };
      if (updatedGame) {
        // Update local state immediately
        setGame(updatedGame);
        
        // Background Firebase sync (non-blocking)
        setTimeout(async () => {
          try {
            await updateGame(gameId, updates);
            console.log('Background Firebase sync completed for registered user game');
          } catch (error) {
            console.warn('Background Firebase sync failed, will retry later:', error);
          }
        }, 0);
        
        return updatedGame;
      }
    }
    
    // Debug: log the final updated game to see what we're returning
    console.log('updateGameOptimized returning:', {
      hasState: !!updatedGame?.state,
      stateKeys: updatedGame?.state ? Object.keys(updatedGame.state) : 'NO STATE',
      statePhase: updatedGame?.state?.phase,
      stateScores: updatedGame?.state?.scores,
      stateIsRunning: updatedGame?.state?.isRunning,
    });
    
    return updatedGame;
  };

  function score(team: "A"|"B") {
    console.log('score called for team:', team, 'current scores:', state.scores, 'current centre pass:', state.centrePass);
    
    // Update quarter scores
    const currentQuarter = state.phase.index;
    const currentQuarterScores = state.quarterScores?.[currentQuarter] || { A: 0, B: 0 };
    const updatedQuarterScores = {
      ...state.quarterScores,
      [currentQuarter]: {
        A: currentQuarterScores.A + (team === "A" ? 1 : 0),
        B: currentQuarterScores.B + (team === "B" ? 1 : 0),
      }
    };
    
    const updatedGame = updateGameOptimized(id, {
      state: {
        ...state,
        scores: { A: (state?.scores?.A || 0) + (team === "A" ? 1 : 0), B: (state?.scores?.B || 0) + (team === "B" ? 1 : 0) },
        quarterScores: updatedQuarterScores,
        centrePass: state.centrePass === "A" ? "B" : "A", // Toggle centre pass after each goal
        lastGoal: {
          team: team,
          previousCentrePass: state.centrePass,
          timestamp: new Date().toISOString(),
        },
      }
    });
    console.log('Updated game for score:', updatedGame);
    if (updatedGame) setGame(updatedGame);
  }

  function startPause() {
    // Safety check: ensure state exists before proceeding
    if (!state) {
      console.error('Cannot start/pause: game state is not loaded yet');
      return;
    }
    
    console.log('startPause called, current state:', { isRunning: state.isRunning, phase: state.phase });
    
    if (!state.isRunning) {
      const updatedGame = updateGameOptimized(id, {
        state: {
          ...state,
          isRunning: true,
          // Do not reset elapsedMs when resuming; keep carried time
          phaseStartedAt: new Date().toISOString(),
        }
      });
      console.log('Updated game for start:', updatedGame);
      if (updatedGame) setGame(updatedGame);
    } else {
      const startedAt = state.phaseStartedAt ? new Date(state.phaseStartedAt).getTime() : nowMs();
      const carried = state.elapsedMs + (nowMs() - startedAt);
      const updatedGame = updateGameOptimized(id, {
        state: {
          ...state,
          isRunning: false,
          elapsedMs: carried,
        }
      });
      console.log('Updated game for pause:', updatedGame);
      if (updatedGame) setGame(updatedGame);
    }
  }

  function resetTimer() {
    console.log('resetTimer called');
    const updatedGame = updateGameOptimized(id, {
      state: {
        ...state,
        isRunning: false,
        elapsedMs: 0,
      }
    });
    console.log('Updated game for reset:', updatedGame);
    if (updatedGame) setGame(updatedGame);
  }

  const advancePhase = useCallback(() => {
    console.log('advancePhase called, current phase:', state.phase);
    const np = nextPhase(state.phase, settings);
    console.log('Next phase:', np);
    
    // Auto-start timer when transitioning between phases (quarter → break and break → quarter)
    const shouldAutoStart =
      (state.phase.type === "quarter" && np.type === "break") ||
      (state.phase.type === "break" && np.type === "quarter");
    
    const updatedGame = updateGameOptimized(id, {
      state: {
        ...state,
        phase: np,
        isRunning: shouldAutoStart, // Auto-start if going from break to quarter
        elapsedMs: 0,
        phaseStartedAt: new Date().toISOString(),
      }
    });
    console.log('Updated game for advance:', updatedGame);
    if (updatedGame) setGame(updatedGame);
  }, [id, state, settings]);

  // Handle phase advancement after advancePhase is defined
  useEffect(() => {
    if (isExpired && game?.state?.isRunning && game?.state?.phaseStartedAt) {
      // Use zero grace for final quarter so it advances immediately
      const isFinalQuarter =
        game.state.phase?.type === "quarter" &&
        game.state.phase?.index === game.settings?.numQuarters;
      const graceMs = isFinalQuarter ? 0 : 5000; // 5s grace otherwise
      const startedAt = new Date(game.state.phaseStartedAt).getTime();
      const elapsed = Date.now() - startedAt;
      const expectedDuration = (game?.state?.phase && game?.settings) ? phaseDurationMs(game.state.phase, game.settings) : 0;

      if (elapsed >= expectedDuration + graceMs) {
        console.log('Phase expired (after grace), advancing to next phase');
        advancePhase();
      }
    }
  }, [isExpired, game?.state?.isRunning, game?.state?.phaseStartedAt, game?.state?.phase, game?.settings, advancePhase]);

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/view/${id}` : "";

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
              <h1 className="text-white font-semibold text-lg tracking-wide">ScoZo - Live Match</h1>
              <p className="text-slate-300 text-xs">{new Date().toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric' 
              }).toUpperCase()} • {new Date().toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              })}</p>
              {/* Sync Status Indicator */}
              {user?.isAnonymous && isHybridGuestGame(id) && (
                <div className="flex items-center space-x-2 mt-1">
                  <div className={`w-2 h-2 rounded-full ${
                    syncStatus === 'synced' ? 'bg-emerald-400' : 
                    syncStatus === 'syncing' ? 'bg-yellow-400 animate-pulse' : 
                    'bg-red-400'
                  }`}></div>
                  <span className={`text-xs ${
                    syncStatus === 'synced' ? 'text-emerald-400' : 
                    syncStatus === 'syncing' ? 'text-yellow-400' : 
                    'text-red-400'
                  }`}>
                    {syncStatus === 'synced' ? 'Live' : 
                     syncStatus === 'syncing' ? 'Syncing...' : 
                     'Sync Error'}
                  </span>
                  {syncStatus === 'synced' && (
                    <span className="text-xs text-slate-400">
                      • Last sync: {new Date(lastSyncTime).toLocaleTimeString()}
                    </span>
                  )}
                  {/* Manual Sync Button */}
                  <button
                    onClick={manualSync}
                    disabled={syncStatus === 'syncing'}
                    className={`px-2 py-1 text-xs rounded ${
                      syncStatus === 'syncing' 
                        ? 'bg-slate-600 text-slate-400 cursor-not-allowed' 
                        : 'bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white'
                    } transition-colors`}
                  >
                    {syncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
                  </button>
                  
                  {/* Firebase Connection Status */}
                  <div className="flex items-center space-x-1 ml-2 pl-2 border-l border-slate-600">
                    <div className={`w-2 h-2 rounded-full ${
                      typeof window !== 'undefined' && navigator.onLine ? 'bg-emerald-400' : 'bg-red-400'
                    }`}></div>
                    <span className={`text-xs ${
                      typeof window !== 'undefined' && navigator.onLine ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {typeof window !== 'undefined' && navigator.onLine ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <button 
            className="bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 shadow-lg hover:shadow-xl" 
            onClick={() => {
              // Create and show share dialog
              const dialog = document.createElement('div');
              dialog.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50';
              dialog.innerHTML = `
                <div class="bg-slate-800 rounded-2xl p-6 border border-slate-600/30 shadow-xl max-w-md w-full mx-4">
                  <div class="text-center mb-4">
                    <h3 class="text-white font-bold text-lg mb-2">Share Live Score</h3>
                    <p class="text-white/60 text-sm">Share this link with spectators to view live scores</p>
                  </div>
                  <div class="bg-slate-900 rounded-lg p-3 mb-4 border border-slate-600/30">
                    <div class="text-slate-200 text-sm font-mono break-all">${shareUrl}</div>
                  </div>
                  <div class="flex space-x-3">
                    <button 
                      class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg font-medium transition-all duration-200"
                      onclick="navigator.clipboard.writeText('${shareUrl}').then(() => { this.textContent = 'Copied!'; setTimeout(() => { this.textContent = 'Copy Link'; }, 2000); })"
                    >
                      Copy Link
                    </button>
                    <button 
                      class="flex-1 bg-slate-600 hover:bg-slate-700 text-white py-2 px-4 rounded-lg font-medium transition-all duration-200"
                      onclick="this.closest('.fixed').remove()"
                    >
                      Close
                    </button>
                  </div>
                </div>
              `;
              document.body.appendChild(dialog);
              
              // Close dialog when clicking outside
              dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                  dialog.remove();
                }
              });
            }}
          >
            Share View
          </button>
        </div>
      </header>

      {/* Main Scoreboard */}
      <div className="max-w-[1140px] mx-auto px-4 py-6">
        {/* Timer/Quarter Section */}
        <div className={`backdrop-blur-sm rounded-2xl p-4 border shadow-lg mb-6 transition-all duration-500 ${
          remainingMs <= 30000 && remainingMs > 0 // 30 seconds or less remaining
            ? 'bg-gradient-to-br from-red-500/30 to-red-600/30 border-red-400/50 animate-pulse'
            : 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 border-blue-500/30'
        }`}>
          <div className="flex items-end justify-between">
            <div className="text-left">
              <div className="text-white/60 text-sm font-medium uppercase tracking-wider mb-1">
                {state.phase.type === "quarter" ? `QUARTER ${state.phase.index}` : 
                 state.phase.type === "break" ? 
                   (state.phase.index === 2 ? "HALF TIME" : `BREAK ${state.phase.index}`) : 
                 "FULL TIME - Game Ended"}
              </div>
              <div className={`text-6xl font-bold tabular-nums leading-none transition-all duration-500 ${
                remainingMs <= 30000 && remainingMs > 0
                  ? 'text-red-100 drop-shadow-lg'
                  : 'text-white'
              }`}>
                {msToClock(remainingMs)}
              </div>
            </div>
            <button 
              className={`font-bold py-2 px-4 rounded-lg transition-all duration-200 text-sm ${
                game.state.isRunning 
                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                  : 'bg-green-500 hover:bg-green-600 text-white'
              }`}
              onClick={() => {
                if (state.phase.type === "fulltime") {
                  window.location.href = '/new';
                } else {
                  console.log('Start/Pause button clicked');
                  startPause();
                }
              }}
            >
              {state.phase.type === "fulltime" ? "START NEW" : (game.state.isRunning ? "PAUSE" : "START")}
            </button>
          </div>
        </div>

        {/* Centre Pass Indicator */}
        {state.phase.type === "quarter" && (
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20 shadow-lg mb-6">
            <div className="flex items-center justify-between">
              <div className="text-left">
                <div className="text-blue-300 text-sm font-medium uppercase tracking-wider mb-1">
                  CENTRE PASS
                </div>
                <div className="text-xl font-bold text-white">
                  {state?.centrePass === "A" ? (teamA?.name || 'Team A') : (teamB?.name || 'Team B')}
                </div>
              </div>
              <button 
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-all duration-200 text-sm"
                onClick={() => {
                  console.log('Centre pass toggle clicked');
                  const updatedGame = updateGameOptimized(id, {
                    state: {
                      ...state,
                      centrePass: state.centrePass === "A" ? "B" : "A",
                    }
                  });
                  console.log('Centre pass toggled:', updatedGame);
                  if (updatedGame) setGame(updatedGame);
                }}
              >
                TOGGLE
              </button>
            </div>
          </div>
        )}

        {/* Scores and Controls */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 shadow-lg mb-6">
          <div className="grid grid-cols-3 items-center text-center gap-4">
            {/* Team A */}
            <div className="space-y-4">
              <div className="text-white/60 text-sm font-medium uppercase tracking-wider">{teamA?.name || 'Team A'}</div>
              <div className="text-5xl font-bold text-white leading-none">{state?.scores?.A || 0}</div>
              <button 
                className={`font-bold py-3 px-4 rounded-xl shadow-lg transition-all duration-200 w-full text-sm ${
                  game.state.isRunning && state.phase.type === "quarter"
                    ? "bg-blue-500 hover:bg-blue-600 text-white transform hover:scale-105 cursor-pointer"
                    : "bg-gray-500 text-gray-300 cursor-not-allowed opacity-50"
                }`}
                onClick={() => {
                  console.log('Team A button clicked');
                  if (game.state.isRunning && state.phase.type === "quarter") {
                    score("A");
                  }
                }}
                disabled={!game.state.isRunning || state.phase.type !== "quarter"}
              >
                +1 GOAL
              </button>
            </div>

            {/* Control Buttons */}
            <div className="flex flex-col space-y-2">
              {/* Reset Button - Only active when paused */}
              <button 
                className={`font-bold py-2 px-4 rounded-lg transition-all duration-200 text-sm ${
                  !game.state.isRunning
                    ? 'bg-gray-600 hover:bg-gray-700 text-white cursor-pointer'
                    : 'bg-gray-400 text-gray-300 cursor-not-allowed opacity-50'
                }`}
                onClick={() => {
                  if (!game.state.isRunning) {
                    console.log('Reset button clicked');
                    const updatedGame = updateGameOptimized(id, {
                      state: {
                        ...state,
                        phase: { type: "quarter", index: 1 },
                        isRunning: false,
                        elapsedMs: 0,
                        scores: { A: 0, B: 0 },
                        quarterScores: {
                          1: { A: 0, B: 0 },
                          2: { A: 0, B: 0 },
                          3: { A: 0, B: 0 },
                          4: { A: 0, B: 0 },
                        },
                        centrePass: "A", // Reset to Team A
                        lastGoal: null, // Clear last goal
                        phaseStartedAt: new Date().toISOString(),
                      }
                    });
                    console.log('Game reset:', updatedGame);
                    if (updatedGame) setGame(updatedGame);
                  }
                }}
                disabled={game.state.isRunning}
              >
                RESET
              </button>
              
              {/* End Stage Button - Only visible when paused */}
              {!game.state.isRunning && (
                <button 
                  className={`font-bold py-2 px-4 rounded-lg transition-all duration-200 text-sm ${
                    state.phase.type === "fulltime"
                      ? 'bg-gray-400 text-gray-300 cursor-not-allowed opacity-50'
                      : 'bg-orange-600 hover:bg-orange-700 text-white'
                  }`} 
                  onClick={() => {
                    if (state.phase.type === 'fulltime') return;
                    console.log('End stage button clicked');
                    advancePhase();
                  }}
                  disabled={state.phase.type === 'fulltime'}
                >
                  END {state.phase.type === "quarter" ? `Q${state.phase.index}` : 
                        state.phase.type === "break" ? 
                          (state.phase.index === 2 ? "HALF TIME" : `BREAK ${state.phase.index}`) : 
                        "STAGE"}
                </button>
              )}
              
              {/* Undo/Edit Button - Different behavior based on game state */}
              {(game.state.isRunning || state.phase.type === "break") && (
                <button 
                  className={`font-bold py-2 px-4 rounded-lg transition-all duration-200 text-sm ${
                    state.phase.type === "break"
                      ? 'bg-orange-600 hover:bg-orange-700 text-white' // Edit mode during breaks
                      : 'bg-purple-600 hover:bg-purple-700 text-white' // Undo mode during quarters
                  }`}
                  onClick={() => {
                    if (state.phase.type === "break") {
                      // Edit mode - allow manual score editing
                      console.log('Edit scores clicked');
                      const scoreInput = prompt(
                        `Edit Scores:\n\n${teamA?.name || 'Team A'}: ${state?.scores?.A || 0}\n${teamB?.name || 'Team B'}: ${state?.scores?.B || 0}\n\nEnter new scores (format: "A,B" or "A B"):`,
                        `${state?.scores?.A || 0},${state?.scores?.B || 0}`
                      );
                      
                      if (scoreInput !== null) {
                        // Parse the input - accept both comma and space separated
                        const scores = scoreInput.replace(/\s+/g, ',').split(',');
                        if (scores.length === 2) {
                          const scoreA = parseInt(scores[0]) || 0;
                          const scoreB = parseInt(scores[1]) || 0;
                          
                          const updatedGame = updateGameOptimized(id, {
                            state: {
                              ...state,
                              scores: { A: scoreA, B: scoreB },
                              lastGoal: null, // Clear last goal when manually editing
                            }
                          });
                          console.log('Scores edited:', updatedGame);
                          if (updatedGame) setGame(updatedGame);
                        }
                      }
                    } else {
                      // Undo mode - remove last goal
                      console.log('Undo last goal clicked');
                      const lastGoal = state.lastGoal;
                      if (lastGoal) {
                        // Update quarter scores
                        const currentQuarter = state.phase.index;
                        const currentQuarterScores = state.quarterScores?.[currentQuarter] || { A: 0, B: 0 };
                        const updatedQuarterScores = {
                          ...state.quarterScores,
                          [currentQuarter]: {
                            A: currentQuarterScores.A - (lastGoal.team === "A" ? 1 : 0),
                            B: currentQuarterScores.B - (lastGoal.team === "B" ? 1 : 0),
                          }
                        };
                        
                        const updatedGame = updateGameOptimized(id, {
                          state: {
                            ...state,
                                                          scores: { 
                                A: (state?.scores?.A || 0) - (lastGoal.team === "A" ? 1 : 0), 
                                B: (state?.scores?.B || 0) - (lastGoal.team === "B" ? 1 : 0) 
                              },
                            quarterScores: updatedQuarterScores,
                            centrePass: lastGoal.previousCentrePass, // Restore previous centre pass
                            lastGoal: null, // Clear the last goal
                          }
                        });
                        console.log('Undone last goal:', updatedGame);
                        if (updatedGame) setGame(updatedGame);
                      }
                    }
                  }}
                  disabled={state.phase.type === "quarter" && !state.lastGoal} // Only disable undo if no goal to undo during quarters
                >
                  {state.phase.type === "break" ? "EDIT" : "UNDO"}
                </button>
              )}
            </div>

            {/* Team B */}
            <div className="space-y-4">
              <div className="text-white/60 text-sm font-medium uppercase tracking-wider">{teamB?.name || 'Team B'}</div>
              <div className="text-5xl font-bold text-white leading-none">{state?.scores?.B || 0}</div>
              <button 
                className={`font-bold py-3 px-4 rounded-xl shadow-lg transition-all duration-200 w-full text-sm ${
                  game.state.isRunning && state.phase.type === "quarter"
                    ? "bg-red-500 hover:bg-red-600 text-white transform hover:scale-105 cursor-pointer"
                    : "bg-gray-500 text-gray-300 cursor-not-allowed opacity-50"
                }`}
                onClick={() => game.state.isRunning && state.phase.type === "quarter" && score("B")}
                disabled={!game.state.isRunning || state.phase.type !== "quarter"}
              >
                +1 GOAL
              </button>
            </div>
          </div>
        </div>

        {/* Quarters Overview */}
        <div className="bg-gradient-to-br from-slate-800/60 to-slate-700/60 backdrop-blur-xl rounded-xl p-4 border border-slate-600/30 shadow-xl mb-6">
          <div className="text-center mb-4">
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Quarters Overview</div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {/* Team Names Column */}
            <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-600/30">
              <div className="text-slate-400 text-xs font-medium mb-2">Teams</div>
              <div className="space-y-1">
                <div className="text-blue-300 text-xs font-medium h-6 flex items-center">{teamA?.name || 'Team A'}</div>
                <div className="text-red-300 text-xs font-medium h-6 flex items-center">{teamB?.name || 'Team B'}</div>
              </div>
            </div>
            
            {/* Quarter Columns */}
            {[1, 2, 3, 4].map((quarter) => (
              <div key={quarter} className="bg-slate-800/60 rounded-lg p-3 border border-slate-600/30">
                <div className="text-slate-400 text-xs font-medium mb-2">Q{quarter}</div>
                <div className="space-y-1">
                  <div className="text-white text-sm font-bold h-6 flex items-center">{state.quarterScores?.[quarter]?.A || 0}</div>
                  <div className="text-white text-sm font-bold h-6 flex items-center">{state.quarterScores?.[quarter]?.B || 0}</div>
                </div>
              </div>
            ))}
          </div>
        </div>



        {/* Bottom Action Buttons */}
        <div className="bg-gradient-to-br from-slate-800/60 to-slate-700/60 backdrop-blur-xl rounded-xl p-4 border border-slate-600/30 shadow-xl">
          <div className="grid grid-cols-3 gap-3">
            {/* Reset Game Button - Only active when paused */}
            <button 
              className={`font-bold py-3 px-4 rounded-lg transition-all duration-200 text-sm ${
                (state.phase.type === 'fulltime' || !game.state.isRunning)
                  ? 'bg-red-600 hover:bg-red-700 text-white cursor-pointer'
                  : 'bg-gray-400 text-gray-300 cursor-not-allowed opacity-50'
              }`}
              onClick={() => {
                if (state.phase.type === 'fulltime') {
                  window.location.href = '/new';
                  return;
                }
                if (!game.state.isRunning) {
                  if (confirm('Are you sure you want to start a new game? This will redirect you to the game setup screen.')) {
                    console.log('Reset game clicked - redirecting to new game');
                    window.location.href = '/new';
                  }
                }
              }}
              disabled={state.phase.type !== 'fulltime' && game.state.isRunning}
            >
              {state.phase.type === 'fulltime' ? 'START NEW' : 'RESET GAME'}
            </button>

            {/* Past Games Button - View previous games */}
            <button 
              className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 text-sm"
              onClick={() => {
                console.log('Past games clicked');
                // Navigate to past games page with current game ID
                window.location.href = `/past-games?currentGame=${id}`;
              }}
            >
              PAST GAMES
            </button>

            {/* Game Log Button */}
            <button 
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 text-sm"
              onClick={() => {
                console.log('Game log clicked');
                const gameLog = {
                  gameId: id,
                  teamA: teamA?.name || 'Team A',
                  teamB: teamB?.name || 'Team B',
                  finalScore: state?.scores,
                  quarterScores: state?.quarterScores,
                  duration: msToClock(state?.elapsedMs || 0),
                  completedAt: new Date().toISOString(),
                };
                console.log('Game Log:', gameLog);
                
                // Create and show game log dialog
                const dialog = document.createElement('div');
                dialog.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50';
                dialog.innerHTML = `
                  <div class="bg-slate-800 rounded-2xl p-6 border border-slate-600/30 shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
                    <div class="text-center mb-6">
                      <h3 class="text-white font-bold text-xl mb-2">Game Log</h3>
                      <p class="text-white/60 text-sm">${teamA?.name || 'Team A'} vs ${teamB?.name || 'Team B'}</p>
                    </div>
                    
                    <!-- Final Score -->
                    <div class="bg-slate-900 rounded-xl p-4 mb-4 border border-slate-600/30">
                      <div class="text-center mb-3">
                        <div class="text-white/60 text-sm font-medium uppercase tracking-wider">Final Score</div>
                      </div>
                      <div class="flex justify-center items-center space-x-8">
                        <div class="text-center">
                          <div class="text-blue-300 text-sm font-medium">${teamA?.name || 'Team A'}</div>
                          <div class="text-white text-3xl font-bold">${state?.scores?.A || 0}</div>
                        </div>
                        <div class="text-white/40 text-2xl font-bold">-</div>
                        <div class="text-center">
                          <div class="text-red-300 text-sm font-medium">${teamB.name}</div>
                          <div class="text-white text-3xl font-bold">${state.scores.B}</div>
                        </div>
                      </div>
                    </div>
                    
                    <!-- Game Duration -->
                    <div class="bg-slate-900 rounded-xl p-4 mb-4 border border-slate-600/30">
                      <div class="text-center mb-2">
                        <div class="text-white/60 text-sm font-medium uppercase tracking-wider">Game Duration</div>
                      </div>
                      <div class="text-center">
                        <div class="text-white text-2xl font-bold">${msToClock(state.elapsedMs)}</div>
                      </div>
                    </div>
                    
                    <!-- Quarters Breakdown -->
                    ${state.quarterScores ? `
                    <div class="bg-slate-900 rounded-xl p-4 mb-4 border border-slate-600/30">
                      <div class="text-center mb-3">
                        <div class="text-white/60 text-sm font-medium uppercase tracking-wider">Quarters Breakdown</div>
                      </div>
                      <div class="grid grid-cols-5 gap-2">
                        <div class="text-center">
                          <div class="text-slate-400 text-xs font-medium mb-2">Teams</div>
                          <div class="space-y-1">
                            <div class="text-blue-300 text-xs font-medium h-6 flex items-center justify-center">${teamA?.name || 'Team A'}</div>
                            <div class="text-red-300 text-xs font-medium h-6 flex items-center justify-center">${teamB?.name || 'Team B'}</div>
                          </div>
                        </div>
                        ${[1, 2, 3, 4].map(quarter => `
                          <div class="text-center">
                            <div class="text-slate-400 text-xs font-medium mb-2">Q${quarter}</div>
                            <div class="space-y-1">
                              <div class="text-white text-sm font-bold h-6 flex items-center justify-center">${state.quarterScores[quarter]?.A || 0}</div>
                              <div class="text-white text-sm font-bold h-6 flex items-center justify-center">${state.quarterScores[quarter]?.B || 0}</div>
                            </div>
                          </div>
                        `).join('')}
                      </div>
                    </div>
                    ` : ''}
                    
                    <!-- Game Info -->
                    <div class="bg-slate-900 rounded-xl p-4 mb-6 border border-slate-600/30">
                      <div class="text-center mb-2">
                        <div class="text-white/60 text-sm font-medium uppercase tracking-wider">Game Information</div>
                      </div>
                      <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                          <span class="text-white/60">Game ID:</span>
                          <span class="text-white font-mono">${id}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-white/60">Current Phase:</span>
                          <span class="text-white">${state.phase.type === "quarter" ? `Quarter ${state.phase.index}` : 
                            state.phase.type === "break" ? 
                              (state.phase.index === 2 ? "Half Time" : `Break ${state.phase.index}`) : 
                            "Full Time"}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-white/60">Game Status:</span>
                          <span class="text-white">${state.isRunning ? 'Running' : 'Paused'}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div class="flex justify-center">
                      <button 
                        class="bg-slate-600 hover:bg-slate-700 text-white py-2 px-6 rounded-lg font-medium transition-all duration-200"
                        onclick="this.closest('.fixed').remove()"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                `;
                document.body.appendChild(dialog);
                
                // Close dialog when clicking outside
                dialog.addEventListener('click', (e) => {
                  if (e.target === dialog) {
                    dialog.remove();
                  }
                });
              }}
            >
              GAME LOG
            </button>
          </div>
        </div>
      </div>
      {showGameEndedBanner && state.phase.type === "fulltime" && !showWinnerOverlay && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-emerald-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-semibold">
            {bannerText}
          </div>
        </div>
      )}
      {showWinnerOverlay && state.phase.type === "fulltime" && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900/90 border border-slate-700 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
            <div className="text-slate-300 text-sm uppercase tracking-wider mb-2">Full Time</div>
            <div className="text-white text-3xl font-extrabold mb-3">{winnerText}</div>
            <div className="text-slate-200 text-lg font-semibold mb-6">{teamA?.name || 'Team A'} {state?.scores?.A || 0} - {state?.scores?.B || 0} {teamB?.name || 'Team B'}</div>
            <div className="flex gap-3 justify-center">
              <button
                className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => setShowWinnerOverlay(false)}
              >
                Back
              </button>
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm"
                onClick={() => { window.location.href = `/past-games?currentGame=${id}`; }}
              >
                Past Games
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GamePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    }>
      <GamePageContent />
    </Suspense>
  );
}
