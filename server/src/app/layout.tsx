import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Header } from '@/components/Header';
import './shadcn.css';
import './style.css';
export const metadata: Metadata = { title: 'Пятница', description: 'Домашний голосовой помощник' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
