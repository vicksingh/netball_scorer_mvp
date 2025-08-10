"use client";
import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";
import { getCompletedGames, deleteGame, GameSummary } from "../lib/firebase-utils";

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

function PastGamesPageContent() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    // Handle authentication redirect
    if (!loading && !user && !isRedirecting) {
      setIsRedirecting(true);
      router.push('/');
      return;
    }

    // Load completed games from Firebase
    const loadGames = async () => {
      try {
        const completedGames = await getCompletedGames();
        setGames(completedGames);
      } catch (error) {
        console.error('Error loading games:', error);
      }
    };

    if (user) {
      loadGames();
    }

    // Get current game ID from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('currentGame');
    if (gameId) {
      setCurrentGameId(gameId);
    }
  }, [user, loading, router, isRedirecting]);

  function formatDate(timestamp: any) {
    if (timestamp?.toDate) {
      return timestamp.toDate().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    return 'Unknown date';
  }

  async function removeGame(gameId: string) {
    if (!confirm('Delete this game? This cannot be undone.')) {
      return;
    }
    
    try {
      setDeleting(gameId);
      const success = await deleteGame(gameId);
      if (success) {
        setGames(prev => prev.filter(g => g.id !== gameId));
      } else {
        alert('Failed to delete game. You may not have permission.');
      }
    } catch (e) {
      console.error('Failed to delete game', e);
      alert('Failed to delete game.');
    } finally {
      setDeleting(null);
    }
  }

  async function clearPastGames() {
    if (!confirm('This will delete all completed games. Continue?')) {
      return;
    }

    try {
      // Delete all completed games
      const deletePromises = games.map(game => deleteGame(game.id));
      await Promise.all(deletePromises);
      setGames([]);
      alert('Past games cleared.');
    } catch (e) {
      console.error('Failed to clear past games', e);
      alert('Failed to clear past games.');
    }
  }

  // Show loading state while checking authentication
  if (loading || isRedirecting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect in useEffect)
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="bg-black/20 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-[1140px] mx-auto flex items-center justify-between p-4">
          <div>
            <h1 className="text-white font-bold text-xl">Past Games</h1>
            <p className="text-white/60 text-sm">Game History & Results</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Smart Back Button */}
            <button
              onClick={() => {
                if (currentGameId) {
                  router.push(`/game/${currentGameId}`);
                } else {
                  router.push('/');
                }
              }}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2"
            >
              ← {currentGameId ? 'Back to Current Game' : 'Back'}
            </button>
            <button
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
              onClick={clearPastGames}
            >
              Clear Past Games
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1140px] mx-auto p-4 space-y-4">
        {games.length === 0 ? (
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20 text-center">
            <div className="text-white/60 text-lg mb-4">No past games found</div>
            <Link 
              href="/new"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200"
            >
              Create New Game
            </Link>
          </div>
        ) : (
          games.map((game) => (
            <div key={game.id} className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
              {/* Game Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-white font-bold text-lg">
                    {game.teamA} vs {game.teamB}
                  </h3>
                  <p className="text-white/60 text-sm">{formatDate(game.createdAt)}</p>
                  {game.location && (
                    <p className="text-white/40 text-xs mt-1">{game.location}</p>
                  )}
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-300">
                      Completed
                    </div>
                    <button
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md text-xs font-medium disabled:opacity-50"
                      onClick={() => removeGame(game.id)}
                      disabled={deleting === game.id}
                    >
                      {deleting === game.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                  <p className="text-white/40 text-xs mt-1">ID: {game.shortId}</p>
                </div>
              </div>

              {/* View Game Button */}
              <div className="text-center">
                <Link
                  href={`/game/${game.id}`}
                  className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                >
                  View Game Details
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function PastGamesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    }>
      <PastGamesPageContent />
    </Suspense>
  );
}
