'use client';

import React, { useState } from 'react';
import { Heart, Bookmark, Volume2, VolumeX, Eye } from 'lucide-react';
import { VideoItem, formatCount } from '@/lib/mockData';
import { getUser, toggleLike, toggleSave, getLikedVideos, isVideoSaved } from '@/lib/userStore';

interface VideoActionBarProps {
  video: VideoItem;
  muted: boolean;
  onMuteToggle: () => void;
  onAuthRequired: (message?: string) => void;
}

export default function VideoActionBar({
  video,
  muted,
  onMuteToggle,
  onAuthRequired,
}: VideoActionBarProps) {
  const user = getUser();
  const [liked, setLiked] = useState(() => getLikedVideos().has(video.id));
  const [saved, setSaved] = useState(() => isVideoSaved(video.id));
  const [likeCount, setLikeCount] = useState(video.likeCount);
  const [heartAnim, setHeartAnim] = useState(false);
  const [bookmarkAnim, setBookmarkAnim] = useState(false);

  function handleLike() {
    if (!user) {
      onAuthRequired('Sign in to like this video and support the creator.');
      return;
    }
    const nowLiked = toggleLike(video.id);
    setLiked(nowLiked);
    setLikeCount((prev) => (nowLiked ? prev + 1 : prev - 1));
    setHeartAnim(true);
    setTimeout(() => setHeartAnim(false), 400);
  }

  function handleSave() {
    if (!user) {
      onAuthRequired('Sign in to save videos to your playlist.');
      return;
    }
    const nowSaved = toggleSave(video.id);
    setSaved(nowSaved);
    setBookmarkAnim(true);
    setTimeout(() => setBookmarkAnim(false), 350);
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2 px-2">
      {/* Like */}
      <div className="action-btn" onClick={handleLike} role="button" tabIndex={0} aria-label={`Like video — ${formatCount(likeCount)} likes`}>
        <div className={`action-icon-wrap ${liked ? 'liked' : ''} ${heartAnim ? 'heart-pop' : ''}`}>
          <Heart
            size={24}
            fill={liked ? '#FE2C55' : 'none'}
            stroke={liked ? '#FE2C55' : 'white'}
            strokeWidth={2}
          />
        </div>
        <span className="text-white text-xs font-semibold font-tabular drop-shadow-sm">
          {formatCount(likeCount)}
        </span>
      </div>

      {/* Save */}
      <div className="action-btn" onClick={handleSave} role="button" tabIndex={0} aria-label={`Save video — ${formatCount(video.saveCount)} saves`}>
        <div className={`action-icon-wrap ${saved ? 'saved' : ''} ${bookmarkAnim ? 'bookmark-pop' : ''}`}>
          <Bookmark
            size={22}
            fill={saved ? '#25F4EE' : 'none'}
            stroke={saved ? '#25F4EE' : 'white'}
            strokeWidth={2}
          />
        </div>
        <span className="text-white text-xs font-semibold font-tabular drop-shadow-sm">
          {formatCount(video.saveCount)}
        </span>
      </div>

      {/* Views */}
      <div className="flex flex-col items-center gap-1">
        <div className="action-icon-wrap" style={{ cursor: 'default' }}>
          <Eye size={22} stroke="white" strokeWidth={2} />
        </div>
        <span className="text-white text-xs font-semibold font-tabular drop-shadow-sm">
          {formatCount(video.viewCount)}
        </span>
      </div>

      {/* Mute */}
      <div
        className="action-btn"
        onClick={onMuteToggle}
        role="button"
        tabIndex={0}
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        <div className="action-icon-wrap">
          {muted
            ? <VolumeX size={22} stroke="white" strokeWidth={2} />
            : <Volume2 size={22} stroke="white" strokeWidth={2} />
          }
        </div>
      </div>
    </div>
  );
}