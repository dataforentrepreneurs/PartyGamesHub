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
  // If running on Android/TV (Native Capacitor), ALWAYS use production domain
  if (isNative) {
    return 'play.d4e.ai';
  }

  // Only use localhost if we are in a desktop browser for development (Vite usually uses 5173)
  if (currentHost && (currentHost.includes('localhost:5173') || currentHost.includes('127.0.0.1:5173'))) {
    return 'localhost:8000';
  }

  // Fallback for everything else (Native, TV, or Production)
  return 'play.d4e.ai';
};

let memoryStorage: Record<string, string> = {};

function safeGetItem(key: string) {
  try {
    return localStorage.getItem(key) || memoryStorage[key] || null;
  } catch (e) {
    return memoryStorage[key] || null;
  }
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn("localStorage blocked, using memory.");
  }
  memoryStorage[key] = value;
}

function generatePlayerId() {
  const existing = safeGetItem('cc_player_id');
  if (existing) return existing;
  const newId = Math.random().toString(36).substring(2, 9);
  safeSetItem('cc_player_id', newId);
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
  const [playerName, setPlayerName] = useState(safeGetItem('cc_player_name') || '');
  const [playerId, setPlayerId] = useState(generatePlayerId());
  const playerIdRef = useRef(playerId); // CRITICAL: Ref for WebSocket closure
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isHostUser, setIsHostUser] = useState(false);

  useEffect(() => {
    if (isHostUser) {
      document.documentElement.classList.add('host-mode');
    } else {
      document.documentElement.classList.remove('host-mode');
    }
    return () => {
      document.documentElement.classList.remove('host-mode');
    };
  }, [isHostUser]);
  const [isConnected, setIsConnected] = useState(false);
  const [errorTiles, setErrorTiles] = useState<Set<number>>(new Set());
  const [isInviteLink, setIsInviteLink] = useState(false);

  const ws = useRef<WebSocket | null>(null);

  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  const basePath = import.meta.env.BASE_URL;
  const tutorialData = [
    { img: `${basePath}host1_createroom.png`, title: 'Create a Game', text: 'One person acts as the Host. Click "Create Room" on a TV, Projector or Laptop to start.' },
    { img: `${basePath}Player1_joinroom.png`, title: 'Join the Lobby', text: 'Players scan the QR code or enter the Room Code on their phones to join.' },
    { img: `${basePath}host2_lobby.png`, title: 'Choose Teams', text: 'Players divide into Blue and Pink teams. The Host selects the game mode.' },
    { img: `${basePath}host3_captain_gamemode.png`, title: 'Assign Captains', text: 'The Host assigns 1 active Captain per team to give clues for the round.' },
    { img: `${basePath}Player2_captainclue.png`, title: 'The Captain\'s Clue', text: 'Captains receive their turn and give a ONE-WORD clue with the total number of images linked to that clue, to guide their team to correctly guess the tiles.' },
    { img: `${basePath}host4_reveal.png`, title: 'Voting and Revealing', text: 'The team discusses and votes for the tiles. Guess right to keep going, but beware the Assassin!' },
    { img: `${basePath}host5_chanceover.png`, title: 'Next Round', text: 'On the first wrong reveal the turn ends. First team to reveal all their tiles wins!' }
  ];

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
      setIsInviteLink(true);
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

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (ws.current && ws.current.readyState !== WebSocket.OPEN && roomCode && playerId) {
          console.log("Tab became visible, WebSocket is dead. Reconnecting...");
          connectWebSocket(roomCode, playerId);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [roomCode, playerId]);

  useEffect(() => {
    const handlePopState = () => {
      if (viewRef.current !== 'landing') {
        window.history.pushState(null, '', window.location.href);
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (viewRef.current !== 'landing') {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

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
        alert("Invalid Room Code! Please try again.");
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
      safeSetItem('cc_player_id', data.host_id);
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
    safeSetItem('cc_player_name', playerName);
    connectWebSocket(roomCode);
  };

  const handleSelectTeam = (team: 'blue' | 'pink' | null) => {
    ws.current?.send(JSON.stringify({ event: 'update_team', team }));
  };

  const handleStartGame = () => {
    const bluePlayers = Object.entries(gameState?.players || {}).filter(([_, p]) => p.team === 'blue');
    const pinkPlayers = Object.entries(gameState?.players || {}).filter(([_, p]) => p.team === 'pink');

    if (bluePlayers.length > 0 && !gameState?.blue_captain) {
      alert("Please assign a Captain for the Blue Team before starting!");
      return;
    }
    if (pinkPlayers.length > 0 && !gameState?.pink_captain) {
      alert("Please assign a Captain for the Pink Team before starting!");
      return;
    }
    if (bluePlayers.length === 0 && pinkPlayers.length === 0) {
      alert("No players have joined the teams yet!");
      return;
    }

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
          <h1 className="title-giant">CodePic</h1>
          <p className="subtitle">Picture Wars: Blue vs Pink</p>
        </div>
        <div className="glass-panel" style={{ maxWidth: '480px', width: '100%', padding: '2.5rem' }}>
          <input
            className="subtitle"
            style={{ width: '100%', padding: '1.2rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '12px', color: 'white', fontSize: '1.2rem', marginBottom: '1.2rem' }}
            placeholder="Your Name"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
          />
          {!isInviteLink && (
            <button className="btn btn-primary" style={{ width: '100%', marginBottom: '1.2rem', padding: '1.2rem', fontSize: '1.25rem' }} onClick={handleCreateRoom}>
              <Play size={22} /> Create Room
            </button>
          )}
          <div className="input-group" style={{ marginBottom: '1.2rem', gap: '12px' }}>
            <input
              className="subtitle"
              style={{ flex: 1, padding: '1.2rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '12px', color: 'white', margin: 0, fontSize: '1.2rem' }}
              placeholder="Room Code"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
            />
            <button className="btn btn-secondary" style={{ padding: '1.2rem 2rem', fontSize: '1.2rem' }} onClick={handleJoinRoom}>Join</button>
          </div>
          <button className="btn btn-secondary" onClick={() => { setTutorialStep(0); setShowTutorial(true); }} style={{ width: '100%', background: 'rgba(255,255,255,0.1)', marginTop: '8px', padding: '1.2rem', fontSize: '1.2rem' }}>
            ❓ How to Play
          </button>
        </div>

        {showTutorial && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(5px)' }}>
            <div className="glass-panel" style={{ maxWidth: '400px', width: '90%', padding: '24px', position: 'relative', textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
              <button onClick={() => setShowTutorial(false)} style={{ position: 'absolute', top: '12px', right: '12px', background: 'transparent', border: 'none', color: 'white', fontSize: '2rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
              <h2 className="title" style={{ fontSize: '1.8rem', marginBottom: '16px', color: 'var(--blue-team)' }}>How to Play</h2>
              <img src={tutorialData[tutorialStep].img} alt="Tutorial Step" style={{ width: '100%', height: 'auto', borderRadius: '12px', marginBottom: '16px', border: '2px solid rgba(255,255,255,0.1)' }} />
              <h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', marginBottom: '8px' }}>{tutorialData[tutorialStep].title}</h3>
              <p style={{ fontSize: '1rem', opacity: 0.8, marginBottom: '24px', minHeight: '60px' }}>{tutorialData[tutorialStep].text}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <button className="btn btn-secondary" disabled={tutorialStep === 0} onClick={() => setTutorialStep(prev => prev - 1)} style={{ padding: '8px 16px', fontSize: '0.9rem', width: 'auto', opacity: tutorialStep === 0 ? 0.3 : 1 }}>Back</button>
                <span style={{ opacity: 0.5, fontWeight: 'bold' }}>{tutorialStep + 1} / {tutorialData.length}</span>
                {tutorialStep < tutorialData.length - 1 ? (
                  <button className="btn btn-primary" onClick={() => setTutorialStep(prev => prev + 1)} style={{ padding: '8px 16px', fontSize: '0.9rem', width: 'auto' }}>Next</button>
                ) : (
                  <button className="btn btn-primary" onClick={() => setShowTutorial(false)} style={{ padding: '8px 16px', fontSize: '0.9rem', width: 'auto' }}>Got it!</button>
                )}
              </div>
            </div>
          </div>
        )}

        <a
          href="mailto:feedback@partygameshub.com"
          style={{ marginTop: '24px', opacity: 0.6, fontSize: '0.9rem', color: 'white', textDecoration: 'underline' }}
        >
          Report Issue or Send Feedback
        </a>
      </div>
    );
  }

  if (view === 'lobby') {
    return (
      <div className="app-container">
        {isHostUser && (
          <button 
            onClick={() => window.location.href = '/'}
            className="hub-btn"
          >
            🏠 Hub
          </button>
        )}
        {isHostUser ? (
          <div className="glass-panel" style={{ textAlign: 'center', marginBottom: '1rem', padding: '20px', display: 'flex', flexDirection: 'column' }}>
            <div className="lobby-connection-row">
              {/* Left Column: QR Code */}
              <div className="lobby-qr-column">
                <div className="lobby-qr-wrapper">
                  <QRCodeSVG value={backendConfig.getJoinUrl(roomCode)} size={220} />
                </div>
                <p className="lobby-qr-label">Scan to Join</p>
              </div>

              {/* Right Column: Lobby Info + How to Play */}
              <div className="lobby-info-column">
                <div className="lobby-info-header">
                  <h1>LOBBY</h1>
                  <h2>Room Code: <span style={{ color: 'var(--blue-team)' }}>{roomCode}</span></h2>
                </div>
                <div className="lobby-instructions">
                  <h3 className="lobby-instructions-title">How to Play</h3>
                  <ol className="lobby-instructions-list">
                    <li>Scan the QR code to join a team on your phone.</li>
                    <li>Wait for the Host to set modes and hit 'Start Game'.</li>
                    <li>Follow the team Captain's clues to click the right pictures!</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <h1 className="title-giant">Lobby</h1>
            <p className="subtitle">Room Code: <span style={{ color: 'var(--blue-team)', fontWeight: '900' }}>{roomCode}</span></p>
          </>
        )}
        <div className="glass-panel" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <h2>Blue Team</h2>
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
            <h2>Pink Team</h2>
            <button className="btn btn-secondary" style={{ margin: '1rem 0' }} onClick={() => handleSelectTeam('pink')}>Join Pink</button>
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
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '1rem', flexWrap: 'nowrap', overflowX: 'auto', width: '100%' }}>
              {(['classic', 'couples', 'movies', 'bollywood_real', 'kids'] as const).map(m => (
                <button
                  key={m}
                  className={`btn ${gameState?.game_mode === m ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '8px 16px', fontSize: '0.85rem', whiteSpace: 'nowrap', flexShrink: 0 }}
                  onClick={() => handleSetMode(m)}
                >
                  {m === 'bollywood_real' ? 'BOOLYWOOD' : m.toUpperCase()}
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
                {gameState?.starting_team_pref === 'blue' ? 'BLUE TEAM' : 'PINK TEAM'}
              </button>
            </div>
          </div>
        )}

        {isHostUser && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
            {(!gameState?.blue_captain || !gameState?.pink_captain) && (
              <div style={{
                color: '#ff4b82',
                fontWeight: 'bold',
                fontSize: '1.1rem',
                padding: '10px 20px',
                background: 'rgba(255, 75, 130, 0.15)',
                borderRadius: '8px',
                border: '1px solid rgba(255, 75, 130, 0.3)',
                textAlign: 'center'
              }}>
                ⚠️ Reminder: Please assign a Captain for both Blue and Pink teams before starting!
              </div>
            )}
            <button 
              className="btn btn-primary" 
              style={{ 
                padding: '1.5rem 4rem', 
                opacity: (!gameState?.blue_captain || !gameState?.pink_captain) ? 0.5 : 1, 
                cursor: (!gameState?.blue_captain || !gameState?.pink_captain) ? 'not-allowed' : 'pointer' 
              }} 
              onClick={handleStartGame}
              disabled={!gameState?.blue_captain || !gameState?.pink_captain}
            >
              Start Game <ArrowRight size={24} />
            </button>
          </div>
        )}
      </div>
    );
  }

  if (view === 'game_over') {
    const winnerName = gameState?.winner === 'blue' ? 'Blue Team' : 'Pink Team';
    const winnerColor = gameState?.winner === 'blue' ? 'var(--blue-team)' : 'var(--pink-team)';

    return (
      <div className="app-container">
        {isHostUser && (
          <button 
            onClick={() => window.location.href = '/'}
            className="hub-btn"
          >
            🏠 Hub
          </button>
        )}
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
      {isHostUser && (
        <button 
          onClick={() => window.location.href = '/'}
          className="hub-btn"
        >
          🏠 Hub
        </button>
      )}
      {/* Game HUD Header */}
      <div className="game-hud-header">
        {/* Column 1: Room Info (Left) */}
        <div className="game-hud-left">
          {isHostUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ background: 'white', padding: '4px', borderRadius: '6px', display: 'flex' }}>
                <QRCodeSVG value={backendConfig.getJoinUrl(roomCode)} size={110} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.75rem', opacity: 0.6, fontWeight: 700, textTransform: 'uppercase' }}>Scan to Join</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'hsla(0,0%,100%,0.8)', marginTop: '2px' }}>{backendConfig.host}/coupleclash</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 900, marginTop: '4px' }}>Code: <span style={{ color: 'var(--blue-team)' }}>{roomCode}</span></div>
              </div>
            </div>
          )}
        </div>

        {/* Column 2: Turn Indicator & Scores (Center stacked) */}
        <div className="game-hud-center">
          <div style={{
            color: gameState?.current_turn === 'blue' ? 'var(--blue-team)' : 'var(--pink-team)',
            fontWeight: 900,
            fontSize: '1.8rem',
            textShadow: '0 0 20px rgba(0,0,0,0.5)',
            lineHeight: 1.1
          }}>
            {gameState?.current_turn.toUpperCase()}'S TURN ({formatTime(elapsed)})
          </div>
          <div style={{ 
            fontSize: '1.3rem', 
            fontWeight: 700,
            color: 'hsla(0,0%,100%,0.8)'
          }}>
            <span style={{ color: 'var(--blue-team)' }}>{gameState?.scores.blue}</span> ({formatTime(gameState?.team_times.blue || 0)})
            {" - "}
            <span style={{ color: 'var(--pink-team)' }}>{gameState?.scores.pink}</span> ({formatTime(gameState?.team_times.pink || 0)})
          </div>
        </div>

        {/* Column 3: Placeholder to balance grid (Right) */}
        <div className="game-hud-right">
          {/* Empty to balance the grid layout */}
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
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <RefreshCw size={64} className="text-primary animate-spin" style={{ color: 'var(--blue-team)', marginBottom: '1rem' }} />
          <h2 style={{ fontSize: '2rem', color: 'white', fontWeight: 'bold', margin: '0' }}>Reconnecting to Server</h2>
          <p style={{ color: 'hsla(0,0%,100%,0.7)', fontSize: '1.2rem', marginTop: '0.5rem' }}>Please wait...</p>
        </div>
      )}
    </div>
  );
}

export default App;
