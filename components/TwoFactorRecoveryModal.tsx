'use client';

import React, { useState } from 'react';
import { Shield, Key, Copy, Check, Download, X, AlertTriangle } from 'lucide-react';
import { enrollRecoveryCodesAction } from '@/lib/actions/two-factor';

interface TwoFactorRecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TwoFactorRecoveryModal({ isOpen, onClose }: TwoFactorRecoveryModalProps) {
  const [codes, setCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  if (!isOpen) return null;

  const handleGenerateCodes = async () => {
    setLoading(true);
    const res = await enrollRecoveryCodesAction();
    setLoading(false);
    if (res.success && res.recoveryCodes) {
      setCodes(res.recoveryCodes);
    }
  };

  const copyAll = () => {
    navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const downloadText = () => {
    const element = document.createElement('a');
    const file = new Blob([`Basim CRM - 2FA One-Time Recovery Codes\nGenerated: ${new Date().toISOString()}\n\n` + codes.join('\n') + '\n\nKeep these codes in a secure password manager. Each code can only be used once.'], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `basim-crm-recovery-codes-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-lg rounded-2xl bg-black/80 border border-white/15 backdrop-blur-3xl shadow-apple-window p-6 text-white overflow-hidden">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white/95 tracking-tight">Two-Factor Recovery Codes</h2>
              <p className="text-xs text-white/50">One-time backup codes for your account</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {codes.length === 0 ? (
          <div className="py-6 text-center space-y-4">
            <p className="text-xs text-white/70 max-w-sm mx-auto leading-relaxed">
              If you lose access to your authenticator app (TOTP), you can use one of these 8 one-time backup codes to access your account.
            </p>
            <button
              onClick={handleGenerateCodes}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl apple-primary-btn text-xs font-semibold shadow-sm cursor-pointer disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate 8 Backup Codes'}
            </button>
          </div>
        ) : (
          <div className="py-4 space-y-4">
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                These codes are shown <strong>once</strong>. Store them in a secure password manager. Each code can be used exactly once.
              </span>
            </div>

            {/* 8 Codes Grid */}
            <div className="grid grid-cols-2 gap-2 p-3.5 rounded-xl bg-white/[0.04] border border-white/10 font-mono text-xs">
              {codes.map((code, idx) => (
                <div key={idx} className="p-2 rounded-lg bg-black/40 border border-white/5 flex items-center justify-between text-white/90">
                  <span className="text-[10px] text-white/30">{idx + 1}.</span>
                  <span className="font-semibold tracking-wider">{code}</span>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center space-x-2">
                <button
                  onClick={copyAll}
                  className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white/80 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-[#30D158]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy Codes'}</span>
                </button>

                <button
                  onClick={downloadText}
                  className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white/80 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Save as .txt</span>
                </button>
              </div>

              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg apple-primary-btn text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
