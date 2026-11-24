import { AudioLines, BookOpen, House } from 'lucide-react';

export function Header({ smartHome }: { smartHome: boolean }) {
  return (
    <header className="mast">
      <div className="wrap mast-inner">
        <a className="brand" href="/" aria-label="Пятница — журнал">
          <i>
            <AudioLines />
          </i>
          Пятница
        </a>
        <nav className="main-nav" aria-label="Основная навигация">
          <a className="nav" href="/" aria-current={!smartHome ? 'page' : undefined}>
            <BookOpen size={16} />
            Журнал
          </a>
          <a className="nav" href="/smart-home" aria-current={smartHome ? 'page' : undefined}>
            <House size={16} />
            Умный дом
          </a>
        </nav>
      </div>
    </header>
  );
}
