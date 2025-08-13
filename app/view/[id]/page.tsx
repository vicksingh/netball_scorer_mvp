"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { msToClock, nowMs, phaseDurationMs } from "../../lib/local-utils";
import { onSnapshot, doc } from "firebase/firestore";
import { getFirebaseDB } from "../../lib/firebase";

// Force dynamic rendering to avoid SSR/CSR markup mismatch
export const dynamic = 'force-dynamic';

export default function ViewGamePage() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<any | null>(null);
  const [left, setLeft] = useState(0);
  const [gameNotFound, setGameNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
  const [updateSource] = useState<"firebase">("firebase");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Single real-time listener: public view should only read from Firestore
  useEffect(() => {
    if (!id) return;
    const db = getFirebaseDB();
    if (!db) {
      setGameNotFound(true);
      setLoading(false);
      return;
    }

    const ref = doc(db, "games", id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data: any = snap.data();
          if (data?.sharePublic === true || data?.isPubliclyViewable === true) {
            // Ignore partial/summary writes that don't include state/phase
            if (!data?.state || !data?.state?.phase) {
              console.warn('Snapshot missing state/phase; ignoring partial update');
            } else {
              setGame(data);
              setGameNotFound(false);
              setLastUpdateTime(Date.now());
            }
          } else {
            setGameNotFound(true);
          }
        } else {
          setGameNotFound(true);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Firebase listener error:", err);
        setGameNotFound(true);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [id]);

  // Timer effect for countdown (robust to missing/invalid data)
  useEffect(() => {
    if (!game || !game.state) {
      setLeft(0);
      return;
    }
    const state = game.state;
    const safeSettings = {
      numQuarters: game?.settings?.numQuarters ?? 4,
      quarterDurationSec: game?.settings?.quarterDurationSec ?? 600,
      breakDurationsSec: game?.settings?.breakDurationsSec ?? [180, 180, 180],
      matchType: game?.settings?.matchType ?? "standard",
    } as any;

    if (state?.phase?.type === "fulltime") {
      setLeft(0);
      return;
    }

    const tick = () => {
      const duration = Number(phaseDurationMs(state?.phase ?? { type: "quarter", index: 1 }, safeSettings)) || 0;
      let elapsed = Number(state?.elapsedMs) || 0;
      if (state?.isRunning && state?.phaseStartedAt) {
        const started = Date.parse(state.phaseStartedAt);
        if (!Number.isNaN(started)) {
          elapsed += Math.max(0, nowMs() - started);
        }
      }
      const remaining = Math.max(0, duration - elapsed);
      setLeft(Number.isFinite(remaining) ? remaining : 0);
    };

    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [game?.state, game?.settings]);

  // Ensure server and client render the same UI initially
  if (!mounted || loading) {
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

  if (gameNotFound || !game) {
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
          <button onClick={() => (window.location.href = "/")} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const { teamA, teamB, state } = game;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
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
            <div className="flex items-center space-x-2 text-xs">
              <div className={`w-2 h-2 rounded-full bg-green-400`}></div>
              <span className="text-slate-300">Firebase</span>
            </div>
            <div className="text-slate-300 text-sm bg-slate-700/50 px-3 py-1 rounded-lg">View Only</div>
          </div>
        </div>
      </header>

      <div className="max-w-[1140px] mx-auto px-4 py-6">
        <div className={`backdrop-blur-sm rounded-2xl p-6 border border-white/20 shadow-lg mb-4 transition-all duration-500 ${
          left <= 30000 && left > 0 // 30 seconds or less remaining
            ? 'bg-gradient-to-br from-red-500/30 to-red-600/30 border-red-400/50 animate-pulse'
            : 'bg-white/10'
        }`}>
          <div className="text-center">
            <div className="text-white/60 text-sm font-medium uppercase tracking-wider mb-2">
              {state?.phase?.type === "quarter" ? `QUARTER ${state.phase.index || 1}` : state?.phase?.type === "break" ? `BREAK ${state.phase.index || 1}` : "FULL TIME"}
            </div>
            <div className={`text-6xl font-bold text-white tabular-nums leading-none transition-all duration-500 ${
              left <= 30000 && left > 0
                ? 'text-red-100 drop-shadow-lg'
                : 'text-white'
            }`}>{msToClock(left)}</div>
            <div className="text-white/60 text-sm mt-2">{state?.isRunning ? "LIVE" : "PAUSED"}</div>
          </div>
        </div>

        {/* Centre Pass Indicator - Only show during quarters */}
        {state?.phase?.type === "quarter" && (
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20 shadow-lg mb-4">
            <div className="flex items-center justify-center">
              <div className="text-center">
                <div className="text-blue-300 text-sm font-medium uppercase tracking-wider mb-1">
                  CENTRE PASS
                </div>
                <div className="text-xl font-bold text-white">
                  {state?.centrePass === "A" ? (teamA?.name || 'Team A') : (teamB?.name || 'Team B')}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 shadow-lg">
          <div className="grid grid-cols-2 items-center text-center gap-4">
            <div className="space-y-4">
              <div className="text-white/60 text-sm font-medium uppercase tracking-wider">{teamA?.name || "Team A"}</div>
              <div className="text-5xl font-bold text-white leading-none">{state?.scores?.A || 0}</div>
            </div>
            <div className="space-y-4">
              <div className="text-white/60 text-sm font-medium uppercase tracking-wider">{teamB?.name || "Team B"}</div>
              <div className="text-5xl font-bold text-white leading-none">{state?.scores?.B || 0}</div>
            </div>
          </div>
        </div>

        <div className="text-center mt-4">
          <div className="text-slate-400 text-xs">Last updated: {lastUpdateTime ? new Date(lastUpdateTime).toLocaleTimeString() : "Never"} • Source: Firebase Real-time</div>
        </div>
      </div>
    </div>
  );
}
