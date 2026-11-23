import { createRoot } from 'react-dom/client';
import { Journal } from './pages/Journal';
import { SmartHome } from './pages/SmartHome';
import { Header } from './components/Header';
import './style.css';

const smartHome = window.location.pathname === '/smart-home';
createRoot(document.getElementById('root')!).render(<><Header smartHome={smartHome} />{smartHome ? <SmartHome /> : <Journal />}</>);
