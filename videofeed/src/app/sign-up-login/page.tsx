import React, { Suspense } from 'react';
import AuthForm from './components/AuthForm';
import PageTransition from '@/components/PageTransition';

function AuthFormFallback() {
  return (
    <div className="w-full max-w-md mx-auto animate-pulse">
      <div className="h-8 bg-surface2 rounded-xl mb-6 w-32" />
      <div className="h-12 bg-surface2 rounded-xl mb-4" />
      <div className="h-12 bg-surface2 rounded-xl mb-4" />
      <div className="h-12 bg-surface2 rounded-xl" />
    </div>
  );
}

export default function SignUpLoginPage() {
  return (
    <PageTransition
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        background: 'radial-gradient(ellipse at 20% 50%, rgba(254,44,85,0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(37,244,238,0.06) 0%, transparent 50%), rgb(var(--bg))',
      }}
    >
      <Suspense fallback={<AuthFormFallback />}>
        <AuthForm />
      </Suspense>
    </PageTransition>
  );
}