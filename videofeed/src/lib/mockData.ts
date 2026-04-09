export interface Creator {
  id: string;
  name: string;
  handle: string;
  avatarColor: string;
  avatarInitials: string;
  followerCount: number;
}

export interface VideoItem {
  id: string;
  creator: Creator;
  title: string;
  tags: string[];
  gradientFrom: string;
  gradientTo: string;
  gradientAngle: number;
  accentColor: string;
  viewCount: number;
  likeCount: number;
  saveCount: number;
  duration: number; // seconds
  category: string;
  videoUrl?: string;
}

export const CREATORS: Creator[] = [
  {
    id: 'creator-001',
    name: 'Minh Anh',
    handle: '@minhanh.creates',
    avatarColor: '#FE2C55',
    avatarInitials: 'MA',
    followerCount: 284000,
  },
  {
    id: 'creator-002',
    name: 'Kai Nakamura',
    handle: '@kai.world',
    avatarColor: '#25F4EE',
    avatarInitials: 'KN',
    followerCount: 1200000,
  },
  {
    id: 'creator-003',
    name: 'Priya Sharma',
    handle: '@priyacooks',
    avatarColor: '#FF9F1C',
    avatarInitials: 'PS',
    followerCount: 560000,
  },
  {
    id: 'creator-004',
    name: 'Lucas Ferreira',
    handle: '@lucasbeats',
    avatarColor: '#7C3AED',
    avatarInitials: 'LF',
    followerCount: 890000,
  },
  {
    id: 'creator-005',
    name: 'Zara Al-Hassan',
    handle: '@zarafitness',
    avatarColor: '#059669',
    avatarInitials: 'ZA',
    followerCount: 430000,
  },
  {
    id: 'creator-006',
    name: 'Tom Eriksson',
    handle: '@tomskates',
    avatarColor: '#0EA5E9',
    avatarInitials: 'TE',
    followerCount: 320000,
  },
  {
    id: 'creator-007',
    name: 'Yuki Tanaka',
    handle: '@yukidraws',
    avatarColor: '#EC4899',
    avatarInitials: 'YT',
    followerCount: 710000,
  },
  {
    id: 'creator-008',
    name: 'Darius Cole',
    handle: '@dariuscooks',
    avatarColor: '#F59E0B',
    avatarInitials: 'DC',
    followerCount: 195000,
  },
];

export const MOCK_VIDEOS: VideoItem[] = [
  {
    id: 'video-001',
    creator: CREATORS[0],
    title: 'Making Bánh Mì from scratch in under 15 minutes — this bread is absolutely unreal 🥖',
    tags: ['#food', '#vietnamese', '#cooking', '#breadmaking'],
    gradientFrom: '#1a0533',
    gradientTo: '#6b21a8',
    gradientAngle: 135,
    accentColor: '#c084fc',
    viewCount: 2840000,
    likeCount: 184200,
    saveCount: 43100,
    duration: 58,
    category: 'Food',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  },
  {
    id: 'video-002',
    creator: CREATORS[1],
    title: "Tokyo at 3AM hits different. Here's the side of the city nobody shows you 🌙",
    tags: ['#tokyo', '#travel', '#nightlife', '#japan'],
    gradientFrom: '#0c1445',
    gradientTo: '#1e40af',
    gradientAngle: 160,
    accentColor: '#60a5fa',
    viewCount: 9200000,
    likeCount: 870000,
    saveCount: 210000,
    duration: 42,
    category: 'Travel',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  },
  {
    id: 'video-003',
    creator: CREATORS[2],
    title: "Butter chicken in 20 min, restaurant quality. My mom's secret: this one spice 🌶️",
    tags: ['#indianfood', '#cooking', '#recipe', '#quickmeals'],
    gradientFrom: '#431407',
    gradientTo: '#c2410c',
    gradientAngle: 145,
    accentColor: '#fb923c',
    viewCount: 4100000,
    likeCount: 312000,
    saveCount: 98000,
    duration: 67,
    category: 'Food',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  },
  {
    id: 'video-004',
    creator: CREATORS[3],
    title: 'I made a beat using only sounds from my apartment. The result slaps harder than expected 🎵',
    tags: ['#music', '#beatmaking', '#producer', '#hiphop'],
    gradientFrom: '#1e0042',
    gradientTo: '#5b21b6',
    gradientAngle: 120,
    accentColor: '#a78bfa',
    viewCount: 6700000,
    likeCount: 520000,
    saveCount: 145000,
    duration: 53,
    category: 'Music',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  },
  {
    id: 'video-005',
    creator: CREATORS[4],
    title: '5 minute morning stretch that changed my posture completely. Do this every day 💪',
    tags: ['#fitness', '#morning', '#stretch', '#wellness'],
    gradientFrom: '#052e16',
    gradientTo: '#166534',
    gradientAngle: 155,
    accentColor: '#4ade80',
    viewCount: 3300000,
    likeCount: 241000,
    saveCount: 87000,
    duration: 61,
    category: 'Fitness',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
  },
  {
    id: 'video-006',
    creator: CREATORS[5],
    title: 'Landed this trick after 6 months of failing. The look on my face says everything 🛹',
    tags: ['#skateboarding', '#sports', '#progression', '#tricks'],
    gradientFrom: '#0c1a2e',
    gradientTo: '#0369a1',
    gradientAngle: 170,
    accentColor: '#38bdf8',
    viewCount: 1850000,
    likeCount: 156000,
    saveCount: 29000,
    duration: 34,
    category: 'Sports',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
  },
  {
    id: 'video-007',
    creator: CREATORS[6],
    title: 'Drawing an entire city in 60 seconds with just a ballpoint pen. Satisfying to watch ✏️',
    tags: ['#art', '#drawing', '#timelapse', '#satisfying'],
    gradientFrom: '#1a0626',
    gradientTo: '#9d174d',
    gradientAngle: 130,
    accentColor: '#f472b6',
    viewCount: 12400000,
    likeCount: 1100000,
    saveCount: 380000,
    duration: 47,
    category: 'Art',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
  },
  {
    id: 'video-008',
    creator: CREATORS[7],
    title: 'Smash burger technique that gets you that perfect crispy crust every single time 🍔',
    tags: ['#burger', '#grilling', '#cooking', '#foodtips'],
    gradientFrom: '#1c0a00',
    gradientTo: '#92400e',
    gradientAngle: 150,
    accentColor: '#fbbf24',
    viewCount: 2200000,
    likeCount: 178000,
    saveCount: 54000,
    duration: 55,
    category: 'Food',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
  },
  {
    id: 'video-009',
    creator: CREATORS[0],
    title: 'Vietnamese iced coffee (cà phê sữa đá) the right way — most people skip this step ☕',
    tags: ['#coffee', '#vietnamese', '#drinks', '#cafe'],
    gradientFrom: '#1a0d00',
    gradientTo: '#78350f',
    gradientAngle: 140,
    accentColor: '#d97706',
    viewCount: 5600000,
    likeCount: 430000,
    saveCount: 120000,
    duration: 38,
    category: 'Food',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
  },
  {
    id: 'video-010',
    creator: CREATORS[1],
    title: 'Riding the Shinkansen at 320km/h — the view from the window is something else 🚄',
    tags: ['#japan', '#travel', '#shinkansen', '#train'],
    gradientFrom: '#0a1628',
    gradientTo: '#1e3a5f',
    gradientAngle: 165,
    accentColor: '#93c5fd',
    viewCount: 7800000,
    likeCount: 640000,
    saveCount: 175000,
    duration: 44,
    category: 'Travel',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
  },
  {
    id: 'video-011',
    creator: CREATORS[4],
    title: 'The only ab workout you need — no equipment, just 8 minutes. My core is on fire 🔥',
    tags: ['#abs', '#workout', '#noequipment', '#fitness'],
    gradientFrom: '#042f2e',
    gradientTo: '#0f766e',
    gradientAngle: 145,
    accentColor: '#2dd4bf',
    viewCount: 4800000,
    likeCount: 365000,
    saveCount: 132000,
    duration: 72,
    category: 'Fitness',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4',
  },
  {
    id: 'video-012',
    creator: CREATORS[6],
    title: 'Speed painting a galaxy portrait in watercolor. Every brush stroke is a new universe 🌌',
    tags: ['#watercolor', '#painting', '#art', '#galaxy'],
    gradientFrom: '#0d0221',
    gradientTo: '#312e81',
    gradientAngle: 125,
    accentColor: '#818cf8',
    viewCount: 8900000,
    likeCount: 780000,
    saveCount: 290000,
    duration: 51,
    category: 'Art',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
  },
];

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}