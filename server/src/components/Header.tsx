'use client';
import { AudioLines, BookOpen, House } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Header() {
  const smartHome = usePathname() === '/smart-home';
  return (
    <header className="mast">
      <div className="wrap mast-inner">
        <Link className="brand" href="/" aria-label="Пятница — журнал">
          <i>
            <AudioLines />
          </i>
          Пятница
        </Link>
        <nav className="main-nav" aria-label="Основная навигация">
          <Link className="nav" href="/" aria-current={!smartHome ? 'page' : undefined}>
            <BookOpen size={16} />
            Журнал
          </Link>
          <Link className="nav" href="/smart-home" aria-current={smartHome ? 'page' : undefined}>
            <House size={16} />
            Умный дом
          </Link>
        </nav>
      </div>
    </header>
  );
}
