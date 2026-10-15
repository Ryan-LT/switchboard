import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './routes/App';
import '@fontsource-variable/figtree';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
