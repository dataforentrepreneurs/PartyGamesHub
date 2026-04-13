import { useState, useRef, useEffect } from 'react';
import { Play, Heart, Bomb, ArrowRight, User, X, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import './App.css';

// --- Types ---
interface Tile {
  id: number;
  image: string;
  type: string;
  revealed: boolean;
}

interface Player {
  name: string;
  team: 'blue' | 'pink' | null;
  role: 'host' | 'player';
}

interface GameState {
  room_code: string;
  host_id: string;
  status: string;
  turn_phase: string;
  current_turn: 'blue' | 'pink';
  players: Record<string, Player>;
  blue_captain: string | null;
  pink_captain: string | null;
  board: Tile[];
  clue_word: string | null;
  clue_number: number;
  guesses_remaining: number;
  scores: { blue: number; pink: number };
  max_tiles: { blue: number; pink: number };
  player_presence: Record<string, any>;
  votes: Record<number, string[]>;
  game_mode: string;
  starting_team_pref: string;
  team_times: { blue: number; pink: number };
  turn_started_at: number;
  winner: 'blue' | 'pink' | null;
}

// --- Dynamic Host Configuration ---
const getDynamicHost = () => {
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl) return envUrl;

  const currentHost = window.location.host;
  // If we are running on a standard web host (like Render), use that
  if (currentHost && !currentHost.includes('localhost') && !currentHost.startsWith('127.0.0.1')) {
    return currentHost;
  }

  const isNative = (window as any).Capacitor?.isNativePlatform;
  // If running on Android/TV (Native Capacitor), ALWAYS use Render
  if (isNative) {
    return 'party-games-hub-0qly.onrender.com';
  }

  // Only use localhost if we are in a desktop browser for development (Vite usually uses 5173)
  if (currentHost && (currentHost.includes('localhost:5173') || currentHost.includes('127.0.0.1:5173'))) {
    return 'localhost:8000';
  }

  // Fallback for everything else (Native, TV, or Production)
  return 'party-games-hub-0qly.onrender.com';
};

function generatePlayerId() {
  const existing = localStorage.getItem('cc_player_id');
  if (existing) return existing;
  const newId = Math.random().toString(36).substring(2, 9);
  localStorage.setItem('cc_player_id', newId);
  return newId;
}

function App() {
  const [backendConfig] = useState(() => {
    const host = getDynamicHost();
    const isSecure = !host.includes('localhost') && !host.startsWith('127.0.0.1');
    const protocol = isSecure ? 'https' : 'http';
    const wsProtocol = isSecure ? 'wss' : 'ws';
    return {
      host,
      apiBase: `${protocol}://${host}/api/coupleclash`,
      wsBase: `${wsProtocol}://${host}/ws/coupleclash/rooms`,
      getJoinUrl: (code: string) => {
        const h = host.startsWith('http') ? host : `${protocol}://${host}`;
        return `${h}/coupleclash/?room=${code}`;
      }
    };
  });

  const [view, setView] = useState<'landing' | 'lobby' | 'game' | 'game_over'>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState(localStorage.getItem('cc_player_name') || '');
  const [playerId, setPlayerId] = useState(generatePlayerId());
  const playerIdRef = useRef(playerId); // CRITICAL: Ref for WebSocket closure
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isHostUser, setIsHostUser] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [errorTiles, setErrorTiles] = useState<Set<number>>(new Set());

  const ws = useRef<WebSocket | null>(null);
  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Parse room code from URL on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomCode(roomParam.toUpperCase());
      // No need to set view to join manually as landing has the room input
    }
  }, []);

  // Live Timer Logic - MUST BE AT TOP
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (gameState?.status !== 'LOBBY' && gameState?.status !== 'GAME_OVER' && gameState?.status !== undefined) {
      const interval = setInterval(() => {
        const now = Date.now() / 1000;
        const diff = Math.floor(now - (gameState?.turn_started_at || now));
        setElapsed(diff);
      }, 500);
      return () => clearInterval(interval);
    }
  }, [gameState?.turn_started_at, gameState?.status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // --- WebSocket Logic ---
  const connectWebSocket = (code: string, overrideId?: string) => {
    const activeId = overrideId || playerId;
    const socket = new WebSocket(`${backendConfig.wsBase}/${code}?player_id=${activeId}&name=${encodeURIComponent(playerName)}`);
    ws.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      console.log("DEBUG: WebSocket connected successfully to room:", code);
    };

    socket.onclose = (event) => {
      setIsConnected(false);
      console.log("DEBUG: WebSocket closed. Code:", event.code, "Reason:", event.reason);

      // If room not found (4004), don't retry. Kick back to landing.
      if (event.code === 4004) {
        console.warn("DEBUG: Room not found on server. Reverting to landing page.");
        setRoomCode('');
        setGameState(null);
        setView('landing');
      } else {
        console.log("DEBUG: Socket closed for other reason. Retrying in 3s...");
        setTimeout(() => connectWebSocket(code), 3000);
      }
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("DEBUG: Received message:", data.event);
      if (data.event === 'sync_state' || data.event === 'game_started' || data.event === 'clue_submitted' || data.event === 'tile_revealed' || data.event === 'turn_ended' || data.event === 'game_reset') {
        const newState = data.state;

        setGameState(prev => {
          // If a specific tile's image was updated on the server, clear its local error state
          if (prev && newState) {
            newState.board.forEach((tile: any) => {
              const oldTile = prev.board.find(t => t.id === tile.id);
              if (oldTile && oldTile.image !== tile.image) {
                setErrorTiles(errors => {
                  if (errors.has(tile.id)) {
                    const next = new Set(errors);
                    next.delete(tile.id);
                    return next;
                  }
                  return errors;
                });
              }
            });
          }
          return newState;
        });

        // Prioritize server-sent is_host, fallback to ID comparison using the latest REF
        const amIHost = data.is_host === true || data.state.host_id === playerIdRef.current;
        setIsHostUser(amIHost);

        if (data.state.status === 'LOBBY') setView('lobby');
        else if (data.state.status === 'GAME_OVER') setView('game_over');
        else setView('game');

        if (data.event === 'tile_revealed' && data.result.game_over) {
          confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        }
      } else if (data.event === 'room_update') {
        setGameState(prev => {
          if (!prev) return null;
          const newState = { ...prev, players: data.players };
          if (data.state) {
            // If full state is provided in room_update (e.g. role changes)
            return data.state;
          }
          return newState;
        });
      } else if (data.event === 'votes_updated') {
        setGameState(prev => prev ? { ...prev, votes: data.votes } : null);
      }
    };
  };

  // --- Handlers ---
  const handleCreateRoom = async () => {
    console.log("DEBUG: handleCreateRoom clicked");
    try {
      const url = `${backendConfig.apiBase}/rooms`;
      console.log(`DEBUG: POST calling ${url}`);
      const res = await fetch(url, { method: 'POST' });

      if (!res.ok) {
        throw new Error(`HTTP Error! Status: ${res.status}`);
      }

      const data = await res.json();
      console.log("DEBUG: POST success. Received:", data);

      // CRITICAL: Store the host_id from the server so the WebSocket recognizes us as Host
      localStorage.setItem('cc_player_id', data.host_id);
      setPlayerId(data.host_id);
      playerIdRef.current = data.host_id; // Sync the Ref immediately!

      setRoomCode(data.room_code);
      connectWebSocket(data.room_code, data.host_id);
    } catch (e: any) {
      console.error("DEBUG: handleCreateRoom FAILED:", e);
      const url = `${backendConfig.apiBase}/rooms`;
      alert(`Failed to create room! URL: ${url}. Error: ${e.message || e}`);
    }
  };

  const handleJoinRoom = () => {
    if (!roomCode || !playerName) return;
    localStorage.setItem('cc_player_name', playerName);
    connectWebSocket(roomCode);
  };

  const handleSelectTeam = (team: 'blue' | 'pink' | null) => {
    ws.current?.send(JSON.stringify({ event: 'update_team', team }));
  };

  const handleStartGame = () => {
    ws.current?.send(JSON.stringify({ event: 'start_game', starting_team: 'blue' }));
  };

  const handleSubmitClue = (word: string, number: number) => {
    ws.current?.send(JSON.stringify({ event: 'submit_clue', word, number }));
  };

  const handleRevealTile = (tileId: number) => {
    ws.current?.send(JSON.stringify({ event: 'reveal_tile', tile_id: tileId }));
  };

  const handleVoteTile = (tileId: number) => {
    ws.current?.send(JSON.stringify({ event: 'vote_tile', tile_id: tileId }));
  };

  const handleRerollTile = (tileId: number) => {
    ws.current?.send(JSON.stringify({ event: 'reroll_tile', tile_id: tileId }));
    // Optimistically clear error while waiting for sync
    setErrorTiles(prev => {
      const next = new Set(prev);
      next.delete(tileId);
      return next;
    });
  };

  const handleAssignCaptain = (player_id: string, team: 'blue' | 'pink') => {
    ws.current?.send(JSON.stringify({ event: 'assign_captain', player_id, team }));
  };

  const handleSetMode = (mode: string) => {
    ws.current?.send(JSON.stringify({ event: 'set_game_mode', mode }));
  };

  const handleSetStartingTeam = (team: string) => {
    ws.current?.send(JSON.stringify({ event: 'set_starting_team', team }));
  };

  const handleEndTurn = () => {
    ws.current?.send(JSON.stringify({ event: 'end_turn' }));
  };

  const handleResetGame = () => {
    ws.current?.send(JSON.stringify({ event: 'reset_game' }));
  };

  // --- Render Helpers ---
  if (view === 'landing') {
    return (
      <div className="app-container">
        <div className="animate-float">
          <h1 className="title-giant">Couple Clash</h1>
          <p className="subtitle">Picture Wars: Men vs Women</p>
        </div>
        <div className="glass-panel" style={{ maxWidth: '400px' }}>
          <input
            className="subtitle"
            style={{ width: '100%', padding: '1rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '12px', color: 'white' }}
            placeholder="Your Name"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
          />
          <button className="btn btn-primary" style={{ width: '100%', marginBottom: '1rem' }} onClick={handleCreateRoom}>
            <Play size={20} /> Create Room
          </button>
          <div className="input-group" style={{ marginBottom: '1rem' }}>
            <input
              className="subtitle"
              style={{ flex: 1, padding: '1rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '12px', color: 'white', margin: 0 }}
              placeholder="Room Code"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
            />
            <button className="btn btn-secondary" onClick={handleJoinRoom}>Join</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'lobby') {
    return (
      <div className="app-container">
        <h1 className="title-giant">Lobby</h1>
        <p className="subtitle">Room Code: <span style={{ color: 'var(--blue-team)', fontWeight: '900' }}>{roomCode}</span></p>

        {isHostUser && (
          <div className="glass-panel" style={{ textAlign: 'center', marginBottom: '1.5rem', animation: 'fadeIn 1s' }}>
            <p className="subtitle" style={{ marginBottom: '1rem' }}>Scan to Join or browse to <b>{backendConfig.host}/coupleclash</b></p>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '24px', display: 'inline-block', boxShadow: '0 0 30px rgba(255,255,255,0.1)' }}>
              <QRCodeSVG value={backendConfig.getJoinUrl(roomCode)} size={200} />
            </div>
          </div>
        )}
        <div className="glass-panel" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <h2>Blue Team (Men)</h2>
            <button className="btn btn-primary" style={{ margin: '1rem 0' }} onClick={() => handleSelectTeam('blue')}>Join Blue</button>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {Object.entries(gameState?.players || {}).filter(([_, p]) => p.team === 'blue').map(([id, p]) => (
                <li key={id} style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    {p.name} {id === playerId && '(You)'}
                    {id === gameState?.blue_captain && <span className="badge" style={{ marginLeft: '8px', background: 'var(--blue-team)' }}>Captain</span>}
                  </span>
                  {isHostUser && id !== gameState?.blue_captain && (
                    <button className="btn btn-primary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }} onClick={() => handleAssignCaptain(id, 'blue')}>
                      Make Captain
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <h2>Pink Team (Women)</h2>
            <button className="btn btn-secondary" style={{ margin: '1rem 0' }} onClick={() => handleSelectTeam('pink')}>Join Sassy Pink</button>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {Object.entries(gameState?.players || {}).filter(([_, p]) => p.team === 'pink').map(([id, p]) => (
                <li key={id} style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    {p.name} {id === playerId && '(You)'}
                    {id === gameState?.pink_captain && <span className="badge" style={{ marginLeft: '8px', background: 'var(--pink-team)' }}>Captain</span>}
                  </span>
                  {isHostUser && id !== gameState?.pink_captain && (
                    <button className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }} onClick={() => handleAssignCaptain(id, 'pink')}>
                      Make Captain
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {isHostUser && (
          <div className="glass-panel" style={{ marginTop: '2rem', textAlign: 'center' }}>
            <h2>Host Settings</h2>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {(['classic', 'couples', 'bollywood', 'kids'] as const).map(m => (
                <button
                  key={m}
                  className={`btn ${gameState?.game_mode === m ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.5rem 1rem' }}
                  onClick={() => handleSetMode(m)}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', alignItems: 'center' }}>
              <span>Starting Team: </span>
              <button
                className={`btn ${gameState?.starting_team_pref === 'blue' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.5rem 1rem' }}
                onClick={() => handleSetStartingTeam(gameState?.starting_team_pref === 'blue' ? 'pink' : 'blue')}
              >
                {gameState?.starting_team_pref === 'blue' ? 'MEN (Blue)' : 'WOMEN (Sassy Pink)'}
              </button>
            </div>
          </div>
        )}

        {isHostUser && (
          <button className="btn btn-primary" style={{ marginTop: '2rem', padding: '1.5rem 4rem' }} onClick={handleStartGame}>
            Start Game <ArrowRight size={24} />
          </button>
        )}
      </div>
    );
  }

  if (view === 'game_over') {
    const winnerName = gameState?.winner === 'blue' ? 'Blue Team' : 'Pink Team';
    const winnerColor = gameState?.winner === 'blue' ? 'var(--blue-team)' : 'var(--pink-team)';
    
    return (
      <div className="app-container">
        <div className="animate-float">
          <h1 className="title-giant" style={{ color: winnerColor }}>{winnerName} Wins!</h1>
          <p className="subtitle">Congratulations to the victors!</p>
        </div>
        
        <div className="glass-panel" style={{ maxWidth: '600px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '4rem', marginBottom: '2rem' }}>
            <div>
              <h2 style={{ color: 'var(--blue-team)' }}>Blue</h2>
              <div style={{ fontSize: '3rem', fontWeight: 900 }}>{gameState?.scores.blue}</div>
            </div>
            <div>
              <h2 style={{ color: 'var(--pink-team)' }}>Pink</h2>
              <div style={{ fontSize: '3rem', fontWeight: 900 }}>{gameState?.scores.pink}</div>
            </div>
          </div>
          
          {isHostUser && (
            <button className="btn btn-primary" style={{ padding: '1.5rem 4rem' }} onClick={handleResetGame}>
              Play Again
            </button>
          )}
          {!isHostUser && (
            <p className="subtitle">Waiting for Host to start a new round...</p>
          )}
        </div>
      </div>
    );
  }

  const isMyTurn = gameState?.current_turn === gameState?.players[playerId]?.team;
  const isCaptain = (playerId === gameState?.blue_captain || playerId === gameState?.pink_captain);
  const isHostRole = isHostUser;

  return (
    <div className={`app-container ${isHostUser ? 'host-view' : ''}`}>
      {/* Game HUD Header */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr auto 1fr', 
        alignItems: 'center', 
        width: '100%', 
        maxWidth: '1200px', 
        marginBottom: '1rem',
        padding: '0 1rem'
      }}>
        {/* Column 1: Room Info (Left) */}
        <div style={{ justifySelf: 'start' }}>
          {isHostUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.05)', padding: '6px 12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ background: 'white', padding: '2px', borderRadius: '4px', display: 'flex' }}>
                <QRCodeSVG value={backendConfig.getJoinUrl(roomCode)} size={40} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.6rem', opacity: 0.6, fontWeight: 700 }}>Scan to Join</div>
                <div style={{ fontSize: '1rem', fontWeight: 900 }}>Code: <span style={{ color: 'var(--blue-team)' }}>{roomCode}</span></div>
              </div>
            </div>
          )}
        </div>

        {/* Column 2: Turn Indicator (Center) */}
        <div style={{ 
          color: gameState?.current_turn === 'blue' ? 'var(--blue-team)' : 'var(--pink-team)', 
          fontWeight: 900, 
          fontSize: '1.5rem',
          textAlign: 'center',
          textShadow: '0 0 20px rgba(0,0,0,0.5)'
        }}>
          {gameState?.current_turn.toUpperCase()}'S TURN ({formatTime(elapsed)})
        </div>

        {/* Column 3: Scores (Right) */}
        <div style={{ justifySelf: 'end', textAlign: 'right' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
            <span style={{ color: 'var(--blue-team)' }}>{gameState?.scores.blue}</span> ({formatTime(gameState?.team_times.blue || 0)})
            {" - "}
            <span style={{ color: 'var(--pink-team)' }}>{gameState?.scores.pink}</span> ({formatTime(gameState?.team_times.pink || 0)})
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ textAlign: 'center', marginBottom: '2rem' }}>
        {gameState?.turn_phase === 'WAITING_FOR_CLUE' ? (
          <div>
            <h2 className="subtitle">Waiting for Captain to give a clue...</h2>
            {isMyTurn && isCaptain && (
              <div className="input-group-row" style={{ justifyContent: 'center' }}>
                <input id="clue-word" className="subtitle" style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '12px', padding: '1rem', color: 'white', margin: 0 }} placeholder="One word clue" />
                <input id="clue-num" type="number" className="subtitle" style={{ width: '80px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '12px', padding: '1rem', color: 'white', margin: 0 }} defaultValue={1} />
                <button className="btn btn-primary" onClick={() => handleSubmitClue(
                  (document.getElementById('clue-word') as HTMLInputElement).value,
                  parseInt((document.getElementById('clue-num') as HTMLInputElement).value)
                )}>Send</button>
              </div>
            )}
          </div>
        ) : (
          <div>
            <h2 className="title-giant" style={{ fontSize: '3rem', margin: 0 }}>{gameState?.clue_word} : {gameState?.clue_number}</h2>
            <p className="subtitle" style={{ marginBottom: '1rem' }}>Guesses remaining: {gameState?.guesses_remaining}</p>

            {isHostUser && (
              <button
                className="btn btn-secondary"
                style={{ padding: '0.5rem 1.5rem', fontSize: '1rem', marginTop: '0.5rem' }}
                onClick={handleEndTurn}
              >
                End {gameState?.current_turn.toUpperCase()} Turn
              </button>
            )}
          </div>
        )}
      </div>

      <div className="game-grid">
        {gameState?.board.map(tile => {
          return (
            <div
              key={tile.id}
              className={`tile`}
              onClick={() => {
                const currentRole = isHostRole ? 'Host' : (isCaptain ? 'Captain' : 'Player');
                console.log(`DEBUG: Tile ${tile.id} clicked. role: ${currentRole}, myId: ${playerIdRef.current}, hostId: ${gameState?.host_id}, phase: ${gameState?.turn_phase}`);

                if (tile.revealed) return;

                // TV Host (Creator) reveals
                if (isHostRole) {
                  handleRevealTile(tile.id);
                }
                // Players vote (only if NOT a captain)
                else if (!isCaptain) {
                  handleVoteTile(tile.id);
                } else {
                  console.log("DEBUG: Vote ignored - Captains cannot vote.");
                }
              }}
            >
              <div className="tile-front" style={{ position: 'relative' }}>
                <img
                  src={tile.image}
                  alt="tile"
                  onError={() => setErrorTiles(prev => new Set(prev).add(tile.id))}
                />

                {/* Refresh Overlay for broken images */}
                {errorTiles.has(tile.id) && !tile.revealed && (
                  <div className="refresh-overlay" onClick={(e) => {
                    e.stopPropagation();
                    handleRerollTile(tile.id);
                  }}>
                    <div className="refresh-btn">
                      <RefreshCw size={24} />
                      <span>Refresh</span>
                    </div>
                  </div>
                )}

                {/* Reveal Overlay (80% opaque color) */}
                {tile.revealed && (
                  <div className={`tile-reveal-overlay ${tile.type}`}>
                    {tile.type === 'trap' ? <Bomb size={48} /> : (tile.type === 'neutral' ? <X size={48} /> : <Heart size={48} />)}
                  </div>
                )}

                {/* Vote Indicators (Avatars/Icons) */}
                <div style={{ position: 'absolute', top: 5, right: 5, display: 'flex', flexWrap: 'wrap', gap: '2px', justifyContent: 'flex-end', maxWidth: '60px' }}>
                  {gameState.votes[tile.id]?.map((vid) => (
                    <div key={vid} style={{ background: 'var(--pink-team)', borderRadius: '50%', width: 14, height: 14, fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid white' }}>
                      <User size={10} />
                    </div>
                  ))}
                </div>

                {/* Visual hint for Captain only (bottom bar) */}
                {isCaptain && !tile.revealed && (
                  <div style={{ position: 'absolute', bottom: 5, width: '100%', height: '8px', background: `var(--${tile.type}-team, var(--${tile.type}))`, borderRadius: '4px' }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!isConnected && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: 'red', padding: '1rem', borderRadius: '12px' }}>
          Disconnected. Reconnecting...
        </div>
      )}
    </div>
  );
}

export default App;
