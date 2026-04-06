import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import posthog from 'posthog-js'
import './index.css'
import App from './App.tsx'

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: 'https://eu.i.posthog.com', // US region usually (or eu.posthog.com)
    autocapture: false, // We'll manage captures manually to avoid noise
  });
} else {
  console.warn("VITE_POSTHOG_KEY is not set. Analytics will not be tracked.");
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

