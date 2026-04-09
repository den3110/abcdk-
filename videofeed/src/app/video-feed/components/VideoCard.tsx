'use client';

import React, { useRef, useEffect, useState } from 'react';
import { VideoItem } from '@/lib/mockData';
import VideoActionBar from './VideoActionBar';
import VideoInfoOverlay from './VideoInfoOverlay';
import { Play, Pause } from 'lucide-react';

interface VideoCardProps {
  video: VideoItem;
  isActive: boolean;
  onAuthRequired: (message?: string) => void;
}

export default function VideoCard({ video, isActive, onAuthRequired }: VideoCardProps) {
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showPauseIcon, setShowPauseIcon] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseIconTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasRealVideo = Boolean(video.videoUrl);

  // Control real video element
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isActive && !paused) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isActive, paused]);

  // Sync mute state
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
  }, [muted]);

  // Update progress from real video
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    function onTimeUpdate() {
      if (!el || !el.duration) return;
      setProgress((el.currentTime / el.duration) * 100);
    }
    el.addEventListener('timeupdate', onTimeUpdate);
    return () => el.removeEventListener('timeupdate', onTimeUpdate);
  }, []);

  // Simulated progress for gradient-only cards
  useEffect(() => {
    if (hasRealVideo) return;
    if (isActive && !paused) {
      setProgress(0);
      intervalRef.current = setInterval(() => {
        setProgress((p) => {
          if (p >= 100) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return 100;
          }
          return p + (100 / video.duration) * 0.5;
        });
      }, 500);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, paused, video.duration, video.id, hasRealVideo]);

  function handleTap() {
    setPaused((p) => !p);
    setShowPauseIcon(true);
    if (pauseIconTimer.current) clearTimeout(pauseIconTimer.current);
    pauseIconTimer.current = setTimeout(() => setShowPauseIcon(false), 800);
  }

  return (
    <div className="snap-start relative w-full h-full flex items-stretch overflow-hidden bg-black">
      {/* Real video element */}
      {hasRealVideo && (
        <video
          ref={videoRef}
          src={video.videoUrl}
          className="absolute inset-0 w-full h-full object-cover"
          loop
          muted
          playsInline
          preload="metadata"
        />
      )}

      {/* Gradient background (shown when no real video, or as fallback) */}
      {!hasRealVideo && (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(${video.gradientAngle}deg, ${video.gradientFrom} 0%, ${video.gradientTo} 100%)`,
          }}
          aria-hidden="true"
        />
      )}

      {/* Animated pattern overlay (gradient cards only) */}
      {!hasRealVideo && (
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `radial-gradient(circle at 30% 60%, ${video.accentColor}33 0%, transparent 50%), radial-gradient(circle at 70% 30%, ${video.accentColor}22 0%, transparent 40%)`,
          }}
          aria-hidden="true"
        />
      )}

      {/* Category badge */}
      <div className="absolute top-4 left-4 z-10">
        <span
          className="text-xs font-bold px-2.5 py-1 rounded-full"
          style={{
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(8px)',
            color: video.accentColor,
            border: `1px solid ${video.accentColor}44`,
          }}
        >
          {video.category}
        </span>
      </div>

      {/* Gradient overlay */}
      <div className="absolute inset-0 video-gradient-overlay z-[1]" aria-hidden="true" />

      {/* Tap to pause area */}
      <div
        className="absolute inset-0 z-[2] cursor-pointer"
        onClick={handleTap}
        aria-label={paused ? 'Tap to play' : 'Tap to pause'}
        role="button"
        tabIndex={-1}
      />

      {/* Pause/Play icon flash */}
      {showPauseIcon && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center pointer-events-none">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(4px)',
              animation: 'heartPop 0.4s ease forwards',
            }}
          >
            {paused
              ? <Play size={36} fill="white" stroke="none" />
              : <Pause size={36} fill="white" stroke="none" />
            }
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 z-10">
        <div className="progress-bar mx-0 rounded-none" style={{ borderRadius: 0 }}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Main content layout */}
      <div className="relative z-[4] flex w-full h-full">
        {/* Info overlay — bottom left */}
        <div className="flex-1 flex flex-col justify-end pl-4 pr-2" style={{ paddingBottom: 'calc(0.5rem + var(--bottom-nav-h, 0px))' }}>
          <VideoInfoOverlay video={video} />
        </div>

        {/* Action bar — right side */}
        <div className="flex flex-col justify-end pr-2" style={{ paddingBottom: 'calc(0.5rem + var(--bottom-nav-h, 0px))' }}>
          <VideoActionBar
            video={video}
            muted={muted}
            onMuteToggle={() => setMuted((m) => !m)}
            onAuthRequired={onAuthRequired}
          />
        </div>
      </div>
    </div>
  );
}