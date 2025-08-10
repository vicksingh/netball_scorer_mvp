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
  console.log('phaseDurationMs called with:', { phase, settings });
  
  // Add null safety checks
  if (!phase || !settings) {
    console.warn('phaseDurationMs: Missing phase or settings:', { phase, settings });
    return 0;
  }
  
  if (phase.type === "quarter") {
    const duration = settings.quarterDurationSec * 1000;
    console.log('Quarter duration:', duration, 'ms');
    return duration;
  } else if (phase.type === "break") {
    const duration = settings.breakDurationsSec[phase.index - 1] * 1000;
    console.log('Break duration:', duration, 'ms');
    return duration;
  }
  console.log('Unknown phase type, returning 0');
  return 0;
}

export function nextPhase(phase: any, settings: any): any {
  if (phase.type === "quarter") {
    if (phase.index < settings.numQuarters) {
      return { type: "break", index: phase.index };
    } else {
      return { type: "fulltime" };
    }
  } else if (phase.type === "break") {
    return { type: "quarter", index: phase.index + 1 };
  }
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
