import { useState, useEffect, useRef } from 'react';
import { Play, Users, ArrowLeft, Loader2, Crown, Trophy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import DrawCanvas from './DrawCanvas';
import mainLogo from './assets/gold.svg';

const playTickSound = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) { }
};

const playTadaSound = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc1 = ctx.createOscillator(); const osc2 = ctx.createOscillator(); const osc3 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.frequency.value = 523.25; osc2.frequency.value = 659.25; osc3.frequency.value = 783.99;
    osc1.type = 'triangle'; osc2.type = 'triangle'; osc3.type = 'triangle';
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
    osc1.connect(gain); osc2.connect(gain); osc3.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(); osc2.start(); osc3.start();
    osc1.stop(ctx.currentTime + 1.5); osc2.stop(ctx.currentTime + 1.5); osc3.stop(ctx.currentTime + 1.5);
  } catch (e) { }
};

const isDevServer = window.location.port === '5173' || window.location.port === '3000';
const backendHost = isDevServer ? 'localhost:8000' : window.location.host;
const API_BASE = `${window.location.protocol}//${backendHost}/api`;
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${backendHost}/ws/rooms`;

function generatePlayerId() {
  const existing = localStorage.getItem('dj_player_id');
  if (existing) return existing;
  const newId = Math.random().toString(36).substring(2, 9);
  localStorage.setItem('dj_player_id', newId);
  return newId;
}

function App() {
  const [view, setView] = useState<'landing' | 'join' | 'hostLobby' | 'playerLobby' | 'drawing' | 'judging' | 'results' | 'leaderboard'>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState(localStorage.getItem('dj_player_name') || '');
  const [playerId] = useState(generatePlayerId());

  const [players, setPlayers] = useState<{ id?: string, name: string, score: number }[]>([]);
  const [prompt, setPrompt] = useState('');
  const [gameMode, setGameMode] = useState('classic');
  const [hostSelectedMode, setHostSelectedMode] = useState('classic');
  const [timeLeft, setTimeLeft] = useState(60);
  const [results, setResults] = useState<any[]>([]);
  const [roundSummary, setRoundSummary] = useState('');
  const [winnerExplanation, setWinnerExplanation] = useState('');
  const [isHostUser, setIsHostUser] = useState(false);
  const [showFullGallery, setShowFullGallery] = useState(false);

  const ws = useRef<WebSocket | null>(null);

  const connectWebSocket = (code: string, isHost: boolean) => {
    setIsHostUser(isHost);
    const name = isHost ? "Host" : playerName;
    const socket = new WebSocket(`${WS_BASE}/${code}?player_id=${playerId}&name=${encodeURIComponent(name)}`);
    ws.current = socket;

    // Render/Heroku drop idle sockets after 60s. Heartbeat prevents this perfectly:
    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ event: 'ping' }));
      }
    }, 30000);

    socket.onclose = () => {
      clearInterval(pingInterval);
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.event === 'room_state_update') {
        const playerList = Object.keys(data.players).map(pid => ({ id: pid, ...data.players[pid] }));
        setPlayers(playerList);
      } else if (data.event === 'round_started') {
        setPrompt(data.prompt);
        setGameMode(data.mode || 'classic');
        setTimeLeft(data.duration_seconds || 60);
        setView('drawing');
      } else if (data.event === 'judging_started') {
        setView('judging');
      } else if (data.event === 'results_ready') {
        playTadaSound();
        setResults(data.results);
        setRoundSummary(data.round_summary || '');
        setWinnerExplanation(data.winner_explanation || '');
        setShowFullGallery(false);
        if (data.leaderboard) {
          const playerList = Object.keys(data.leaderboard).map(pid => ({ id: pid, ...data.leaderboard[pid] }));
          setPlayers(playerList);
        }
        setView('results');
      }
    };
  }

  useEffect(() => {
    if (view === 'drawing' && timeLeft > 0) {
      if (timeLeft <= 10) playTickSound();
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [view, timeLeft]);

  const handleCreateRoom = async () => {
    try {
      const res = await fetch(`${API_BASE}/rooms`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      if (!data.room_code) throw new Error("Backend returned empty room_code");
      setRoomCode(data.room_code);
      setPlayerName("Host");
      localStorage.setItem('dj_player_name', "Host");
      connectWebSocket(data.room_code, true);
      setView('hostLobby');
    } catch (e) {
      alert("Failed creating room! Ensure backend is running. " + e);
    }
  };

  const submitJoin = () => {
    if (!roomCode || !playerName) return;
    localStorage.setItem('dj_player_name', playerName);
    connectWebSocket(roomCode, false);
    setView('playerLobby');
  };

  const handleStartGame = () => {
    if (ws.current) {
      ws.current.send(JSON.stringify({ event: 'start_round', mode: hostSelectedMode }));
    }
  };

  const handleDrawSubmit = (dataUrl: string) => {
    if (ws.current) {
      ws.current.send(JSON.stringify({ event: 'submit_drawing', image_data: dataUrl }));
      setView('judging');
    }
  };

  return (
    <div className={(view === 'results' || view === 'hostLobby') && isHostUser ? "w-full max-w-6xl px-4" : "max-w-md w-full"}>
      {view === 'landing' && (
        <div className="flex-col animate-float">
          <div className="text-center mb-8 ">
            <img src={mainLogo} alt="Draw Judge Logo" style={{ width: '100%', maxWidth: '350px', height: 'auto', margin: '0 auto', display: 'block', filter: 'drop-shadow(0 0 20px hsla(45, 100%, 50%, 0.3))' }} />
            <p className="subtitle mt-4">Draw. Submit. Let AI decide.</p>
          </div>
          <div className="glass-panel flex-col">
            <button className="btn-primary" onClick={handleCreateRoom} style={{ animation: 'pulse-glow 2s infinite' }}><Play size={24} /> Create Game</button>
            <button className="btn-secondary" onClick={() => setView('join')}><Users size={24} /> Join Room</button>
          </div>
        </div>
      )}

      {view === 'join' && (
        <div className="glass-panel flex-col">
          <button className="btn-secondary" style={{ width: 'auto', alignSelf: 'flex-start', padding: '8px 12px', marginBottom: '16px' }} onClick={() => setView('landing')}><ArrowLeft size={20} /> Back</button>
          <h2 className="title-giant" style={{ fontSize: '3rem' }}>JOIN</h2>
          <input type="text" className="input-field mb-4" placeholder="ROOM CODE" maxLength={6} value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} />
          <input type="text" className="input-field mb-8" placeholder="YOUR NAME" maxLength={12} value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
          <button className="btn-primary" onClick={submitJoin} disabled={!roomCode || !playerName}>Enter Lobby</button>
        </div>
      )}

      {view === 'hostLobby' && (
        <div className="glass-panel flex-col items-center">
          <h2 className="title-giant" style={{ fontSize: '2.5rem', marginBottom: '4px' }}>ROOM CODE</h2>
          <h1 style={{ fontSize: '4rem', fontWeight: 900, color: 'var(--primary)', textShadow: '0 0 20px hsla(320,90%,65%,0.5)', letterSpacing: '4px' }}>{roomCode}</h1>
          <p className="subtitle" style={{ marginBottom: '0', color: 'hsla(0,0%,100%,0.8)' }}>Open a <b>New Tab</b> and enter this code to Join!</p>
          <div className="mb-4 mt-2 p-4" style={{ background: 'white', borderRadius: '16px' }}>
            <QRCodeSVG value={`${window.location.origin}/?room=${roomCode}`} size={160} />
          </div>

          <div className="flex-row w-full mb-4">
            <select className="input-field" value={hostSelectedMode} onChange={e => setHostSelectedMode(e.target.value)} style={{ fontSize: '1rem', padding: '12px', flex: 1 }}>
              <option value="classic">🏆 Classic Mode (60s)</option>
              <option value="speed">⚡ Speed Sketch (15s)</option>
              <option value="blind">🙈 Blind Draw (3s Prompt)</option>
            </select>
          </div>

          <div className="flex-col w-full mb-8 pt-4" style={{ borderTop: '1px solid hsla(0,0%,100%,0.1)' }}>
            <p className="subtitle" style={{ marginBottom: '8px', fontSize: '0.9rem' }}>PROMPT PACKS</p>
            <button className="btn-secondary" style={{ padding: '8px', fontSize: '1rem' }}>Standard Library (Free)</button>
            <button className="btn-secondary" style={{ padding: '8px', fontSize: '1rem', opacity: 0.5 }} disabled>NSFW Pack (DLC 🔒)</button>
            <button className="btn-secondary" style={{ padding: '8px', fontSize: '1rem', opacity: 0.5 }} disabled>Office Jobs (DLC 🔒)</button>
          </div>

          <div className="w-full text-center mb-8">
            <p className="subtitle mb-2">Players Joined ({players.length}):</p>
            <div className="flex-row justify-center" style={{ flexWrap: 'wrap', gap: '8px' }}>
              {players.map((p, i) => <span key={i} style={{ background: 'hsla(0,0%,100%,0.1)', padding: '4px 12px', borderRadius: '16px' }}>{p.name}</span>)}
            </div>
          </div>
          <button className="btn-primary w-full" onClick={handleStartGame}>Start Round</button>
        </div>
      )}

      {view === 'playerLobby' && (
        <div className="glass-panel flex-col text-center">
          <h2 className="title-giant" style={{ fontSize: '2.5rem' }}>CONNECTED</h2>
          <p className="subtitle">Waiting for Host to start the game...</p>
        </div>
      )}

      {view === 'drawing' && (<DrawCanvas onSubmit={handleDrawSubmit} prompt={prompt} timeLeft={timeLeft} mode={gameMode} />)}

      {view === 'judging' && (
        <div className="flex-col items-center justify-center h-full text-center">
          <Loader2 size={64} className="text-primary mb-4" style={{ animation: 'spin 2s linear infinite' }} />
          <h2 className="title-giant" style={{ fontSize: '2.5rem' }}>JUDGING...</h2>
          <p className="subtitle">The AI is contemplating your masterpieces.</p>
        </div>
      )}

      {view === 'results' && isHostUser && (
        <div className="flex-col w-full text-center animate-pop-in mt-4" style={{ margin: '0 auto', height: '100vh', display: 'flex', flexDirection: 'column' }}>
          <div className="text-center mb-2 pt-2" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2 className="title-giant" style={{ fontSize: '2rem', letterSpacing: '2px', margin: 0 }}>
              <Crown size={28} className="text-primary inline mr-2" style={{ verticalAlign: 'middle', animation: 'pulse-glow 2s infinite' }} />
              ROUND WINNER
            </h2>
            {roundSummary && (
              <p style={{ fontSize: '1.1rem', marginTop: '8px', fontStyle: 'italic', padding: '8px 16px', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', maxWidth: '800px', display: 'inline-block', marginBottom: 0 }}>
                🎭 "{roundSummary}"
              </p>
            )}
          </div>

          <div className="flex-col md:flex-row" style={{ gap: '16px', alignItems: 'stretch', flex: 1, overflow: 'hidden' }}>
            {/* Winner Card */}
            <div className="glass-panel" style={{ flex: 1.5, padding: '16px', border: '3px solid var(--primary)', boxShadow: '0 0 20px hsla(45, 100%, 50%, 0.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--primary)', marginBottom: '12px', textTransform: 'uppercase', textAlign: 'left' }}>
                1st Place: {players.find(p => p.id === results[0]?.submission_id)?.name}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'row', gap: '16px', flex: 1, minHeight: 0 }}>
                {results[0]?.image && (
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 0 }}>
                    <img src={results[0].image} alt="Winner Drawing" style={{ width: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '12px', background: '#fff' }} />
                  </div>
                )}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', overflowY: 'auto', paddingRight: '8px', textAlign: 'left' }}>
                  <h3 className="text-primary" style={{ fontSize: '2.5rem', fontWeight: 900, marginBottom: '12px', lineHeight: '1' }}>{results[0]?.total_score} pts</h3>

                  {/* Score Breakdown Winner */}
                  {results[0]?.scores && (
                    <div className="flex-row" style={{ gap: '8px', flexWrap: 'wrap', marginBottom: '16px', fontSize: '0.85rem' }}>
                      <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '6px 10px', borderRadius: '8px' }}>🎯 Relevance: {results[0].scores.prompt_relevance}</span>
                      <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '6px 10px', borderRadius: '8px' }}>💡 Creativity: {results[0].scores.creativity}</span>
                      <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '6px 10px', borderRadius: '8px' }}>✏️ Clarity: {results[0].scores.clarity}</span>
                      <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '6px 10px', borderRadius: '8px' }}>😂 Fun: {results[0].scores.entertainment}</span>
                    </div>
                  )}

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px', borderRadius: '12px', fontSize: '1.1rem', fontStyle: 'italic', fontWeight: '600', marginBottom: '16px' }}>
                    "{results[0]?.comment}"
                  </div>

                  {winnerExplanation && (
                    <div style={{ background: 'var(--primary)', color: '#000', padding: '12px', borderRadius: '12px', fontSize: '0.95rem', fontWeight: 700 }}>
                      🤖 <strong>AI on why they won:</strong> {winnerExplanation}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Runner Ups List - Scrollable vertically */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', paddingRight: '12px', maxHeight: '100%' }}>
              {results.slice(1).map((r, i) => {
                const player = players.find(p => p.id === r.submission_id) || { name: 'Unknown' };
                return (
                  <div key={i} className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '16px' }}>
                    {r.image && <img src={r.image} alt="Drawing" style={{ width: '100px', height: '100px', objectFit: 'contain', borderRadius: '8px', background: '#fff' }} />}
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <h4 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'white' }}>{player.name}</h4>
                        <h4 className="text-primary" style={{ fontSize: '1.5rem', fontWeight: 900, margin: 0 }}>{r.total_score} pts</h4>
                      </div>

                      {/* Score Breakdown Runner Ups */}
                      {r.scores && (
                        <div className="flex-row" style={{ gap: '6px', fontSize: '0.75rem', marginBottom: '8px', flexWrap: 'wrap' }}>
                          <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '2px 6px', borderRadius: '4px' }}>Relevance {r.scores.prompt_relevance}</span>
                          <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '2px 6px', borderRadius: '4px' }}>Creativity {r.scores.creativity}</span>
                          <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '2px 6px', borderRadius: '4px' }}>Clarity {r.scores.clarity}</span>
                          <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '2px 6px', borderRadius: '4px' }}>Fun {r.scores.entertainment}</span>
                        </div>
                      )}

                      <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '8px', fontSize: '0.9rem', fontStyle: 'italic', color: 'hsla(0,0%,100%,0.9)' }}>
                        "{r.comment}"
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: '16px' }}>
            <button className="btn-primary" style={{ fontSize: '1.25rem', padding: '12px 32px' }} onClick={() => setView('leaderboard')}>View Overall Leaderboard</button>
          </div>
        </div>
      )}

      {view === 'results' && !isHostUser && (
        <div className="flex-col w-full text-center animate-slide-up">
          <div className="glass-panel text-center mb-6 pt-8 pb-8" style={{ border: '2px dashed var(--primary)' }}>
            <h2 className="title-giant" style={{ fontSize: '2rem', marginBottom: '12px' }}>LOOK AT THE SCREEN!</h2>
            <p className="subtitle" style={{ marginBottom: 0 }}>The Host projector is showing everyone's drawings.</p>
          </div>

          {/* Show personal result constrainted view */}
          {!showFullGallery ? (
            <>
              {(() => {
                const myRank = results.findIndex(r => r.submission_id === playerId);
                const myRes = myRank !== -1 ? results[myRank] : null;
                if (!myRes) return null;

                return (
                  <div className="glass-panel text-left" style={{ padding: '24px', marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--primary)', textTransform: 'uppercase', marginBottom: '16px' }}>
                      Your Placement: #{myRank + 1}
                    </h3>
                    {myRes.image && <img src={myRes.image} alt="Your Drawing" style={{ width: '100%', borderRadius: '12px', marginBottom: '20px', background: '#fff' }} />}
                    <div className="flex-row justify-between mb-4">
                      <h3 className="text-primary" style={{ fontSize: '2.5rem', fontWeight: 900, lineHeight: 1 }}>{myRes.total_score} pts</h3>
                    </div>
                    {myRes.scores && (
                      <div className="flex-row" style={{ gap: '8px', flexWrap: 'wrap', marginBottom: '16px', fontSize: '0.85rem' }}>
                        <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '4px 8px', borderRadius: '4px' }}>🎯 Relevance: {myRes.scores.prompt_relevance}</span>
                        <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '4px 8px', borderRadius: '4px' }}>💡 Creativity: {myRes.scores.creativity}</span>
                        <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '4px 8px', borderRadius: '4px' }}>✏️ Clarity: {myRes.scores.clarity}</span>
                        <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '4px 8px', borderRadius: '4px' }}>😂 Fun: {myRes.scores.entertainment}</span>
                      </div>
                    )}
                    <div style={{ background: 'rgba(0,0,0,0.4)', padding: '16px', borderRadius: '12px', fontSize: '1.1rem', fontStyle: 'italic' }}>
                      "{myRes.comment}"
                    </div>
                  </div>
                );
              })()}
              <button className="btn-secondary w-full" onClick={() => setShowFullGallery(true)}>View Full Gallery 🖼️</button>
            </>
          ) : (
            <div className="flex-col animate-slide-up" style={{ gap: '16px', textAlign: 'left', marginTop: '16px' }}>
              <button className="btn-secondary w-full mb-4" onClick={() => setShowFullGallery(false)}><ArrowLeft size={20} style={{ display: 'inline', marginRight: '8px' }} /> Back to My Score</button>
              {results.map((r, i) => {
                const player = players.find(p => p.id === r.submission_id) || { name: 'Unknown' };
                return (
                  <div key={i} className="glass-panel text-left" style={{ padding: '20px', position: 'relative' }}>
                    {i === 0 && <div style={{ position: 'absolute', top: '-12px', right: '-12px', background: 'var(--primary)', color: 'black', padding: '6px 12px', borderRadius: '16px', fontWeight: 900, fontSize: '0.8rem' }}>WINNER</div>}
                    <h4 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '12px', color: i === 0 ? 'var(--primary)' : 'white' }}>
                      {i + 1}. {player.name}
                    </h4>
                    {r.image && <img src={r.image} alt="Drawing" style={{ width: '100%', borderRadius: '8px', marginBottom: '12px', background: '#fff' }} />}
                    <h4 className="text-primary" style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: '8px' }}>{r.total_score} pts</h4>

                    {r.scores && (
                      <div className="flex-row" style={{ gap: '6px', fontSize: '0.8rem', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '2px 6px', borderRadius: '4px' }}>Relevance: {r.scores.prompt_relevance}</span>
                        <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '2px 6px', borderRadius: '4px' }}>Creativity: {r.scores.creativity}</span>
                        <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '2px 6px', borderRadius: '4px' }}>Clarity: {r.scores.clarity}</span>
                        <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '2px 6px', borderRadius: '4px' }}>Fun: {r.scores.entertainment}</span>
                      </div>
                    )}

                    <div style={{ background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '8px', fontSize: '1rem', fontStyle: 'italic', color: 'hsla(0,0%,100%,0.9)' }}>
                      "{r.comment}"
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view === 'leaderboard' && (
        <div className="glass-panel flex-col w-full text-center animate-slide-up">
          <Trophy size={48} className="text-primary mb-4 w-full" style={{ margin: '0 auto' }} />
          <h2 className="title-giant mb-8" style={{ fontSize: '2.5rem' }}>LEADERBOARD</h2>
          <div className="flex-col mb-8" style={{ gap: '12px' }}>
            {[...players].sort((a, b) => b.score - a.score).map((p, i) => (
              <div key={i} className="flex-row justify-between items-center" style={{ padding: '16px', background: 'hsla(0,0%,100%,0.05)', borderRadius: '12px', border: i === 0 ? '1px solid var(--primary)' : 'none' }}>
                <span style={{ fontSize: '1.25rem', fontWeight: 800, color: i === 0 ? 'var(--primary)' : 'white' }}>{i + 1}. {p.name}</span>
                <span className="text-primary" style={{ fontSize: '1.25rem', fontWeight: 900 }}>{p.score} pts</span>
              </div>
            ))}
          </div>
          {isHostUser ? (
            <button className="btn-primary" onClick={() => setView('hostLobby')}>Next Round</button>
          ) : (
            <p className="subtitle">Waiting for Host to start next round...</p>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
