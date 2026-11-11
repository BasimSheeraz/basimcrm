'use client';

import React from 'react';
import { AppProvider } from '@/lib/store';

export function Providers({ children }: { children: React.ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}
