'use client';

import React, { useEffect, useRef, CSSProperties } from 'react';
import { usePathname } from 'next/navigation';

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
}

// Direction map: which direction each route slides in from
const ROUTE_ORDER: Record<string, number> = {
  '/video-feed': 0,
  '/': 0,
  '/saved-playlist': 1,
  '/sign-up-login': 2,
};

function getRouteIndex(pathname: string): number {
  return ROUTE_ORDER[pathname] ?? 0;
}

export default function PageTransition({ children, className = '', style }: PageTransitionProps) {
  const pathname = usePathname();
  const prevPathnameRef = useRef<string>(pathname);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = prevPathnameRef.current;
    const current = pathname;

    if (prev === current) return;

    const prevIndex = getRouteIndex(prev);
    const currentIndex = getRouteIndex(current);
    const direction = currentIndex >= prevIndex ? 1 : -1;

    const el = containerRef.current;
    if (!el) return;

    // Start position: slide in from right (direction=1) or left (direction=-1)
    el.style.transform = `translateX(${direction * 40}px)`;
    el.style.opacity = '0';
    el.style.transition = 'none';

    // Force reflow
    void el.offsetHeight;

    // Animate to final position
    el.style.transition = 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.28s ease-out';
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';

    prevPathnameRef.current = current;
  }, [pathname]);

  return (
    <div ref={containerRef} className={className} style={{ opacity: 1, ...style }}>
      {children}
    </div>
  );
}
