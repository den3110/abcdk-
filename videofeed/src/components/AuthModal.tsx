'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface AuthModalProps {
  onClose: () => void;
  message?: string;
}

export default function AuthModal({ onClose, message }: AuthModalProps) {
  const router = useRouter();
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in required"
    >
      <div className="modal-card bg-surface rounded-2xl p-6 w-full max-w-sm border border-app shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-app font-bold text-lg">Sign in to interact</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-app transition-colors p-1 rounded-lg hover:bg-surface2"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-muted text-sm mb-6 leading-relaxed">
          {message || 'Create a free account to like videos, save to your playlist, and more.'}
        </p>

        <button
          onClick={() => { router.push('/sign-up-login'); onClose(); }}
          className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all duration-150 active:scale-95"
          style={{ background: 'rgb(var(--accent))' }}
        >
          Sign in or create account
        </button>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl font-semibold text-sm text-muted hover:text-app transition-all duration-150 mt-2 hover:bg-surface2"
        >
          Continue watching
        </button>
      </div>
    </div>
  );
}