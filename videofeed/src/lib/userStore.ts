// Backend integration point: replace with real auth (NextAuth, Supabase, Firebase, etc.)
'use client';

export interface User {
  id: string;
  email: string;
  name: string;
}

const STORAGE_KEY = 'videofeed_user';
const LIKES_KEY = 'videofeed_likes';
const SAVES_KEY = 'videofeed_saves';

export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setUser(user: User | null): void {
  if (typeof window === 'undefined') return;
  if (user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function getLikedVideos(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(LIKES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function toggleLike(videoId: string): boolean {
  const liked = getLikedVideos();
  if (liked.has(videoId)) {
    liked.delete(videoId);
  } else {
    liked.add(videoId);
  }
  localStorage.setItem(LIKES_KEY, JSON.stringify([...liked]));
  return liked.has(videoId);
}

export function getSavedVideos(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function toggleSave(videoId: string): boolean {
  const saved = getSavedVideos();
  const idx = saved.indexOf(videoId);
  if (idx >= 0) {
    saved.splice(idx, 1);
  } else {
    saved.unshift(videoId);
  }
  localStorage.setItem(SAVES_KEY, JSON.stringify(saved));
  return idx < 0; // returns true if now saved
}

export function isVideoSaved(videoId: string): boolean {
  return getSavedVideos().includes(videoId);
}