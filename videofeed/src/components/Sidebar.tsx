'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Home, Bookmark, LogIn, LogOut, ChevronLeft, ChevronRight } from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import { getUser, setUser, User } from '@/lib/userStore';
import { toast } from 'sonner';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  route: string;
  requiresAuth?: boolean;
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUserState] = useState<User | null>(null);

  useEffect(() => {
    setUserState(getUser());
  }, []);

  const navItems: NavItem[] = [
    { id: 'nav-feed', label: 'For You', icon: <Home size={20} />, route: '/video-feed' },
    { id: 'nav-saved', label: 'Saved', icon: <Bookmark size={20} />, route: '/saved-playlist', requiresAuth: true },
  ];

  function handleNav(item: NavItem) {
    if (item.requiresAuth && !user) {
      router.push('/sign-up-login');
      return;
    }
    router.push(item.route);
  }

  function handleLogout() {
    setUser(null);
    setUserState(null);
    toast.success('Signed out successfully');
    router.push('/video-feed');
  }

  return (
    <aside
      className="hidden md:flex flex-col bg-surface border-r border-app h-screen flex-shrink-0 transition-all duration-300 ease-in-out"
      style={{ width: collapsed ? '64px' : '220px', minWidth: collapsed ? '64px' : '220px' }}
    >
      {/* Logo */}
      <div className={`flex items-center gap-2 px-3 py-4 border-b border-app ${collapsed ? 'justify-center' : ''}`}>
        <AppLogo size={32} />
        {!collapsed && (
          <span className="font-bold text-lg text-app tracking-tight whitespace-nowrap">VideoFeed</span>
        )}
      </div>

      {/* Nav Items */}
      <nav className="flex-1 flex flex-col gap-1 px-2 pt-4">
        {navItems.map((item) => {
          const isActive = pathname === item.route;
          return (
            <button
              key={item.id}
              onClick={() => handleNav(item)}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-150 w-full text-left
                ${isActive
                  ? 'bg-surface2 text-accent' :'text-muted hover:bg-surface2 hover:text-app'
                }
                ${collapsed ? 'justify-center' : ''}
              `}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-2 pb-4 flex flex-col gap-1">
        <div className="h-px bg-surface2 mx-1 mb-2" />

        {user ? (
          <>
            <div className={`flex items-center gap-3 px-3 py-2 rounded-xl ${collapsed ? 'justify-center' : ''}`}>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: 'rgb(var(--accent))' }}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <p className="text-app text-xs font-semibold truncate">{user.name}</p>
                  <p className="text-muted text-xs truncate">{user.email}</p>
                </div>
              )}
            </div>
            <button
              onClick={handleLogout}
              title={collapsed ? 'Sign out' : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted hover:text-app hover:bg-surface2 transition-all duration-150 w-full
                ${collapsed ? 'justify-center' : ''}
              `}
            >
              <LogOut size={18} />
              {!collapsed && <span>Sign out</span>}
            </button>
          </>
        ) : (
          <button
            onClick={() => router.push('/sign-up-login')}
            title={collapsed ? 'Sign in' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-150 w-full active:scale-95
              ${collapsed ? 'justify-center' : ''}
            `}
            style={{ background: 'rgb(var(--accent))' }}
          >
            <LogIn size={18} />
            {!collapsed && <span>Sign in</span>}
          </button>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted hover:text-app hover:bg-surface2 transition-all duration-150 w-full mt-1
            ${collapsed ? 'justify-center' : ''}
          `}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}