'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Mail, Lock, User, AlertCircle, Copy, Check, ArrowLeft } from 'lucide-react';
import { setUser } from '@/lib/userStore';
import { toast } from 'sonner';

// Backend integration point: replace with real auth API call
const DEMO_ACCOUNTS = [
  { email: 'alex.nguyen@videofeed.app', password: 'Watch2024!', name: 'Alex Nguyen' },
  { email: 'priya.demo@videofeed.app', password: 'Stream2024!', name: 'Priya Demo' },
];

interface FormData {
  name?: string;
  email: string;
  password: string;
}

export default function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
    reset,
  } = useForm<FormData>();

  const redirectTo = searchParams?.get('from') || '/video-feed';

  useEffect(() => {
    reset();
  }, [tab, reset]);

  async function onSubmit(data: FormData) {
    setLoading(true);
    // Backend integration point: POST /api/auth/signin or /api/auth/signup
    await new Promise((r) => setTimeout(r, 900));

    if (tab === 'signin') {
      const match = DEMO_ACCOUNTS.find(
        (a) => a.email === data.email && a.password === data.password
      );
      if (!match) {
        setError('email', {
          message: 'Invalid credentials — use the demo accounts below to sign in',
        });
        setLoading(false);
        return;
      }
      setUser({ id: `user-${Date.now()}`, email: match.email, name: match.name });
      toast.success(`Welcome back, ${match.name.split(' ')[0]}! 👋`);
      router.push(redirectTo);
    } else {
      // Signup: create mock user
      const name = data.name || data.email.split('@')[0];
      setUser({ id: `user-${Date.now()}`, email: data.email, name });
      toast.success('Account created! Welcome to VideoFeed 🎉');
      router.push('/video-feed');
    }
    setLoading(false);
  }

  function autofill(account: typeof DEMO_ACCOUNTS[0]) {
    setValue('email', account.email);
    setValue('password', account.password);
    toast.info('Demo credentials filled in');
  }

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Back button */}
      <button
        onClick={() => router.push('/video-feed')}
        className="flex items-center gap-2 text-muted hover:text-app text-sm font-medium mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to feed
      </button>

      {/* Logo + headline */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgb(var(--accent))' }}
          >
            <span className="text-white font-bold text-lg">V</span>
          </div>
          <span className="font-bold text-xl text-app tracking-tight">VideoFeed</span>
        </div>
        <h1 className="text-2xl font-bold text-app mb-1">
          {tab === 'signin' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="text-muted text-sm">
          {tab === 'signin' ?'Sign in to like videos and save to your playlist.' :'Join VideoFeed to interact with creators and save your favorites.'}
        </p>
      </div>

      {/* Tab toggle */}
      <div className="flex bg-surface2 rounded-xl p-1 mb-6">
        {(['signin', 'signup'] as const).map((t) => (
          <button
            key={`tab-${t}`}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200
              ${tab === t ? 'bg-surface text-app shadow-sm' : 'text-muted hover:text-app'}
            `}
          >
            {t === 'signin' ? 'Sign In' : 'Sign Up'}
          </button>
        ))}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        {/* Name (signup only) */}
        {tab === 'signup' && (
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-app mb-1.5">
              Display name
            </label>
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="How you'll appear to others"
                className="w-full bg-surface2 border border-app rounded-xl py-3 pl-9 pr-4 text-sm text-app placeholder:text-muted focus:outline-none focus:border-accent transition-colors"
                style={{ borderColor: errors.name ? 'rgb(var(--accent))' : undefined }}
                {...register('name', {
                  required: 'Display name is required',
                  minLength: { value: 2, message: 'Name must be at least 2 characters' },
                })}
              />
            </div>
            {errors.name && (
              <p className="mt-1.5 text-xs flex items-center gap-1" style={{ color: 'rgb(var(--accent))' }}>
                <AlertCircle size={12} /> {errors.name.message}
              </p>
            )}
          </div>
        )}

        {/* Email */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-app mb-1.5">
            Email address
          </label>
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full bg-surface2 border border-app rounded-xl py-3 pl-9 pr-4 text-sm text-app placeholder:text-muted focus:outline-none focus:border-accent transition-colors"
              style={{ borderColor: errors.email ? 'rgb(var(--accent))' : undefined }}
              {...register('email', {
                required: 'Email is required',
                pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' },
              })}
            />
          </div>
          {errors.email && (
            <p className="mt-1.5 text-xs flex items-center gap-1.5 leading-snug" style={{ color: 'rgb(var(--accent))' }}>
              <AlertCircle size={12} className="flex-shrink-0" /> {errors.email.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-app">
              Password
            </label>
            {tab === 'signin' && (
              <button type="button" className="text-xs text-muted hover:text-accent transition-colors">
                Forgot password?
              </button>
            )}
          </div>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              id="password"
              type={showPass ? 'text' : 'password'}
              autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
              placeholder={tab === 'signin' ? 'Your password' : 'Create a strong password'}
              className="w-full bg-surface2 border border-app rounded-xl py-3 pl-9 pr-11 text-sm text-app placeholder:text-muted focus:outline-none focus:border-accent transition-colors"
              style={{ borderColor: errors.password ? 'rgb(var(--accent))' : undefined }}
              {...register('password', {
                required: 'Password is required',
                minLength: tab === 'signup' ? { value: 8, message: 'Password must be at least 8 characters' } : undefined,
              })}
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-app transition-colors"
              aria-label={showPass ? 'Hide password' : 'Show password'}
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.password && (
            <p className="mt-1.5 text-xs flex items-center gap-1" style={{ color: 'rgb(var(--accent))' }}>
              <AlertCircle size={12} /> {errors.password.message}
            </p>
          )}
        </div>

        {/* Terms (signup) */}
        {tab === 'signup' && (
          <p className="text-xs text-muted leading-relaxed">
            By creating an account you agree to our{' '}
            <button type="button" className="text-accent hover:underline">Terms of Service</button>
            {' '}and{' '}
            <button type="button" className="text-accent hover:underline">Privacy Policy</button>.
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all duration-150 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1"
          style={{ background: 'rgb(var(--accent))' }}
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {tab === 'signin' ? 'Signing in…' : 'Creating account…'}
            </>
          ) : (
            tab === 'signin' ? 'Sign in' : 'Create account'
          )}
        </button>
      </form>

      {/* Demo credentials — sign in only */}
      {tab === 'signin' && (
        <div className="mt-6 rounded-xl border border-app p-4 bg-surface2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Demo accounts</p>
          <div className="flex flex-col gap-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <div
                key={`demo-${acc.email}`}
                className="flex items-center justify-between gap-2 bg-surface rounded-lg px-3 py-2.5 border border-app"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-app truncate">{acc.name}</p>
                  <p className="text-xs text-muted truncate">{acc.email}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => copyText(acc.password, `pwd-${acc.email}`)}
                    className="text-muted hover:text-app transition-colors p-1.5 rounded-lg hover:bg-surface2"
                    title="Copy password"
                    aria-label="Copy password"
                  >
                    {copied === `pwd-${acc.email}` ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => autofill(acc)}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-all duration-150 active:scale-95"
                    style={{ background: 'rgba(254,44,85,0.15)', color: 'rgb(var(--accent))' }}
                  >
                    Use
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toggle link */}
      <p className="text-center text-sm text-muted mt-6">
        {tab === 'signin' ? "Don't have an account? " : 'Already have an account? '}
        <button
          type="button"
          onClick={() => setTab(tab === 'signin' ? 'signup' : 'signin')}
          className="text-accent font-semibold hover:underline"
        >
          {tab === 'signin' ? 'Sign up free' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}