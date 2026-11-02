const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// ─── Game State ────────────────────────────────────────────────────────────
const gameRooms = new Map();

const LETTER_SCORES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10
};

const normalizePlayerName = (name) =>
  name.toLowerCase().trim().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();

const wordConflict = (a, b) => {
  if (a === b) return true;
  if (a.length > 3 && b.length > 3) {
    const w1 = a.split(' ');
    const w2 = b.split(' ');
    return w1.some(x => w2.some(y => x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x))));
  }
  return false;
};

const validateAnswer = (input, letter, usedPlayers) => {
  const trimmed = input.trim();
  if (!trimmed) return { valid: false, reason: 'empty' };
  if (trimmed.length < 2) return { valid: false, reason: 'too_short' };
  if (!trimmed.toLowerCase().startsWith(letter.toLowerCase())) return { valid: false, reason: 'wrong_letter' };

  const normalized = normalizePlayerName(trimmed);
  const alreadyUsed = usedPlayers?.some(u => wordConflict(normalizePlayerName(u), normalized));
  if (alreadyUsed) return { valid: false, reason: 'already_used' };

  return { valid: true, matchedPlayer: trimmed };
};

// ─── Boot ───────────────────────────────────────────────────────────────────
app.prepare().then(() => {
  let rondaMount;
  const httpServer = createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    if (parsedUrl.pathname === '/la-ronda' || parsedUrl.pathname.startsWith('/la-ronda/')) {
      const ronda = await rondaMount;
      if (!ronda) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({error:'La Ronda is awaiting its dedicated Firebase connection.'})); return; }
      await ronda(req, res); return;
    }
    await handle(req, res, parsedUrl);
  });

  rondaMount = import('./la-ronda/shared.mjs').then(m => m.mountRonda(httpServer)).catch(() => { console.warn('La Ronda Firebase connection is not configured. A-Z Trivia remains available.'); return null; });

  const io = new Server(httpServer, {
    path: '/api/socketio',
    cors: { origin: '*', methods: ['GET', 'POST'], credentials: false },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    serveClient: false,
    destroyUpgrade: false,
    cookie: false,
  });

  // ─── Socket.io Event Handlers ────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.emit('connection-confirmed', { status: 'connected', id: socket.id });

    socket.on('join-room', ({ roomId, playerName, gameMode }) => {
      try {
        if (!gameRooms.has(roomId)) {
          gameRooms.set(roomId, {
            id: roomId,
            players: {},
            scores: {},
            currentLetter: 'A',
            currentLetterIndex: 0,
            usedPlayers: [],
            roundAnswers: {},
            timer: 30,
            isActive: false,
            gameStarted: false,
            gameMode: gameMode || 'football-modern',
            winner: null,
            timerInterval: null,
            isPaused: false,
            pausedBy: null,
          });
          console.log('Created room:', roomId);
        }

        const room = gameRooms.get(roomId);
        room.players[playerName] = { id: socket.id };
        if (!room.scores[playerName]) room.scores[playerName] = 0;

        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.playerName = playerName;

        socket.emit('join-confirmed', {
          roomId,
          playerName,
          playersCount: Object.keys(room.players).length,
        });

        io.to(roomId).emit('game-state-update', roomSnapshot(room));
        console.log(`Room ${roomId}: ${Object.keys(room.players).length} players`);
      } catch (err) {
        console.error('join-room error:', err);
        socket.emit('error-message', { message: 'Failed to join room' });
      }
    });

    socket.on('start-game', ({ roomId }) => {
      try {
        const room = gameRooms.get(roomId);
        if (!room) return socket.emit('error-message', { message: 'Room not found' });
        if (room.isActive) return socket.emit('error-message', { message: 'Game already active' });
        if (room.gameStarted && !room.winner) return socket.emit('error-message', { message: 'Game already in progress' });
        if (Object.keys(room.players).length < 1) return socket.emit('error-message', { message: 'Need at least 1 player' });

        room.isActive = true;
        room.gameStarted = true;
        room.timer = 30;
        room.roundAnswers = {};
        room.currentLetter = 'A';
        room.currentLetterIndex = 0;
        room.usedPlayers = [];
        room.winner = null;
        room.isPaused = false;
        room.pausedBy = null;
        room.scores = Object.fromEntries(Object.keys(room.players).map(p => [p, 0]));

        io.to(roomId).emit('game-started', { currentLetter: room.currentLetter, timer: room.timer });
        io.to(roomId).emit('game-state-update', roomSnapshot(room));

        startTimer(roomId);
      } catch (err) {
        console.error('start-game error:', err);
        socket.emit('error-message', { message: 'Failed to start game' });
      }
    });

    socket.on('submit-answer', ({ roomId, playerName, answer, isValid, points, matchedPlayer }) => {
      try {
        const room = gameRooms.get(roomId);
        if (!room || !room.isActive) return socket.emit('error-message', { message: 'Game not active' });

        // Use the canonical matched name (if provided by the client) for letter
        // validation — so aliases like "Dinho" → "Ronaldinho" pass the R-round check.
        const effectiveAnswer = matchedPlayer || answer;
        const serverResult = validateAnswer(effectiveAnswer, room.currentLetter, room.usedPlayers);
        const finalValid = isValid && serverResult.valid;

        room.roundAnswers[playerName] = {
          answer,
          isValid: finalValid,
          points: finalValid ? points : 0,
          matchedPlayer: serverResult.matchedPlayer || matchedPlayer,
        };

        io.to(roomId).emit('player-answered', { playerName, answered: true });

        if (Object.keys(room.roundAnswers).length >= Object.keys(room.players).length) {
          completeRound(roomId);
        }
      } catch (err) {
        console.error('submit-answer error:', err);
        socket.emit('error-message', { message: 'Failed to submit answer' });
      }
    });

    socket.on('pause-game', ({ roomId }) => {
      try {
        const room = gameRooms.get(roomId);
        if (!room || !room.isActive || room.isPaused) return;

        room.isPaused = true;
        room.pausedBy = socket.playerName || 'A player';
        if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }

        io.to(roomId).emit('game-paused', { pausedBy: room.pausedBy, timer: room.timer });
        io.to(roomId).emit('game-state-update', roomSnapshot(room));
      } catch (err) {
        console.error('pause-game error:', err);
      }
    });

    socket.on('resume-game', ({ roomId }) => {
      try {
        const room = gameRooms.get(roomId);
        if (!room || !room.isPaused) return;

        room.isPaused = false;
        room.pausedBy = null;

        io.to(roomId).emit('game-resumed', { timer: room.timer });
        io.to(roomId).emit('game-state-update', roomSnapshot(room));

        // Restart the timer from the remaining time
        startTimer(roomId);
      } catch (err) {
        console.error('resume-game error:', err);
      }
    });

    socket.on('disconnect', () => {
      const { currentRoom, playerName } = socket;
      if (!currentRoom || !playerName) return;

      const room = gameRooms.get(currentRoom);
      if (!room) return;

      delete room.players[playerName];
      io.to(currentRoom).emit('player-left', { playerName });

      if (Object.keys(room.players).length === 0) {
        if (room.timerInterval) clearInterval(room.timerInterval);
        gameRooms.delete(currentRoom);
        console.log('Deleted empty room:', currentRoom);
      } else {
        io.to(currentRoom).emit('game-state-update', roomSnapshot(room));
      }
    });
  });

  // ─── Helpers ────────────────────────────────────────────────────────────
  function roomSnapshot(room) {
    return {
      players: room.players,
      scores: room.scores,
      currentLetter: room.currentLetter,
      currentLetterIndex: room.currentLetterIndex,
      usedPlayers: room.usedPlayers,
      roundAnswers: room.roundAnswers,
      timer: room.timer,
      isActive: room.isActive,
      gameStarted: room.gameStarted,
      gameMode: room.gameMode,
      winner: room.winner,
      isPaused: room.isPaused,
      pausedBy: room.pausedBy,
    };
  }

  function startTimer(roomId) {
    const room = gameRooms.get(roomId);
    if (!room || !room.isActive) return;
    if (room.timerInterval) clearInterval(room.timerInterval);

    room.timerInterval = setInterval(() => {
      const r = gameRooms.get(roomId);
      if (!r || !r.isActive) { clearInterval(room.timerInterval); return; }

      r.timer--;
      io.to(roomId).emit('timer-update', { timer: r.timer });

      if (r.timer <= 0) {
        clearInterval(r.timerInterval);
        r.timerInterval = null;
        completeRound(roomId);
      }
    }, 1000);
  }

  function completeRound(roomId) {
    const room = gameRooms.get(roomId);
    if (!room) return;

    if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }

    const validAnswers = Object.entries(room.roundAnswers).filter(([, d]) => d.isValid);
    const pts = LETTER_SCORES[room.currentLetter];

    if (validAnswers.length > 0) {
      const share = Math.floor(pts / validAnswers.length);
      validAnswers.forEach(([name]) => { room.scores[name] += share; });

      validAnswers.forEach(([, d]) => {
        if (!d.answer) return;
        // Store the canonical player name so aliases don't bypass deduplication.
        // e.g. "Dinho" → matchedPlayer "Ronaldinho" → stored as "ronaldinho"
        const canonical = d.matchedPlayer || d.answer;
        const norm = normalizePlayerName(canonical);
        const conflict = room.usedPlayers.some(u => wordConflict(normalizePlayerName(u), norm));
        if (!conflict) room.usedPlayers.push(norm);
      });
    }

    room.isActive = false;
    io.to(roomId).emit('round-complete', {
      answers: room.roundAnswers,
      scores: room.scores,
      usedPlayers: room.usedPlayers,
    });

    setTimeout(() => {
      const r = gameRooms.get(roomId);
      if (!r) return;

      if (r.currentLetterIndex >= 25) {
        const [[winner]] = Object.entries(r.scores).sort(([, a], [, b]) => b - a);
        r.winner = winner;
        io.to(roomId).emit('game-complete', { winner, scores: r.scores });
        console.log(`Game complete in ${roomId}, winner: ${winner}`);
      } else {
        r.currentLetterIndex++;
        r.currentLetter = String.fromCharCode(65 + r.currentLetterIndex);
        r.roundAnswers = {};
        r.timer = 30;
        r.isActive = true;

        io.to(roomId).emit('new-round', { letter: r.currentLetter, letterIndex: r.currentLetterIndex });
        startTimer(roomId);
      }
    }, 3000);
  }

  // ─── Listen ──────────────────────────────────────────────────────────────
  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} [${dev ? 'dev' : 'production'}]`);
  });
});
