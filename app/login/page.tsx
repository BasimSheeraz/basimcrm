'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { verifyRecoveryCodeLoginAction } from '@/lib/actions/two-factor';
import { Mail, Lock, Shield, Key, AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // 2FA step state
  const [step, setStep] = useState<'credentials' | 'totp' | 'recovery'>('credentials');
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [challengeId, setChallengeId] = useState('');

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam === 'unauthorized_teammate') {
      setErrorMessage('Access denied: Your account is not authorized or has been deactivated.');
    }
  }, [searchParams]);

  // Handle Step 1: Email & Password
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!email.trim() || !password) {
      setErrorMessage('Please enter both your work email and password.');
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        setErrorMessage(error.message || 'Invalid email or password.');
        setLoading(false);
        return;
      }

      // Check MFA Assurance Level
      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) {
        console.warn('MFA check warning:', aalError);
      }

      // If user requires AAL2 (TOTP enrolled)
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const factors = await supabase.auth.mfa.listFactors();
        const totpFactor = factors.data?.totp?.[0];

        if (totpFactor) {
          const challenge = await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
          if (challenge.error) {
            setErrorMessage(challenge.error.message || 'Failed to initialize 2FA challenge.');
            setLoading(false);
            return;
          }
          setFactorId(totpFactor.id);
          setChallengeId(challenge.data.id);
          setStep('totp');
          setLoading(false);
          return;
        }
      }

      // User authenticated successfully without requiring MFA
      router.push('/');
      router.refresh();
    } catch (err: any) {
      setErrorMessage(err?.message || 'An unexpected error occurred during sign-in.');
      setLoading(false);
    }
  };

  // Handle Step 2: TOTP 6-digit Code
  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (totpCode.trim().length !== 6) {
      setErrorMessage('Please enter the 6-digit code from your authenticator app.');
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const verify = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: totpCode.trim(),
      });

      if (verify.error) {
        setErrorMessage(verify.error.message || 'Invalid verification code. Please try again.');
        setLoading(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Verification failed. Please try again.');
      setLoading(false);
    }
  };

  // Handle Step 2 Alternative: One-time Recovery Code
  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanCode = recoveryCode.trim().toUpperCase();
    if (cleanCode.length < 8) {
      setErrorMessage('Please enter a valid recovery code (e.g. XXXX-XXXX).');
      return;
    }

    setLoading(true);

    try {
      const res = await verifyRecoveryCodeLoginAction(email, cleanCode);
      if (!res.success) {
        setErrorMessage(res.error || 'Invalid or already used recovery code.');
        setLoading(false);
        return;
      }

      // Recovery code verified and consumed, proceed to dashboard
      router.push('/');
      router.refresh();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to verify recovery code.');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in-95 duration-200">
      <div className="glass-window p-8 rounded-3xl border border-white/10 shadow-2xl backdrop-blur-3xl bg-black/40">
        {/* Header Brand */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#0A84FF] to-[#5E5CE6] flex items-center justify-center text-white shadow-lg mb-3">
            <Mail className="w-6 h-6" strokeWidth={1.75} />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">Basim</h1>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/10 text-white/80 border border-white/10">
              CRM
            </span>
          </div>
          <p className="text-xs text-white/50 mt-1.5 font-medium">
            Private client outreach & multi-mailbox console
          </p>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="mb-6 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start space-x-2.5 text-xs text-red-200 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-[#FF453A] shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Step 1: Credentials */}
        {step === 'credentials' && (
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/50 mb-1.5">
                Work Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@ourteam.io"
                  required
                  autoFocus
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#0A84FF] focus:ring-1 focus:ring-[#0A84FF] transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-white/50 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#0A84FF] focus:ring-1 focus:ring-[#0A84FF] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-[#0A84FF] to-[#0071E3] hover:brightness-110 active:scale-[0.99] transition-all shadow-md flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer mt-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>Continue to Workspace</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Step 2: TOTP 2FA Verification */}
        {step === 'totp' && (
          <form onSubmit={handleTotpSubmit} className="space-y-4">
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-center mb-2">
              <Shield className="w-6 h-6 text-[#0A84FF] mx-auto mb-1.5" />
              <div className="text-xs font-semibold text-white">Two-Factor Authentication</div>
              <div className="text-[11px] text-white/60 mt-0.5">
                Enter the 6-digit code from your authenticator app
              </div>
            </div>

            <div>
              <input
                type="text"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                autoFocus
                className="w-full py-3 text-center tracking-[0.4em] font-mono text-2xl rounded-xl bg-white/[0.06] border border-white/10 text-white placeholder-white/20 focus:outline-none focus:border-[#0A84FF] focus:ring-1 focus:ring-[#0A84FF] transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              className="w-full py-2.5 px-4 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-[#0A84FF] to-[#0071E3] hover:brightness-110 active:scale-[0.99] transition-all shadow-md flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Verify & Sign In</span>}
            </button>

            <div className="pt-2 text-center space-y-2">
              <button
                type="button"
                onClick={() => {
                  setErrorMessage('');
                  setStep('recovery');
                }}
                className="text-[11px] text-white/60 hover:text-white underline decoration-white/30 transition-colors"
              >
                Lost your phone? Use an emergency recovery code
              </button>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage('');
                    setStep('credentials');
                  }}
                  className="text-[11px] text-white/40 hover:text-white transition-colors"
                >
                  ← Back to email sign in
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Step 2 Alternative: Emergency Recovery Code */}
        {step === 'recovery' && (
          <form onSubmit={handleRecoverySubmit} className="space-y-4">
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-center mb-2">
              <Key className="w-6 h-6 text-[#FF9F0A] mx-auto mb-1.5" />
              <div className="text-xs font-semibold text-white">Emergency Recovery Code</div>
              <div className="text-[11px] text-white/60 mt-0.5">
                Enter one of your 8 one-time backup codes
              </div>
            </div>

            <div>
              <input
                type="text"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                required
                autoFocus
                className="w-full py-2.5 text-center font-mono text-base rounded-xl bg-white/[0.06] border border-white/10 text-white placeholder-white/20 focus:outline-none focus:border-[#FF9F0A] focus:ring-1 focus:ring-[#FF9F0A] transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading || recoveryCode.trim().length < 8}
              className="w-full py-2.5 px-4 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-[#FF9F0A] to-[#FF8000] hover:brightness-110 active:scale-[0.99] transition-all shadow-md flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Redeem Recovery Code</span>}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setErrorMessage('');
                  setStep('totp');
                }}
                className="text-[11px] text-white/60 hover:text-white underline decoration-white/30 transition-colors"
              >
                ← Use authenticator app instead
              </button>
            </div>
          </form>
        )}

        {/* Footer Notice */}
        <div className="mt-8 pt-4 border-t border-white/[0.08] text-center">
          <span className="text-[10.5px] text-white/40">
            Internal authorized personnel only. Signups are closed.
          </span>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden bg-[#070913] text-white">
      {/* Background Animated Glow Mesh */}
      <div className="apple-mesh-bg" />

      <Suspense fallback={
        <div className="w-full max-w-md h-96 rounded-3xl bg-white/[0.04] border border-white/10 animate-pulse flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-white/40" />
        </div>
      }>
        <LoginContent />
      </Suspense>
    </div>
  );
}
