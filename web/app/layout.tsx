import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dubai Agents',
  description: 'Domovoy and OWED — operations panel',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans text-[15px] leading-[1.45]">{children}</body>
    </html>
  );
}
