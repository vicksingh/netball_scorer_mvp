'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import { getCompletedGames, GameSummary } from '../lib/firebase-utils';

export default function RecentMatches() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      setGames([]);
      setLoading(false);
      return;
    }

    const loadGames = async () => {
      try {
        setLoading(true);
        const completedGames = await getCompletedGames();
        setGames(completedGames);
      } catch (error) {
        console.error('Error loading games:', error);
      } finally {
        setLoading(false);
      }
    };

    loadGames();
  }, [user]);

  if (!user) return null;

  if (loading) {
    return (
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
        <div className="text-white/60 text-center">Loading recent matches...</div>
      </div>
    );
  }

  if (games.length === 0) {
    return null;
  }

  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
      <h2 className="text-white font-semibold text-lg mb-4">Recent Matches</h2>
      <div className="space-y-3">
        {games.slice(-5).reverse().map((game) => (
          <Link 
            key={game.id}
            href={`/game/${game.id}`}
            className="block bg-white/5 hover:bg-white/10 rounded-xl p-4 border border-white/10 transition-all duration-200"
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="text-white font-medium">{game.teamA} vs {game.teamB}</div>
                <div className="text-xs text-white/60">
                  {game.createdAt?.toDate?.() ? 
                    game.createdAt.toDate().toLocaleDateString() : 
                    new Date().toLocaleDateString()
                  }
                </div>
                {game.location && (
                  <div className="text-xs text-white/40 mt-1">{game.location}</div>
                )}
              </div>
              <div className="text-xs text-white/40 bg-white/10 px-2 py-1 rounded-full">#{game.shortId}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
