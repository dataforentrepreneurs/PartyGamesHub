import { useState, useRef, useEffect } from 'react';
import { Play, Heart, Bomb, ArrowRight, User, X, RefreshCw, Home, ArrowLeft, MessageSquare, Loader2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import { sound } from './sound_service';
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
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [createRoomCountdown, setCreateRoomCountdown] = useState(60);

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

  const [savedHostSession, setSavedHostSession] = useState<{ roomCode: string; hostId: string } | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Feedback State
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackType, setFeedbackType] = useState('general');
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Check saved host session on mount
  useEffect(() => {
    try {
      const r = safeGetItem('cc_host_room_code');
      const h = safeGetItem('cc_host_id');
      const t = safeGetItem('cc_host_timestamp');
      if (r && h && t) {
        const ageHours = (Date.now() - parseInt(t, 10)) / (1000 * 60 * 60);
        if (ageHours < 4) {
          setSavedHostSession({ roomCode: r, hostId: h });
        }
      }
    } catch (e) {}
  }, []);

  const handleResumeHostSession = () => {
    if (!savedHostSession) return;
    setRoomCode(savedHostSession.roomCode);
    setPlayerId(savedHostSession.hostId);
    playerIdRef.current = savedHostSession.hostId;
    safeSetItem('cc_player_id', savedHostSession.hostId);
    connectWebSocket(savedHostSession.roomCode, savedHostSession.hostId);
  };

  const handleDismissHostSession = () => {
    safeSetItem('cc_host_room_code', '');
    safeSetItem('cc_host_id', '');
    safeSetItem('cc_host_timestamp', '');
    setSavedHostSession(null);
  };

  const handleLeaveRoom = () => {
    if (ws.current) {
      try {
        ws.current.close();
      } catch (e) {}
      ws.current = null;
    }
    setRoomCode('');
    setGameState(null);
    setIsHostUser(false);
    setView('landing');
  };

  const handleSubmitFeedback = async () => {
    if (!rating || !comment.trim()) return;
    setIsSubmitting(true);
    try {
      const host = backendConfig.host.startsWith('http') ? backendConfig.host : `https://${backendConfig.host}`;
      const url = `${host}/api/feedback`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback_type: feedbackType,
          rating: rating,
          comment: comment.trim(),
          game: 'coupleclash',
          platform: (window as any).Capacitor?.isNativePlatform ? 'android' : 'web'
        })
      });
      if (response.ok) {
        setSubmitSuccess(true);
      } else {
        alert('Failed to submit feedback. Please try again.');
      }
    } catch (err) {
      console.error('Error submitting feedback:', err);
      alert('Network error. Failed to submit feedback.');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        if (viewRef.current !== 'landing') {
          e.preventDefault();
          setShowExitConfirm(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomCode(roomParam.toUpperCase());
      setIsInviteLink(true);
    }
    if (params.get('test') === 'game') {
      const samplePhotos = [
        'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=250',
        'https://images.unsplash.com/photo-1517976487508-319760777583?w=250',
        'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=250',
        'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=250',
        'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=250',
        'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=250',
        'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=250',
        'https://images.unsplash.com/photo-1518770660439-4636190af475?w=250',
        'https://images.unsplash.com/photo-1552053831-71594a27632d?w=250',
        'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=250',
        'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=250',
        'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=250',
        'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=250',
        'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=250',
        'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=250',
        'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=250',
        'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=250',
        'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=250',
        'https://images.unsplash.com/photo-1533450718592-29d45635f0a9?w=250',
        'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=250',
        'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=250',
        'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=250',
        'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=250',
        'https://images.unsplash.com/photo-1534067783941-51c9c23ecefd?w=250',
        'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=250',
      ];
      const mockTiles: Tile[] = Array.from({ length: 25 }, (_, i) => ({
        id: i,
        image: samplePhotos[i % samplePhotos.length],
        type: i === 0 ? 'assassin' : (i % 2 === 0 ? 'blue' : 'pink'),
        revealed: i < 3
      }));
      setGameState({
        room_code: 'TEST99',
        host_id: 'host_123',
        status: 'IN_PROGRESS',
        turn_phase: 'WAITING_FOR_CLUE',
        current_turn: 'blue',
        players: {
          [playerId]: { name: 'Alice', team: 'blue', role: 'player' },
          p2: { name: 'Bob', team: 'pink', role: 'player' }
        },
        blue_captain: playerId,
        pink_captain: 'p2',
        board: mockTiles,
        clue_word: null,
        clue_number: 0,
        guesses_remaining: 0,
        scores: { blue: 2, pink: 1 },
        max_tiles: { blue: 8, pink: 8 },
        player_presence: {},
        votes: {},
        game_mode: 'classic',
        starting_team_pref: 'blue',
        team_times: { blue: 45, pink: 30 },
        turn_started_at: Date.now() / 1000,
        winner: null
      });
      setView('game');
      setIsConnected(true);
    }
  }, [playerId]);

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

        if (data.event === 'clue_submitted') {
          sound.playChime();
          navigator.vibrate?.([15, 30, 15]);
        } else if (data.event === 'tile_revealed') {
          if (data.result?.game_over) {
            sound.playVictory();
            navigator.vibrate?.([20, 60, 20, 60, 40]);
            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
          } else {
            sound.playPop();
            navigator.vibrate?.([10]);
          }
        } else if (data.event === 'turn_ended') {
          sound.playTick();
        } else if (data.event === 'game_started') {
          sound.playChime();
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
    navigator.vibrate?.([8]);
    console.log("DEBUG: handleCreateRoom clicked");
    setIsCreatingRoom(true);
    setCreateRoomCountdown(60);
    const timerInterval = setInterval(() => {
      setCreateRoomCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

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
      safeSetItem('cc_host_room_code', data.room_code);
      safeSetItem('cc_host_id', data.host_id);
      safeSetItem('cc_host_timestamp', Date.now().toString());
      setSavedHostSession({ roomCode: data.room_code, hostId: data.host_id });
      setPlayerId(data.host_id);
      playerIdRef.current = data.host_id; // Sync the Ref immediately!

      setRoomCode(data.room_code);
      connectWebSocket(data.room_code, data.host_id);
    } catch (e: any) {
      console.error("DEBUG: handleCreateRoom FAILED:", e);
      const url = `${backendConfig.apiBase}/rooms`;
      alert(`Failed to create room! URL: ${url}. Error: ${e.message || e}`);
    } finally {
      clearInterval(timerInterval);
      setIsCreatingRoom(false);
    }
  };

  const handleJoinRoom = () => {
    if (!roomCode || !playerName) return;
    navigator.vibrate?.([8]);
    safeSetItem('cc_player_name', playerName);
    connectWebSocket(roomCode);
  };

  const handleSelectTeam = (team: 'blue' | 'pink' | null) => {
    sound.playPop();
    navigator.vibrate?.([8]);
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

    sound.playChime();
    navigator.vibrate?.([15, 30, 15]);
    ws.current?.send(JSON.stringify({ event: 'start_game', starting_team: 'blue' }));
  };

  const handleSubmitClue = (word: string, number: number) => {
    sound.playChime();
    navigator.vibrate?.([15, 30, 15]);
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ event: 'submit_clue', word, number }));
    } else {
      setGameState(prev => prev ? {
        ...prev,
        turn_phase: 'GUESSING',
        clue_word: word.toUpperCase(),
        clue_number: number,
        guesses_remaining: number + 1
      } : null);
    }
  };

  const handleRevealTile = (tileId: number) => {
    sound.playPop();
    navigator.vibrate?.([12]);
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ event: 'reveal_tile', tile_id: tileId }));
    } else {
      setGameState(prev => {
        if (!prev) return null;
        return {
          ...prev,
          board: prev.board.map(t => t.id === tileId ? { ...t, revealed: true } : t),
          scores: {
            ...prev.scores,
            blue: prev.scores.blue + 1
          },
          guesses_remaining: Math.max(0, prev.guesses_remaining - 1)
        };
      });
    }
  };

  const handleVoteTile = (tileId: number) => {
    sound.playPop();
    navigator.vibrate?.([8]);
    ws.current?.send(JSON.stringify({ event: 'vote_tile', tile_id: tileId }));
  };

  const handleRerollTile = (tileId: number) => {
    sound.playPop();
    ws.current?.send(JSON.stringify({ event: 'reroll_tile', tile_id: tileId }));
    // Optimistically clear error while waiting for sync
    setErrorTiles(prev => {
      const next = new Set(prev);
      next.delete(tileId);
      return next;
    });
  };

  const handleAssignCaptain = (player_id: string, team: 'blue' | 'pink') => {
    sound.playPop();
    navigator.vibrate?.([8]);
    ws.current?.send(JSON.stringify({ event: 'assign_captain', player_id, team }));
  };

  const handleSetMode = (mode: string) => {
    sound.playPop();
    ws.current?.send(JSON.stringify({ event: 'set_game_mode', mode }));
  };

  const handleSetStartingTeam = (team: string) => {
    sound.playPop();
    ws.current?.send(JSON.stringify({ event: 'set_starting_team', team }));
  };

  const handleEndTurn = () => {
    sound.playTick();
    ws.current?.send(JSON.stringify({ event: 'end_turn' }));
  };

  const handleResetGame = () => {
    sound.playChime();
    ws.current?.send(JSON.stringify({ event: 'reset_game' }));
  };

  const renderFeedbackAndExitModals = () => (
    <>
      {/* Floating In-Game Feedback Button (Bottom Right) */}
      <button 
        onClick={() => {
          setSubmitSuccess(false);
          setRating(null);
          setComment('');
          setFeedbackType('general');
          setShowFeedbackModal(true);
        }}
        className="in-game-floating-feedback-btn"
        aria-label="Give Feedback"
      >
        <MessageSquare size={20} />
      </button>

      {/* Exit Confirmation Modal */}
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
          zIndex: 10000
        }}>
          <div className="glass-panel text-center" style={{ padding: '2rem', maxWidth: '420px', width: '90%', border: '2px solid var(--blue-team)' }}>
            <h2 style={{ fontSize: '1.8rem', color: 'var(--blue-team)', marginBottom: '0.5rem' }}>Quit CodePic?</h2>
            <p style={{ margin: '1rem 0 1.5rem 0', opacity: 0.85, fontSize: '1.05rem' }}>
              Are you sure you want to return to the Party Games Hub?
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                className="btn btn-primary"
                style={{ padding: '0.8rem 1.8rem', background: '#ef4444' }}
                onClick={() => window.location.href = '/'}
              >
                Quit to Hub
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '0.8rem 1.8rem' }}
                onClick={() => setShowExitConfirm(false)}
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reconnecting Overlay */}
      {!isConnected && view !== 'landing' && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={64} className="text-primary animate-spin" style={{ color: 'var(--blue-team)', marginBottom: '1rem' }} />
          <h2 style={{ fontSize: '2rem', color: 'white', fontWeight: 'bold', margin: '0' }}>Reconnecting to Server</h2>
          <p style={{ color: 'hsla(0,0%,100%,0.7)', fontSize: '1.2rem', marginTop: '0.5rem' }}>Please wait...</p>
        </div>
      )}

      {/* 60s Server Loading Modal when Creating Room */}
      {isCreatingRoom && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(10, 15, 25, 0.92)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '520px',
            width: '100%',
            textAlign: 'center',
            padding: '2.5rem',
            border: '2px solid var(--blue-team)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(56, 189, 248, 0.25)'
          }}>
            <Loader2 className="animate-spin text-primary" size={54} style={{ color: 'var(--blue-team)', margin: '0 auto 1.5rem auto' }} />
            <h2 style={{ fontSize: '2rem', margin: '0 0 0.5rem 0', color: '#fff' }}>Creating Picture Battle</h2>
            <div style={{
              display: 'inline-block',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid var(--blue-team)',
              color: 'var(--blue-team)',
              padding: '6px 16px',
              borderRadius: '20px',
              fontWeight: 'bold',
              fontSize: '1rem',
              margin: '0.5rem 0 1rem 0'
            }}>
              ⏳ Waking Up Cloud Server: {createRoomCountdown}s
            </div>

            <div style={{
              width: '100%',
              height: '8px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '4px',
              overflow: 'hidden',
              margin: '1rem 0'
            }}>
              <div style={{
                height: '100%',
                background: 'linear-gradient(90deg, var(--blue-team), var(--pink-team))',
                width: `${Math.min(100, Math.max(0, ((60 - createRoomCountdown) / 60) * 100))}%`,
                transition: 'width 0.3s ease'
              }} />
            </div>

            <p style={{ opacity: 0.85, fontSize: '0.95rem', lineHeight: '1.5', margin: '0 0 1.5rem 0', color: '#d0d7de' }}>
              Free cloud instances take ~30–60 seconds to wake up from standby. Please keep this screen open while your game initializes!
            </p>

            <button
              className="btn btn-secondary"
              onClick={() => setIsCreatingRoom(false)}
              style={{ fontSize: '0.9rem', padding: '0.6rem 1.4rem' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
                  >
                    <option value="general">💬 General Feedback</option>
                    <option value="bug">🐛 Bug Report</option>
                    <option value="feature">💡 Feature Suggestion</option>
                    <option value="love_it">❤️ Love the Game</option>
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
                        title={item.label}
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
                  />
                </div>

                <div className="modal-actions">
                  <button 
                    className="btn-cancel" 
                    onClick={() => setShowFeedbackModal(false)}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn-submit" 
                    onClick={handleSubmitFeedback}
                    disabled={!rating || !comment.trim() || isSubmitting}
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
                  Your feedback helps us make CodePic even better.
                </p>
                <button 
                  className="btn-submit" 
                  style={{ width: '100%', padding: '0.8rem' }}
                  onClick={() => setShowFeedbackModal(false)}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );

  // --- Render Helpers ---
  if (view === 'landing') {
    return (
      <div className="landing-container">
        {/* Top Navigation Bar */}
        <div className="game-top-bar" style={{ width: '100%', marginBottom: '8px' }}>
          <button 
            onClick={() => window.location.href = '/'}
            className="top-bar-btn icon-only"
            aria-label="Back to Hub"
          >
            <Home size={20} />
          </button>
        </div>

        <div className="text-center mb-1">
          <h1 className="title-giant" style={{ fontSize: 'clamp(1.9rem, 4.5vw, 2.3rem)', marginBottom: '2px' }}>CodePic</h1>
          <p className="subtitle" style={{ marginBottom: '8px', fontSize: '0.88rem' }}>Picture Wars: Blue vs Pink</p>
        </div>

        {/* Host Recovery Banner */}
        {savedHostSession && (
          <div className="host-recovery-banner" style={{ marginBottom: '8px' }}>
            <div className="host-recovery-content">
              <span className="host-recovery-icon">👑</span>
              <div>
                <div className="host-recovery-title" style={{ fontSize: '0.85rem' }}>Active Host Session Found</div>
                <div className="host-recovery-desc" style={{ fontSize: '0.8rem' }}>Room Code: <strong style={{ color: '#ffd700', fontSize: '0.95rem' }}>{savedHostSession.roomCode}</strong></div>
              </div>
            </div>
            <div className="host-recovery-actions">
              <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.85rem' }} onClick={handleResumeHostSession}>
                Resume Hosting
              </button>
              <button className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '0.85rem' }} onClick={handleDismissHostSession}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="glass-panel" style={{ maxWidth: '420px', width: '100%', padding: '1rem' }}>
          <input
            className="input-field"
            style={{ marginBottom: '0.6rem', padding: '0.65rem 0.9rem', fontSize: '0.95rem' }}
            placeholder="Your Name"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
          />
          {!isInviteLink && (
            <button className="btn btn-primary" style={{ width: '100%', marginBottom: '0.6rem', padding: '0.7rem 1rem', fontSize: '0.98rem' }} onClick={handleCreateRoom}>
              <Play size={18} /> Create Room
            </button>
          )}
          <div className="input-group" style={{ marginBottom: '0.6rem', gap: '8px' }}>
            <input
              className="input-field"
              style={{ flex: 1, margin: 0, padding: '0.65rem 0.9rem', fontSize: '0.95rem' }}
              placeholder="Room Code"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
            />
            <button className="btn btn-secondary" style={{ padding: '0.7rem 1.25rem', fontSize: '0.98rem' }} onClick={handleJoinRoom}>Join</button>
          </div>
          <button className="btn btn-secondary" onClick={() => { setTutorialStep(0); setShowTutorial(true); }} style={{ width: '100%', background: 'rgba(255,255,255,0.08)', marginTop: '2px', padding: '0.65rem 1rem', fontSize: '0.92rem' }}>
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

        {renderFeedbackAndExitModals()}
      </div>
    );
  }

  if (view === 'lobby') {
    return (
      <div className={`app-container ${isHostUser ? 'host-view' : ''}`}>
        {isHostUser && (
          <button 
            onClick={() => window.location.href = '/'}
            className="hub-btn"
            aria-label="Back to Hub"
          >
            <Home size={20} />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: '640px', marginBottom: '1rem' }}>
              <button className="btn btn-secondary" onClick={handleLeaveRoom} style={{ padding: '8px 16px', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <ArrowLeft size={16} /> Leave Room
              </button>
              <button className="btn btn-secondary" onClick={() => { setTutorialStep(0); setShowTutorial(true); }} style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
                ❓ Rules
              </button>
            </div>
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
        {renderFeedbackAndExitModals()}
      </div>
    );
  }

  if (view === 'game_over') {
    const winnerName = gameState?.winner === 'blue' ? 'Blue Team' : 'Pink Team';
    const winnerColor = gameState?.winner === 'blue' ? 'var(--blue-team)' : 'var(--pink-team)';

    return (
      <div className={`app-container ${isHostUser ? 'host-view' : ''}`}>
        {isHostUser && (
          <button 
            onClick={() => window.location.href = '/'}
            className="hub-btn"
            aria-label="Back to Hub"
          >
            <Home size={20} />
          </button>
        )}
        <div>
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
        {renderFeedbackAndExitModals()}
      </div>
    );
  }

  const isMyTurn = gameState?.current_turn === gameState?.players[playerId]?.team;
  const isCaptain = (playerId === gameState?.blue_captain || playerId === gameState?.pink_captain);
  const isHostRole = isHostUser;

  return (
    <div className={`app-container ${isHostUser ? 'host-view' : 'player-game-view'}`}>
      {isHostUser && (
        <button 
          onClick={() => window.location.href = '/'}
          className="hub-btn"
          aria-label="Back to Hub"
        >
          <Home size={20} />
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

      <div className="glass-panel clue-banner">
        {gameState?.turn_phase === 'WAITING_FOR_CLUE' ? (
          <div>
            {isMyTurn && isCaptain ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '1.2rem' }}>🎯</span>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: gameState?.current_turn === 'blue' ? 'var(--blue-team)' : 'var(--pink-team)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Your Turn, Captain!
                  </h2>
                </div>
                <p style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.7)', margin: '0 0 10px 0' }}>
                  Enter a 1-word clue and select how many tiles it connects to:
                </p>
                <div className="captain-clue-form">
                  <div className="clue-word-field">
                    <input 
                      id="clue-word" 
                      type="text" 
                      placeholder="One-word clue (e.g. Ocean)..." 
                      autoFocus
                    />
                  </div>
                  <div className="clue-num-field">
                    <label htmlFor="clue-num">Tiles:</label>
                    <select id="clue-num" defaultValue="1">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                        <option key={n} value={n}>{n} {n === 1 ? 'tile' : 'tiles'}</option>
                      ))}
                    </select>
                  </div>
                  <button 
                    className="btn btn-primary clue-submit-btn" 
                    onClick={() => {
                      const wordInput = document.getElementById('clue-word') as HTMLInputElement;
                      const numSelect = document.getElementById('clue-num') as HTMLSelectElement;
                      const word = wordInput?.value?.trim();
                      const num = parseInt(numSelect?.value || '1', 10);
                      if (!word) {
                        alert('Please enter a one-word clue!');
                        wordInput?.focus();
                        return;
                      }
                      handleSubmitClue(word, isNaN(num) ? 1 : num);
                    }}
                  >
                    Send Clue
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '0.25rem 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '1.2rem' }}>⏳</span>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: gameState?.current_turn === 'blue' ? 'var(--blue-team)' : 'var(--pink-team)' }}>
                    Waiting for {gameState?.current_turn === 'blue' ? 'Blue' : 'Pink'} Captain...
                  </h2>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.65)', margin: 0 }}>
                  The Captain is choosing a 1-word clue and the number of matching cards.
                </p>
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

      {renderFeedbackAndExitModals()}
    </div>
  );
}

export default App;
