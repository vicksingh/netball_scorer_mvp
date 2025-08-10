"use client";
import { useRouter } from "next/navigation";
import { useState, Suspense } from "react";
import { useAuth } from "../contexts/AuthContext";
import { createGame } from "../lib/firebase-utils";

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

// Simple ID generator for local storage
function makeShortId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function NewGamePageContent() {
  const r = useRouter();
  const { user, loading } = useAuth();
  const [teamA, setTeamA] = useState("Home");
  const [teamB, setTeamB] = useState("Away");
  const [numQuarters, setNumQuarters] = useState(4);
  const [quarterMin, setQuarterMin] = useState(10);
  const [location, setLocation] = useState("");

  const [creating, setCreating] = useState(false);

  // Redirect if not authenticated
  if (!loading && !user) {
    r.push('/');
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  async function createGameHandler() {
    if (!user) return;
    
    try {
      setCreating(true);
      const breakDefaults = [3,5,3].slice(0, Math.max(0, numQuarters-1)).map(m=>m*60);
      
      const gameData = {
        shortId: makeShortId(),
        sharePublic: true,
        teamA: { name: teamA },
        teamB: { name: teamB },
        location,
        settings: {
          numQuarters,
          quarterDurationSec: quarterMin * 60,
          breakDurationsSec: breakDefaults,
          matchType: "standard" as const,
        },
        state: {
          phase: { type: "quarter", index: 1 },
          isRunning: false,
          phaseStartedAt: new Date().toISOString(),
          elapsedMs: 0,
          scores: { A: 0, B: 0 },
          quarterScores: {
            1: { A: 0, B: 0 },
            2: { A: 0, B: 0 },
            3: { A: 0, B: 0 },
            4: { A: 0, B: 0 },
          },
          centrePass: "A" as "A", // Team A starts with centre pass
          lastGoal: null,
        },
      };
      
      const gameId = await createGame(gameData);
      r.push(`/game/${gameId}`);
    } catch (e) {
      alert("Failed to create game: " + (e as Error).message);
      console.error(e);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900">
      {/* Header */}
      <header className="bg-black/20 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-[1140px] mx-auto p-4">
          <h1 className="text-white font-bold text-xl">Create New Match</h1>
          <p className="text-white/60 text-sm mt-1">Set up your netball game</p>
        </div>
      </header>

      {/* Form */}
      <div className="max-w-[1140px] mx-auto px-6 py-8 space-y-8">
        <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-6 border border-white/20 shadow-2xl space-y-6">
          {/* Team Names */}
          <div className="space-y-4">
            <h2 className="text-white font-semibold text-xl">Team Information</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-white/80 text-sm font-medium mb-2">Team A</label>
                <input 
                  className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg" 
                  value={teamA} 
                  onChange={e=>setTeamA(e.target.value)} 
                  placeholder="Home Team"
                />
              </div>
              <div>
                <label className="block text-white/80 text-sm font-medium mb-2">Team B</label>
                <input 
                  className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg" 
                  value={teamB} 
                  onChange={e=>setTeamB(e.target.value)} 
                  placeholder="Away Team"
                />
              </div>
            </div>
            <div>
              <label className="block text-white/80 text-sm font-medium mb-2">Location</label>
              <input 
                className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg" 
                value={location}
                onChange={e=>setLocation(e.target.value)}
                placeholder="Court / Venue"
              />
            </div>
          </div>

          {/* Game Settings */}
          <div className="space-y-4">
            <h2 className="text-white font-semibold text-xl">Game Settings</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-white/80 text-sm font-medium mb-3">Quarters</label>
                <div className="relative">
                  <select 
                    className="w-full bg-white/10 border border-white/20 rounded-2xl pl-6 pr-14 py-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg appearance-none" 
                    value={numQuarters} 
                    onChange={e=>setNumQuarters(parseInt(e.target.value))}
                  >
                    {[2,4].map(n=> <option key={n} value={n}>{n}</option>)}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
                    <svg className="h-4 w-4 text-white/80" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.08 1.04l-4.25 4.25a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-white/80 text-sm font-medium mb-3">Length</label>
                <div className="relative">
                  <select
                    className="w-full bg-white/10 border border-white/20 rounded-2xl pl-6 pr-14 py-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg appearance-none"
                    value={quarterMin}
                    onChange={e => setQuarterMin(parseInt(e.target.value))}
                  >
                    {[5, 10, 15].map(m => (
                      <option key={m} value={m}>{m} mins</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
                    <svg className="h-4 w-4 text-white/80" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.08 1.04l-4.25 4.25a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Create Button */}
        <button 
          className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-6 px-8 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-200 text-xl" 
          onClick={createGameHandler}
          disabled={creating}
        >
          {creating ? 'Creating Match...' : 'CREATE MATCH'}
        </button>

        {/* Back Button */}
        <button 
          className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-medium py-4 px-8 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-200 text-lg" 
          onClick={() => r.push('/')}
        >
          ← Back to Home
        </button>
      </div>
    </div>
  );
}

export default function NewGamePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    }>
      <NewGamePageContent />
    </Suspense>
  );
}
