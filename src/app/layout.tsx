import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GTO Poker Lab — Texas Hold'em vs 5 AI Paradigms",
  description:
    "Play No-Limit Texas Hold'em against five AI approaches: rule-based expert system, Monte Carlo equity simulation, CFR equilibrium blueprint, Deep CFR advantage network, and Q-learning self-play. Full decision transparency.",
  keywords: ["poker", "Texas Hold'em", "AI", "CFR", "Deep CFR", "reinforcement learning", "Monte Carlo", "game theory", "Nash equilibrium"],
  authors: [{ name: "Cathy Li" }],
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    title: "GTO Poker Lab",
    description: "Texas Hold'em vs 5 AI paradigms — rule-based, Monte Carlo, CFR, Deep CFR, RL",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
