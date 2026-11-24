import { createRoot } from 'react-dom/client';
import { Header } from './components/Header';
import { Journal } from './pages/Journal';
import { SmartHome } from './pages/SmartHome';
import './style.css';

const smartHome = window.location.pathname === '/smart-home';
const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing');
createRoot(root).render(
  <>
    <Header smartHome={smartHome} />
    {smartHome ? <SmartHome /> : <Journal />}
  </>,
);
