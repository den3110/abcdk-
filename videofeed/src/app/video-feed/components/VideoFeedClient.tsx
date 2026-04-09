'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MOCK_VIDEOS } from '@/lib/mockData';
import VideoCard from './VideoCard';
import AuthModal from '@/components/AuthModal';
import { ChevronUp, ChevronDown, CheckCircle } from 'lucide-react';

// Pull-to-refresh constants
const PTR_THRESHOLD = 80;   // px to trigger refresh
const PTR_MAX      = 120;   // max pull distance shown

// Lazy loading window: render cards within this range of activeIndex
const RENDER_WINDOW = 2;

// ── Skeleton Card ────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div
      className="relative w-full flex-shrink-0 overflow-hidden bg-black"
      style={{ height: 'var(--feed-h, 100svh)' }}
    >
      {/* Shimmer background */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        }}
      />
      {/* Animated shimmer overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'skeletonShimmer 1.6s ease-in-out infinite',
        }}
      />

      {/* Category badge skeleton */}
      <div className="absolute top-4 left-4 z-10">
        <div className="h-5 w-20 rounded-full bg-white/10 animate-pulse" />
      </div>

      {/* Bottom info skeleton */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10 flex items-end justify-between px-4"
        style={{ paddingBottom: 'calc(0.5rem + var(--bottom-nav-h, 0px))' }}
      >
        {/* Left: title + meta */}
        <div className="flex-1 pr-4 space-y-2 pb-2">
          {/* Avatar + username */}
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-white/10 animate-pulse flex-shrink-0" />
            <div className="h-3 w-24 rounded-full bg-white/10 animate-pulse" />
          </div>
          {/* Title lines */}
          <div className="h-4 w-4/5 rounded-full bg-white/10 animate-pulse" />
          <div className="h-4 w-3/5 rounded-full bg-white/10 animate-pulse" />
          {/* Tags */}
          <div className="flex gap-2 pt-1">
            <div className="h-3 w-14 rounded-full bg-white/10 animate-pulse" />
            <div className="h-3 w-16 rounded-full bg-white/10 animate-pulse" />
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex flex-col items-center gap-4 pb-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
              <div className="h-2 w-6 rounded-full bg-white/10 animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Progress bar skeleton */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10" />
    </div>
  );
}

export default function VideoFeedClient() {
  const [isLoading, setIsLoading] = useState(true);
  const [feedVisible, setFeedVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | undefined>();

  // Track which video indices have been "unlocked" for rendering
  // Start with first RENDER_WINDOW+1 cards pre-loaded
  const [renderedIndices, setRenderedIndices] = useState<Set<number>>(
    () => new Set(Array.from({ length: Math.min(RENDER_WINDOW + 1, MOCK_VIDEOS.length) }, (_, i) => i))
  );

  // Pull-to-refresh state
  const [ptrPull, setPtrPull]       = useState(0);      // current pull distance (0-PTR_MAX)
  const [ptrLoading, setPtrLoading] = useState(false);
  const [ptrSuccess, setPtrSuccess] = useState(false);
  const ptrActive = useRef(false);                       // are we in a PTR drag?

  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state
  const dragStartY = useRef<number | null>(null);
  const dragStartX = useRef<number | null>(null);
  const currentDragDelta = useRef(0);
  const isDragging = useRef(false);
  const isAnimating = useRef(false);
  const activeIndexRef = useRef(0);

  // Keep ref in sync with state
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  // Expand rendered window as user navigates — lazy load + prefetch ahead
  useEffect(() => {
    setRenderedIndices((prev) => {
      const next = new Set(prev);
      // Render active ± RENDER_WINDOW
      for (let i = Math.max(0, activeIndex - RENDER_WINDOW); i <= Math.min(MOCK_VIDEOS.length - 1, activeIndex + RENDER_WINDOW); i++) {
        next.add(i);
      }
      // Prefetch one extra card ahead (activeIndex + RENDER_WINDOW + 1)
      const prefetchIdx = activeIndex + RENDER_WINDOW + 1;
      if (prefetchIdx < MOCK_VIDEOS.length) {
        next.add(prefetchIdx);
      }
      return next;
    });
  }, [activeIndex]);

  // Initial loading simulation — show skeletons then fade in feed
  useEffect(() => {
    const loadTimer = setTimeout(() => {
      setIsLoading(false);
      // Small delay so the skeleton fades out before feed fades in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setFeedVisible(true));
      });
    }, 1200);
    return () => clearTimeout(loadTimer);
  }, []);

  // Get the container height (= one video height)
  const getSlideHeight = useCallback(() => {
    return containerRef.current?.clientHeight ?? window.innerHeight;
  }, []);

  // Apply transform to the inner wrapper
  const setTranslate = useCallback((y: number, animate: boolean) => {
    const inner = containerRef.current?.querySelector<HTMLDivElement>('.feed-inner');
    if (!inner) return;
    inner.style.transition = animate ? 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
    inner.style.transform = `translateY(${y}px)`;
  }, []);

  // Snap to a given index
  const snapToIndex = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(MOCK_VIDEOS.length - 1, idx));
    const slideHeight = getSlideHeight();
    isAnimating.current = true;
    setTranslate(-clamped * slideHeight, true);
    setActiveIndex(clamped);
    activeIndexRef.current = clamped;
    setTimeout(() => { isAnimating.current = false; }, 380);
  }, [getSlideHeight, setTranslate]);

  // On window resize, re-snap without animation to keep alignment
  useEffect(() => {
    const handleResize = () => {
      const slideHeight = getSlideHeight();
      setTranslate(-activeIndexRef.current * slideHeight, false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [getSlideHeight, setTranslate]);

  // ── Pull-to-refresh trigger ──────────────────────────────────────
  const triggerRefresh = useCallback(() => {
    setPtrLoading(true);
    setPtrPull(0);
    // Simulate reload delay
    setTimeout(() => {
      setPtrLoading(false);
      setPtrSuccess(true);
      snapToIndex(0);
      setTimeout(() => setPtrSuccess(false), 1800);
    }, 1200);
  }, [snapToIndex]);

  // ── Touch handlers ──────────────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isAnimating.current) return;
    dragStartY.current = e.touches[0].clientY;
    dragStartX.current = e.touches[0].clientX;
    currentDragDelta.current = 0;
    isDragging.current = false;
    ptrActive.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const deltaY = e.touches[0].clientY - dragStartY.current;
    const deltaX = dragStartX.current !== null ? Math.abs(e.touches[0].clientX - dragStartX.current) : 0;

    // Pull-to-refresh: only when at top video and pulling down
    if (activeIndexRef.current === 0 && deltaY > 0 && !ptrLoading) {
      if (!isDragging.current && !ptrActive.current) {
        if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > deltaX) {
          ptrActive.current = true;
        }
      }
      if (ptrActive.current) {
        e.preventDefault();
        const pull = Math.min(deltaY * 0.5, PTR_MAX);
        setPtrPull(pull);
        return; // don't also move the feed
      }
    }

    // Confirm vertical drag
    if (!isDragging.current) {
      if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > deltaX) {
        isDragging.current = true;
      } else if (deltaX > Math.abs(deltaY)) {
        // Horizontal — abort
        dragStartY.current = null;
        return;
      }
    }

    if (isDragging.current) {
      e.preventDefault();
      currentDragDelta.current = deltaY;
      const slideHeight = getSlideHeight();
      const baseOffset = -activeIndexRef.current * slideHeight;
      // Add resistance at edges
      let resistedDelta = deltaY;
      if ((activeIndexRef.current === 0 && deltaY > 0) || (activeIndexRef.current === MOCK_VIDEOS.length - 1 && deltaY < 0)) {
        resistedDelta = deltaY * 0.25;
      }
      setTranslate(baseOffset + resistedDelta, false);
    }
  }, [getSlideHeight, setTranslate, ptrLoading]);

  const handleTouchEnd = useCallback(() => {
    // Handle pull-to-refresh release
    if (ptrActive.current) {
      ptrActive.current = false;
      if (ptrPull >= PTR_THRESHOLD) {
        triggerRefresh();
      } else {
        setPtrPull(0);
      }
      dragStartY.current = null;
      dragStartX.current = null;
      isDragging.current = false;
      return;
    }

    if (dragStartY.current === null || !isDragging.current) {
      dragStartY.current = null;
      dragStartX.current = null;
      isDragging.current = false;
      return;
    }

    const delta = currentDragDelta.current;
    const slideHeight = getSlideHeight();
    const threshold = slideHeight * 0.2; // 20% of screen height

    if (delta < -threshold) {
      snapToIndex(activeIndexRef.current + 1);
    } else if (delta > threshold) {
      snapToIndex(activeIndexRef.current - 1);
    } else {
      // Snap back to current
      snapToIndex(activeIndexRef.current);
    }

    dragStartY.current = null;
    dragStartX.current = null;
    currentDragDelta.current = 0;
    isDragging.current = false;
  }, [getSlideHeight, snapToIndex, ptrPull, triggerRefresh]);

  // ── Mouse drag handlers ─────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isAnimating.current) return;
    dragStartY.current = e.clientY;
    dragStartX.current = e.clientX;
    currentDragDelta.current = 0;
    isDragging.current = false;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStartY.current === null || e.buttons === 0) return;
    const deltaY = e.clientY - dragStartY.current;
    const deltaX = Math.abs(e.clientX - (dragStartX.current ?? e.clientX));

    if (!isDragging.current) {
      if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > deltaX) {
        isDragging.current = true;
      }
    }

    if (isDragging.current) {
      e.preventDefault();
      currentDragDelta.current = deltaY;
      const slideHeight = getSlideHeight();
      const baseOffset = -activeIndexRef.current * slideHeight;
      let resistedDelta = deltaY;
      if ((activeIndexRef.current === 0 && deltaY > 0) || (activeIndexRef.current === MOCK_VIDEOS.length - 1 && deltaY < 0)) {
        resistedDelta = deltaY * 0.25;
      }
      setTranslate(baseOffset + resistedDelta, false);
    }
  }, [getSlideHeight, setTranslate]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (dragStartY.current === null || !isDragging.current) {
      dragStartY.current = null;
      dragStartX.current = null;
      isDragging.current = false;
      return;
    }

    const delta = currentDragDelta.current;
    const slideHeight = getSlideHeight();
    const threshold = slideHeight * 0.2;

    if (delta < -threshold) {
      snapToIndex(activeIndexRef.current + 1);
    } else if (delta > threshold) {
      snapToIndex(activeIndexRef.current - 1);
    } else {
      snapToIndex(activeIndexRef.current);
    }

    dragStartY.current = null;
    dragStartX.current = null;
    currentDragDelta.current = 0;
    isDragging.current = false;
  }, [getSlideHeight, snapToIndex]);

  const handleAuthRequired = useCallback((message?: string) => {
    setAuthMessage(message);
    setShowAuthModal(true);
  }, []);

  // Pull-to-refresh indicator visibility
  const showPtrIndicator = ptrPull > 0 || ptrLoading || ptrSuccess;
  const ptrReady = ptrPull >= PTR_THRESHOLD;

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden select-none"
      style={{ height: '100%', touchAction: 'none', cursor: isDragging.current ? 'grabbing' : 'grab' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* ── Skeleton loading overlay ─────────────────────────────── */}
      {isLoading && (
        <div
          className="absolute inset-0 z-50 overflow-hidden"
          style={{
            animation: 'skeletonFadeOut 0.4s ease forwards',
            animationDelay: '0.9s',
          }}
        >
          <SkeletonCard />
        </div>
      )}

      {/* Pull-to-refresh indicator — mobile only */}
      <div
        className="md:hidden absolute left-0 right-0 z-30 flex flex-col items-center justify-end pointer-events-none"
        style={{
          top: 0,
          height: showPtrIndicator ? (ptrLoading || ptrSuccess ? 64 : ptrPull) : 0,
          transition: ptrActive.current ? 'none' : 'height 0.3s ease',
          overflow: 'hidden',
        }}
      >
        <div
          className="flex flex-col items-center gap-1 pb-2"
          style={{
            opacity: showPtrIndicator ? 1 : 0,
            transition: 'opacity 0.2s',
          }}
        >
          {ptrSuccess ? (
            <>
              <CheckCircle size={24} className="text-green-400" />
              <span className="text-xs font-semibold text-green-400">Refreshed!</span>
            </>
          ) : ptrLoading ? (
            <>
              {/* Spinner */}
              <svg
                className="animate-spin"
                width={24} height={24} viewBox="0 0 24 24" fill="none"
              >
                <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span className="text-xs font-semibold text-white/80">Loading…</span>
            </>
          ) : (
            <>
              {/* Arrow indicator */}
              <svg
                width={24} height={24} viewBox="0 0 24 24" fill="none"
                style={{
                  transform: ptrReady ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease',
                }}
              >
                <path d="M12 5v14M5 12l7 7 7-7" stroke={ptrReady ? '#4ade80' : 'white'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span
                className="text-xs font-semibold"
                style={{ color: ptrReady ? '#4ade80' : 'rgba(255,255,255,0.8)' }}
              >
                {ptrReady ? 'Release to refresh' : 'Pull to refresh'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Inner wrapper — this is what we translate */}
      <div
        className="feed-inner will-change-transform"
        style={{
          transform: 'translateY(0px)',
          marginTop: showPtrIndicator && !ptrLoading && !ptrSuccess ? ptrPull : 0,
          transition: ptrActive.current ? 'none' : 'margin-top 0.3s ease',
          opacity: feedVisible ? 1 : 0,
          animation: feedVisible ? 'feedFadeIn 0.5s ease forwards' : 'none',
        }}
      >
        {MOCK_VIDEOS.map((video, idx) => (
          <div
            key={video.id}
            style={{ height: 'var(--feed-h, 100svh)' }}
          >
            {renderedIndices.has(idx) ? (
              <VideoCard
                video={video}
                isActive={activeIndex === idx}
                onAuthRequired={handleAuthRequired}
              />
            ) : (
              /* Lightweight placeholder for unrendered cards — preserves scroll height */
              <div
                className="w-full h-full bg-black"
                aria-hidden="true"
                style={{
                  background: `linear-gradient(${video.gradientAngle}deg, ${video.gradientFrom} 0%, ${video.gradientTo} 100%)`,
                  opacity: 0.15,
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Desktop nav arrows */}
      <div className="hidden md:flex flex-col gap-2 absolute right-6 top-1/2 -translate-y-1/2 z-20">
        <button
          onClick={() => snapToIndex(activeIndex - 1)}
          disabled={activeIndex === 0}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 disabled:opacity-30"
          style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
          aria-label="Previous video"
        >
          <ChevronUp size={20} stroke="white" />
        </button>
        <button
          onClick={() => snapToIndex(activeIndex + 1)}
          disabled={activeIndex === MOCK_VIDEOS.length - 1}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 disabled:opacity-30"
          style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
          aria-label="Next video"
        >
          <ChevronDown size={20} stroke="white" />
        </button>
      </div>

      {/* Video counter */}
      <div
        className="absolute top-4 right-4 z-20 text-xs font-semibold px-2.5 py-1 rounded-full hidden md:block"
        style={{
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(8px)',
          color: 'rgba(255,255,255,0.8)',
          border: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        {activeIndex + 1} / {MOCK_VIDEOS.length}
      </div>

      {/* Auth modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          message={authMessage}
        />
      )}
    </div>
  );
}