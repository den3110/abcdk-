import React from 'react';
import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';
import SavedPlaylistClient from './components/SavedPlaylistClient';
import PageTransition from '@/components/PageTransition';

export default function SavedPlaylistPage() {
  return (
    <PageTransition className="flex h-screen w-screen overflow-hidden bg-app">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Main content */}
      <SavedPlaylistClient />

      {/* Mobile Bottom Nav */}
      <BottomNav />
    </PageTransition>
  );
}