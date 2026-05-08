import type { Metadata } from 'next';
import './globals.css';

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
      <body className="min-h-screen bg-white font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
