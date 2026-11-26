import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useJournal } from '../hooks/useJournal';
import type { Interaction } from '../lib/journal';
import { InteractionDetail } from './InteractionDetail';

export function InteractionList({ query }: { query: string }) {
  const { items, loading, hasMore, error, reconnecting, loadMore } = useJournal(query);
  const sentinel = useRef<HTMLDivElement>(null);

  const enabled = hasMore && !loading && !error;
  useEffect(() => observeEnd(sentinel.current, enabled, loadMore), [enabled, loadMore]);

  return (
    <>
      {reconnecting && (
        <p className="connection-notice" role="status">
          Восстанавливаем связь. Новые обращения появятся после подключения.
        </p>
      )}
      <section className="journal-feed" aria-label="Журнал обращений">
        {items.map(renderInteraction)}
      </section>
      {error && (
        <div className="notice error" role="alert">
          {error}{' '}
          <Button type="button" className="retry" onClick={loadMore}>
            Повторить загрузку
          </Button>
        </div>
      )}
      {!loading && !error && !items.length && (
        <p className="notice" role="status">
          По выбранным фильтрам обращений пока нет.
        </p>
      )}
      <div ref={sentinel} className="feed-end">
        {loading && <p role="status">Загрузка обращений…</p>}
        {hasMore && !loading && !error && (
          <Button type="button" className="load-more" onClick={loadMore}>
            Показать ещё
          </Button>
        )}
        {!hasMore && !loading && items.length > 0 && <p>Все обращения загружены</p>}
      </div>
    </>
  );
}

function renderInteraction(interaction: Interaction) {
  return <InteractionDetail key={interaction.id} interaction={interaction} />;
}

function observeEnd(element: HTMLDivElement | null, enabled: boolean, loadMore: () => void) {
  if (!enabled || !element) return;
  const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && loadMore(), {
    rootMargin: '500px',
  });
  observer.observe(element);
  return () => observer.disconnect();
}
