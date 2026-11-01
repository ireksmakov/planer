import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { UpdateWatcher } from './components/UpdateWatcher';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <><UpdateWatcher /><App /></>
  </StrictMode>,
);
