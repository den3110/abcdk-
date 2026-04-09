import React from 'react';
import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';
import VideoFeedClient from './components/VideoFeedClient';
import PageTransition from '@/components/PageTransition';

export default function VideoFeedPage() {
  return (
    <PageTransition>
      {/* --feed-h: on mobile subtract bottom nav (64px = 4rem), on md+ use full height */}
      <style>{`
        :root { --feed-h: calc(100svh - 4rem); --bottom-nav-h: 4rem; }
        @media (min-width: 768px) { :root { --feed-h: 100svh; --bottom-nav-h: 0px; } }
      `}</style>
      <div className="flex w-screen overflow-hidden bg-black" style={{ height: 'var(--feed-h, 100svh)' }}>
        {/* Desktop Sidebar */}
        <Sidebar />

        {/* Feed */}
        <VideoFeedClient />

        {/* Mobile Bottom Nav */}
        <BottomNav />
      </div>
    </PageTransition>
  );
}