import { Suspense } from 'react';
import { SmartHome } from '@/components/screens/SmartHome';
export default function Page() {
  return (
    <Suspense fallback={<p className="wrap">Загрузка…</p>}>
      <SmartHome />
    </Suspense>
  );
}
