import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Basim CRM - 3-Person Shared Gmail & Outreach Tracker",
  description: "Shared Gmail inbox with automated contact tracking, collision guard, and multi-user support for 3 setups.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full" suppressHydrationWarning>
      <body className="h-full overflow-hidden antialiased select-none font-sans relative" suppressHydrationWarning>
        {/* Apple Style Ambient Mesh Background and Subtle Grain */}
        <div className="apple-mesh-bg" />
        <div className="apple-grain-overlay" />

        {/* Main Application */}
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
