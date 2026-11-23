import { useEffect, useRef } from 'react';
import { useJournal } from '../hooks/useJournal';
import { EntryDetail } from './EntryDetail';

export function EntryList({ query }: { query: string }) {
  const { items, loading, hasMore, error, reconnecting, loadMore } = useJournal(query);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || loading || error || !sentinel.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMore();
    }, { rootMargin: '500px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, loading, error, loadMore]);

  return (
    <>
      {reconnecting && <p className="connection-notice" role="status">Восстанавливаем связь. Новые обращения появятся после подключения.</p>}
      <section className="journal-feed" aria-label="Журнал обращений">
        {items.map(entry => <EntryDetail key={entry.id} entry={entry} />)}
      </section>
      {error && <div className="notice error" role="alert">{error}. <button className="retry" onClick={loadMore}>Повторить загрузку</button></div>}
      {!loading && !error && !items.length && <p className="notice" role="status">По выбранным фильтрам обращений пока нет.</p>}
      <div ref={sentinel} className="feed-end">
        {loading && <p role="status">Загрузка обращений…</p>}
        {hasMore && !loading && !error && <button className="load-more" onClick={loadMore}>Показать ещё</button>}
        {!hasMore && !loading && items.length > 0 && <p>Все обращения загружены</p>}
      </div>
    </>
  );
}
