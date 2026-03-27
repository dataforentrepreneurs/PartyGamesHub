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
  const [playerId, setPlayerId] = useState(generatePlayerId());

  const [players, setPlayers] = useState<{ id?: string, name: string, score: number }[]>([]);
  const [prompt, setPrompt] = useState('');
  const [gameMode, setGameMode] = useState('classic');
  const [hostSelectedMode, setHostSelectedMode] = useState('classic');
  const [timeLeft, setTimeLeft] = useState(60);
  const [results, setResults] = useState<any[]>([]);
  const [roundSummary, setRoundSummary] = useState('');
  const [winnerExplanation, setWinnerExplanation] = useState('');
  const [currentRound, setCurrentRound] = useState(0);
  const [maxRounds, setMaxRounds] = useState(10);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [roundDeltas, setRoundDeltas] = useState<Record<string, number>>({});
  const [selectedPlayerHistory, setSelectedPlayerHistory] = useState<any[] | null>(null);
  const [selectedPlayerName, setSelectedPlayerName] = useState<string>('');
  const [isHostUser, setIsHostUser] = useState(false);
  const [showFullGallery, setShowFullGallery] = useState(false);

  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomCode(roomParam.toUpperCase());
      setView('join');
    }
  }, []);

  const connectWebSocket = (code: string, isHost: boolean, overridePlayerId: string) => {
    setIsHostUser(isHost);
    const name = isHost ? "Host" : playerName;
    const socket = new WebSocket(`${WS_BASE}/${code}?player_id=${overridePlayerId}&name=${encodeURIComponent(name)}`);
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
        if (data.current_round !== undefined) setCurrentRound(data.current_round);
        if (data.max_rounds !== undefined) setMaxRounds(data.max_rounds);
        if (data.status === 'waiting') setView(isHost ? 'hostLobby' : 'playerLobby');
      } else if (data.event === 'round_started') {
        setPrompt(data.prompt);
        setGameMode(data.mode || 'classic');
        setTimeLeft(data.duration_seconds || 60);
        if (data.current_round !== undefined) setCurrentRound(data.current_round);
        if (data.max_rounds !== undefined) setMaxRounds(data.max_rounds);
        setSubmissionCount(0);
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
        if (data.current_round !== undefined) setCurrentRound(data.current_round);
        if (data.max_rounds !== undefined) setMaxRounds(data.max_rounds);
        if (data.round_deltas) setRoundDeltas(data.round_deltas);
        
        if (data.current_round !== undefined && data.max_rounds !== undefined && data.current_round >= data.max_rounds && isHost) {
           const sortedLeaderboard = Object.keys(data.leaderboard || {}).map(pid => ({ id: pid, ...data.leaderboard[pid] })).sort((a, b) => b.score - a.score);
           if (sortedLeaderboard.length > 0) {
               setSelectedPlayerName(sortedLeaderboard[0].name);
               socket.send(JSON.stringify({ event: 'get_player_history', player_id: sortedLeaderboard[0].id }));
           }
        }
        
        setView('results');
      } else if (data.event === 'player_history') {
        setSelectedPlayerHistory(data.history);
      } else if (data.event === 'submission_count_update') {
        setSubmissionCount(data.count);
      }
    };
  }

  useEffect(() => {
    if (view === 'drawing' && timeLeft > 0) {
      if (timeLeft <= 10) playTickSound();
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (view === 'drawing' && timeLeft === 0 && isHostUser && ws.current) {
       // Allow mobile clients a brief 3-second grace period to finish and upload their auto-submitted Canvas JPEGs
       const overrideTimer = setTimeout(() => {
           ws.current?.send(JSON.stringify({ event: 'force_judging' }));
       }, 3000);
       return () => clearTimeout(overrideTimer);
    }
  }, [view, timeLeft, isHostUser]);

  const handleCreateRoom = async () => {
    try {
      const res = await fetch(`${API_BASE}/rooms`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      if (!data.room_code) throw new Error("Backend returned empty room_code");
      setRoomCode(data.room_code);
      setPlayerId(data.host_id);
      setPlayerName("Host");
      localStorage.setItem('dj_player_name', "Host");
      connectWebSocket(data.room_code, true, data.host_id);
      setView('hostLobby');
    } catch (e) {
      alert("Failed creating room! Ensure backend is running. " + e);
    }
  };

  const submitJoin = () => {
    if (!roomCode || !playerName) return;
    localStorage.setItem('dj_player_name', playerName);
    connectWebSocket(roomCode, false, playerId);
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
    <div className={isHostUser ? "w-full max-w-6xl px-4" : "max-w-md w-full"}>
      
      {/* Persistent Room Code on Host screen */}
      {isHostUser && view !== 'landing' && view !== 'join' && view !== 'hostLobby' && (
         <div className="glass-panel" style={{ position: 'absolute', top: '16px', left: '16px', padding: '12px 24px', zIndex: 50, border: '2px solid var(--primary)' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Room Code: <span className="text-primary">{roomCode}</span></span>
         </div>
      )}
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

          <div className="flex-row w-full mb-4" style={{ gap: '16px' }}>
            <select className="input-field" value={hostSelectedMode} onChange={e => setHostSelectedMode(e.target.value)} style={{ fontSize: '1rem', padding: '12px', flex: 2 }}>
              <option value="classic">🏆 Classic Mode (60s)</option>
              <option value="speed">⚡ Speed Sketch (15s)</option>
              <option value="blind">🙈 Blind Draw (3s Prompt)</option>
            </select>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <label style={{ fontSize: '0.8rem', color: 'hsla(0,0%,100%,0.7)', marginBottom: '4px', textAlign: 'left' }}>TOTAL ROUNDS</label>
              <input type="number" min="1" max="50" className="input-field" value={maxRounds} onChange={e => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && ws.current) {
                   ws.current.send(JSON.stringify({ event: 'update_settings', max_rounds: val }));
                }
              }} style={{ fontSize: '1rem', padding: '12px' }} />
            </div>
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

      {view === 'drawing' && (
        isHostUser ? (
          <div className="glass-panel text-center animate-slide-up" style={{ padding: '48px', maxWidth: '800px', width: '100%', margin: '0 auto' }}>
            <h2 className={`title-giant mb-4 ${timeLeft <= 10 ? 'text-primary' : ''}`} style={{ fontSize: '4rem', textShadow: '0 0 20px hsla(320,90%,65%,0.3)' }}>
              {timeLeft}s
            </h2>
            <p className="subtitle mb-8" style={{ fontSize: '2.5rem', color: 'white', fontWeight: 800 }}>
              Prompt: "{gameMode === 'blind' ? '???' : prompt}"
            </p>
            <div className="mb-8 p-6" style={{ background: 'rgba(0,0,0,0.5)', borderRadius: '24px', border: '2px solid hsla(0,0%,100%,0.2)' }}>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'white', marginBottom: '8px' }}>RECEIVED</h3>
                <h1 style={{ fontSize: '5rem', fontWeight: 900, color: 'var(--primary)', lineHeight: 1 }}>{submissionCount} / {players.length}</h1>
            </div>
            <p className="subtitle" style={{ color: 'hsla(0,0%,100%,0.7)', fontSize: '1.2rem' }}>Look at your phone to draw!</p>
          </div>
        ) : (
          <DrawCanvas onSubmit={handleDrawSubmit} prompt={prompt} timeLeft={timeLeft} mode={gameMode} />
        )
      )}

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
                    <img src={results[0].image} alt="Winner Drawing" style={{ height: '100%', width: 'auto', aspectRatio: '3/4', objectFit: 'contain', borderRadius: '16px', background: '#1a1f33', border: '2px solid hsla(0,0%,100%,0.2)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }} />
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
                    {r.image && <img src={r.image} alt="Drawing" style={{ width: '80px', height: 'auto', aspectRatio: '3/4', objectFit: 'contain', borderRadius: '8px', background: '#1a1f33', border: '1px solid hsla(0,0%,100%,0.2)' }} />}
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
                    <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                        {myRes.image && <img src={myRes.image} alt="Your Drawing" style={{ width: '100%', maxWidth: '320px', aspectRatio: '3/4', objectFit: 'contain', borderRadius: '16px', marginBottom: '20px', background: '#1a1f33', border: '2px solid hsla(0,0%,100%,0.2)' }} />}
                    </div>
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
                  <button className="btn-primary w-full mt-4" style={{border: '2px solid var(--primary)'}} onClick={() => setView('leaderboard')}>View Leaderboard 🏆</button>
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
                    <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                        {r.image && <img src={r.image} alt="Drawing" style={{ width: '100%', maxWidth: '320px', aspectRatio: '3/4', objectFit: 'contain', borderRadius: '16px', marginBottom: '12px', background: '#1a1f33', border: '2px solid hsla(0,0%,100%,0.2)' }} />}
                    </div>
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
        <div className="glass-panel flex-col w-full text-center animate-slide-up" style={{ position: 'relative' }}>
          {isHostUser && currentRound < maxRounds && (
            <div style={{ position: 'absolute', top: '16px', right: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
               <label style={{ fontSize: '0.8rem', color: 'hsla(0,0%,100%,0.7)' }}>MAX ROUNDS:</label>
               <input type="number" min="1" max="50" className="input-field" value={maxRounds} onChange={e => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && ws.current) {
                     ws.current.send(JSON.stringify({ event: 'update_settings', max_rounds: val }));
                  }
               }} style={{ width: '80px', padding: '6px', fontSize: '1rem' }} />
            </div>
          )}

          <Trophy size={48} className="text-primary mb-4 w-full" style={{ margin: '0 auto' }} />
          <h2 className="title-giant" style={{ fontSize: '2.5rem', marginBottom: '8px' }}>
            {currentRound >= maxRounds ? "FINAL RESULTS" : "LEADERBOARD"}
          </h2>
          <p className="subtitle mb-8" style={{ fontSize: '1.2rem', color: 'hsla(0,0%,100%,0.8)' }}>
            {currentRound >= maxRounds ? "The Ultimate Winner has been crowned!" : `Round ${currentRound} of ${maxRounds}`}
          </p>

          <div className="flex-col mb-8" style={{ gap: '12px' }}>
            {[...players].sort((a, b) => b.score - a.score).map((p, i) => (
              <div key={i} className="flex-row justify-between items-center" 
                onClick={() => {
                   setSelectedPlayerName(p.name);
                   if (ws.current) ws.current.send(JSON.stringify({ event: 'get_player_history', player_id: p.id }));
                }}
                style={{ padding: '16px', background: 'hsla(0,0%,100%,0.05)', borderRadius: '12px', border: i === 0 ? '2px solid var(--primary)' : 'none', position: 'relative', overflow: 'hidden', cursor: 'pointer', transition: 'background 0.2s ease' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'hsla(0,0%,100%,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'hsla(0,0%,100%,0.05)'}
              >
                {currentRound >= maxRounds && i === 0 && (
                   <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(45deg, transparent, hsla(45,100%,50%,0.1), transparent)', animation: 'pulse-glow 2s infinite' }} />
                )}
                
                <span style={{ fontSize: '1.25rem', fontWeight: 800, color: i === 0 ? 'var(--primary)' : 'white', zIndex: 1 }}>
                   {i === 0 && currentRound >= maxRounds && "👑 "}
                   {i + 1}. {p.name}
                </span>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', zIndex: 1 }}>
                  {roundDeltas[p.id || ''] !== undefined && roundDeltas[p.id || ''] > 0 && (
                     <span style={{ color: '#4ade80', fontWeight: 'bold', fontSize: '1.2rem' }}>
                        ↑ +{roundDeltas[p.id || '']}
                     </span>
                  )}
                  <span className="text-primary" style={{ fontSize: '1.5rem', fontWeight: 900 }}>{p.score} pts</span>
                </div>
              </div>
            ))}
          </div>
          {/* Navigation for Players & Hosts */}
          {currentRound < maxRounds && (
              <button className="btn-secondary w-full mb-4" onClick={() => setView('results')}>🔙 Back to Results</button>
          )}

          {isHostUser ? (
             currentRound >= maxRounds ? (
                <button className="btn-secondary" style={{ border: '2px solid var(--primary)' }} onClick={() => {
                   if (ws.current) ws.current.send(JSON.stringify({ event: 'return_to_lobby' }));
                }}>🏆 Return to Lobby for a Rematch</button>
             ) : (
                <button className="btn-primary" onClick={() => {
                   if (ws.current) ws.current.send(JSON.stringify({ event: 'start_round', mode: hostSelectedMode }));
                }}>Next Round</button>
             )
          ) : (
             <p className="subtitle">Waiting for Host...</p>
          )}

          {/* Ultimate Winner Gallery */}
          {currentRound >= maxRounds && isHostUser && selectedPlayerHistory && (
             <div className="glass-panel w-full mt-8 animate-pop-in" style={{ padding: '24px', border: '3px solid var(--primary)', background: 'linear-gradient(145deg, rgba(200,0,100,0.1), transparent)' }}>
                 <h3 className="text-primary" style={{ fontSize: '2.5rem', marginBottom: '16px', textTransform: 'uppercase' }}>
                    {players.sort((a,b) => b.score - a.score)[0]?.name === selectedPlayerName 
                       ? `🏆 ULTIMATE WINNER: ${selectedPlayerName} 🏆` 
                       : `🎨 ${selectedPlayerName}'S SHOWCASE`}
                 </h3>
                 <p className="subtitle mb-6" style={{ color: 'hsla(0,0%,100%,0.8)' }}>A gallery of their masterpieces</p>
                 <div style={{ display: 'flex', overflowX: 'auto', gap: '16px', paddingBottom: '16px', alignItems: 'stretch', textAlign: 'left' }}>
                     {selectedPlayerHistory.map((item, idx) => (
                         <div key={idx} className="glass-panel" style={{ minWidth: '320px', flex: '0 0 auto', padding: '16px', display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.5)' }}>
                             <h4 style={{ fontSize: '1.2rem', marginBottom: '8px', color: 'white' }}>Round {item.round}: {item.prompt}</h4>
                             {item.image && <img src={item.image} alt="Drawing" style={{ width: '100%', maxWidth: '280px', aspectRatio: '3/4', objectFit: 'contain', background: '#1a1f33', borderRadius: '16px', border: '2px solid hsla(0,0%,100%,0.2)', marginBottom: '12px', alignSelf: 'center' }} />}
                             <h4 className="text-primary" style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: '8px' }}>{item.total_score} pts</h4>
                             <div style={{ fontStyle: 'italic', fontSize: '1rem', background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '8px', flex: 1 }}>"{item.comment}"</div>
                         </div>
                     ))}
                 </div>
             </div>
          )}

          {/* History Modal Overlay for manually clicking players */}
          {selectedPlayerHistory && (currentRound < maxRounds || !isHostUser) && (
             <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', flexDirection: 'column', padding: '24px', overflowY: 'auto', alignItems: 'center' }}>
                 <div className="animate-pop-in w-full max-w-4xl">
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                         <h2 className="title-giant text-primary" style={{ fontSize: '2.5rem', margin: 0 }}>{selectedPlayerName}'s History</h2>
                         <button className="btn-secondary" onClick={() => setSelectedPlayerHistory(null)} style={{ padding: '8px 16px', fontSize: '1.2rem' }}>✕ Close</button>
                     </div>
                     <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                         {selectedPlayerHistory.map((item, idx) => (
                             <div key={idx} className="glass-panel flex-col text-left" style={{ padding: '20px' }}>
                                 <h4 style={{ fontSize: '1.2rem', marginBottom: '8px', color: 'white' }}>Round {item.round}: {item.prompt}</h4>
                                 {item.image && <img src={item.image} alt="Drawing" style={{ width: '100%', maxWidth: '250px', aspectRatio: '3/4', objectFit: 'contain', background: '#1a1f33', borderRadius: '16px', border: '2px solid hsla(0,0%,100%,0.2)', marginBottom: '12px', alignSelf: 'center' }} />}
                                 <h4 className="text-primary" style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: '8px' }}>{item.total_score} pts</h4>
                                 
                                 {item.scores && (
                                   <div className="flex-row" style={{ gap: '6px', fontSize: '0.8rem', marginBottom: '12px', flexWrap: 'wrap' }}>
                                     <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '4px 8px', borderRadius: '4px' }}>Rel: {item.scores.prompt_relevance}</span>
                                     <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '4px 8px', borderRadius: '4px' }}>Cre: {item.scores.creativity}</span>
                                     <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '4px 8px', borderRadius: '4px' }}>Cla: {item.scores.clarity}</span>
                                     <span style={{ background: 'hsla(0,0%,100%,0.1)', padding: '4px 8px', borderRadius: '4px' }}>Fun: {item.scores.entertainment}</span>
                                   </div>
                                 )}
                                 
                                 <div style={{ fontStyle: 'italic', fontSize: '1rem', background: 'rgba(0,0,0,0.4)', padding: '12px', borderRadius: '8px' }}>"{item.comment}"</div>
                             </div>
                         ))}
                     </div>
                 </div>
             </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
