import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './components/AuthGate';
import './index.css';
import { startFilterMarks } from './utils/filterMarks';

startFilterMarks();

// (21 Oct 2026) the app opens only after sign-in with the shared database; it restarts for each person signed in
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthGate>{(profile) => <App key={profile ? profile.user_id : 'local'} profile={profile} />}</AuthGate>
  </ErrorBoundary>
);
