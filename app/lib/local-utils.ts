// Simple clock utilities for local storage
export function nowMs(): number {
  return Date.now();
}

export function msToClock(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function phaseDurationMs(phase: any, settings: any): number {
  // Add null safety checks
  if (!phase || !settings) {
    console.warn('phaseDurationMs: Missing phase or settings:', { phase, settings });
    return 0;
  }
  
  if (phase.type === "quarter") {
    const duration = settings.quarterDurationSec * 1000;
    console.log('Quarter duration:', { phase, duration, settings: settings.quarterDurationSec });
    return duration;
  } else if (phase.type === "break") {
    const duration = settings.breakDurationsSec[phase.index - 1] * 1000;
    console.log('Break duration:', { 
      phase, 
      duration, 
      breakIndex: phase.index, 
      arrayIndex: phase.index - 1,
      breakDurations: settings.breakDurationsSec 
    });
    return duration;
  }
  return 0;
}

export function nextPhase(phase: any, settings: any): any {
  console.log('nextPhase called:', { phase, settings });
  
  if (phase.type === "quarter") {
    if (phase.index < settings.numQuarters) {
      const next = { type: "break", index: phase.index };
      console.log('Quarter -> Break:', next);
      return next;
    } else {
      const next = { type: "fulltime" };
      console.log('Quarter -> Fulltime:', next);
      return next;
    }
  } else if (phase.type === "break") {
    const next = { type: "quarter", index: phase.index + 1 };
    console.log('Break -> Quarter:', next);
    return next;
  }
  console.log('No phase change:', phase);
  return phase;
}

// Local storage utilities
export function saveGame(gameId: string, game: any) {
  localStorage.setItem(`game_${gameId}`, JSON.stringify(game));
}

export function loadGame(gameId: string) {
  const saved = localStorage.getItem(`game_${gameId}`);
  return saved ? JSON.parse(saved) : null;
}

export function updateGame(gameId: string, updates: any) {
  const game = loadGame(gameId);
  if (game) {
    const updatedGame = { 
      ...game, 
      ...updates,
      // Deep merge for nested objects
      state: updates.state ? { ...game.state, ...updates.state } : game.state
    };
    saveGame(gameId, updatedGame);
    return updatedGame;
  }
  return null;
}
