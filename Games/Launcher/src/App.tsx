import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Android TV "Back" button often maps to Escape or Backspace in WebViews
      if (e.key === 'Escape' || e.key === 'Backspace') {
        // If we are already on the home screen of the launcher, show confirm
        // Otherwise, the browser back behavior might be okay, but for a single-page launcher, 
        // we want to catch it.
        e.preventDefault();
        setShowExitConfirm(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const go = (path: string) => {
    // Chromecast / Android TV remotes sometimes don't "activate" <a> on DPAD_CENTER.
    // We use a direct location assignment to bypass potential click-blocking.
    console.log(`Navigating to: ${path}`);
    window.location.href = path;
  }

  const onCardKeyDown = (e: React.KeyboardEvent, path: string) => {
    // Standard TV remote "OK/Select" button emits 'Enter'. 
    // We also support ' ' (SpaceBar) as some remotes map to it.
    if (e.key === 'Enter' || e.key === 'NumpadEnter' || e.key === ' ') {
      e.preventDefault();
      go(path);
    }
  }

  return (
    <div className="launcher-container">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', marginBottom: '2rem' }}>
        <img src="/logo.png" alt="Company Logo" style={{ height: '80px', width: 'auto' }} />
        <div style={{ textAlign: 'left' }}>
          <h1 style={{ margin: 0 }}>Party Games Hub</h1>
          <p style={{ margin: 0, opacity: 0.8 }}>Select a game to start playing</p>
        </div>
      </header>

      <main className="cards-grid">
        <a
          href="/drawjudge/"
          className="game-card"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault()
            go('/drawjudge/index.html')
          }}
          onKeyDown={(e) => onCardKeyDown(e, '/drawjudge/index.html')}
        >
          <div className="card-image drawjudge-img">
            <span>🎨</span>
          </div>
          <div className="card-content">
            <h2>Draw Judge</h2>
            <p>An AI-powered drawing competition!</p>
          </div>
        </a>

        <a
          href="/coupleclash/"
          className="game-card"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault()
            go('/coupleclash/index.html')
          }}
          onKeyDown={(e) => onCardKeyDown(e, '/coupleclash/index.html')}
        >
          <div className="card-image coupleclash-img" style={{ background: 'linear-gradient(135deg, var(--blue-team) 0%, var(--pink-team) 100%)' }}>
            <span>🎯</span>
          </div>
          <div className="card-content">
            <h2>Couple Clash</h2>
            <p>Picture Wars: Team-based image guessing!</p>
          </div>
        </a>
      </main>

      {showExitConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="game-card" style={{ padding: '2rem', textAlign: 'center', width: 'auto', border: '1px solid var(--blue-team)' }}>
            <h2>Quit PartyGames Hub?</h2>
            <p style={{ margin: '1rem 0', opacity: 0.8 }}>Are you sure you want to exit to the TV Home Screen?</p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                className="btn-primary"
                style={{ padding: '0.8rem 2rem', background: '#ff4b82' }}
                onClick={() => (window as any).Capacitor?.Plugins?.App?.exitApp()}
              >
                Quit Game
              </button>
              <button
                className="btn-secondary"
                style={{ padding: '0.8rem 2rem' }}
                onClick={() => setShowExitConfirm(false)}
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
