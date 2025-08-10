'use client';

import { useAuth } from './contexts/AuthContext';
import RecentMatches from './components/RecentMatches';
import AuthForm from './components/AuthForm';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import PWAInstallPrompt from './components/PWAInstallPrompt';

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

function HomeContent() {
  const { user, logout, loading: authLoading } = useAuth();
  const [guestInfo, setGuestInfo] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && user?.isAnonymous) {
      // Only load guest info after mounted and when user is confirmed to be anonymous
      const loadGuestInfo = async () => {
        try {
          // Dynamic import to avoid server-side issues
          const { getGuestUserInfo } = await import('./lib/guest-storage');
          const info = getGuestUserInfo();
          setGuestInfo(info);
        } catch (error) {
          console.error('Error getting guest info:', error);
          setGuestInfo(null);
        }
      };
      
      loadGuestInfo();
    }
  }, [mounted, user]);

  // Show loading state until mounted and auth is ready
  if (!mounted || authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-purple-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  // Show auth form if no user
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-purple-900">
        {/* Header */}
        <header className="bg-black/20 backdrop-blur-sm border-b border-white/10">
          <div className="max-w-[1140px] mx-auto p-4">
            <h1 className="text-white font-bold text-2xl">Scozo</h1>
            <p className="text-white/60 text-sm">Netball Scorer</p>
          </div>
        </header>

        {/* Auth Form */}
        <div className="max-w-[1140px] mx-auto p-4 flex items-center justify-center min-h-[calc(100vh-120px)]">
          <AuthForm />
        </div>
      </div>
    );
  }

  // Show main content for authenticated users
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-purple-900" suppressHydrationWarning>
      <PWAInstallPrompt />
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-sm border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="text-left">
              <h1 className="text-white font-bold text-4xl">ScoZo</h1>
              <span className="text-white/60 text-lg">Built for sideline scoring</span>
            </div>
            <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl flex items-center justify-center overflow-hidden">
              <img 
                src="/netball-player.png" 
                alt="Netball Player" 
                className="w-12 h-12 object-contain"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="text-center mb-12">
          <h2 className="text-white text-3xl font-bold mb-4">
            Hello {user.isAnonymous ? 'Guest' : (user.displayName || 'User')},<br />
            Welcome to ScoZo
          </h2>
          <p className="text-white/80 text-lg mb-8">
            Professional netball scoring made simple and intuitive
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/new"
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold py-4 px-12 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-200 max-w-xs text-center"
            >
              🆕 Start New Game
            </Link>
            <Link
              href="/past-games"
              className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-4 px-12 rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-200 max-w-xs text-center"
            >
              📊 View Past Games
            </Link>
          </div>
        </div>

        {/* Recent Matches */}
        <RecentMatches />
        
        {/* Guest User Info - Only show when we have actual guest data */}
        {user.isAnonymous && mounted && guestInfo && guestInfo.deviceId !== 'guest_device_id_placeholder' && (
          <div className="mt-8 text-center">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 max-w-md mx-auto">
              <h3 className="text-white font-semibold text-lg mb-3">Guest Mode Active</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-white/80">Device ID:</span>
                  <span className="text-white/60 font-mono text-xs">{guestInfo.deviceId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/80">Saved Games:</span>
                  <span className="text-white/60 font-mono text-xs">{guestInfo.gamesCount}</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* User Controls - Bottom of Page */}
        <div className="mt-6">
          {/* Guest Mode Limitations - Moved here */}
          {user.isAnonymous && (
            <div className="text-center mb-6">
              <div className="text-yellow-400 text-xs mb-2">⚠️ Guest Mode Limitations</div>
              <div className="text-white/60 text-xs space-y-1">
                <p>• Games are saved locally on this device only</p>
                <p>• Data will be lost if you clear browser data</p>
                <p>• Sign up to save games permanently in the cloud</p>
              </div>
            </div>
          )}
          
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <span className="text-white/60 text-sm">
                {user.isAnonymous ? 'Guest User' : `Signed in as ${user.email}`}
              </span>
            </div>
            <button
              onClick={logout}
              className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              {user.isAnonymous ? 'Sign out' : 'Logout'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-purple-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    }>
      <HomeContent key="home-content" />
    </Suspense>
  );
}
