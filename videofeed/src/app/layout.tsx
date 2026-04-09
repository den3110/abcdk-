import React from 'react';
import type { Metadata, Viewport } from 'next';
import '../styles/tailwind.css';
import { Toaster } from 'sonner';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'VideoFeed — Short Videos, Endless Discovery',
  description:
    'Scroll through an endless vertical feed of short videos. Like, save, and discover creators — no account needed to watch.',
  icons: {
    icon: [{ url: '/favicon.ico', type: 'image/x-icon' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: 'rgb(24 24 27)',
              color: 'rgb(250 250 250)',
              border: '1px solid rgb(63 63 70)',
              fontFamily: 'DM Sans, system-ui, sans-serif',
              fontSize: '14px',
            },
          }}
        />
</body>
    </html>
  );
}