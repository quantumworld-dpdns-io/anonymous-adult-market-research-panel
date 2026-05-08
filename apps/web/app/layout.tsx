import type { Metadata } from 'next';
import { Crimson_Pro, Inter } from 'next/font/google';
import './globals.css';

const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const fontDisplay = Crimson_Pro({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Anonymous Panel | Market Research',
  description: 'Participate in market research studies with zero-knowledge age verification.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${fontSans.variable} ${fontDisplay.variable} min-h-screen bg-[var(--paper)] font-sans antialiased text-[var(--ink)]`}
      >
        {children}
      </body>
    </html>
  );
}
