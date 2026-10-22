import { useState, useEffect, useRef } from 'react';
import { Play, Users, ArrowLeft, Loader2, Crown, Trophy, Share2, Volume2, VolumeX, MessageSquare, Home, LogOut } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import { toJpeg } from 'html-to-image';
import { pushEvent, getPlatform } from './analytics';
import DrawCanvas from './DrawCanvas';
import mainLogo from './assets/gold.png';

const isSoundEnabled = () => {
  try {
    return localStorage.getItem('dj_sound_enabled') !== 'false';
  } catch (e) {
    return true;
  }
};

const playTickSound = () => {
  if (!isSoundEnabled()) return;
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
  if (!isSoundEnabled()) return;
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

// Determine the backend host dynamically (Supports Local IP and Production URLs)
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

  // Default to your production domain for connectivity
  return 'play.d4e.ai';
};

let memoryStorage: Record<string, string> = {};

function safeGetItem(key: string) {
  try {
    return sessionStorage.getItem(key) || memoryStorage[key] || null;
  } catch (e) {
    return memoryStorage[key] || null;
  }
}

function safeSetItem(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch (e) {
    console.warn("sessionStorage blocked, using memory.");
  }
  memoryStorage[key] = value;
}

function generatePlayerId() {
  const existing = safeGetItem('dj_player_id');
  if (existing) return existing;
  const newId = Math.random().toString(36).substring(2, 9);
  safeSetItem('dj_player_id', newId);
  return newId;
}

function App() {
  const [backendConfig] = useState(() => {
    const host = getDynamicHost();
    const isSecure = !host.includes('localhost') && !host.startsWith('127.0.0.1');
    const protocol = isSecure ? 'https' : 'http';
    const wsProtocol = isSecure ? 'wss' : 'ws';
    const apiBase = host.startsWith('http') ? `${host}/api/drawjudge` : `${protocol}://${host}/api/drawjudge`;
    const wsBase = host.startsWith('http') ? host.replace('http', 'ws') + '/ws/drawjudge/rooms' : `${wsProtocol}://${host}/ws/drawjudge/rooms`;
    const getJoinUrl = (code: string) => {
      const h = host.startsWith('http') ? host : `${protocol}://${host}`;
      return `${h}/drawjudge/?room=${code}`;
    };
    return { host, apiBase, wsBase, getJoinUrl };
  });

  const [view, setView] = useState<'landing' | 'join' | 'hostLobby' | 'playerLobby' | 'drawing' | 'judging' | 'results' | 'leaderboard'>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState(safeGetItem('dj_player_name') || '');
  const [playerId, setPlayerId] = useState(generatePlayerId());

  const [players, setPlayers] = useState<{ id?: string, name: string, score: number }[]>([]);
  const [prompt, setPrompt] = useState('');
  const [gameMode, setGameMode] = useState('classic');
  const [theme, setTheme] = useState('Family');
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

  const [, setShowFullGallery] = useState(false);
  const [playerResultsTab, setPlayerResultsTab] = useState<'my_result' | 'all_drawings' | 'standings'>('my_result');
  const [isStartingNextRound, setIsStartingNextRound] = useState(false);
  const [hostShowAllHistory, setHostShowAllHistory] = useState(false);
  const [allPlayerHistory, setAllPlayerHistory] = useState<Record<string, any[]>>({});
  const [hasPlayedFinale, setHasPlayedFinale] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [roundEndTime, setRoundEndTime] = useState(0);
  const [hasSubmittedThisRound, setHasSubmittedThisRound] = useState(false);
  const [hasSubmittedImage, setHasSubmittedImage] = useState<string | null>(null);
  const [isInviteLink, setIsInviteLink] = useState(false);
  const [, setDevTapCount] = useState(0);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const tapTimeoutRef = useRef<any>(null);

  const handleLogoTap = () => {
    if (isDebugMode) return;
    setDevTapCount(prev => {
      const next = prev + 1;
      if (next >= 7) {
        setIsDebugMode(true);
        alert("Developer Options Enabled!");
        return 0;
      }
      return next;
    });

    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    tapTimeoutRef.current = setTimeout(() => {
      setDevTapCount(0);
    }, 1000);
  };

  const ws = useRef<WebSocket | null>(null);

  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  const basePath = import.meta.env.BASE_URL;
  const tutorialData = [
    { img: `${basePath}host1_create_room.png`, title: 'Create a Game', text: 'One person acts as the Host. Click "Create Game" on a TV, Projector, or Laptop to start.' },
    { img: `${basePath}host2_lobby.png`, title: 'Join & Setup', text: 'Players scan the QR code to join. The Host customizes the game settings.' },
    { img: `${basePath}host3_round.png`, title: 'The Prompt', text: 'Watch the main screen for the current round prompt and time limit.' },
    { img: `${basePath}player1_round.png`, title: 'Start Drawing!', text: 'Look at your phone to draw your best illustration before the timer ends.' },
    { img: `${basePath}host4_results.png`, title: 'The AI Judge', text: 'Watch the main screen! The AI evaluates each drawing and awards points.' },
    { img: `${basePath}player2_results.png`, title: 'Personal Results', text: 'Check your phone to see how well you scored on this round.' },
    { img: `${basePath}host5_leaderboard.png`, title: 'Round Results', text: 'Scores are tallied up! Keep playing until the final round to see who becomes the ultimate Draw Judge champion!' }
  ];

  const [savedHostSession, setSavedHostSession] = useState<{ roomCode: string; hostId: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => isSoundEnabled());
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Feedback State
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackType, setFeedbackType] = useState('general');
  const [rating, setRating] = useState<number | null>(null);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);

  // Sound Toggle Handler
  const toggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      try {
        localStorage.setItem('dj_sound_enabled', next ? 'true' : 'false');
      } catch (e) {}
      return next;
    });
  };

  // Check saved host session on mount
  useEffect(() => {
    try {
      const r = safeGetItem('dj_host_room_code');
      const h = safeGetItem('dj_host_id');
      const t = safeGetItem('dj_host_timestamp');
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
    setPlayerName("Host");
    safeSetItem('dj_player_name', "Host");
    safeSetItem('dj_player_id', savedHostSession.hostId);
    setIsHostUser(true);
    connectWebSocket(savedHostSession.roomCode, true, savedHostSession.hostId);
  };

  const handleDismissHostSession = () => {
    safeSetItem('dj_host_room_code', '');
    safeSetItem('dj_host_id', '');
    safeSetItem('dj_host_timestamp', '');
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
    setIsHostUser(false);
    setView('landing');
  };

  const handleSubmitFeedback = async () => {
    if (!rating || !feedbackComment.trim()) return;
    setIsSubmittingFeedback(true);
    try {
      const h = backendConfig.host.startsWith('http') ? backendConfig.host : `https://${backendConfig.host}`;
      const url = `${h}/api/feedback`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback_type: feedbackType,
          rating: rating,
          comment: feedbackComment.trim(),
          game: 'drawjudge',
          platform: getPlatform()
        })
      });
      if (response.ok) {
        setFeedbackSuccess(true);
      } else {
        alert('Failed to submit feedback. Please try again.');
      }
    } catch (err) {
      console.error('Error submitting feedback:', err);
      alert('Network error. Failed to submit feedback.');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        if (viewRef.current !== 'landing' && viewRef.current !== 'join') {
          e.preventDefault();
          setShowExitConfirm(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const viewRef = useRef(view);
  const hasSubmittedRef = useRef(hasSubmittedThisRound);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    hasSubmittedRef.current = hasSubmittedThisRound;
  }, [hasSubmittedThisRound]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomCode(roomParam.toUpperCase());
      setIsInviteLink(true);
      setView('join');
    }
    if (params.get('test') === 'draw') {
      setPrompt('A dancing astronaut on Mars');
      setTimeLeft(60);
      setIsHostUser(false);
      setView('drawing');
    }

    if (params.get('test')?.startsWith('results') || params.get('test')?.startsWith('leaderboard') || params.get('test')?.startsWith('winner')) {
      const isHost = params.get('test')?.includes('host');
      const isLead = params.get('test')?.includes('leaderboard');
      const isWinner = params.get('test')?.includes('winner');
      const mockImg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400' viewBox='0 0 300 400'><rect width='300' height='400' fill='%231a1f33'/><circle cx='150' cy='180' r='70' fill='%2338bdf8'/><path d='M100 280 Q150 220 200 280' stroke='%23f43f5e' stroke-width='12' fill='none'/><circle cx='130' cy='160' r='12' fill='white'/><circle cx='170' cy='160' r='12' fill='white'/><text x='150' y='360' font-size='22' font-weight='bold' fill='%23facc15' text-anchor='middle'>Astronaut</text></svg>";
      const mockImg2 = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400' viewBox='0 0 300 400'><rect width='300' height='400' fill='%23131b2e'/><rect x='80' y='120' width='140' height='160' rx='20' fill='%23ec4899'/><circle cx='150' cy='200' r='40' fill='%23facc15'/><text x='150' y='350' font-size='22' font-weight='bold' fill='white' text-anchor='middle'>Cyber Dog</text></svg>";
      const mockImg3 = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400' viewBox='0 0 300 400'><rect width='300' height='400' fill='%231a1528'/><polygon points='150,80 80,240 220,240' fill='%23a855f7'/><circle cx='150' cy='170' r='25' fill='%2338bdf8'/><text x='150' y='350' font-size='22' font-weight='bold' fill='%234ade80' text-anchor='middle'>Rocket</text></svg>";

      const is2Player = params.get('test')?.includes('2p') || params.get('2p') === 'true';
      const mockPlayers = [
        { id: playerId, name: 'Alice Walker', score: isWinner ? 285 : 95 },
        { id: 'p2', name: 'Bob Wonder', score: isWinner ? 240 : 88 },
        ...(is2Player ? [] : [
          { id: 'p3', name: 'Charlie Champion', score: isWinner ? 210 : 76 },
          { id: 'p4', name: 'Diana Masterpiece', score: isWinner ? 165 : 65 },
        ])
      ];
      const mockResults = [
        {
          submission_id: playerId,
          image: mockImg,
          total_score: 95,
          scores: { prompt_relevance: 25, creativity: 24, clarity: 23, entertainment: 23 },
          comment: "Incredible lunar energy, the colors pop with great attitude!"
        },
        {
          submission_id: 'p2',
          image: mockImg2,
          total_score: 88,
          scores: { prompt_relevance: 23, creativity: 22, clarity: 22, entertainment: 21 },
          comment: "Very bold lines and delightful composition."
        },
        ...(is2Player ? [] : [
          {
            submission_id: 'p3',
            image: mockImg3,
            total_score: 76,
            scores: { prompt_relevance: 20, creativity: 19, clarity: 18, entertainment: 19 },
            comment: "Hilarious interpretation of the prompt!"
          },
          {
            submission_id: 'p4',
            image: mockImg,
            total_score: 65,
            scores: { prompt_relevance: 18, creativity: 17, clarity: 16, entertainment: 18 },
            comment: "Charming minimalist design."
          }
        ])
      ];

      const mockHistory = {
        [playerId]: [
          { round: 1, prompt: "Dancing astronaut", image: mockImg, total_score: 95, comment: "Pure cosmic genius!" },
          { round: 2, prompt: "Cyberpunk dog", image: mockImg2, total_score: 96, comment: "Neon perfection." },
          { round: 3, prompt: "Space rocket", image: mockImg3, total_score: 94, comment: "Ready for takeoff!" }
        ],
        p2: [
          { round: 1, prompt: "Grandpa juggling apples poorly", image: mockImg2, total_score: 88, comment: "Great vibe." },
          { round: 2, prompt: "Cyberpunk dog with sunglasses", image: mockImg, total_score: 80, comment: "Nice colors." },
          { round: 3, prompt: "Space rocket launching to Mars", image: mockImg3, total_score: 72, comment: "Very bold lines." }
        ],
        p3: [
          { round: 1, prompt: "Dancing astronaut", image: mockImg3, total_score: 76, comment: "Funny drawing." },
          { round: 2, prompt: "Cyberpunk dog", image: mockImg2, total_score: 68, comment: "Quirky pup." },
          { round: 3, prompt: "Space rocket", image: mockImg, total_score: 66, comment: "Good rocket form." }
        ],
        p4: [
          { round: 1, prompt: "Dancing astronaut", image: mockImg, total_score: 65, comment: "Cute sketch." },
          { round: 2, prompt: "Cyberpunk dog", image: mockImg3, total_score: 55, comment: "Minimalist take." },
          { round: 3, prompt: "Space rocket", image: mockImg2, total_score: 45, comment: "Fast doodle." }
        ]
      };

      setPlayers(mockPlayers);
      setResults(mockResults);
      setAllPlayerHistory(mockHistory);
      if (isWinner && isHost) {
        setSelectedPlayerHistory(mockHistory[playerId]);
        setSelectedPlayerName('Alice Walker');
      } else {
        setSelectedPlayerHistory(null);
        setSelectedPlayerName('');
      }
      setRoundSummary("Alice conquered the cosmos with an electrifying dancing astronaut!");
      setWinnerExplanation("Remarkable creativity and attention to detail that won the AI judge's heart.");
      setIsHostUser(Boolean(isHost));
      setCurrentRound(isWinner ? 3 : 2);
      setMaxRounds(3);
      setRoundDeltas({ [playerId]: 25, p2: 18, p3: 15 });
      setView(isLead ? 'leaderboard' : 'results');
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (ws.current && ws.current.readyState !== WebSocket.OPEN && roomCode && playerId) {
          console.log("Tab became visible, WebSocket is dead. Reconnecting...");
          connectWebSocket(roomCode, isHostUser, playerId);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [roomCode, isHostUser, playerId]);

  useEffect(() => {
    const handlePopState = () => {
      if (viewRef.current !== 'landing' && viewRef.current !== 'join') {
        window.history.pushState(null, '', window.location.href);
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (viewRef.current !== 'landing' && viewRef.current !== 'join') {
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

  const connectWebSocket = (code: string, isHost: boolean, overridePlayerId: string) => {
    setIsHostUser(isHost);
    const name = isHost ? "Host" : playerName;
    const socket = new WebSocket(`${backendConfig.wsBase}/${code}?player_id=${overridePlayerId}&name=${encodeURIComponent(name)}&platform=${getPlatform()}`);
    ws.current = socket;

    // Render/Heroku drop idle sockets after 60s. Heartbeat prevents this perfectly:
    const pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ event: 'ping' }));
      }
    }, 15000); // Lowered to 15 seconds to beat aggressive TCP proxies

    // Prevent Render's free tier HTTP Spin-Down Bug
    const keepAliveInterval = setInterval(() => {
      fetch(`${backendConfig.apiBase}/rooms/fake-keep-alive`).catch(() => { });
    }, 5 * 60 * 1000); // 5 minutes

    socket.onclose = (event) => {
      clearInterval(pingInterval);
      clearInterval(keepAliveInterval);
      setIsConnected(false);

      if (event && event.code === 4004) {
        console.warn("DEBUG: Room not found on server. Reverting to join page.");
        alert("Invalid Room Code! Please try again.");
        setRoomCode('');
        setView('join');
        return;
      }

      // Auto-reconnect after 3 seconds if not in a landing state
      setTimeout(() => {
        if (viewRef.current !== 'landing' && viewRef.current !== 'join') {
          console.log("Attempting to reconnect...");
          connectWebSocket(code, isHost, overridePlayerId);
        }
      }, 3000);
    };

    socket.onopen = () => {
      setIsConnected(true);
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.event === 'room_state_update') {
        const isActuallyHost = (data.host_id === overridePlayerId) || isHost;
        setIsHostUser(isActuallyHost);
        const playerList = Object.keys(data.players).map(pid => ({ id: pid, ...data.players[pid] }));
        setPlayers(playerList);
        if (data.current_round !== undefined) setCurrentRound(data.current_round);
        if (data.max_rounds !== undefined) setMaxRounds(data.max_rounds);
        if (data.theme !== undefined) setTheme(data.theme);

        if (data.status === 'judging') {
          setHasSubmittedThisRound(false);
          setHasSubmittedImage(null);
        }

        if (data.status === 'drawing' && data.time_left !== undefined) {
          setRoundEndTime(Date.now() + (data.time_left * 1000));
        }

        if (data.status === 'waiting') {
          if (viewRef.current !== 'results' && viewRef.current !== 'leaderboard') {
            setView(isActuallyHost ? 'hostLobby' : 'playerLobby');
          }
        } else if (data.status === 'drawing') {
          if (isActuallyHost) {
            setView('drawing');
          } else if (!hasSubmittedRef.current) {
            if (data.time_left !== undefined) setTimeLeft(data.time_left);
            setView('drawing');
          }
        } else if (data.status === 'judging') {
          if (viewRef.current !== 'results' && viewRef.current !== 'leaderboard') {
            setView('judging');
          }
        }
      } else if (data.event === 'resume_state') {
        setIsHostUser(data.is_host);
        const isActuallyHost = data.is_host;
        setPrompt(data.prompt || '');
        setGameMode(data.mode || 'classic');
        if (data.theme !== undefined) setTheme(data.theme);
        if (data.time_left !== undefined) {
          setRoundEndTime(Date.now() + (data.time_left * 1000));
          setTimeLeft(data.time_left);
        }
        if (data.current_round !== undefined) setCurrentRound(data.current_round);
        if (data.max_rounds !== undefined) setMaxRounds(data.max_rounds);
        if (data.leaderboard) {
          const playerList = Object.keys(data.leaderboard).map(pid => ({ id: pid, ...data.leaderboard[pid] }));
          setPlayers(playerList);
        }

        if (data.has_submitted) {
          setHasSubmittedThisRound(true);
          setHasSubmittedImage(data.submitted_image || null);
        } else {
          setHasSubmittedThisRound(false);
          setHasSubmittedImage(null);
        }

        if (data.status === 'waiting') {
          if (viewRef.current !== 'results' && viewRef.current !== 'leaderboard') {
            setView(isActuallyHost ? 'hostLobby' : 'playerLobby');
          }
        } else if (data.status === 'drawing') {
          if (isActuallyHost) {
            setView('drawing');
          } else if (data.has_submitted) {
            setView('playerLobby');
          } else {
            setView('drawing');
          }
        } else if (data.status === 'judging') {
          if (viewRef.current !== 'results' && viewRef.current !== 'leaderboard') {
            setView('judging');
          }
        }
      } else if (data.event === 'round_starting') {
        setIsStartingNextRound(true);
      } else if (data.event === 'round_started') {
        setIsStartingNextRound(false);
        hasSubmittedRef.current = false;
        setHasSubmittedThisRound(false);
        setHasSubmittedImage(null);
        setSelectedPlayerHistory(null);
        setSelectedPlayerName('');
        setShowFullGallery(false);
        setPlayerResultsTab('my_result');
        setPrompt(data.prompt);
        setGameMode(data.mode || 'classic');
        if (data.duration_seconds !== undefined) {
          setTimeLeft(data.duration_seconds);
          setRoundEndTime(Date.now() + (data.duration_seconds * 1000));
        }
        if (data.current_round !== undefined) setCurrentRound(data.current_round);
        if (data.max_rounds !== undefined) setMaxRounds(data.max_rounds);
        setSubmissionCount(0);
        setView('drawing');
      } else if (data.event === 'judging_started') {
        setIsStartingNextRound(false);
        setView('judging');
      } else if (data.event === 'results_ready') {
        setIsStartingNextRound(false);
        playTadaSound();
        setResults(data.results);
        setRoundSummary(data.round_summary || '');
        setWinnerExplanation(data.winner_explanation || '');
        setShowFullGallery(false);
        setPlayerResultsTab('my_result');
        if (data.all_player_history) {
          setAllPlayerHistory(data.all_player_history);
        }
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
          pushEvent('game_ended', roomCode, isHostUser ? 'host' : 'player', playerId, { player_count: Object.keys(data.leaderboard || {}).length, total_rounds: data.current_round });
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
    if (view === 'drawing' && roundEndTime > 0) {
      const timer = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((roundEndTime - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 10 && remaining > 0) playTickSound();
        if (remaining <= 0) clearInterval(timer);
      }, 500);
      return () => clearInterval(timer);
    }
  }, [view, roundEndTime]);

  useEffect(() => {
    if (view === 'drawing' && timeLeft === 0 && isHostUser && ws.current) {
      // Allow mobile clients a brief grace period so auto-submitted Canvas JPEGs flush perfectly
      const overrideTimer = setTimeout(() => {
        ws.current?.send(JSON.stringify({ event: 'force_judging' }));
      }, 3000);
      return () => clearTimeout(overrideTimer);
    }
  }, [view, timeLeft, isHostUser]);

  useEffect(() => {
    if (currentRound < maxRounds) setHasPlayedFinale(false);
  }, [currentRound, maxRounds]);

  useEffect(() => {
    if (view === 'leaderboard' && currentRound >= maxRounds && isHostUser && !hasPlayedFinale) {
      setHasPlayedFinale(true);

      // Grand Confetti
      const duration = 5000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 10000 };

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval: any = setInterval(function () {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) return clearInterval(interval);
        const particleCount = 50 * (timeLeft / duration);
        confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
        confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
      }, 250);

      // Text to Speech Announcement
      if ('speechSynthesis' in window) {
        const sortedLeaderboard = [...players].sort((a, b) => b.score - a.score);
        if (sortedLeaderboard.length > 0) {
          const msg = new SpeechSynthesisUtterance(`And the ultimate winner is... ${sortedLeaderboard[0].name}!`);
          msg.rate = 0.9;
          msg.pitch = 1.1;
          window.speechSynthesis.speak(msg);
        }
      }
    }
  }, [view, currentRound, maxRounds, hasPlayedFinale, isHostUser, players]);

  useEffect(() => {
    if (!isHostUser && view === 'leaderboard' && currentRound >= maxRounds && players.length > 0 && playerId) {
      if (!selectedPlayerHistory) {
        setSelectedPlayerName(players.find(p => p.id === playerId)?.name || 'Me');
        if (ws.current) ws.current.send(JSON.stringify({ event: 'get_player_history', player_id: playerId }));
      }
    }
  }, [isHostUser, view, currentRound, maxRounds, players, selectedPlayerHistory, playerId]);

  const [isTesting, setIsTesting] = useState(false);

  const testConnection = async () => {
    setIsTesting(true);
    const testUrl = `${backendConfig.apiBase.replace('/drawjudge', '')}/health`;
    console.log("Testing connection to:", testUrl);
    try {
      const res = await fetch(testUrl);
      const data = await res.json();
      alert(`Connection Success! Response: ${JSON.stringify(data)}`);
    } catch (e: any) {
      alert(`Connection Failed to ${testUrl}: ${e.message || e}`);
      console.error("Test connection error:", e);
    } finally {
      setIsTesting(false);
    }
  };

  const handleCreateRoom = async () => {
    const url = `${backendConfig.apiBase}/rooms`;
    console.log("Attempting to create room at:", url);
    setIsCreatingRoom(true);
    setCreateRoomCountdown(60);
    const timerInterval = setInterval(() => {
      setCreateRoomCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: playerId, platform: getPlatform() })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
      const data = await res.json();
      if (!data.room_code) throw new Error("Backend returned empty room_code");
      setRoomCode(data.room_code);
      setPlayerId(data.host_id);
      setPlayerName("Host");
      safeSetItem('dj_player_name', "Host");
      safeSetItem('dj_player_id', data.host_id);
      safeSetItem('dj_host_room_code', data.room_code);
      safeSetItem('dj_host_id', data.host_id);
      safeSetItem('dj_host_timestamp', Date.now().toString());
      setSavedHostSession({ roomCode: data.room_code, hostId: data.host_id });
      connectWebSocket(data.room_code, true, data.host_id);
      setView('hostLobby');
      pushEvent('lobby_created', data.room_code, 'host', data.host_id, { player_count: 1 });
    } catch (e: any) {
      alert(`Failed creating room! URL: ${url}. Error: ${e.message || e}`);
    } finally {
      clearInterval(timerInterval);
      setIsCreatingRoom(false);
    }
  };

  const submitJoin = () => {
    if (!roomCode || !playerName) return;
    safeSetItem('dj_player_name', playerName);
    safeSetItem('dj_player_id', playerId);
    connectWebSocket(roomCode, false, playerId);
    pushEvent('lobby_joined', roomCode, 'player', playerId);
    // Wait for the new resume_state payload to deliberately route the view instead of hardcoding 'playerLobby'
  };

  const handleStartGame = () => {
    if (ws.current) {
      ws.current.send(JSON.stringify({ event: 'start_round', mode: hostSelectedMode }));
    }
  };

  const handleDrawSubmit = (dataUrl: string) => {
    if (ws.current) {
      ws.current.send(JSON.stringify({ event: 'submit_drawing', image_data: dataUrl }));
      setHasSubmittedThisRound(true);
      setHasSubmittedImage(dataUrl);
      setView('playerLobby');
    }
  };

  const handleShare = async (id: string, name: string) => {
    if (isSharing) return;
    setIsSharing(true);
    const el = document.getElementById(id);
    if (!el) {
      alert("Element not found");
      setIsSharing(false);
      return;
    }

    try {
      const dataUrl = await toJpeg(el, {
        quality: 0.95,
        backgroundColor: '#0f1322',
        pixelRatio: window.devicePixelRatio || 2,
        // Opt out of font downloading if it takes too long
        skipFonts: false
      });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `${name}_DrawJudge.jpg`, { type: 'image/jpeg' });

      let shared = false;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: 'Draw Judge!',
            text: 'Look at what the AI generated from my drawing! 🎨🤖',
            files: [file]
          });
          shared = true;
        } catch (shareErr: any) {
          if (shareErr.name === 'AbortError') {
            // User cancelled share dialogue, no big deal
            shared = true;
          }
        }
      }

      if (!shared) {
        // Fallback to download
        const link = document.createElement('a');
        link.download = `${name}_DrawJudge.jpg`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err: any) {
      console.error("Failed to share", err);
      alert("Could not create image: " + (err.message || err.toString()));
    } finally {
      setIsSharing(false);
    }
  };

  const openPlayerHistoryGallery = (p: { id?: string; name: string }) => {
    setSelectedPlayerName(p.name);
    const targetId = p.id;
    const history = (targetId ? allPlayerHistory[targetId] : null) 
      || results.filter(r => r.submission_id === targetId);

    if (history && history.length > 0) {
      setSelectedPlayerHistory(history);
    } else {
      const fallback = results.filter(r => r.submission_id === targetId);
      setSelectedPlayerHistory(fallback);
    }

    if (ws.current && ws.current.readyState === WebSocket.OPEN && targetId) {
      ws.current.send(JSON.stringify({ event: 'get_player_history', player_id: targetId }));
    }
  };

  return (
    <div className={isHostUser ? "host-view-tv" : "w-full flex-col h-full"} style={isHostUser ? {} : { flex: 1, padding: 0 }}>
      {isHostUser && view !== 'landing' && (
        <button 
          onClick={() => window.location.href = '/'}
          className="hub-btn"
          aria-label="Back to Hub"
        >
          <Home size={20} />
        </button>
      )}

      {showTutorial && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(5px)' }}>
          <div className="glass-panel flex-col" style={{ maxWidth: '400px', width: '90%', padding: '24px', position: 'relative', textAlign: 'center' }}>
            <button onClick={() => setShowTutorial(false)} style={{ position: 'absolute', top: '12px', right: '12px', background: 'transparent', border: 'none', color: 'white', fontSize: '2rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
            <h2 className="title" style={{ fontSize: '1.8rem', marginBottom: '16px', color: 'var(--primary)' }}>How to Play</h2>
            <img src={tutorialData[tutorialStep].img} alt="Tutorial Step" style={{ width: '100%', height: 'auto', borderRadius: '12px', marginBottom: '16px', border: '2px solid rgba(255,255,255,0.1)' }} />
            <h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', marginBottom: '8px' }}>{tutorialData[tutorialStep].title}</h3>
            <p style={{ fontSize: '1rem', opacity: 0.8, marginBottom: '24px', minHeight: '60px' }}>{tutorialData[tutorialStep].text}</p>
            <div className="flex-row" style={{ justifyItems: 'center', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <button className="btn-secondary" disabled={tutorialStep === 0} onClick={() => setTutorialStep(prev => prev - 1)} style={{ padding: '8px 16px', fontSize: '0.9rem', width: 'auto', opacity: tutorialStep === 0 ? 0.3 : 1 }}>Back</button>
              <span style={{ opacity: 0.5, fontWeight: 'bold' }}>{tutorialStep + 1} / {tutorialData.length}</span>
              {tutorialStep < tutorialData.length - 1 ? (
                <button className="btn-primary" onClick={() => setTutorialStep(prev => prev + 1)} style={{ padding: '8px 16px', fontSize: '0.9rem', width: 'auto' }}>Next</button>
              ) : (
                <button className="btn-primary" onClick={() => setShowTutorial(false)} style={{ padding: '8px 16px', fontSize: '0.9rem', width: 'auto' }}>Got it!</button>
              )}
            </div>
          </div>
        </div>
      )}

      {!isConnected && view !== 'landing' && view !== 'join' && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={64} className="text-primary animate-spin mb-4" />
          <h2 style={{ fontSize: '2rem', color: 'white', fontWeight: 'bold' }}>Reconnecting to Server</h2>
          <p style={{ color: 'hsla(0,0%,100%,0.7)', fontSize: '1.2rem' }}>Please wait...</p>
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
            border: '2px solid rgba(243, 156, 18, 0.4)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(243, 156, 18, 0.2)'
          }}>
            <Loader2 className="animate-spin text-primary" size={54} style={{ margin: '0 auto 1.5rem auto' }} />
            <h2 style={{ fontSize: '2rem', margin: '0 0 0.5rem 0', color: '#fff' }}>Creating Game Room</h2>
            <div style={{
              display: 'inline-block',
              background: 'rgba(243, 156, 18, 0.15)',
              border: '1px solid #f39c12',
              color: '#f39c12',
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
                background: 'linear-gradient(90deg, #f39c12, #e67e22)',
                width: `${Math.min(100, Math.max(0, ((60 - createRoomCountdown) / 60) * 100))}%`,
                transition: 'width 0.3s ease'
              }} />
            </div>

            <p style={{ opacity: 0.85, fontSize: '0.95rem', lineHeight: '1.5', margin: '0 0 1.5rem 0', color: '#d0d7de' }}>
              Free cloud instances take ~30–60 seconds to wake up from standby. Please keep this screen open while your game initializes!
            </p>

            <button
              className="btn-secondary"
              onClick={() => setIsCreatingRoom(false)}
              style={{ fontSize: '0.9rem', padding: '0.6rem 1.4rem' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Persistent Room Code on Host screen */}
      {isHostUser && view !== 'landing' && view !== 'join' && view !== 'hostLobby' && (
        view === 'results' || view === 'leaderboard' ? (
          <div className="persistent-room-code-compact animate-fade-in" title="Room Join Info">
            <div style={{ background: 'white', padding: '2px', borderRadius: '6px', display: 'flex' }}>
              <QRCodeSVG value={backendConfig.getJoinUrl(roomCode)} size={38} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.1 }}>
              <span style={{ fontSize: '0.65rem', color: 'hsla(0,0%,100%,0.7)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Room Code</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '1px' }}>{roomCode}</span>
            </div>
          </div>
        ) : (
          <div className="glass-panel text-center persistent-room-code-card">
            <div style={{ background: 'white', padding: '4px', borderRadius: '8px', display: 'flex' }}>
              <QRCodeSVG value={backendConfig.getJoinUrl(roomCode)} size={view === 'drawing' ? 140 : 90} />
            </div>
            <div className="flex-col text-left">
              <span style={{ fontSize: '0.85rem', color: 'hsla(0,0%,100%,0.8)', fontWeight: 'bold', textTransform: 'uppercase' }}>Join at {backendConfig.host}/drawjudge</span>
              <span style={{ fontSize: '1.5rem', fontWeight: 900, lineHeight: 1 }}>Code: <span className="text-primary">{roomCode}</span></span>
            </div>
          </div>
        )
      )}

      {view === 'landing' && (
        <div className="landing-container">
          {/* Top Bar with Hub and Sound Toggle */}
          <div className="game-top-bar">
            <button 
              onClick={() => window.location.href = '/'}
              className="top-bar-btn icon-only"
              aria-label="Back to Hub"
            >
              <Home size={20} />
            </button>
            <div className="top-bar-right">
              <button 
                onClick={toggleSound}
                className="top-bar-btn icon-only"
                title={soundEnabled ? "Mute Sound" : "Enable Sound"}
                aria-label="Sound Toggle"
              >
                {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
              </button>
            </div>
          </div>

          <div className="text-center mb-2">
            <img src={mainLogo} alt="Draw Judge Logo" onClick={handleLogoTap} style={{ width: '100%', maxWidth: '220px', height: 'auto', margin: '0 auto', display: 'block', filter: 'drop-shadow(0 0 16px hsla(45, 100%, 50%, 0.25))' }} />
            <p className="subtitle mt-1" style={{ marginBottom: '12px' }}>Draw. Submit. Let AI decide.</p>
          </div>

          {/* Host Fallback Recovery Card */}
          {savedHostSession && (
            <div className="host-recovery-banner">
              <div className="host-recovery-content">
                <span className="host-recovery-icon">👑</span>
                <div>
                  <div className="host-recovery-title">Active Host Session Found</div>
                  <div className="host-recovery-desc">Room Code: <strong style={{ color: 'var(--primary)', fontSize: '1.05rem' }}>{savedHostSession.roomCode}</strong></div>
                </div>
              </div>
              <div className="host-recovery-actions">
                <button className="btn-primary" onClick={handleResumeHostSession}>
                  Resume Hosting
                </button>
                <button className="btn-secondary" onClick={handleDismissHostSession}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="glass-panel flex-col" style={{ maxWidth: '420px', width: '100%', margin: '0 auto' }}>
            <button className="btn-primary" onClick={handleCreateRoom}><Play size={20} /> Create Game</button>
            <button className="btn-secondary" onClick={() => setView('join')}><Users size={20} /> Join Room</button>
            <button className="btn-secondary" onClick={() => { setTutorialStep(0); setShowTutorial(true); }} style={{ background: 'rgba(255,255,255,0.1)', marginTop: '4px' }}>
              ❓ How to Play
            </button>
            {isDebugMode && (
              <button
                onClick={testConnection}
                style={{ marginTop: '16px', background: 'transparent', color: 'rgba(255,255,255,0.5)', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                {isTesting ? 'Testing...' : 'Debug: Test Connection to PC'}
              </button>
            )}
          </div>
        </div>
      )}

      {view === 'join' && (
        <div className="landing-container">
          <div className="glass-panel flex-col" style={{ width: '100%', maxWidth: '420px' }}>
            <div className="flex-row" style={{ width: '100%', justifyContent: 'space-between', marginBottom: '12px' }}>
              {!isInviteLink ? (
                <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.9rem' }} onClick={() => setView('landing')}><ArrowLeft size={18} /> Back</button>
              ) : <div />}
              <button onClick={() => { setTutorialStep(0); setShowTutorial(true); }} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>
                ❓ How to Play
              </button>
            </div>
            <h2 className="title-giant" style={{ fontSize: '2.4rem', marginBottom: '8px' }}>JOIN</h2>
            <input type="text" className="input-field mb-3" placeholder="ROOM CODE" maxLength={6} value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} />
            <input type="text" className="input-field mb-4" placeholder="YOUR NAME" maxLength={12} value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
            <button className="btn-primary" onClick={submitJoin} disabled={!roomCode || !playerName}>Enter Lobby</button>
          </div>
        </div>
      )}

      {view === 'hostLobby' && (
        <div className="dashboard-layout animate-slide-up">
          <div className="dashboard-main" style={{ gap: '16px' }}>
            {/* Connection Card (QR + How to Play side-by-side) */}
            <div className="glass-panel" style={{ padding: '20px' }}>
              <div className="lobby-connection-row">
                <div className="lobby-qr-column">
                  <QRCodeSVG value={backendConfig.getJoinUrl(roomCode)} size={260} />
                </div>
                <div className="lobby-info-column">
                  <div className="lobby-info-header">
                    <span style={{ fontSize: '0.9rem', color: 'hsla(0,0%,100%,0.6)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>Room Code</span>
                    <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--primary)', margin: 0, lineHeight: 1 }}>{roomCode}</h2>
                  </div>
                  <div className="lobby-instructions">
                    <h3 className="lobby-instructions-title">How to Play</h3>
                    <ol className="lobby-instructions-list">
                      <li>Scan the QR code with your mobile device.</li>
                      <li>Wait for the Host to configure and start the round.</li>
                      <li>Follow the prompt and draw on your phone screen!</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>

            {/* Players Card */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '12px', textAlign: 'left' }}>Players Joined ({players.length})</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', overflowY: 'auto', flex: 1 }}>
                {players.length === 0 ? (
                  <span style={{ color: 'hsla(0,0%,100%,0.4)', fontStyle: 'italic' }}>Waiting for players to join...</span>
                ) : (
                  players.map((p, i) => <span key={i} style={{ background: 'hsla(0,0%,100%,0.1)', padding: '6px 14px', borderRadius: '16px', fontSize: '0.95rem' }}>{p.name}</span>)
                )}
              </div>
            </div>
          </div>

          {/* Settings Sidebar */}
          <div className="dashboard-sidebar" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '16px' }}>
            <div className="flex-col" style={{ gap: '14px' }}>
              <h3 style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--primary)', marginBottom: '4px' }}>GAME SETTINGS</h3>
              
              <div className="flex-col" style={{ gap: '6px', textAlign: 'left' }}>
                <label style={{ fontSize: '0.8rem', color: 'hsla(0,0%,100%,0.7)', fontWeight: 'bold' }}>GAME MODE</label>
                <select className="input-field" value={hostSelectedMode} onChange={e => setHostSelectedMode(e.target.value)} style={{ fontSize: '0.9rem', padding: '8px 12px' }}>
                  <option value="classic">🏆 Classic Mode (60s)</option>
                  <option value="speed">⚡ Speed Sketch (15s)</option>
                  <option value="blind">🙈 Blind Draw (3s Prompt)</option>
                </select>
              </div>

              <div className="flex-col" style={{ gap: '6px', textAlign: 'left' }}>
                <label style={{ fontSize: '0.8rem', color: 'hsla(0,0%,100%,0.7)', fontWeight: 'bold' }}>TOTAL ROUNDS</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[3, 5, 10, 15].map(r => (
                    <button
                      key={r}
                      className={maxRounds === r ? 'btn-primary' : 'btn-secondary'}
                      style={{ flex: 1, padding: '8px 0', fontSize: '0.95rem', margin: 0 }}
                      onClick={() => {
                        if (ws.current) ws.current.send(JSON.stringify({ event: 'update_settings', max_rounds: r }));
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-col" style={{ gap: '6px', textAlign: 'left' }}>
                <label style={{ fontSize: '0.8rem', color: 'hsla(0,0%,100%,0.7)', fontWeight: 'bold' }}>THEME / PROMPT DECK</label>
                <select className="input-field" value={theme} onChange={e => {
                  const val = e.target.value;
                  setTheme(val);
                  if (ws.current) {
                    ws.current.send(JSON.stringify({ event: 'update_settings', theme: val }));
                  }
                }} style={{ fontSize: '0.9rem', padding: '8px 12px' }}>
                  <option value="Family">🏡 Family Friendly</option>
                  <option value="Kids">🧸 Kids & Silly</option>
                  <option value="Couples">💔 Couples Arguments</option>
                  <option value="Office">👔 Office Chaos</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button 
                className="btn-secondary" 
                onClick={() => setShowExitConfirm(true)} 
                style={{ padding: '10px 16px', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px', width: 'auto' }}
                title="Exit Game Room"
              >
                <LogOut size={18} /> Exit
              </button>
              <button className="btn-primary" onClick={handleStartGame} style={{ flex: 1, padding: '10px 16px', fontSize: '1rem' }}>Start Round</button>
            </div>
          </div>
        </div>
      )}

      {view === 'playerLobby' && (
        <div className="glass-panel flex-col text-center">
          <h2 className="title-giant" style={{ fontSize: '2.5rem' }}>CONNECTED</h2>
          <p className="subtitle mb-4">Waiting for Host to start the next action...</p>

          {hasSubmittedThisRound && hasSubmittedImage && (
            <div className="mb-4 animate-fade-in" style={{ background: 'rgba(0,0,0,0.5)', padding: '16px', borderRadius: '16px' }}>
              <span style={{ color: '#4ade80', fontWeight: 'bold', fontSize: '1.2rem', display: 'block', marginBottom: '8px' }}>✅ Drawing Submitted Successfully!</span>
              <div className="mt-2" style={{ display: 'flex', justifyContent: 'center' }}>
                <img src={hasSubmittedImage} alt="Your submission" style={{ width: '100%', maxWidth: '240px', aspectRatio: '3/4', objectFit: 'contain', borderRadius: '8px', border: '2px solid hsla(0,0%,100%,0.2)', backgroundColor: 'black' }} />
              </div>
            </div>
          )}

          {currentRound > 0 && (
            <div style={{ background: 'rgba(0,0,0,0.5)', padding: '16px', borderRadius: '16px' }}>
              <h3 style={{ fontSize: '1.2rem', color: 'hsla(0,0%,100%,0.8)', marginBottom: '8px' }}>Current Progress</h3>
              <h1 style={{ fontSize: '2.5rem', color: 'var(--primary)', fontWeight: 900, lineHeight: 1 }}>Round {currentRound} / {maxRounds}</h1>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '20px', flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={handleLeaveRoom} style={{ padding: '10px 20px', fontSize: '0.95rem', display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'auto' }}>
              <ArrowLeft size={18} /> Leave Room
            </button>
            <button className="btn-secondary" onClick={() => { setTutorialStep(0); setShowTutorial(true); }} style={{ padding: '10px 20px', fontSize: '0.95rem', width: 'auto' }}>
              ❓ Rules
            </button>
          </div>
        </div>
      )}

      {view === 'drawing' && (
        isHostUser ? (
          <div className="dashboard-layout animate-slide-up">
            <div className="dashboard-main justify-center items-center">
              <div className="glass-panel text-center w-full host-drawing-panel">
                <h2 className={`title-giant mb-4 ${timeLeft <= 10 ? 'text-primary' : ''}`} style={{ fontSize: '4rem', textShadow: '0 0 20px hsla(320,90%,65%,0.3)' }}>
                  {timeLeft}s
                </h2>
                <p className="subtitle mb-8 host-prompt-text">
                  Prompt: "{gameMode === 'blind' ? '???' : prompt}"
                </p>
                <div className="host-received-box">
                  <h3 className="host-received-title">RECEIVED</h3>
                  <h1 className="host-received-count">{submissionCount} / {players.length}</h1>
                </div>
                <p className="subtitle" style={{ color: 'hsla(0,0%,100%,0.7)', fontSize: '1.2rem' }}>Look at your phones to draw!</p>
              </div>
            </div>
            <div className="dashboard-sidebar">
              <h3 className="text-center" style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white' }}>PLAYERS ({players.length})</h3>
              <div className="flex-col" style={{ gap: '8px' }}>
                {players.map((p, i) => (
                  <div key={i} className="glass-panel" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.5)' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>{p.name}</span>
                    <span className="text-primary" style={{ fontWeight: 'bold' }}>{p.score} pts</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <DrawCanvas key={`canvas-r${currentRound}-${prompt}`} onSubmit={handleDrawSubmit} prompt={prompt} timeLeft={timeLeft} mode={gameMode} />
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
        currentRound >= maxRounds && !hostShowAllHistory ? (
          /* ==========================================================================
             HOST GRAND CHAMPION PODIUM CEREMONY (100VH BALANCED / NO DEAD SPACE)
             ========================================================================== */
          (() => {
            const sortedLeaderboard = [...players].sort((a, b) => b.score - a.score);
            const grandChampion = sortedLeaderboard[0];
            const secondPlace = sortedLeaderboard[1];
            const thirdPlace = sortedLeaderboard[2];
            const otherRankedPlayers = sortedLeaderboard.slice(3);

            // History drawings for the champion, second, and third place
            const champHistory = (grandChampion && grandChampion.id ? allPlayerHistory[grandChampion.id] : null) 
              || selectedPlayerHistory 
              || results.filter(r => r.submission_id === grandChampion?.id);

            const secondHistory = (secondPlace && secondPlace.id ? allPlayerHistory[secondPlace.id] : null)
              || results.filter(r => r.submission_id === secondPlace?.id);

            const thirdHistory = (thirdPlace && thirdPlace.id ? allPlayerHistory[thirdPlace.id] : null)
              || results.filter(r => r.submission_id === thirdPlace?.id);

            return (
              <div className="host-grand-champion-screen animate-pop-in">
                {/* Header */}
                <div className="champion-ceremony-header">
                  <div className="champion-trophy-icon">🏆</div>
                  <h1 className="champion-ceremony-title">GRAND CHAMPION CROWNED!</h1>
                  <p className="champion-ceremony-sub">
                    All {maxRounds} Rounds Complete • Ultimate Victory!
                  </p>
                </div>

                {/* Left-to-Right Hierarchy: 1st Place (Champion) -> 2nd Place -> 3rd Place */}
                <div className={`champion-podium-row ${!thirdPlace ? 'two-players' : 'three-players'}`}>
                  {/* 1st Place Grand Champion (Primary Visual Hero on Left) */}
                  {grandChampion && (
                    <div className="glass-panel champion-podium-card champion-card-first animate-pop-in">
                      <div className="podium-crown-badge">👑 1ST PLACE CHAMPION 🏆</div>
                      <h1 className="champion-player-name">{grandChampion.name}</h1>
                      <div className="champion-score-wrap">
                        <span className="champion-score-val">{grandChampion.score}</span>
                        <span className="champion-score-unit">PTS</span>
                      </div>

                      {/* Champion's Masterpieces Showcase */}
                      <div className="champion-showcase-title">🎨 CHAMPION'S MASTERPIECES</div>
                      <div className="champion-mosaic-gallery">
                        {(champHistory && champHistory.length > 0 ? champHistory.slice(0, 3) : results.slice(0, 1)).map((item: any, idx: number) => (
                          <div key={idx} className="champion-mosaic-item">
                            <span className="mosaic-round-pill">Round {item.round || (idx + 1)}</span>
                            {item.image && (
                              <img src={item.image} alt="Champion Artwork" className="champion-mosaic-img" />
                            )}
                            <span className="mosaic-prompt-text" title={item.prompt}>"{item.prompt || 'Masterpiece'}"</span>
                            <span className="mosaic-score-text">{item.total_score} pts</span>
                          </div>
                        ))}
                      </div>

                      {winnerExplanation && (
                        <div className="champion-ai-verdict">
                          🤖 <strong>AI Verdict:</strong> "{winnerExplanation}"
                        </div>
                      )}
                    </div>
                  )}

                  {/* 2nd Place Runner-Up (Full Gallery of Designs) */}
                  {secondPlace && (
                    <div className="glass-panel champion-podium-card champion-card-second animate-slide-up">
                      <div className="podium-rank-badge silver">🥈 2ND PLACE RUNNER-UP</div>
                      <h2 className="podium-player-name">{secondPlace.name}</h2>
                      <div className="podium-score-wrap">
                        <span className="podium-score-val silver">{secondPlace.score}</span>
                        <span className="podium-score-unit">PTS</span>
                      </div>

                      {/* 2nd Place All Designs Showcase */}
                      <div className="podium-showcase-title silver">🎨 RUNNER-UP MASTERPIECES</div>
                      <div className="champion-mosaic-gallery">
                        {(secondHistory && secondHistory.length > 0 ? secondHistory.slice(0, 3) : results.filter(r => r.submission_id === secondPlace.id).slice(0, 1)).map((item: any, idx: number) => (
                          <div key={idx} className="champion-mosaic-item silver-item">
                            <span className="mosaic-round-pill silver">Round {item.round || (idx + 1)}</span>
                            {item.image && (
                              <img src={item.image} alt="Runner-up Artwork" className="champion-mosaic-img" />
                            )}
                            <span className="mosaic-prompt-text" title={item.prompt}>"{item.prompt || 'Artwork'}"</span>
                            <span className="mosaic-score-text silver">{item.total_score} pts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3rd Place Runner-Up (Full Gallery of Designs) */}
                  {thirdPlace && (
                    <div className="glass-panel champion-podium-card champion-card-third animate-slide-up">
                      <div className="podium-rank-badge bronze">🥉 3RD PLACE RUNNER-UP</div>
                      <h2 className="podium-player-name">{thirdPlace.name}</h2>
                      <div className="podium-score-wrap">
                        <span className="podium-score-val bronze">{thirdPlace.score}</span>
                        <span className="podium-score-unit">PTS</span>
                      </div>

                      {/* 3rd Place All Designs Showcase */}
                      <div className="podium-showcase-title bronze">🎨 3RD PLACE MASTERPIECES</div>
                      <div className="champion-mosaic-gallery">
                        {(thirdHistory && thirdHistory.length > 0 ? thirdHistory.slice(0, 3) : results.filter(r => r.submission_id === thirdPlace.id).slice(0, 1)).map((item: any, idx: number) => (
                          <div key={idx} className="champion-mosaic-item bronze-item">
                            <span className="mosaic-round-pill bronze">Round {item.round || (idx + 1)}</span>
                            {item.image && (
                              <img src={item.image} alt="3rd Place Artwork" className="champion-mosaic-img" />
                            )}
                            <span className="mosaic-prompt-text" title={item.prompt}>"{item.prompt || 'Artwork'}"</span>
                            <span className="mosaic-score-text bronze">{item.total_score} pts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Other Ranked Players Ticker (4th, 5th, etc.) */}
                {otherRankedPlayers.length > 0 && (
                  <div className="champion-other-players-ticker">
                    {otherRankedPlayers.map((p, idx) => (
                      <span key={p.id} className="other-player-pill">
                        #{idx + 4} {p.name}: <strong>{p.score} pts</strong>
                      </span>
                    ))}
                  </div>
                )}

                {/* Bottom Action Bar */}
                <div className="champion-ceremony-actions">
                  <button 
                    className="btn-secondary" 
                    onClick={() => setHostShowAllHistory(true)}
                    style={{ padding: '12px 24px', fontSize: '1.1rem' }}
                  >
                    📊 View Detailed Standings
                  </button>
                  <button 
                    className="btn-primary" 
                    onClick={() => {
                      setView('hostLobby');
                      if (ws.current) ws.current.send(JSON.stringify({ event: 'return_to_lobby' }));
                    }}
                    style={{ padding: '12px 32px', fontSize: '1.25rem', fontWeight: 900 }}
                  >
                    🏆 Setup New Game
                  </button>
                </div>
              </div>
            );
          })()
        ) : (
          /* ==========================================================================
             REGULAR ROUND RESULTS (OR DETAILED STANDINGS VIEW)
             ========================================================================== */
          <div className="host-results-container animate-pop-in">
            <div className="host-results-header">
              <div className="host-results-title-badge">
                <Crown size={28} className="text-primary inline" />
                <span>{currentRound >= maxRounds ? 'FINAL ROUND RESULTS' : `ROUND ${currentRound} WINNER`}</span>
              </div>
              {roundSummary && (
                <p className="host-results-summary">
                  🎭 "{roundSummary}"
                </p>
              )}
            </div>

            <div className="host-results-grid">
              {/* Winner Card */}
              <div className="glass-panel host-winner-card">
                <div className="host-winner-badge">
                  <Crown size={22} />
                  <span>1ST PLACE • {players.find(p => p.id === results[0]?.submission_id)?.name || 'Winner'}</span>
                </div>
                <div className="host-winner-content">
                  {results[0]?.image && (
                    <div className="host-winner-image-wrap">
                      <img src={results[0].image} alt="Winner Drawing" className="host-winner-image" />
                    </div>
                  )}
                  <div className="host-winner-details">
                    <div className="host-winner-score-row">
                      <span className="host-winner-score-val">{results[0]?.total_score}</span>
                      <span className="host-winner-score-unit">PTS</span>
                    </div>

                    {results[0]?.scores && (
                      <div className="score-metrics-wrap">
                        <span className="metric-pill">🎯 Rel: {results[0].scores.prompt_relevance}</span>
                        <span className="metric-pill">💡 Cre: {results[0].scores.creativity}</span>
                        <span className="metric-pill">✏️ Cla: {results[0].scores.clarity}</span>
                        <span className="metric-pill">😂 Fun: {results[0].scores.entertainment}</span>
                      </div>
                    )}

                    <div className="host-ai-quote">
                      "{results[0]?.comment}"
                    </div>

                    {winnerExplanation && (
                      <div className="host-ai-verdict">
                        🤖 <strong>Why they won:</strong> {winnerExplanation}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Runner Ups Column */}
              <div className="host-runnerups-column">
                <div className="host-runnerups-header">
                  <span>🏅 RUNNER-UPS</span>
                  <span className="host-runnerups-count">{results.slice(1).length} entries</span>
                </div>
                <div className="host-runnerups-list">
                  {results.slice(1).map((r, i) => {
                    const player = players.find(p => p.id === r.submission_id) || { name: 'Unknown' };
                    return (
                      <div key={i} className="glass-panel host-runnerup-card">
                        {r.image && (
                          <img src={r.image} alt="Drawing" className="host-runnerup-thumb" />
                        )}
                        <div className="host-runnerup-info">
                          <div className="host-runnerup-top">
                            <span className="host-runnerup-name">#{i + 2} {player.name}</span>
                            <div className="host-runnerup-score">
                              <span className="score-val">{r.total_score}</span>
                              <span className="score-unit">pts</span>
                            </div>
                          </div>

                          {r.scores && (
                            <div className="score-metrics-mini">
                              <span>Rel {r.scores.prompt_relevance}</span>
                              <span>Cre {r.scores.creativity}</span>
                              <span>Cla {r.scores.clarity}</span>
                              <span>Fun {r.scores.entertainment}</span>
                            </div>
                          )}

                          <div className="host-runnerup-comment">
                            "{r.comment}"
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="host-results-actions" style={{ gap: '16px' }}>
              {currentRound >= maxRounds ? (
                <>
                  <button className="btn-secondary host-leaderboard-btn" onClick={() => setHostShowAllHistory(false)}>
                    🏆 Show Champion Podium
                  </button>
                  <button className="btn-primary" style={{ padding: '14px 28px', fontSize: '1.25rem', fontWeight: 800 }} onClick={() => {
                    setView('hostLobby');
                    if (ws.current) ws.current.send(JSON.stringify({ event: 'return_to_lobby' }));
                  }}>
                    🏆 Setup New Game
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-secondary host-leaderboard-btn" onClick={() => setView('leaderboard')}>
                    View Standings 🏆
                  </button>
                  <button 
                    className="btn-primary" 
                    style={{ padding: '14px 32px', fontSize: '1.25rem', fontWeight: 800 }}
                    disabled={isStartingNextRound}
                    onClick={() => {
                      if (ws.current) ws.current.send(JSON.stringify({ event: 'start_round', mode: hostSelectedMode }));
                    }}
                  >
                    {isStartingNextRound ? '⏳ Starting Next Round...' : 'Start Next Round 🚀'}
                  </button>
                </>
              )}
            </div>
          </div>
        )
      )}

      {/* ==========================================================================
         PARTICIPANT / PLAYER RESULTS (3-TAB SEGMENTED EXPERIENCE)
         ========================================================================== */}
      {view === 'results' && !isHostUser && (
        <div className="player-results-container animate-slide-up">
          {/* Header Status Bar */}
          <div className="player-results-status-bar">
            {currentRound >= maxRounds ? (
              <div className="player-host-alert-pill winner-pill">
                <span>🏆 FINAL GAME RESULTS 🏆</span>
              </div>
            ) : (
              <div className="player-host-alert-pill">
                <span className="live-pulse-dot" />
                <span>Round {currentRound} of {maxRounds} • AI Scored!</span>
              </div>
            )}
          </div>

          {/* Next round starting banner if host triggered it */}
          {isStartingNextRound && (
            <div className="round-starting-alert animate-pulse">
              ⏳ Host is starting the next round... Ready your canvas!
            </div>
          )}

          {/* 3-Tab Segmented Control */}
          <div className="player-results-segmented-tabs">
            <button
              className={`segmented-tab-btn ${playerResultsTab === 'my_result' ? 'active' : ''}`}
              onClick={() => setPlayerResultsTab('my_result')}
            >
              🎨 My Score
            </button>
            <button
              className={`segmented-tab-btn ${playerResultsTab === 'all_drawings' ? 'active' : ''}`}
              onClick={() => setPlayerResultsTab('all_drawings')}
            >
              🖼️ All Drawings ({results.length})
            </button>
            <button
              className={`segmented-tab-btn ${playerResultsTab === 'standings' ? 'active' : ''}`}
              onClick={() => setPlayerResultsTab('standings')}
            >
              🏆 Standings
            </button>
          </div>

          {/* TAB 1: MY SCORE */}
          {playerResultsTab === 'my_result' && (() => {
            const myRank = results.findIndex(r => r.submission_id === playerId);
            const myRes = myRank !== -1 ? results[myRank] : null;
            if (!myRes) {
              return (
                <div className="glass-panel text-center" style={{ padding: '32px 16px' }}>
                  <p className="subtitle">No drawing submitted this round.</p>
                  <button className="btn-secondary mt-4 w-full" onClick={() => setPlayerResultsTab('all_drawings')}>
                    View Everyone's Drawings 🖼️
                  </button>
                </div>
              );
            }

            const rankText = myRank === 0 
              ? '👑 1st Place • Winner!' 
              : myRank === 1 
              ? '🥈 2nd Place' 
              : myRank === 2 
              ? '🥉 3rd Place' 
              : `🎨 Placement: #${myRank + 1}`;

            return (
              <div className="player-tab-content animate-slide-up">
                <div className="glass-panel player-card-showcase" id="my-share-card">
                  <div className={`player-rank-badge ${myRank === 0 ? 'winner' : ''}`}>
                    <span>{rankText}</span>
                  </div>

                  {myRes.image && (
                    <div className="player-artwork-frame">
                      <img src={myRes.image} alt="Your Drawing" className="player-artwork-img" />
                    </div>
                  )}

                  <div className="player-score-banner">
                    <span className="player-score-label">ROUND SCORE</span>
                    <div className="player-score-val-row">
                      <span className="player-score-number">{myRes.total_score}</span>
                      <span className="player-score-pts">PTS</span>
                    </div>
                    {roundDeltas[playerId] !== undefined && roundDeltas[playerId] > 0 && (
                      <span className="delta-badge" style={{ marginTop: '4px' }}>
                        ↑ +{roundDeltas[playerId]} pts added to total
                      </span>
                    )}
                  </div>

                  {myRes.scores && (
                    <div className="player-metrics-grid">
                      <div className="metric-chip"><span>🎯 Relevance</span><strong>{myRes.scores.prompt_relevance}</strong></div>
                      <div className="metric-chip"><span>💡 Creativity</span><strong>{myRes.scores.creativity}</strong></div>
                      <div className="metric-chip"><span>✏️ Clarity</span><strong>{myRes.scores.clarity}</strong></div>
                      <div className="metric-chip"><span>😂 Fun</span><strong>{myRes.scores.entertainment}</strong></div>
                    </div>
                  )}

                  <div className="player-ai-comment-card">
                    <div className="comment-header">🤖 AI JUDGE FEEDBACK</div>
                    <p className="comment-quote">"{myRes.comment}"</p>
                  </div>
                </div>

                <button
                  className="btn-primary w-full player-share-btn mt-2"
                  disabled={isSharing}
                  onClick={() => handleShare('my-share-card', 'MyDrawing')}
                >
                  {isSharing ? <Loader2 size={20} className="animate-spin" /> : <Share2 size={20} />}
                  <span>{isSharing ? 'Generating Image...' : 'Share Drawing 📸'}</span>
                </button>
              </div>
            );
          })()}

          {/* TAB 2: ALL DRAWINGS (Everyone else's as well) */}
          {playerResultsTab === 'all_drawings' && (
            <div className="player-tab-content animate-slide-up">
              <div className="player-all-drawings-list">
                {results.map((r, i) => {
                  const player = players.find(p => p.id === r.submission_id) || { name: 'Player' };
                  const isMe = r.submission_id === playerId;
                  return (
                    <div key={i} className={`glass-panel player-gallery-card ${isMe ? 'my-highlight-card' : ''}`}>
                      <div 
                        className="gallery-card-top" 
                        style={{ cursor: 'pointer' }} 
                        onClick={() => openPlayerHistoryGallery({ id: r.submission_id, name: player.name })}
                        title={`Tap to view all of ${player.name}'s drawings`}
                      >
                        <span className={`gallery-rank-pill ${i === 0 ? 'winner' : ''}`}>
                          {i === 0 ? '👑 1ST' : i === 1 ? '🥈 2ND' : i === 2 ? '🥉 3RD' : `#${i + 1}`}
                        </span>
                        <h4 className="gallery-player-name">
                          {player.name} {isMe && <span className="you-tag">(You)</span>}
                        </h4>
                        <span className="view-gallery-pill" style={{ marginLeft: 'auto', marginRight: '6px' }}>
                          🎨 History ❯
                        </span>
                        <div className="gallery-score-badge">
                          <span className="score-val">{r.total_score}</span>
                          <span className="score-unit">pts</span>
                        </div>
                      </div>

                      {r.image && (
                        <div className="player-artwork-frame small">
                          <img src={r.image} alt={`${player.name}'s Drawing`} className="player-artwork-img" />
                        </div>
                      )}

                      {r.scores && (
                        <div className="player-metrics-grid mini">
                          <div className="metric-chip">Rel: <strong>{r.scores.prompt_relevance}</strong></div>
                          <div className="metric-chip">Cre: <strong>{r.scores.creativity}</strong></div>
                          <div className="metric-chip">Cla: <strong>{r.scores.clarity}</strong></div>
                          <div className="metric-chip">Fun: <strong>{r.scores.entertainment}</strong></div>
                        </div>
                      )}

                      <div className="player-ai-comment-card mini">
                        <p className="comment-quote">"{r.comment}"</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: STANDINGS / LEADERBOARD (Click any player to view their drawings) */}
          {playerResultsTab === 'standings' && (
            <div className="player-tab-content animate-slide-up">
              <div className="glass-panel text-center" style={{ padding: '20px 14px' }}>
                <Trophy size={32} className="text-primary" style={{ margin: '0 auto 8px auto' }} />
                <h3 className="title-giant" style={{ fontSize: '1.6rem', marginBottom: '2px' }}>
                  {currentRound >= maxRounds ? 'FINAL STANDINGS' : 'OVERALL STANDINGS'}
                </h3>
                <p className="subtitle" style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
                  {currentRound >= maxRounds ? 'Total Game Scores' : `Round ${currentRound} of ${maxRounds}`}
                </p>
                <div className="standings-tap-hint">
                  💡 Tap any player to see all their drawings across all rounds!
                </div>

                <div className="leaderboard-list">
                  {[...players].sort((a, b) => b.score - a.score).map((p, i) => (
                    <div 
                      key={i} 
                      className={`leaderboard-row ${i === 0 ? 'leaderboard-row-first' : ''} ${p.id === playerId ? 'leaderboard-row-me' : ''}`}
                      onClick={() => openPlayerHistoryGallery(p)}
                      title={`Tap to view all of ${p.name}'s designs`}
                    >
                      <div className="leaderboard-col-player">
                        <div className={`rank-badge rank-badge-${i + 1}`}>
                          {i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                        </div>
                        <span className="player-row-name" title={p.name}>
                          {p.name} {p.id === playerId && '(You)'}
                        </span>
                      </div>

                      <div className="leaderboard-col-delta">
                        {roundDeltas[p.id || ''] !== undefined && roundDeltas[p.id || ''] > 0 && (
                          <span className="delta-badge">
                            ↑ +{roundDeltas[p.id || '']}
                          </span>
                        )}
                      </div>

                      <div className="leaderboard-col-action">
                        <span className="view-gallery-pill">🎨 View Art ❯</span>
                      </div>

                      <div className="leaderboard-col-score">
                        <span className="score-val">{p.score}</span>
                        <span className="score-unit">PTS</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="player-waiting-bottom-pill">
            <span className="live-pulse-dot" />
            <span>Waiting for Host to start next round...</span>
          </div>
        </div>
      )}

      {view === 'leaderboard' && (
        isHostUser ? (
          <div className="dashboard-layout animate-slide-up">
            <div className="dashboard-main glass-panel text-center">
              <Trophy size={40} className="text-primary mb-2" style={{ margin: '0 auto' }} />
              <h2 className="title-giant" style={{ fontSize: '2.4rem', marginBottom: '4px' }}>
                {currentRound >= maxRounds ? "FINAL RESULTS" : "LEADERBOARD"}
              </h2>
              <p className="subtitle mb-6" style={{ fontSize: '1.1rem', color: 'hsla(0,0%,100%,0.8)' }}>
                {currentRound >= maxRounds ? "The Ultimate Winner has been crowned!" : `Round ${currentRound} of ${maxRounds}`}
              </p>

              <div className="leaderboard-list">
                {[...players].sort((a, b) => b.score - a.score).map((p, i) => (
                  <div key={i} className={`leaderboard-row ${i === 0 ? 'leaderboard-row-first' : ''}`}
                    onClick={() => openPlayerHistoryGallery(p)}
                    title={`Tap to view all of ${p.name}'s drawings`}
                  >
                    <div className="leaderboard-col-player">
                      <div className={`rank-badge rank-badge-${i + 1}`}>
                        {i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </div>
                      <span className="player-row-name" title={p.name}>
                        {p.name}
                      </span>
                    </div>

                    <div className="leaderboard-col-delta">
                      {roundDeltas[p.id || ''] !== undefined && roundDeltas[p.id || ''] > 0 && (
                        <span className="delta-badge">
                          ↑ +{roundDeltas[p.id || '']}
                        </span>
                      )}
                    </div>

                    <div className="leaderboard-col-action">
                      <span className="view-gallery-pill">🎨 View Art ❯</span>
                    </div>

                    <div className="leaderboard-col-score">
                      <span className="score-val">{p.score}</span>
                      <span className="score-unit">PTS</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="dashboard-sidebar justify-center">
              <div className="glass-panel flex-col text-center" style={{ background: 'rgba(0,0,0,0.5)', padding: '28px' }}>
                <h3 className="mb-4" style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--primary)' }}>HOST CONTROLS</h3>
                {currentRound < maxRounds && (
                  <button className="btn-secondary w-full mb-3" onClick={() => setView('results')}>🔙 Show Round Winner</button>
                )}
                {currentRound >= maxRounds ? (
                  <button className="btn-secondary" style={{ border: '2px solid var(--primary)' }} onClick={() => {
                    setView('hostLobby');
                    if (ws.current) ws.current.send(JSON.stringify({ event: 'return_to_lobby' }));
                  }}>🏆 Setup New Game</button>
                ) : (
                  <>
                    <button className="btn-secondary w-full mb-3" onClick={() => {
                      setView('hostLobby');
                      if (ws.current) ws.current.send(JSON.stringify({ event: 'return_to_lobby' }));
                    }}>⚙️ Settings & Setup</button>
                    <button 
                      className="btn-primary" 
                      style={{ padding: '20px', fontSize: '1.35rem' }} 
                      disabled={isStartingNextRound}
                      onClick={() => {
                        if (ws.current) ws.current.send(JSON.stringify({ event: 'start_round', mode: hostSelectedMode }));
                      }}
                    >
                      {isStartingNextRound ? '⏳ Generating Next Round...' : 'Start Next Round 🚀'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="player-leaderboard-container animate-slide-up">
            <div className="glass-panel text-center" style={{ padding: '24px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Trophy size={36} className="text-primary" style={{ margin: '0 auto' }} />
              <h2 className="title-giant" style={{ fontSize: '2rem', marginBottom: '2px' }}>
                {currentRound >= maxRounds ? "FINAL RESULTS" : "LEADERBOARD"}
              </h2>
              <p className="subtitle" style={{ fontSize: '0.95rem', marginBottom: '12px' }}>
                {currentRound >= maxRounds ? "The Ultimate Winner has been crowned!" : `Round ${currentRound} of ${maxRounds}`}
              </p>
              <div className="standings-tap-hint">
                💡 Tap any player to see all their drawings across all rounds!
              </div>

              <div className="leaderboard-list">
                {[...players].sort((a, b) => b.score - a.score).map((p, i) => (
                  <div key={i} className={`leaderboard-row ${i === 0 ? 'leaderboard-row-first' : ''}`}
                    onClick={() => openPlayerHistoryGallery(p)}
                    title={`Tap to view all of ${p.name}'s drawings`}
                  >
                    <div className="leaderboard-col-player">
                      <div className={`rank-badge rank-badge-${i + 1}`}>
                        {i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </div>
                      <span className="player-row-name" title={p.name}>
                        {p.name}
                      </span>
                    </div>

                    <div className="leaderboard-col-delta">
                      {roundDeltas[p.id || ''] !== undefined && roundDeltas[p.id || ''] > 0 && (
                        <span className="delta-badge">
                          ↑ +{roundDeltas[p.id || '']}
                        </span>
                      )}
                    </div>

                    <div className="leaderboard-col-action">
                      <span className="view-gallery-pill">🎨 View Art ❯</span>
                    </div>

                    <div className="leaderboard-col-score">
                      <span className="score-val">{p.score}</span>
                      <span className="score-unit">PTS</span>
                    </div>
                  </div>
                ))}
              </div>

              {currentRound < maxRounds && (
                <button className="btn-secondary w-full mt-3" onClick={() => setView('results')}>
                  🔙 Back to Results
                </button>
              )}
              <p className="subtitle" style={{ margin: 0, fontSize: '0.85rem' }}>Waiting for Host...</p>
            </div>
          </div>
        )
      )}

      {/* History Modal Overlay for inspecting any player's designs or the Grand Recap */}
      {selectedPlayerHistory && (
        <div className="player-history-modal-overlay animate-fade-in" onClick={() => setSelectedPlayerHistory(null)}>
          <div className="player-history-modal-container animate-slide-up" onClick={(e) => e.stopPropagation()}>
            
            {/* Header */}
            <div className="player-history-modal-header">
              <div className="player-history-title-wrap">
                <h2 className="player-history-title">
                  {selectedPlayerName === playerName || (playerId && players.find(p => p.id === playerId)?.name === selectedPlayerName)
                    ? (currentRound >= maxRounds ? '🏆 My Draw Judge Journey' : '🎨 My Artwork History')
                    : `🎨 ${selectedPlayerName}'s Masterpieces`}
                </h2>
                <p className="player-history-subtitle">
                  Total Score: <strong style={{ color: '#fbbf24' }}>{players.find(p => p.name === selectedPlayerName)?.score ?? 0} pts</strong> • {selectedPlayerHistory.length} round{selectedPlayerHistory.length === 1 ? '' : 's'} recorded
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {(!isHostUser && currentRound >= maxRounds && (selectedPlayerName === playerName || (playerId && players.find(p => p.id === playerId)?.name === selectedPlayerName))) && (
                  <button
                    className="btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', fontSize: '0.9rem' }}
                    disabled={isSharing}
                    onClick={() => handleShare('player-history-card-grid', `${selectedPlayerName}_Recap`)}
                  >
                    {isSharing ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
                    <span>{isSharing ? 'Saving...' : 'Share Recap 📸'}</span>
                  </button>
                )}
                <button 
                  className="btn-secondary player-history-close-btn" 
                  onClick={() => setSelectedPlayerHistory(null)}
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Cards Grid */}
            <div id="player-history-card-grid" className="player-history-cards-grid">
              {selectedPlayerHistory.length === 0 ? (
                <div className="glass-panel text-center" style={{ padding: '32px', gridColumn: '1 / -1' }}>
                  <p className="subtitle">No artwork submitted yet for this player.</p>
                </div>
              ) : (
                selectedPlayerHistory.map((item, idx) => (
                  <div key={idx} className="player-history-round-card">
                    <div className="player-history-round-card-top">
                      <span className="player-history-round-pill">
                        Round {item.round || (idx + 1)}
                      </span>
                      <span className="player-history-score-pill">
                        {item.total_score} PTS
                      </span>
                    </div>

                    <p className="player-history-prompt-text" title={item.prompt}>
                      "{item.prompt || 'Artwork'}"
                    </p>

                    {item.image && (
                      <div className="player-history-img-frame">
                        <img src={item.image} alt={`Round ${item.round || (idx + 1)} artwork`} className="player-history-img" />
                      </div>
                    )}

                    {item.scores && (
                      <div className="player-metrics-grid mini">
                        <div className="metric-chip">Rel: <strong>{item.scores.prompt_relevance}</strong></div>
                        <div className="metric-chip">Cre: <strong>{item.scores.creativity}</strong></div>
                        <div className="metric-chip">Cla: <strong>{item.scores.clarity}</strong></div>
                        <div className="metric-chip">Fun: <strong>{item.scores.entertainment}</strong></div>
                      </div>
                    )}

                    {item.comment && (
                      <div className="player-history-comment-box">
                        "{item.comment}"
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <button 
                className="btn-secondary" 
                style={{ minWidth: '180px', margin: '0 auto', display: 'inline-block' }}
                onClick={() => setSelectedPlayerHistory(null)}
              >
                ✕ Close Gallery
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Feedback Trigger Button (Bottom Right) */}
      <button 
        onClick={() => {
          setFeedbackSuccess(false);
          setRating(null);
          setFeedbackComment('');
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
          <div className="glass-panel text-center" style={{ padding: '2rem', maxWidth: '420px', width: '90%', border: '2px solid var(--primary)' }}>
            <h2 style={{ fontSize: '1.8rem', color: 'var(--primary)', marginBottom: '0.5rem' }}>Quit Draw Judge?</h2>
            <p style={{ margin: '1rem 0 1.5rem 0', opacity: 0.85, fontSize: '1.05rem' }}>
              Are you sure you want to return to the Party Games Hub?
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                className="btn-primary"
                style={{ padding: '0.8rem 1.8rem', background: '#ef4444' }}
                onClick={() => window.location.href = '/'}
              >
                Quit to Hub
              </button>
              <button
                className="btn-secondary"
                style={{ padding: '0.8rem 1.8rem' }}
                onClick={() => setShowExitConfirm(false)}
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal Overlay */}
      {showFeedbackModal && (
        <div className="feedback-modal-overlay" onClick={() => setShowFeedbackModal(false)}>
          <div className="feedback-modal-content" onClick={(e) => e.stopPropagation()}>
            {!feedbackSuccess ? (
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
                    value={feedbackComment}
                    onChange={(e) => setFeedbackComment(e.target.value)}
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
                    disabled={!rating || !feedbackComment.trim() || isSubmittingFeedback}
                  >
                    {isSubmittingFeedback ? 'Sending...' : 'Submit'}
                  </button>
                </div>
              </>
            ) : (
              <div className="feedback-success-state">
                <span className="success-icon">🚀</span>
                <h2>Thank you!</h2>
                <p style={{ margin: '1rem 0 2rem 0', opacity: 0.8, textAlign: 'center' }}>
                  Your feedback helps us make Draw Judge even better.
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
    </div>
  );
}

export default App;
