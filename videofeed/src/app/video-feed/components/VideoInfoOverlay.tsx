import React from 'react';
import { VideoItem, formatDuration } from '@/lib/mockData';
import { Clock } from 'lucide-react';

interface VideoInfoOverlayProps {
  video: VideoItem;
}

export default function VideoInfoOverlay({ video }: VideoInfoOverlayProps) {
  return (
    <div className="fade-in-up">
      {/* Creator */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 border-2"
          style={{
            background: video.creator.avatarColor,
            borderColor: '#25F4EE',
          }}
          aria-label={`Avatar of ${video.creator.name}`}
        >
          {video.creator.avatarInitials}
        </div>
        <div>
          <p className="text-white font-bold text-sm leading-tight">{video.creator.name}</p>
          <p className="text-white/70 text-xs">{video.creator.handle}</p>
        </div>
        <div className="flex items-center gap-1 ml-1 text-white/60 text-xs">
          <Clock size={11} />
          <span>{formatDuration(video.duration)}</span>
        </div>
      </div>

      {/* Title */}
      <p className="text-white text-sm leading-relaxed mb-3 line-clamp-2 font-medium" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
        {video.title}
      </p>

      {/* Tags */}
      <div className="flex flex-wrap gap-2">
        {video.tags.map((tag) => (
          <span
            key={`tag-${video.id}-${tag}`}
            className="text-xs font-semibold cursor-pointer hover:underline"
            style={{ color: '#25F4EE' }}
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}