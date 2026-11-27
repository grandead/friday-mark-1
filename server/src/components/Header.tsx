'use client';
import { AudioLines, BookOpen, House, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Header() {
  const path = usePathname();
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
          <Link className="nav" href="/" aria-current={path === '/' ? 'page' : undefined}>
            <BookOpen size={16} />
            Журнал
          </Link>
          <Link
            className="nav"
            href="/smart-home"
            aria-current={path === '/smart-home' ? 'page' : undefined}
          >
            <House size={16} />
            Умный дом
          </Link>
          <Link className="nav" href="/tasks" aria-current={path === '/tasks' ? 'page' : undefined}>
            <ListChecks size={16} />
            Задачи
          </Link>
        </nav>
      </div>
    </header>
  );
}
