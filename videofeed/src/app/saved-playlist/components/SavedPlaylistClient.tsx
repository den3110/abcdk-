'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, Trash2, Eye, Clock, Play, LogIn, Search, X } from 'lucide-react';
import { MOCK_VIDEOS, VideoItem, formatCount, formatDuration } from '@/lib/mockData';
import { getUser, getSavedVideos, toggleSave } from '@/lib/userStore';
import { toast } from 'sonner';

export default function SavedPlaylistClient() {
  const router = useRouter();
  const user = getUser();
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    // Backend integration point: GET /api/user/saved-videos
    setSavedIds(getSavedVideos());
  }, []);

  const savedVideos: VideoItem[] = savedIds
    .map((id) => MOCK_VIDEOS.find((v) => v.id === id))
    .filter((v): v is VideoItem => Boolean(v));

  const filteredVideos: VideoItem[] = searchQuery.trim()
    ? savedVideos.filter((v) => {
        const q = searchQuery.toLowerCase();
        return (
          v.title.toLowerCase().includes(q) ||
          v.creator.name.toLowerCase().includes(q) ||
          v.tags.some((tag) => tag.toLowerCase().includes(q))
        );
      })
    : savedVideos;

  function handleRemove(videoId: string) {
    setRemovingId(videoId);
    setTimeout(() => {
      toggleSave(videoId);
      setSavedIds(getSavedVideos());
      setRemovingId(null);
      toast.success('Removed from playlist');
    }, 280);
  }

  function handlePlay(videoId: string) {
    // Navigate to feed — ideally deep-link to specific video index
    router.push('/video-feed');
  }

  if (!user) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[60vh]">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
          style={{ background: 'rgba(254,44,85,0.1)' }}
        >
          <LogIn size={36} style={{ color: 'rgb(var(--accent))' }} />
        </div>
        <h2 className="text-xl font-bold text-app mb-2">Sign in to view your playlist</h2>
        <p className="text-muted text-sm max-w-sm mb-6 leading-relaxed">
          Your saved videos are tied to your account. Sign in to access your bookmarked content.
        </p>
        <button
          onClick={() => router.push('/sign-up-login')}
          className="px-6 py-3 rounded-xl font-semibold text-sm text-white transition-all duration-150 active:scale-95"
          style={{ background: 'rgb(var(--accent))' }}
        >
          Sign in or create account
        </button>
      </div>
    );
  }

  if (savedVideos.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[60vh]">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
          style={{ background: 'rgba(37,244,238,0.1)' }}
        >
          <Bookmark size={36} style={{ color: '#25F4EE' }} />
        </div>
        <h2 className="text-xl font-bold text-app mb-2">No saved videos yet</h2>
        <p className="text-muted text-sm max-w-sm mb-6 leading-relaxed">
          Tap the bookmark icon on any video to save it here. Your playlist is private and only visible to you.
        </p>
        <button
          onClick={() => router.push('/video-feed')}
          className="px-6 py-3 rounded-xl font-semibold text-sm text-white transition-all duration-150 active:scale-95"
          style={{ background: 'rgb(var(--accent))' }}
        >
          Browse videos
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-none pb-20 md:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-app border-b border-app px-4 md:px-8 py-4">
        <div className="max-w-screen-2xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-bold text-app">Saved Playlist</h1>
              <p className="text-muted text-sm mt-0.5">
                {filteredVideos.length}{searchQuery.trim() ? ` of ${savedVideos.length}` : ''} video{savedVideos.length !== 1 ? 's' : ''} saved
              </p>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
              style={{ background: 'rgba(37,244,238,0.1)', color: '#25F4EE' }}
            >
              <Bookmark size={15} />
              <span className="font-tabular">{savedVideos.length}</span>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'rgb(var(--muted))' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, creator, or tag…"
              className="w-full pl-9 pr-9 py-2.5 rounded-xl text-sm bg-surface border border-app text-app placeholder:text-muted focus:outline-none focus:ring-2 transition-all duration-150"
              style={{ '--tw-ring-color': 'rgba(37,244,238,0.35)' } as React.CSSProperties}
              aria-label="Search saved videos"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-app transition-colors duration-150"
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-6">
        {filteredVideos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(254,44,85,0.08)' }}
            >
              <Search size={28} style={{ color: 'rgb(var(--muted))' }} />
            </div>
            <h3 className="text-base font-semibold text-app mb-1">No results found</h3>
            <p className="text-muted text-sm max-w-xs">
              No saved videos match &ldquo;{searchQuery}&rdquo;. Try a different title, creator, or tag.
            </p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-4 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 active:scale-95"
              style={{ background: 'rgba(37,244,238,0.1)', color: '#25F4EE' }}
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
            {filteredVideos.map((video) => (
              <div
                key={video.id}
                className={`group rounded-2xl overflow-hidden border border-app bg-surface transition-all duration-280
                  ${removingId === video.id ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'}
                `}
                style={{ transition: 'opacity 0.28s ease, transform 0.28s ease' }}
              >
                {/* Thumbnail */}
                <div
                  className="relative aspect-[9/16] w-full cursor-pointer overflow-hidden"
                  onClick={() => handlePlay(video.id)}
                  role="button"
                  aria-label={`Play: ${video.title}`}
                  tabIndex={0}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `linear-gradient(${video.gradientAngle}deg, ${video.gradientFrom} 0%, ${video.gradientTo} 100%)`,
                    }}
                  />
                  <div
                    className="absolute inset-0 opacity-40"
                    style={{
                      backgroundImage: `radial-gradient(circle at 40% 60%, ${video.accentColor}44 0%, transparent 60%)`,
                    }}
                  />
                  {/* Overlay on hover */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-all duration-200 w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
                      <Play size={24} fill="white" stroke="none" />
                    </div>
                  </div>
                  {/* Duration badge */}
                  <div
                    className="absolute bottom-2 right-2 text-xs font-semibold px-2 py-0.5 rounded-md"
                    style={{ background: 'rgba(0,0,0,0.65)', color: 'rgba(255,255,255,0.9)' }}
                  >
                    {formatDuration(video.duration)}
                  </div>
                  {/* Category badge */}
                  <div
                    className="absolute top-2 left-2 text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: 'rgba(0,0,0,0.5)',
                      color: video.accentColor,
                      border: `1px solid ${video.accentColor}44`,
                    }}
                  >
                    {video.category}
                  </div>
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5"
                      style={{ background: video.creator.avatarColor }}
                    >
                      {video.creator.avatarInitials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-app text-xs font-semibold line-clamp-2 leading-snug mb-1">
                        {video.title}
                      </p>
                      <p className="text-muted text-xs">{video.creator.name}</p>
                    </div>
                  </div>

                  {/* Tags */}
                  {video.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {video.tags.slice(0, 3).map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setSearchQuery(tag)}
                          className="text-xs px-1.5 py-0.5 rounded-md transition-colors duration-150"
                          style={{
                            background: 'rgba(37,244,238,0.08)',
                            color: '#25F4EE',
                          }}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-muted text-xs">
                      <span className="flex items-center gap-1 font-tabular">
                        <Eye size={11} />
                        {formatCount(video.viewCount)}
                      </span>
                      <span className="flex items-center gap-1 font-tabular">
                        <Clock size={11} />
                        {formatDuration(video.duration)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemove(video.id)}
                      className="p-1.5 rounded-lg text-muted hover:text-accent hover:bg-surface2 transition-all duration-150 active:scale-90"
                      title="Remove from playlist"
                      aria-label="Remove from saved playlist"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}