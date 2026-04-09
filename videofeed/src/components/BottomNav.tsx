'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Home, Bookmark, User } from 'lucide-react';
import { getUser, User as UserType } from '@/lib/userStore';

const STATIC_TABS = [
  { id: 'tab-feed', label: 'For You', icon: <Home size={22} />, route: '/video-feed' },
  { id: 'tab-saved', label: 'Saved', icon: <Bookmark size={22} />, route: '/saved-playlist', requiresAuth: true },
  { id: 'tab-auth', label: 'Sign in', icon: <User size={22} />, route: '/sign-up-login', isAuth: true },
];

export default function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserType | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setUser(getUser());
  }, []);

  function handleTabClick(tab: typeof STATIC_TABS[number]) {
    if (tab.requiresAuth && !user) {
      router.push('/sign-up-login');
      return;
    }
    router.push(tab.route);
  }

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-app bg-surface flex items-center h-16 safe-area-inset-bottom">
      {STATIC_TABS.map((tab) => {
        const isActive = pathname === tab.route || (tab.route === '/video-feed' && pathname === '/');
        const label = (mounted && tab.isAuth && user) ? 'Profile' : tab.label;
        return (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-all duration-150
              ${isActive ? 'text-accent' : 'text-muted hover:text-app'}
            `}
          >
            {tab.icon}
            <span className="text-xs font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}