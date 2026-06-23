import { useState, useEffect } from 'react'
import './App.css'

const getBackendUrl = () => {
  const currentHost = window.location.host;
  
  // Custom Vite environment variable
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl) return envUrl;

  // Render or other production hosts
  if (currentHost && !currentHost.includes('localhost') && !currentHost.startsWith('127.0.0.1')) {
    const protocol = window.location.protocol;
    return `${protocol}//${currentHost}`;
  }

  // Capacitor fallback
  const isNative = (window as any).Capacitor?.isNativePlatform;
  if (isNative) {
    return 'https://play.d4e.ai';
  }

  // Local development
  return 'http://localhost:8000';
};

function App() {
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackType, setFeedbackType] = useState('general');
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Background wake-up for Render server
  useEffect(() => {
    fetch(`${getBackendUrl()}/api/health`)
      .then(res => res.json())
      .then(data => console.log('Server wake-up complete:', data))
      .catch(err => console.log('Server wake-up ping failed (expected if waking from deep sleep):', err));
  }, []);

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
      <header style={{ 
        display: 'flex', 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: '4rem', 
        marginBottom: '2.5rem',
        width: '100%',
        maxWidth: '1000px',
        margin: '0 auto 2.5rem auto'
      }}>
        <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h1 style={{ margin: 0, fontSize: '4.5rem', fontWeight: 900, lineHeight: '1.1' }}>Party Games Hub</h1>
          <p style={{ margin: 0, opacity: 0.8, fontSize: '1.5rem' }}>Select a game to start playing</p>
        </div>
        <img src="/logo.png" alt="Company Logo" style={{ height: '140px', width: 'auto', filter: 'drop-shadow(0 0 15px rgba(243, 156, 18, 0.4))' }} />
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
          style={{ width: '450px' }}
        >
          <div className="card-image drawjudge-img" style={{ height: '250px' }}>
            <span style={{ fontSize: '6rem' }}>🎨</span>
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
          style={{ width: '450px' }}
        >
          <div className="card-image coupleclash-img" style={{ height: '250px', background: 'linear-gradient(135deg, var(--blue-team) 0%, var(--pink-team) 100%)' }}>
            <span style={{ fontSize: '6rem' }}>🎯</span>
          </div>
          <div className="card-content">
            <h2>CodePic</h2>
            <p>Picture Wars: Blue vs Pink Team!</p>
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

      {/* Floating Feedback Trigger Button */}
      <button 
        className="feedback-trigger-btn"
        onClick={() => {
          setSubmitSuccess(false);
          setRating(null);
          setComment('');
          setFeedbackType('general');
          setShowFeedbackModal(true);
        }}
        tabIndex={0}
        aria-label="Give Feedback"
      >
        💬 Give Feedback
      </button>

      {/* Feedback Modal Overlay */}
      {showFeedbackModal && (
        <div className="feedback-modal-overlay" onClick={() => setShowFeedbackModal(false)}>
          <div className="feedback-modal-content" onClick={(e) => e.stopPropagation()}>
            {!submitSuccess ? (
              <>
                <h2>Submit Feedback</h2>
                <p className="subtitle">Tell us what you think or report an issue!</p>
                
                <div className="feedback-form-group">
                  <label htmlFor="feedback-type">Category</label>
                  <select 
                    id="feedback-type"
                    className="feedback-select" 
                    value={feedbackType} 
                    onChange={(e) => setFeedbackType(e.target.value)}
                    tabIndex={0}
                  >
                    <option value="general">💬 General Feedback</option>
                    <option value="bug">🐛 Bug Report</option>
                    <option value="feature">💡 Feature Suggestion</option>
                    <option value="love_it">❤️ Love the App</option>
                  </select>
                </div>

                <div className="feedback-form-group">
                  <label>How would you rate your experience?</label>
                  <div className="rating-emojis">
                    {[
                      { val: 1, char: '😠', label: 'Angry' },
                      { val: 2, char: '🙁', label: 'Sad' },
                      { val: 3, char: '😐', label: 'Neutral' },
                      { val: 4, char: '🙂', label: 'Happy' },
                      { val: 5, char: '😀', label: 'Excited' }
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        className={`rating-emoji-btn ${rating === item.val ? 'active' : ''}`}
                        onClick={() => setRating(item.val)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setRating(item.val);
                          }
                        }}
                        title={item.label}
                        tabIndex={0}
                      >
                        {item.char}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="feedback-form-group">
                  <label htmlFor="feedback-comment">Comments</label>
                  <textarea 
                    id="feedback-comment"
                    className="feedback-textarea" 
                    placeholder="Tell us more about your experience..." 
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    tabIndex={0}
                  />
                </div>

                <div className="modal-actions">
                  <button 
                    className="btn-cancel" 
                    onClick={() => setShowFeedbackModal(false)}
                    tabIndex={0}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn-submit" 
                    onClick={async () => {
                      if (!rating || !comment.trim()) return;
                      setIsSubmitting(true);
                      try {
                        const response = await fetch(`${getBackendUrl()}/api/feedback`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            feedback_type: feedbackType,
                            rating: rating,
                            comment: comment.trim(),
                            game: 'launcher',
                            platform: 'web'
                          })
                        });
                        if (response.ok) {
                          setSubmitSuccess(true);
                        } else {
                          alert('Failed to submit feedback. Please try again.');
                        }
                      } catch (error) {
                        console.error('Error submitting feedback:', error);
                        alert('Network error. Failed to submit feedback.');
                      } finally {
                        setIsSubmitting(false);
                      }
                    }}
                    disabled={!rating || !comment.trim() || isSubmitting}
                    tabIndex={0}
                  >
                    {isSubmitting ? 'Sending...' : 'Submit'}
                  </button>
                </div>
              </>
            ) : (
              <div className="feedback-success-state">
                <span className="success-icon">🚀</span>
                <h2>Thank you!</h2>
                <p style={{ margin: '1rem 0 2rem 0', opacity: 0.8, textAlign: 'center' }}>
                  Your feedback helps us make Party Games Hub even better.
                </p>
                <button 
                  className="btn-submit" 
                  style={{ width: '100%', padding: '0.8rem' }}
                  onClick={() => setShowFeedbackModal(false)}
                  tabIndex={0}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
