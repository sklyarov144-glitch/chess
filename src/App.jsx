import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Trophy, Bot, Wifi, User, Settings, Gift, RotateCcw, Flag, Handshake, Home, Zap, X } from "lucide-react";

const STORAGE_KEY = "yandex_chess_mvp_profile_v1";
const FALLBACK_REWARDED_DELAY_MS = 300;
const SDK_MISSING_MESSAGE = "Yandex Games SDK is not available: local fallback is active.";
const BOT_LEVELS = [
  { label: "Новичок", rating: 400, depth: 1, mistake: 0.55 },
  { label: "Любитель", rating: 800, depth: 1, mistake: 0.38 },
  { label: "Клубный игрок", rating: 1200, depth: 2, mistake: 0.22 },
  { label: "Сильный игрок", rating: 1600, depth: 2, mistake: 0.12 },
  { label: "Эксперт", rating: 2000, depth: 2, mistake: 0.06 },
  { label: "Мастер", rating: 2400, depth: 3, mistake: 0.02 },
];

const NAMES = ["MaxKnight", "SofiaQueen", "LeoRook", "NikaChess", "Ivan64", "MiraMate", "DenisBlitz", "AlinaBoard", "TimurKing", "VeraFork"];
const AVATARS = ["♞", "♛", "♜", "♚", "♟", "★", "◆", "●", "▲", "♝"];
const PRAISE = ["Отличная партия!", "Красивая победа!", "Твой рейтинг растёт!", "Ты стал сильнее!", "Хорошая защита!", "Сыграно уверенно!", "Так держать!"];

const PIECE_UNICODE = {
  wp: "♟", wn: "♞", wb: "♝", wr: "♜", wq: "♛", wk: "♚",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

function defaultProfile() {
  return {
    name: "Игрок",
    rating: 800,
    xp: 0,
    level: 1,
    wins: 0,
    losses: 0,
    draws: 0,
    games: 0,
    winStreak: 0,
    bestWinStreak: 0,
    achievements: [],
    lastDailyReward: null,
    gamesSinceAd: 0,
  };
}

function loadProfile() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...defaultProfile(), ...JSON.parse(saved) } : defaultProfile();
  } catch {
    return defaultProfile();
  }
}

function saveProfile(profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

async function initYandexGamesSdk() {
  if (typeof window === "undefined" || !window.YaGames?.init) {
    console.info(SDK_MISSING_MESSAGE);
    return null;
  }

  try {
    const ysdk = await window.YaGames.init();
    window.__CHESS_ARENA_YSDK__ = ysdk;
    return ysdk;
  } catch (error) {
    console.warn("Yandex Games SDK initialization failed, fallback mode is active.", error);
    return null;
  }
}

function markYandexGameReady(ysdk) {
  try {
    ysdk?.features?.LoadingAPI?.ready?.();
  } catch (error) {
    console.warn("LoadingAPI.ready() failed.", error);
  }
}

function showInterstitialAd(ysdk, { isGameplayActive } = {}) {
  if (isGameplayActive?.()) {
    console.info("Interstitial ad skipped: gameplay is active.");
    return;
  }

  if (!ysdk?.adv?.showFullscreenAdv) {
    console.info("Interstitial ad fallback: SDK is unavailable.");
    return;
  }

  try {
    ysdk.adv.showFullscreenAdv({
      callbacks: {
        onOpen: () => console.info("Interstitial ad opened."),
        onClose: (wasShown) => console.info(wasShown ? "Interstitial ad closed." : "Interstitial ad was not shown."),
        onError: (error) => console.warn("Interstitial ad error.", error),
      },
    });
  } catch (error) {
    console.warn("Interstitial ad call failed.", error);
  }
}

function showRewardedAd(ysdk, onReward, { isGameplayActive } = {}) {
  if (isGameplayActive?.()) {
    console.info("Rewarded ad skipped: gameplay is active.");
    return;
  }

  if (!ysdk?.adv?.showRewardedVideo) {
    console.info("Rewarded ad fallback: SDK is unavailable.");
    setTimeout(() => onReward?.(), FALLBACK_REWARDED_DELAY_MS);
    return;
  }

  let rewarded = false;
  try {
    ysdk.adv.showRewardedVideo({
      callbacks: {
        onOpen: () => console.info("Rewarded ad opened."),
        onRewarded: () => {
          rewarded = true;
          onReward?.();
        },
        onClose: (wasShown) => console.info(wasShown ? "Rewarded ad closed." : "Rewarded ad was not shown.", { rewarded }),
        onError: (error) => console.warn("Rewarded ad error.", error),
      },
    });
  } catch (error) {
    console.warn("Rewarded ad call failed, granting local fallback reward.", error);
    setTimeout(() => onReward?.(), FALLBACK_REWARDED_DELAY_MS);
  }
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function botDelayMs(mode = "bot") {
  if (mode === "bot") return randomInt(1000, 2000);
  const roll = Math.random();
  if (roll < 0.45) return randomInt(1000, 3000);
  if (roll < 0.85) return randomInt(3000, 6000);
  return randomInt(6000, 10000);
}

function expectedScore(playerRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

function calculateElo(playerRating, opponentRating, score) {
  const k = 32;
  return Math.round(k * (score - expectedScore(playerRating, opponentRating)));
}

function xpForLevel(level) {
  return 100 + (level - 1) * 60;
}

function applyXp(profile, gainedXp) {
  let xp = profile.xp + gainedXp;
  let level = profile.level;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
  }
  return { ...profile, xp, level };
}

function materialScore(game) {
  const values = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  let score = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const value = values[piece.type] || 0;
      score += piece.color === "w" ? value : -value;
    }
  }
  if (game.isCheckmate()) score += game.turn() === "w" ? -100000 : 100000;
  return score;
}

function positionalScore(game) {
  const centerFiles = [-2, -1, 1, 2, 2, 1, -1, -2];
  let score = 0;
  game.board().forEach((row, rowIndex) => {
    row.forEach((piece, fileIndex) => {
      if (!piece) return;
      const rank = 8 - rowIndex;
      const side = piece.color === "w" ? 1 : -1;
      const advancement = piece.color === "w" ? rank - 2 : 7 - rank;
      const center = centerFiles[fileIndex] || 0;
      const pieceBonus = piece.type === "p" ? advancement * 5 : piece.type === "n" || piece.type === "b" ? center * 8 : piece.type === "q" ? center * 3 : 0;
      score += side * pieceBonus;
    });
  });
  return score;
}

function evaluatePosition(game, botColor) {
  if (game.isCheckmate()) return game.turn() === botColor ? -100000 : 100000;
  if (game.isDraw() || game.isStalemate() || game.isThreefoldRepetition()) return 0;

  const perspective = botColor === "w" ? 1 : -1;
  const material = materialScore(game) * perspective;
  const positional = positionalScore(game) * perspective;
  const mobility = game.moves().length * (game.turn() === botColor ? 2 : -2);
  const checkPressure = game.isCheck() ? (game.turn() === botColor ? -35 : 35) : 0;
  return material + positional + mobility + checkPressure;
}

function minimax(game, depth, alpha, beta, botColor) {
  if (depth === 0 || game.isGameOver()) return evaluatePosition(game, botColor);

  const maximizing = game.turn() === botColor;
  const moves = game.moves({ verbose: true });
  if (maximizing) {
    let value = -Infinity;
    for (const move of moves) {
      const clone = new Chess(game.fen());
      clone.move(move);
      value = Math.max(value, minimax(clone, depth - 1, alpha, beta, botColor));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  let value = Infinity;
  for (const move of moves) {
    const clone = new Chess(game.fen());
    clone.move(move);
    value = Math.min(value, minimax(clone, depth - 1, alpha, beta, botColor));
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

function evaluateMove(game, move, botColor, depth) {
  const clone = new Chess(game.fen());
  clone.move(move);
  let score = minimax(clone, Math.max(0, depth - 1), -Infinity, Infinity, botColor);
  if (clone.isCheckmate()) score += 100000;
  if (clone.isCheck()) score += 35;
  if (move.captured) score += 45;
  if (move.promotion) score += 120;
  return score + Math.random() * 10;
}

function getBotMove(game, difficultyRating, playerRating = 800) {
  const level = BOT_LEVELS.reduce((best, item) => Math.abs(item.rating - difficultyRating) < Math.abs(best.rating - difficultyRating) ? item : best, BOT_LEVELS[0]);
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;

  const botColor = game.turn();
  const ratingGap = difficultyRating - playerRating;
  const adjustedMistake = Math.min(0.68, Math.max(0.015, level.mistake - ratingGap / 3000));
  const depth = Math.min(3, Math.max(1, level.depth + (ratingGap > 350 || difficultyRating >= 2200 ? 1 : 0)));
  const scored = moves
    .map((move) => ({ move, score: evaluateMove(game, move, botColor, depth) }))
    .sort((a, b) => b.score - a.score);

  if (Math.random() < adjustedMistake) {
    const from = difficultyRating >= 1200 ? 0.25 : 0.45;
    const to = difficultyRating >= 1200 ? 0.75 : 1;
    const weakPool = scored.slice(Math.floor(scored.length * from), Math.max(Math.ceil(scored.length * to), 1));
    return (weakPool[randomInt(0, Math.max(weakPool.length - 1, 0))] || scored[0]).move;
  }

  const topPoolSize = difficultyRating >= 2200 ? 1 : difficultyRating >= 1800 ? 2 : difficultyRating >= 1200 ? 3 : 6;
  const pool = scored.slice(0, Math.min(topPoolSize, scored.length));
  return pool[randomInt(0, pool.length - 1)].move;
}

function createOpponent(playerRating, hiddenAi = true) {
  const rating = Math.max(300, playerRating + randomInt(-180, 180));
  const name = NAMES[randomInt(0, NAMES.length - 1)];
  const avatar = AVATARS[randomInt(0, AVATARS.length - 1)];
  return { name, rating, avatar, hiddenAi };
}

function findOpponent(playerRating, onProgress) {
  return new Promise((resolve) => {
    const stages = [
      { seconds: 10, range: 100 },
      { seconds: 10, range: 200 },
      { seconds: 10, range: 400 },
    ];

    let stageIndex = 0;
    const tick = () => {
      const stage = stages[stageIndex];
      onProgress?.({ range: stage.range, stage: stageIndex + 1 });

      const foundRealPlayerInMvp = false;
      if (foundRealPlayerInMvp) {
        resolve(createOpponent(playerRating, false));
        return;
      }

      stageIndex += 1;
      if (stageIndex >= stages.length) {
        // Здесь позже подключается настоящий matchmaking-сервер.
        // В честном релизе укажите в правилах игры, что быстрая игра может подбирать виртуальных соперников.
        resolve(createOpponent(playerRating, true));
      } else {
        setTimeout(tick, 900);
      }
    };

    setTimeout(tick, 500);
  });
}

function getAchievements(profile, result, opponentRating, gameSeconds) {
  const unlocked = [];
  const has = (id) => profile.achievements.includes(id) || unlocked.some((a) => a.id === id);
  const add = (id, title) => { if (!has(id)) unlocked.push({ id, title }); };

  if (result === "win") add("first_win", "Первая победа");
  if (profile.winStreak >= 3) add("streak_3", "3 победы подряд");
  if (result === "win" && opponentRating > profile.rating) add("beat_stronger", "Победа над сильным соперником");
  if (result === "win" && gameSeconds < 300) add("fast_win", "Победа менее чем за 5 минут");
  if (profile.games >= 10) add("games_10", "10 сыгранных партий");
  if (profile.games >= 50) add("games_50", "50 сыгранных партий");
  if (profile.rating >= 1000) add("rating_1000", "Рейтинг 1000");
  if (profile.rating >= 1500) add("rating_1500", "Рейтинг 1500");
  if (profile.rating >= 2000) add("rating_2000", "Рейтинг 2000");
  return unlocked;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function Button({ children, onClick, variant = "primary", disabled = false, className = "" }) {
  const base = "rounded-2xl px-4 py-3 font-semibold transition active:scale-95 disabled:opacity-50 disabled:active:scale-100";
  const styles = {
    primary: "bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 hover:bg-emerald-400",
    secondary: "bg-slate-800 text-slate-100 hover:bg-slate-700",
    ghost: "bg-white/10 text-white hover:bg-white/15",
    danger: "bg-rose-500 text-white hover:bg-rose-400",
    gold: "bg-amber-400 text-slate-950 hover:bg-amber-300",
  };
  return <button disabled={disabled} onClick={onClick} className={`${base} ${styles[variant]} ${className}`}>{children}</button>;
}

function Card({ children, className = "" }) {
  return <div className={`rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl backdrop-blur ${className}`}>{children}</div>;
}

function PlayerCard({ name, rating, avatar, active, time }) {
  return (
    <div className={`chess-player-card ${active ? "chess-player-card--active" : ""}`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="chess-avatar">{avatar}</div>
        <div className="min-w-0">
          <div className="truncate font-bold text-zinc-100">{name}</div>
          <div className="text-xs font-semibold text-zinc-400">Рейтинг {rating}</div>
        </div>
      </div>
      <div className="chess-clock">{formatTime(time)}</div>
    </div>
  );
}

function MainMenu({ profile, onPlayBot, onOnline, onQuick, onProfile, onAchievements, onDaily }) {
  const dailyAvailable = profile.lastDailyReward !== new Date().toDateString();
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <Card className="overflow-hidden">
        <div className="mb-8 flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-3xl bg-emerald-500 text-4xl shadow-lg">♚</div>
          <div>
            <h1 className="text-4xl font-black text-white md:text-5xl">Chess Arena</h1>
            <p className="mt-1 text-slate-300">Быстрые шахматы для Яндекс Игр</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button onClick={onPlayBot} className="flex items-center justify-center gap-2"><Bot size={20} /> Играть с ботом</Button>
          <Button onClick={onOnline} variant="gold" className="flex items-center justify-center gap-2"><Wifi size={20} /> Онлайн-игра</Button>
          <Button onClick={onQuick} variant="secondary" className="flex items-center justify-center gap-2"><Zap size={20} /> Быстрая игра</Button>
          <Button onClick={onProfile} variant="secondary" className="flex items-center justify-center gap-2"><User size={20} /> Профиль</Button>
          <Button onClick={onAchievements} variant="ghost" className="flex items-center justify-center gap-2"><Trophy size={20} /> Достижения</Button>
          <Button variant="ghost" className="flex items-center justify-center gap-2"><Settings size={20} /> Настройки</Button>
        </div>
      </Card>

      <div className="grid gap-5">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm uppercase tracking-widest text-slate-400">Профиль</p>
              <h2 className="mt-1 text-2xl font-black text-white">{profile.name}</h2>
            </div>
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-900 text-3xl">♞</div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-slate-950/70 p-3"><div className="text-2xl font-black text-white">{profile.rating}</div><div className="text-xs text-slate-400">Рейтинг</div></div>
            <div className="rounded-2xl bg-slate-950/70 p-3"><div className="text-2xl font-black text-white">{profile.level}</div><div className="text-xs text-slate-400">Уровень</div></div>
            <div className="rounded-2xl bg-slate-950/70 p-3"><div className="text-2xl font-black text-white">{profile.winStreak}</div><div className="text-xs text-slate-400">Серия</div></div>
          </div>
          <div className="mt-4">
            <div className="mb-2 flex justify-between text-sm text-slate-300"><span>XP</span><span>{profile.xp}/{xpForLevel(profile.level)}</span></div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-950"><div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, profile.xp / xpForLevel(profile.level) * 100)}%` }} /></div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3 text-white"><Gift className="text-amber-300" /> <b>Ежедневная награда</b></div>
          <p className="mt-2 text-sm text-slate-300">Возвращайся каждый день и получай XP.</p>
          <Button disabled={!dailyAvailable} onClick={onDaily} variant="gold" className="mt-4 w-full">{dailyAvailable ? "Забрать +40 XP" : "Уже получено сегодня"}</Button>
        </Card>
      </div>
    </motion.div>
  );
}

function BotSelect({ onStart, onBack }) {
  return (
    <Card className="mx-auto max-w-3xl">
      <h2 className="text-3xl font-black text-white">Выбери уровень бота</h2>
      <p className="mt-2 text-slate-300">Чем выше рейтинг, тем меньше ошибок делает соперник.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BOT_LEVELS.map((level) => (
          <button key={level.rating} onClick={() => onStart(level)} className="rounded-3xl border border-white/10 bg-slate-950/50 p-5 text-left transition hover:border-emerald-400 hover:bg-emerald-400/10">
            <div className="text-xl font-black text-white">{level.label}</div>
            <div className="mt-2 text-emerald-300">Рейтинг {level.rating}</div>
          </button>
        ))}
      </div>
      <Button onClick={onBack} variant="ghost" className="mt-6">Назад</Button>
    </Card>
  );
}

function Matchmaking({ profile, progress }) {
  return (
    <Card className="mx-auto max-w-xl text-center">
      <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-full bg-emerald-400/20 text-4xl">♟</div>
      <h2 className="text-3xl font-black text-white">Поиск соперника</h2>
      <p className="mt-3 text-slate-300">Ищем игрока рядом с твоим рейтингом {profile.rating}</p>
      <div className="mt-6 rounded-2xl bg-slate-950/60 p-4 text-white">Диапазон: ±{progress?.range || 100}</div>
      <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-950"><motion.div className="h-full bg-emerald-400" initial={{ width: "10%" }} animate={{ width: "95%" }} transition={{ duration: 2.2, repeat: Infinity, repeatType: "reverse" }} /></div>
    </Card>
  );
}

function ChessBoard({ game, selected, legalTargets, lastMove, onSquareClick, disabled, playerColor }) {
  const shouldReduceMotion = useReducedMotion();
  const files = playerColor === "b" ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = playerColor === "b" ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const squares = [];
  const squareToCoord = new Map();

  for (let r = 0; r < ranks.length; r++) {
    for (let c = 0; c < files.length; c++) {
      squareToCoord.set(`${files[c]}${ranks[r]}`, { c, r });
    }
  }

  for (let r = 0; r < ranks.length; r++) {
    for (let c = 0; c < files.length; c++) {
      const file = files[c];
      const rank = ranks[r];
      const square = `${file}${rank}`;
      const piece = game.get(square);
      const fileIndex = file.charCodeAt(0) - 97;
      const dark = (fileIndex + rank) % 2 === 1;
      const isSelected = selected === square;
      const isLegal = legalTargets.includes(square);
      const isLast = lastMove?.from === square || lastMove?.to === square;
      const isMovedPiece = piece && lastMove?.to === square;
      const fromCoord = isMovedPiece ? squareToCoord.get(lastMove.from) : null;
      const initialOffset = fromCoord ? {
        x: `calc(${fromCoord.c - c} * var(--square-size))`,
        y: `calc(${fromCoord.r - r} * var(--square-size))`,
      } : false;

      squares.push(
        <button
          key={square}
          disabled={disabled}
          onClick={() => onSquareClick(square)}
          className={`chess-square ${dark ? "chess-square--dark" : "chess-square--light"} ${isSelected ? "chess-square--selected" : ""} ${isLast ? "chess-square--last" : ""}`}
          aria-label={square}
        >
          {piece && (
            <motion.span
              key={`${square}-${piece.color}${piece.type}-${lastMove?.from || "initial"}-${lastMove?.to || "initial"}`}
              className={`chess-piece chess-piece--${piece.color}`}
              initial={shouldReduceMotion ? false : initialOffset}
              animate={{ x: 0, y: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34, mass: 0.7 }}
            >
              {PIECE_UNICODE[piece.color + piece.type]}
            </motion.span>
          )}
          {isLegal && <span className={piece ? "chess-capture-hint" : "chess-move-hint"} />}
          {c === 0 && <span className="chess-rank-label">{rank}</span>}
          {r === 7 && <span className="chess-file-label">{file}</span>}
        </button>
      );
    }
  }
  return (
    <div className="chess-board-shell">
      <div className="chess-board">
        {squares}
      </div>
    </div>
  );
}

function GameScreen({ profile, mode, opponent, botLevel, playerColor, onFinish, onBack }) {
  const [game, setGame] = useState(() => new Chess());
  const [fenHistory, setFenHistory] = useState([new Chess().fen()]);
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [moveList, setMoveList] = useState([]);
  const [whiteTime, setWhiteTime] = useState(600);
  const [blackTime, setBlackTime] = useState(600);
  const [drawDeclined, setDrawDeclined] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const finishedRef = useRef(false);
  const drawDeclinedTimeoutRef = useRef(null);

  const botColor = playerColor === "w" ? "b" : "w";
  const activePlayerIsHuman = game.turn() === playerColor;
  const effectiveBotRating = opponent?.rating || botLevel?.rating || 800;
  const botMode = mode === "bot" ? "bot" : "online";

  const legalTargets = useMemo(() => {
    if (!selected) return [];
    return game.moves({ square: selected, verbose: true }).map((m) => m.to);
  }, [game, selected]);

  const finishGame = useCallback((resultReason) => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    let result;
    if (resultReason === "resign" || resultReason === "timeout_player") result = "loss";
    else if (resultReason === "opponent_resign" || resultReason === "timeout_opponent") result = "win";
    else if (game.isCheckmate()) result = game.turn() === playerColor ? "loss" : "win";
    else result = "draw";

    const gameSeconds = Math.round((Date.now() - startedAt) / 1000);
    onFinish({ result, opponentRating: effectiveBotRating, gameSeconds });
  }, [effectiveBotRating, game, onFinish, playerColor, startedAt]);

  useEffect(() => {
    const id = setInterval(() => {
      if (finishedRef.current) return;
      if (game.isGameOver()) return;
      if (game.turn() === "w") setWhiteTime((t) => Math.max(0, t - 1));
      else setBlackTime((t) => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [game]);

  useEffect(() => {
    if (whiteTime <= 0) finishGame(playerColor === "w" ? "timeout_player" : "timeout_opponent");
    if (blackTime <= 0) finishGame(playerColor === "b" ? "timeout_player" : "timeout_opponent");
  }, [whiteTime, blackTime, finishGame, playerColor]);

  useEffect(() => {
    if (game.isGameOver()) finishGame("game_over");
  }, [game, finishGame]);

  useEffect(() => () => window.clearTimeout(drawDeclinedTimeoutRef.current), []);

  useEffect(() => {
    if (finishedRef.current || game.isGameOver()) return;
    if (game.turn() !== botColor) return;
    const thinkingTimeout = setTimeout(() => setThinking(true), 0);
    const timeout = setTimeout(() => {
      const move = getBotMove(game, effectiveBotRating, profile.rating);
      if (move) {
        const next = new Chess(game.fen());
        const made = next.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
        setGame(next);
        setFenHistory((h) => [...h, next.fen()]);
        setLastMove({ from: made.from, to: made.to });
        setMoveList((list) => [...list, made.san]);
      }
      setThinking(false);
    }, botDelayMs(botMode));
    return () => {
      clearTimeout(thinkingTimeout);
      clearTimeout(timeout);
    };
  }, [game, botColor, effectiveBotRating, botMode, profile.rating]);

  function handleSquareClick(square) {
    if (thinking || !activePlayerIsHuman || game.isGameOver()) return;
    const piece = game.get(square);
    if (!selected) {
      if (piece?.color === playerColor) setSelected(square);
      return;
    }

    if (selected === square) {
      setSelected(null);
      return;
    }

    if (piece?.color === playerColor) {
      setSelected(square);
      return;
    }

    const moveIsLegal = game.moves({ square: selected, verbose: true }).some((move) => move.to === square);
    if (moveIsLegal) {
      const next = new Chess(game.fen());
      const move = next.move({ from: selected, to: square, promotion: "q" });
      setGame(next);
      setFenHistory((h) => [...h, next.fen()]);
      setLastMove({ from: move.from, to: move.to });
      setMoveList((list) => [...list, move.san]);
    }
    setSelected(null);
  }

  function undoMove() {
    if (mode !== "bot" || fenHistory.length < 3 || thinking) return;
    const previousFen = fenHistory[fenHistory.length - 3];
    setGame(new Chess(previousFen));
    setFenHistory((h) => h.slice(0, -2));
    setMoveList((list) => list.slice(0, -2));
    setSelected(null);
  }

  function offerDraw() {
    if (finishedRef.current || game.isGameOver()) return;
    window.clearTimeout(drawDeclinedTimeoutRef.current);
    setDrawDeclined(true);
    drawDeclinedTimeoutRef.current = window.setTimeout(() => setDrawDeclined(false), 2600);
  }

  function requestExitConfirmation() {
    if (finishedRef.current || game.isGameOver()) {
      onBack();
      return;
    }
    setExitConfirmOpen(true);
  }

  const status = game.isCheckmate() ? "Мат" : game.isStalemate() ? "Пат" : game.isDraw() ? "Ничья" : game.isCheck() ? "Шах" : thinking ? "Соперник думает..." : activePlayerIsHuman ? "Твой ход" : "Ход соперника";

  return (
    <div className="chess-table mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[minmax(360px,720px)_360px] lg:justify-center">
      <div className="grid gap-2">
        <PlayerCard name={opponent?.name || botLevel?.label || "Соперник"} rating={effectiveBotRating} avatar={opponent?.avatar || "♛"} active={game.turn() === botColor} time={botColor === "w" ? whiteTime : blackTime} />
        <ChessBoard game={game} selected={selected} legalTargets={legalTargets} lastMove={lastMove} onSquareClick={handleSquareClick} disabled={thinking || !activePlayerIsHuman} playerColor={playerColor} />
        <PlayerCard name={profile.name} rating={profile.rating} avatar="♞" active={game.turn() === playerColor} time={playerColor === "w" ? whiteTime : blackTime} />
      </div>

      <div className="grid content-start gap-4">
        <Card>
          <div className="text-sm uppercase tracking-widest text-slate-400">Статус</div>
          <div className="mt-2 text-2xl font-black text-white">{status}</div>
          <div className="mt-2 text-sm text-slate-300">Режим: {mode === "bot" ? "Игра с ботом" : "Быстрая партия"}</div>
          {drawDeclined && <div className="mt-3 rounded-2xl bg-rose-500/15 px-3 py-2 text-sm font-semibold text-rose-100">Соперник отказался от ничьей. Партия продолжается.</div>}
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2 font-bold text-white"><RotateCcw size={18} /> Ходы</div>
          <div className="max-h-56 overflow-auto rounded-2xl bg-slate-950/50 p-3 text-sm text-slate-200">
            {moveList.length === 0 ? <span className="text-slate-500">Пока ходов нет</span> : moveList.map((m, i) => <span key={i} className="mr-2">{i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ""} {m}</span>)}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button onClick={() => finishGame("resign")} variant="danger" className="flex items-center justify-center gap-2"><Flag size={18} /> Сдаться</Button>
          <Button onClick={offerDraw} variant="ghost" className="flex items-center justify-center gap-2"><Handshake size={18} /> Ничья</Button>
          <Button onClick={undoMove} disabled={mode !== "bot" || fenHistory.length < 3} variant="secondary">Отменить</Button>
          <Button onClick={requestExitConfirmation} variant="secondary" className="flex items-center justify-center gap-2"><Home size={18} /> Меню</Button>
        </div>
      </div>

      <AnimatePresence>
        {exitConfirmOpen && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="exit-match-title"
              className="w-full max-w-md rounded-3xl border border-white/10 bg-[#2f2d28] p-5 text-center shadow-2xl"
              initial={{ scale: 0.94, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 8 }}
            >
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-400/20 text-amber-200"><Home size={28} /></div>
              <h3 id="exit-match-title" className="mt-4 text-2xl font-black text-white">Выйти из матча?</h3>
              <p className="mt-2 text-sm text-slate-300">Текущая партия будет прервана, если вернуться в меню.</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Button onClick={onBack} variant="danger" className="flex items-center justify-center gap-2"><Home size={18} /> Да, выйти</Button>
                <Button onClick={() => setExitConfirmOpen(false)} variant="secondary" className="flex items-center justify-center gap-2"><X size={18} /> Продолжить</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ResultScreen({ resultData, profile, onAgain, onHome }) {
  const win = resultData.result === "win";
  const draw = resultData.result === "draw";
  return (
    <Card className="mx-auto max-w-2xl text-center">
      <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-amber-400 text-5xl shadow-xl">{win ? "🏆" : draw ? "🤝" : "♟"}</div>
      <h2 className="mt-5 text-4xl font-black text-white">{win ? "Победа!" : draw ? "Ничья" : "Поражение"}</h2>
      <p className="mt-2 text-xl text-emerald-300">{resultData.praise}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-slate-950/60 p-4"><div className="text-2xl font-black text-white">{resultData.eloDelta > 0 ? "+" : ""}{resultData.eloDelta}</div><div className="text-xs text-slate-400">Рейтинг</div></div>
        <div className="rounded-2xl bg-slate-950/60 p-4"><div className="text-2xl font-black text-white">+{resultData.xp}</div><div className="text-xs text-slate-400">XP</div></div>
        <div className="rounded-2xl bg-slate-950/60 p-4"><div className="text-2xl font-black text-white">{profile.winStreak}</div><div className="text-xs text-slate-400">Серия</div></div>
      </div>

      {resultData.unlocked.length > 0 && (
        <div className="mt-6 rounded-3xl bg-amber-400/15 p-4 text-left">
          <div className="mb-2 flex items-center gap-2 font-black text-amber-200"><Trophy size={18} /> Новые достижения</div>
          {resultData.unlocked.map((a) => <div key={a.id} className="text-white">• {a.title}</div>)}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button onClick={onAgain}>Играть снова</Button>
        <Button onClick={onHome} variant="secondary">Главное меню</Button>
      </div>
    </Card>
  );
}

function ProfileScreen({ profile, onBack }) {
  return (
    <Card className="mx-auto max-w-3xl">
      <h2 className="text-3xl font-black text-white">Профиль</h2>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-slate-950/60 p-4"><b className="text-2xl text-white">{profile.rating}</b><p className="text-slate-400">Рейтинг</p></div>
        <div className="rounded-2xl bg-slate-950/60 p-4"><b className="text-2xl text-white">{profile.level}</b><p className="text-slate-400">Уровень</p></div>
        <div className="rounded-2xl bg-slate-950/60 p-4"><b className="text-2xl text-white">{profile.games}</b><p className="text-slate-400">Партии</p></div>
        <div className="rounded-2xl bg-slate-950/60 p-4"><b className="text-2xl text-white">{profile.bestWinStreak}</b><p className="text-slate-400">Лучшая серия</p></div>
      </div>
      <p className="mt-5 text-slate-300">Победы: {profile.wins} · Поражения: {profile.losses} · Ничьи: {profile.draws}</p>
      <Button onClick={onBack} variant="ghost" className="mt-6">Назад</Button>
    </Card>
  );
}

function AchievementsScreen({ profile, onBack }) {
  const all = [
    ["first_win", "Первая победа"], ["streak_3", "3 победы подряд"], ["beat_stronger", "Победа над сильным соперником"], ["fast_win", "Победа менее чем за 5 минут"], ["games_10", "10 сыгранных партий"], ["games_50", "50 сыгранных партий"], ["rating_1000", "Рейтинг 1000"], ["rating_1500", "Рейтинг 1500"], ["rating_2000", "Рейтинг 2000"],
  ];
  return (
    <Card className="mx-auto max-w-4xl">
      <h2 className="text-3xl font-black text-white">Достижения</h2>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {all.map(([id, title]) => {
          const unlocked = profile.achievements.includes(id);
          return <div key={id} className={`rounded-2xl border p-4 ${unlocked ? "border-amber-300 bg-amber-300/15" : "border-white/10 bg-slate-950/40 opacity-60"}`}><div className="text-2xl">{unlocked ? "🏆" : "🔒"}</div><b className="text-white">{title}</b></div>;
        })}
      </div>
      <Button onClick={onBack} variant="ghost" className="mt-6">Назад</Button>
    </Card>
  );
}

export default function App() {
  const [screen, setScreen] = useState("menu");
  const [profile, setProfile] = useState(loadProfile);
  const [selectedLevel, setSelectedLevel] = useState(BOT_LEVELS[1]);
  const [opponent, setOpponent] = useState(null);
  const [matchProgress, setMatchProgress] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [lastMode, setLastMode] = useState("bot");
  const [gameSessionId, setGameSessionId] = useState(0);
  const [playerColor, setPlayerColor] = useState("w");
  const [ysdk, setYsdk] = useState(null);
  const [sdkInitialized, setSdkInitialized] = useState(false);
  const screenRef = useRef(screen);
  const loadingReadySentRef = useRef(false);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    let mounted = true;
    initYandexGamesSdk().then((sdk) => {
      if (mounted) {
        setYsdk(sdk);
        setSdkInitialized(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (screen !== "menu" || loadingReadySentRef.current || !sdkInitialized) return;
    loadingReadySentRef.current = true;
    markYandexGameReady(ysdk);
  }, [screen, sdkInitialized, ysdk]);

  useEffect(() => saveProfile(profile), [profile]);

  function claimDaily() {
    const today = new Date().toDateString();
    if (profile.lastDailyReward === today) return;
    showRewardedAd(ysdk, () => setProfile((p) => applyXp({ ...p, lastDailyReward: today }, 40)), { isGameplayActive: () => screenRef.current === "game" });
  }

  function startBot(level) {
    setSelectedLevel(level);
    setOpponent(null);
    setLastMode("bot");
    setPlayerColor(Math.random() < 0.5 ? "w" : "b");
    setGameSessionId((id) => id + 1);
    setScreen("game");
  }

  async function startOnline() {
    setScreen("matchmaking");
    setLastMode("online");
    setPlayerColor(Math.random() < 0.5 ? "w" : "b");
    const found = await findOpponent(profile.rating, setMatchProgress);
    setOpponent(found);
    setSelectedLevel({ label: "Соперник", rating: found.rating });
    setGameSessionId((id) => id + 1);
    setScreen("game");
  }

  function handleFinish({ result, opponentRating, gameSeconds }) {
    const score = result === "win" ? 1 : result === "draw" ? 0.5 : 0;
    const eloDelta = calculateElo(profile.rating, opponentRating, score);
    const gainedXp = result === "win" ? 60 : result === "draw" ? 35 : 20;

    let next = {
      ...profile,
      rating: Math.max(100, profile.rating + eloDelta),
      games: profile.games + 1,
      wins: profile.wins + (result === "win" ? 1 : 0),
      losses: profile.losses + (result === "loss" ? 1 : 0),
      draws: profile.draws + (result === "draw" ? 1 : 0),
      winStreak: result === "win" ? profile.winStreak + 1 : 0,
      gamesSinceAd: profile.gamesSinceAd + 1,
    };
    next.bestWinStreak = Math.max(next.bestWinStreak, next.winStreak);
    next = applyXp(next, gainedXp);
    const unlocked = getAchievements(next, result, opponentRating, gameSeconds);
    next.achievements = [...new Set([...next.achievements, ...unlocked.map((a) => a.id)])];

    const shouldShowInterstitial = next.gamesSinceAd >= 3;
    if (shouldShowInterstitial) next.gamesSinceAd = 0;

    setProfile(next);
    setLastResult({ result, eloDelta, xp: gainedXp, unlocked, praise: PRAISE[randomInt(0, PRAISE.length - 1)] });
    setScreen("result");

    if (shouldShowInterstitial) {
      window.setTimeout(() => showInterstitialAd(ysdk, { isGameplayActive: () => screenRef.current === "game" }), 250);
    }
  }

  function playAgain() {
    if (lastMode === "online") startOnline();
    else setScreen("botSelect");
  }

  return (
    <div className={`app-shell bg-[#312f2a] px-3 py-3 text-slate-100 md:px-6 md:py-5 ${screen === "game" ? "app-shell--game" : ""}`}>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(129,182,76,.28),transparent_30%),linear-gradient(90deg,rgba(0,0,0,.18),transparent_18%,transparent_82%,rgba(0,0,0,.18))]" />
      <div className="relative z-10">
        <AnimatePresence mode="wait">
          {screen === "menu" && <MainMenu key="menu" profile={profile} onPlayBot={() => setScreen("botSelect")} onOnline={startOnline} onQuick={startOnline} onProfile={() => setScreen("profile")} onAchievements={() => setScreen("achievements")} onDaily={claimDaily} />}
          {screen === "botSelect" && <BotSelect key="botSelect" onStart={startBot} onBack={() => setScreen("menu")} />}
          {screen === "matchmaking" && <Matchmaking key="matchmaking" profile={profile} progress={matchProgress} />}
          {screen === "game" && <GameScreen key={`${lastMode}-${gameSessionId}`} profile={profile} mode={lastMode} opponent={opponent} botLevel={selectedLevel} playerColor={playerColor} onFinish={handleFinish} onBack={() => setScreen("menu")} />}
          {screen === "result" && <ResultScreen key="result" resultData={lastResult} profile={profile} onAgain={playAgain} onHome={() => setScreen("menu")} />}
          {screen === "profile" && <ProfileScreen key="profile" profile={profile} onBack={() => setScreen("menu")} />}
          {screen === "achievements" && <AchievementsScreen key="achievements" profile={profile} onBack={() => setScreen("menu")} />}
        </AnimatePresence>
      </div>
    </div>
  );
}
