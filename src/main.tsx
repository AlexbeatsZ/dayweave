import { createRoot } from 'react-dom/client';
import { App } from './App';
import { store } from './store';
import './styles.css';
import './dayweave.css';
import './phone/phone.css';
import './desktop.css';
import { initializeTheme } from './theme';
import { initializeMobile, startMobileSync } from './mobile';

initializeTheme();
createRoot(document.getElementById('root')!).render(<App />);
void initializeMobile()
  .then(() => store.initialize())
  .then(startMobileSync);
