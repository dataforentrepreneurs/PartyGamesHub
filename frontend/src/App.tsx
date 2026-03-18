import { useState, useEffect, useRef } from 'react';
import { Palette, Play, Users, ArrowLeft, Loader2, Crown, Trophy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import DrawCanvas from './DrawCanvas';

const API_BASE = 'http://localhost:8000/api';
const WS_BASE = 'ws://localhost:8000/ws/rooms';

function generatePlayerId() {
  const existing = localStorage.getItem('dj_player_id');
  if (existing) return existing;
  const newId = Math.random().toString(36).substring(2, 9);
  localStorage.setItem('dj_player_id', newId);
  return newId;
}

function App() {
  const [view, setView] = useState<'landing'|'join'|'hostLobby'|'playerLobby'|'drawing'|'judging'|'results'|'leaderboard'>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState(localStorage.getItem('dj_player_name') || '');
  const [playerId] = useState(generatePlayerId());
  
  const [players, setPlayers] = useState<{id?: string, name: string, score: number}[]>([]);
  const [prompt, setPrompt] = useState('');
  const [gameMode, setGameMode] = useState('classic');
  const [hostSelectedMode, setHostSelectedMode] = useState('classic');
  const [timeLeft, setTimeLeft] = useState(60);
  const [results, setResults] = useState<any[]>([]);
  const [isHostUser, setIsHostUser] = useState(false);
  
  const ws = useRef<WebSocket | null>(null);

  const connectWebSocket = (code: string, isHost: boolean) => {
    setIsHostUser(isHost);
    const name = isHost ? "Host" : playerName;
    const socket = new WebSocket(`${WS_BASE}/${code}?player_id=${playerId}&name=${encodeURIComponent(name)}`);
    ws.current = socket;
    
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
        setResults(data.results);
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
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [view, timeLeft]);

  const handleCreateRoom = async () => {
    try {
      const res = await fetch(`${API_BASE}/rooms`, { method: 'POST' });
      const data = await res.json();
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
    <div className="max-w-md w-full">
      {view === 'landing' && (
        <div className="flex-col animate-float">
          <div className="text-center mb-8">
            <div className="flex-row justify-center mb-4"><Palette size={64} className="text-primary" /></div>
            <h1 className="title-giant">DRAW<br/>JUDGE</h1>
            <p className="subtitle">Draw. Submit. Let AI decide.</p>
          </div>
          <div className="glass-panel flex-col">
            <button className="btn-primary" onClick={handleCreateRoom} style={{animation: 'pulse-glow 2s infinite'}}><Play size={24} /> Create Game</button>
            <button className="btn-secondary" onClick={() => setView('join')}><Users size={24} /> Join Room</button>
          </div>
        </div>
      )}

      {view === 'join' && (
        <div className="glass-panel flex-col">
          <button className="btn-secondary" style={{width: 'auto', alignSelf: 'flex-start', padding: '8px 12px', marginBottom: '16px'}} onClick={() => setView('landing')}><ArrowLeft size={20} /> Back</button>
          <h2 className="title-giant" style={{fontSize: '3rem'}}>JOIN</h2>
          <input type="text" className="input-field mb-4" placeholder="ROOM CODE" maxLength={6} value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} />
          <input type="text" className="input-field mb-8" placeholder="YOUR NAME" maxLength={12} value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
          <button className="btn-primary" onClick={submitJoin} disabled={!roomCode || !playerName}>Enter Lobby</button>
        </div>
      )}

      {view === 'hostLobby' && (
        <div className="glass-panel flex-col items-center">
          <h2 className="title-giant" style={{fontSize: '2.5rem', marginBottom: '4px'}}>ROOM CODE</h2>
          <h1 className="title-giant" style={{fontSize: '4rem', color: 'var(--primary)', textShadow: '0 0 20px hsla(320,90%,65%,0.5)'}}>{roomCode}</h1>
          <div className="mb-4 mt-2 p-4" style={{background: 'white', borderRadius: '16px'}}>
            <QRCodeSVG value={`http://localhost:5173/?room=${roomCode}`} size={160} />
          </div>
          
          <div className="flex-row w-full mb-4">
            <select className="input-field" value={hostSelectedMode} onChange={e => setHostSelectedMode(e.target.value)} style={{fontSize: '1rem', padding: '12px', flex: 1}}>
              <option value="classic">🏆 Classic Mode (60s)</option>
              <option value="speed">⚡ Speed Sketch (15s)</option>
              <option value="blind">🙈 Blind Draw (3s Prompt)</option>
            </select>
          </div>
          
          <div className="flex-col w-full mb-8 pt-4" style={{borderTop: '1px solid hsla(0,0%,100%,0.1)'}}>
            <p className="subtitle" style={{marginBottom: '8px', fontSize: '0.9rem'}}>PROMPT PACKS</p>
             <button className="btn-secondary" style={{padding: '8px', fontSize: '1rem'}}>Standard Library (Free)</button>
             <button className="btn-secondary" style={{padding: '8px', fontSize: '1rem', opacity: 0.5}} disabled>NSFW Pack (DLC 🔒)</button>
             <button className="btn-secondary" style={{padding: '8px', fontSize: '1rem', opacity: 0.5}} disabled>Office Jobs (DLC 🔒)</button>
          </div>

          <div className="w-full text-center mb-8">
            <p className="subtitle mb-2">Players Joined ({players.length}):</p>
            <div className="flex-row justify-center" style={{flexWrap: 'wrap', gap: '8px'}}>
              {players.map((p, i) => <span key={i} style={{background: 'hsla(0,0%,100%,0.1)', padding: '4px 12px', borderRadius: '16px'}}>{p.name}</span>)}
            </div>
          </div>
          <button className="btn-primary w-full" onClick={handleStartGame}>Start Round</button>
        </div>
      )}

      {view === 'playerLobby' && (
        <div className="glass-panel flex-col text-center">
          <h2 className="title-giant" style={{fontSize: '2.5rem'}}>CONNECTED</h2>
          <p className="subtitle">Waiting for Host to start the game...</p>
        </div>
      )}

      {view === 'drawing' && (<DrawCanvas onSubmit={handleDrawSubmit} prompt={prompt} timeLeft={timeLeft} mode={gameMode} />)}

      {view === 'judging' && (
        <div className="flex-col items-center justify-center h-full text-center">
          <Loader2 size={64} className="text-primary mb-4" style={{animation: 'spin 2s linear infinite'}} />
          <h2 className="title-giant" style={{fontSize: '2.5rem'}}>JUDGING...</h2>
          <p className="subtitle">The AI is contemplating your masterpieces.</p>
        </div>
      )}

      {view === 'results' && (
        <div className="flex-col w-full text-center">
          <div className="glass-panel text-center mb-4 pt-8">
            <Crown size={48} className="text-primary mb-2 w-full" style={{margin: '0 auto'}} />
            <h2 className="title-giant" style={{fontSize: '2.5rem'}}>RESULTS</h2>
          </div>
          <div className="flex-col" style={{gap: '16px'}}>
            {results.map((r, i) => {
              const player = players.find(p => p.id === r.submission_id) || { name: 'Unknown' };
              return (
                <div key={i} className="glass-panel text-left" style={{padding: '24px', position: 'relative'}}>
                  {i === 0 && (<div style={{position: 'absolute', top: '-15px', right: '-15px', background: 'var(--primary)', color: 'white', padding: '8px 16px', borderRadius: '20px', fontWeight: 900}}>WINNER</div>)}
                  <div className="flex-row justify-between mb-2">
                    <h3 style={{fontSize: '1.5rem', fontWeight: 800, color: i===0?'var(--primary)':'white'}}>{player.name}</h3>
                    <h3 className="text-primary" style={{fontSize: '1.5rem', fontWeight: 900}}>{r.total_score} pts</h3>
                  </div>
                  <div className="flex-row justify-between mb-4" style={{fontSize: '0.85rem', color: 'hsla(0,0%,100%,0.6)', fontWeight: 600}}>
                    <span>Match: {r.scores.prompt_relevance}</span>
                    <span>Creative: {r.scores.creativity}</span>
                    <span>Clarity: {r.scores.clarity}</span>
                    <span>Fun: {r.scores.entertainment}</span>
                  </div>
                  <div style={{background: 'rgba(0,0,0,0.4)', padding: '16px', borderRadius: '12px', fontStyle: 'italic', color: 'hsla(0,0%,100%,0.9)'}}>"{r.comment}"</div>
                </div>
              );
            })}
          </div>
          <button className="btn-primary mt-8" onClick={() => setView('leaderboard')}>View Leaderboard</button>
        </div>
      )}

      {view === 'leaderboard' && (
        <div className="glass-panel flex-col w-full text-center">
          <Trophy size={48} className="text-primary mb-4 w-full" style={{margin: '0 auto'}} />
          <h2 className="title-giant mb-8" style={{fontSize: '2.5rem'}}>LEADERBOARD</h2>
          <div className="flex-col mb-8" style={{gap: '12px'}}>
            {[...players].sort((a,b) => b.score - a.score).map((p, i) => (
                <div key={i} className="flex-row justify-between items-center" style={{padding: '16px', background: 'hsla(0,0%,100%,0.05)', borderRadius: '12px', border: i===0?'1px solid var(--primary)':'none'}}>
                   <span style={{fontSize:'1.25rem', fontWeight: 800, color: i===0?'var(--primary)':'white'}}>{i+1}. {p.name}</span>
                   <span className="text-primary" style={{fontSize: '1.25rem', fontWeight: 900}}>{p.score} pts</span>
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
