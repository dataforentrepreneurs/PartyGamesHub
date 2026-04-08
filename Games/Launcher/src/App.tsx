import './App.css'

function App() {
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
      <header>
        <h1>PartyGames Hub</h1>
        <p>Select a game to start playing on the TV</p>
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

        <a href="/tambola/" className="game-card empty-card">
          <div className="card-image tambola-img">
            <span>🎱</span>
          </div>
          <div className="card-content">
            <h2>Tambola</h2>
            <p>Coming Soon...</p>
          </div>
        </a>
      </main>
    </div>
  )
}

export default App
