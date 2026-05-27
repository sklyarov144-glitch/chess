import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'

const STORAGE_KEY = 'yandex_chess_profile_v6'
const OLD_KEYS = ['yandex_chess_profile_v5', 'yandex_chess_profile_v4', 'yandex_chess_mvp_profile_v3', 'yandex_chess_mvp_profile_v2', 'yandex_chess_mvp_profile_v1']

const BOT_LEVELS = [
  { label: 'Новичок', rating: 300, depth: 1, mistake: 0.65 },
  { label: 'Средний', rating: 400, depth: 1, mistake: 0.5 },
  { label: 'Любитель', rating: 700, depth: 1, mistake: 0.38 },
  { label: 'Клубный игрок', rating: 1000, depth: 2, mistake: 0.25 },
  { label: 'Сильный игрок', rating: 1400, depth: 2, mistake: 0.15 },
  { label: 'Эксперт', rating: 1800, depth: 2, mistake: 0.08 },
  { label: 'Мастер', rating: 2200, depth: 3, mistake: 0.03 },
]

const LEAGUES = [
  { id: 'yard', title: 'Дворовый игрок', min: 400, max: 599, nextTitle: 'Ученик' },
  { id: 'pupil', title: 'Ученик', min: 600, max: 799, nextTitle: 'Любитель' },
  { id: 'lover', title: 'Любитель', min: 800, max: 999, nextTitle: 'Клубный игрок' },
  { id: 'club', title: 'Клубный игрок', min: 1000, max: 1199, nextTitle: 'Турнирный игрок' },
  { id: 'tournament', title: 'Турнирный игрок', min: 1200, max: 1499, nextTitle: 'Кандидат' },
  { id: 'candidate', title: 'Кандидат', min: 1500, max: 1799, nextTitle: 'Эксперт' },
  { id: 'expert', title: 'Эксперт', min: 1800, max: 2199, nextTitle: 'Мастер' },
  { id: 'master', title: 'Мастер', min: 2200, max: Infinity, nextTitle: null },
]

const OFFLINE_OPPONENTS = [
  { name: 'Петя Пешкин', avatar: '♙', style: 'Любит двигать пешки и рано атаковать центр', quote: 'Пешки тоже умеют побеждать!', bias: 'pawns' },
  { name: 'Соня Ферзёва', avatar: '♛', style: 'Рано выводит ферзя и ищет быстрые атаки', quote: 'Ферзь решает всё!', bias: 'queen' },
  { name: 'Кирилл Конев', avatar: '♞', style: 'Часто атакует конями и ищет вилки', quote: 'Берегись вилки!', bias: 'knights' },
  { name: 'Виктор Ладья', avatar: '♜', style: 'Любит открытые линии и давление ладьями', quote: 'Ладья любит простор.', bias: 'rooks' },
  { name: 'Лена Защитница', avatar: '♚', style: 'Играет осторожно и укрепляет короля', quote: 'Главное — безопасность короля.', bias: 'solid' },
]

const PIECES = { wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔', bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚' }

const goalPools = {
  easy: [
    { id: 'castle', title: 'Сделай рокировку' },
    { id: 'develop_two', title: 'Развей двух лёгких фигур' },
    { id: 'queen_safe', title: 'Не потеряй ферзя' },
    { id: 'give_check', title: 'Сделай шах сопернику' },
  ],
  medium: [
    { id: 'win_piece', title: 'Выиграй хотя бы одну фигуру' },
    { id: 'win_game', title: 'Победи соперника' },
    { id: 'reach_25', title: 'Доведи партию до 25-го хода' },
    { id: 'keep_rooks_20', title: 'Сохрани обе ладьи до 20-го хода' },
  ],
  hard: [
    { id: 'win_no_queen_loss', title: 'Победи без потери ферзя' },
    { id: 'beat_stronger', title: 'Победи соперника сильнее тебя' },
    { id: 'checkmate', title: 'Поставь мат' },
    { id: 'promote', title: 'Преврати пешку' },
  ],
}

const ACHIEVEMENTS = [
  ['first_win', 'Первая победа', (p) => p.wins >= 1],
  ['rating_600', 'Рейтинг 600', (p) => p.rating >= 600],
  ['rating_1000', 'Рейтинг 1000', (p) => p.rating >= 1000],
  ['rating_1500', 'Рейтинг 1500', (p) => p.rating >= 1500],
  ['castle_master', 'Мастер рокировки', (p) => (p.stats?.castledGames || 0) >= 10],
  ['queen_safe', 'Береги ферзя', (p) => (p.stats?.queenSafeGames || 0) >= 5],
  ['giant_killer', 'Гроза фаворитов', (p) => (p.stats?.giantKills || 0) >= 1],
  ['task_hunter', 'Охотник за заданиями', (p) => (p.stats?.completedGoals || 0) >= 10],
]

function defaultProfile() {
  return {
    name: 'Игрок', rating: 400, xp: 0, level: 1, wins: 0, losses: 0, draws: 0, games: 0,
    winStreak: 0, bestWinStreak: 0, achievements: [], recentGames: [],
    stats: { castledGames: 0, queenSafeGames: 0, completedGoals: 0, giantKills: 0 },
  }
}
const randomInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a
const xpNeed = (level) => 100 + (level - 1) * 60
const clamp = (n, min, max) => Math.max(min, Math.min(max, n))
const findBotLevel = (rating) => BOT_LEVELS.reduce((best, x) => Math.abs(x.rating - rating) < Math.abs(best.rating - rating) ? x : best, BOT_LEVELS[0])

function getLeague(rating) {
  const league = LEAGUES.find((x) => rating >= x.min && rating <= x.max) || LEAGUES[0]
  const range = league.max === Infinity ? 1 : league.max - league.min + 1
  const progress = league.max === Infinity ? 1 : clamp((rating - league.min + 1) / range, 0, 1)
  return { ...league, progress }
}

function createOfflineOpponent(playerRating) {
  const base = OFFLINE_OPPONENTS[randomInt(0, OFFLINE_OPPONENTS.length - 1)]
  const spread = Math.random() < 0.5 ? 80 : 120
  const rating = clamp(playerRating + randomInt(-spread, spread), 300, 2400)
  return { ...base, rating, levelLabel: findBotLevel(rating).label }
}

function generateMatchGoals(profile, opponent) {
  const pick = (arr) => arr[randomInt(0, arr.length - 1)]
  const hard = pick(goalPools.hard)
  const medium = pick(goalPools.medium)
  const easy = pick(goalPools.easy)
  return [
    { ...easy, difficulty: 'easy', rewardXp: 10, completed: false },
    { ...medium, difficulty: 'medium', rewardXp: 20, completed: false },
    { ...hard, difficulty: 'hard', rewardXp: 35, completed: false, targetHigher: hard.id === 'beat_stronger' ? opponent.rating > profile.rating : false },
  ]
}

function loadProfile() {
  for (const key of [STORAGE_KEY, ...OLD_KEYS]) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      return migrateProfile(JSON.parse(raw))
    } catch {}
  }
  return defaultProfile()
}
const saveProfile = (p) => localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
const migrateProfile = (p) => ({ ...defaultProfile(), ...p, stats: { ...defaultProfile().stats, ...(p.stats || {}) }, recentGames: Array.isArray(p.recentGames) ? p.recentGames : [] })

function evalMaterial(g, color = 'b') {
  const v = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
  let s = 0
  for (const row of g.board()) for (const piece of row) if (piece) s += (piece.color === color ? 1 : -1) * v[piece.type]
  return s
}

function getBotMove(game, difficultyRating, playerRating, bias = 'solid') {
  const level = findBotLevel(difficultyRating)
  const moves = game.moves({ verbose: true })
  if (!moves.length) return null
  const scored = moves.map((m) => {
    const c = new Chess(game.fen()); c.move(m)
    let score = evalMaterial(c, 'b')
    if (level.depth > 1) {
      const replies = c.moves({ verbose: true })
      if (replies.length) score -= Math.max(...replies.map((r) => { const d = new Chess(c.fen()); d.move(r); return evalMaterial(d, 'b') })) * 0.35
    }
    if (bias === 'pawns' && m.piece === 'p') score += 0.15
    if (bias === 'queen' && m.piece === 'q') score += 0.2
    if (bias === 'knights' && m.piece === 'n') score += 0.2
    if (bias === 'rooks' && m.piece === 'r') score += 0.2
    if (bias === 'solid' && (m.san.includes('O-O') || !m.captured)) score += 0.08
    return { m, score }
  }).sort((a, b) => b.score - a.score)
  const mistakeBoost = playerRating < 700 ? 0.08 : 0
  const mistakeChance = clamp(level.mistake + mistakeBoost, 0.02, 0.85)
  if (Math.random() < mistakeChance) return scored[Math.min(randomInt(1, Math.min(3, scored.length - 1)), scored.length - 1)]?.m || scored[0].m
  return scored[0].m
}

function App() {
  const [profile, setProfile] = useState(loadProfile)
  const [screen, setScreen] = useState('menu')
  const [game, setGame] = useState(null)
  const [selected, setSelected] = useState(null)

  const league = useMemo(() => getLeague(profile.rating), [profile.rating])
  useEffect(() => saveProfile(profile), [profile])

  const startRanked = () => {
    const opponent = createOfflineOpponent(profile.rating)
    const goals = generateMatchGoals(profile, opponent)
    setGame({ chess: new Chess(), opponent, goals, result: null, lastMove: null, stats: { playerCastled: false, gaveCheck: false, lostQueen: false, moveCount: 0, wonPiece: false, promotedPawn: false, checkmatedOpponent: false, beatStrongerOpponent: false, developedMinorPieces: 0, keptRooksUntil20: true } })
    setScreen('game')
  }

  const finishGame = useCallback((resultType, reason = 'gameover') => {
    if (!game) return
    const g = game.chess
    const stats = { ...game.stats }
    stats.checkmatedOpponent = resultType === 'win' && g.isCheckmate()
    stats.beatStrongerOpponent = resultType === 'win' && game.opponent.rating > profile.rating
    const completedGoals = game.goals.map((goal) => {
      const done = (
        (goal.id === 'castle' && stats.playerCastled) ||
        (goal.id === 'develop_two' && stats.developedMinorPieces >= 2) ||
        (goal.id === 'queen_safe' && !stats.lostQueen) ||
        (goal.id === 'give_check' && stats.gaveCheck) ||
        (goal.id === 'win_piece' && stats.wonPiece) ||
        (goal.id === 'win_game' && resultType === 'win') ||
        (goal.id === 'reach_25' && stats.moveCount >= 25) ||
        (goal.id === 'keep_rooks_20' && stats.keptRooksUntil20 && stats.moveCount >= 20) ||
        (goal.id === 'win_no_queen_loss' && resultType === 'win' && !stats.lostQueen) ||
        (goal.id === 'beat_stronger' && stats.beatStrongerOpponent) ||
        (goal.id === 'checkmate' && stats.checkmatedOpponent) ||
        (goal.id === 'promote' && stats.promotedPawn)
      )
      return { ...goal, completed: done }
    })
    const goalXp = completedGoals.filter((x) => x.completed).reduce((sum, x) => sum + x.rewardXp, 0)
    const baseXp = resultType === 'win' ? 50 : resultType === 'draw' ? 30 : 15
    const score = resultType === 'win' ? 1 : resultType === 'draw' ? 0.5 : 0
    const expected = 1 / (1 + 10 ** ((game.opponent.rating - profile.rating) / 400))
    const eloDelta = Math.round(32 * (score - expected))
    setProfile((p) => {
      let xp = p.xp + baseXp + goalXp
      let level = p.level
      while (xp >= xpNeed(level)) { xp -= xpNeed(level); level += 1 }
      const next = {
        ...p,
        xp,
        level,
        rating: Math.max(300, p.rating + eloDelta),
        wins: p.wins + (resultType === 'win' ? 1 : 0),
        losses: p.losses + (resultType === 'loss' ? 1 : 0),
        draws: p.draws + (resultType === 'draw' ? 1 : 0),
        games: p.games + 1,
        winStreak: resultType === 'win' ? p.winStreak + 1 : 0,
        bestWinStreak: resultType === 'win' ? Math.max(p.bestWinStreak, p.winStreak + 1) : p.bestWinStreak,
        stats: {
          ...p.stats,
          castledGames: p.stats.castledGames + (stats.playerCastled ? 1 : 0),
          queenSafeGames: p.stats.queenSafeGames + (!stats.lostQueen ? 1 : 0),
          completedGoals: p.stats.completedGoals + completedGoals.filter((x) => x.completed).length,
          giantKills: p.stats.giantKills + (stats.beatStrongerOpponent ? 1 : 0),
        },
      }
      const unlocked = ACHIEVEMENTS.filter(([id, , ok]) => ok(next) && !next.achievements.includes(id)).map(([id]) => id)
      next.achievements = [...next.achievements, ...unlocked]
      next.recentGames = [{ result: resultType, rating: next.rating, ratingBefore: p.rating, eloDelta, opponentName: game.opponent.name, opponentRating: game.opponent.rating, completedGoals: completedGoals.filter((x) => x.completed).map((x) => x.id), totalGoalXp: goalXp, timeControlId: '10+0', gameSeconds: stats.moveCount * 6, reason, createdAt: new Date().toISOString() }, ...p.recentGames].slice(0, 20)
      setGame((old) => ({ ...old, result: { resultType, baseXp, goalXp, completedGoals, eloDelta, unlocked } }))
      return next
    })
    setScreen('result')
  }, [game, profile.rating])

  useEffect(() => {
    if (!game || screen !== 'game') return
    if (game.chess.turn() === 'b' && !game.chess.isGameOver()) {
      const id = setTimeout(() => {
        const move = getBotMove(game.chess, game.opponent.rating, profile.rating, game.opponent.bias)
        if (!move) return
        const chess = new Chess(game.chess.fen())
        chess.move(move)
        setGame((old) => ({ ...old, chess, lastMove: { from: move.from, to: move.to } }))
        if (chess.isGameOver()) finishGame(chess.isCheckmate() ? 'loss' : 'draw')
      }, 350)
      return () => clearTimeout(id)
    }
  }, [game, screen, finishGame, profile.rating])

  const clickSquare = (sq) => {
    if (!game || game.chess.turn() !== 'w') return
    const piece = game.chess.get(sq)
    if (piece?.color === 'w') return setSelected((s) => (s === sq ? null : sq))
    if (!selected) return
    const chess = new Chess(game.chess.fen())
    const move = chess.move({ from: selected, to: sq, promotion: 'q' })
    setSelected(null)
    if (!move) return
    setGame((old) => {
      const stats = { ...old.stats }
      stats.moveCount += 1
      if (move.san.includes('O-O')) stats.playerCastled = true
      if (move.san.includes('+') || move.san.includes('#')) stats.gaveCheck = true
      if (move.captured) stats.wonPiece = true
      if (move.promotion) stats.promotedPawn = true
      if (move.piece === 'n' || move.piece === 'b') stats.developedMinorPieces += 1
      const q = chess.board().flat().filter(Boolean).some((p) => p.type === 'q' && p.color === 'w')
      stats.lostQueen = !q
      if (stats.moveCount < 20) {
        const whiteRooks = chess.board().flat().filter((p) => p && p.color === 'w' && p.type === 'r').length
        stats.keptRooksUntil20 = stats.keptRooksUntil20 && whiteRooks === 2
      }
      return { ...old, chess, lastMove: { from: move.from, to: move.to }, stats }
    })
    if (chess.isGameOver()) finishGame(chess.isCheckmate() ? 'win' : 'draw')
  }

  if (screen === 'menu') {
    const next = LEAGUES.find((l) => l.min > profile.rating)
    return <main className='p-6 text-white'><h1 className='text-4xl font-black'>400 к Мастеру</h1><p className='mt-2 text-slate-300'>Начни с рейтинга 400 и поднимись до звания Мастера.</p><div className='mt-4'>Рейтинг: {profile.rating}</div><div>Лига: {league.title}</div><div>Прогресс: {Math.round(league.progress * 100)}%</div><div>{next ? `До лиги ${next.title}: ${Math.max(0, next.min - profile.rating)} рейтинга` : 'Максимальная лига достигнута'}</div><button className='mt-4 rounded bg-emerald-600 px-4 py-2' onClick={startRanked}>Играть рейтинговую</button><p className='mt-1 text-sm text-slate-300'>Офлайн-партия против соперника твоего уровня</p><div className='mt-3 flex gap-2'><button className='rounded bg-slate-700 px-3 py-2' onClick={() => setScreen('profile')}>Профиль</button><button className='rounded bg-slate-700 px-3 py-2' onClick={() => setScreen('achievements')}>Достижения</button></div></main>
  }

  if (screen === 'profile') {
    const next = LEAGUES.find((l) => l.min > profile.rating)
    return <main className='p-6 text-white'><h2 className='text-3xl font-bold'>Профиль</h2><div>Рейтинг: {profile.rating}</div><div>Лига: {league.title}</div><div>{next ? `До лиги ${next.title}: ${Math.max(0, next.min - profile.rating)} рейтинга` : 'Мастер'}</div><div>Победы/Поражения/Ничьи: {profile.wins}/{profile.losses}/{profile.draws}</div><div>Лучшая серия: {profile.bestWinStreak}</div><div>Выполнено заданий: {profile.stats.completedGoals}</div><div>Партий с рокировкой: {profile.stats.castledGames}</div><div>Партий без потери ферзя: {profile.stats.queenSafeGames}</div><button className='mt-4 rounded bg-slate-700 px-3 py-2' onClick={() => setScreen('menu')}>Назад</button></main>
  }

  if (screen === 'achievements') {
    return <main className='p-6 text-white'><h2 className='text-3xl font-bold'>Достижения</h2>{ACHIEVEMENTS.map(([id, title]) => <div key={id}>{profile.achievements.includes(id) ? '✓' : '✗'} {title}</div>)}<button className='mt-4 rounded bg-slate-700 px-3 py-2' onClick={() => setScreen('menu')}>Назад</button></main>
  }

  if (screen === 'result' && game?.result) {
    const r = game.result
    return <main className='p-6 text-white'><h2 className='text-4xl font-black'>{r.resultType === 'win' ? 'Победа!' : r.resultType === 'draw' ? 'Ничья' : 'Поражение'}</h2><p>Рейтинг: {profile.rating - r.eloDelta} → {profile.rating}</p><p>Соперник: {game.opponent.name}, {game.opponent.rating}</p><p>XP за партию: {r.baseXp}</p><p>XP за задания: {r.goalXp}</p><h3 className='mt-3 font-bold'>Задания:</h3>{r.completedGoals.map((g) => <div key={g.id}>{g.completed ? '✓' : '✗'} {g.title} +{g.rewardXp} XP</div>)}{r.unlocked.length > 0 && <div className='mt-2'>Новые достижения: {r.unlocked.join(', ')}</div>}<div className='mt-4 flex gap-2'><button className='rounded bg-emerald-600 px-3 py-2' onClick={startRanked}>Ещё партия</button><button className='rounded bg-slate-700 px-3 py-2' onClick={() => setScreen('menu')}>Меню</button></div></main>
  }

  if (!game) return null
  const board = game.chess.board()
  return <main className='p-4 text-white'><h2 className='text-2xl font-bold'>Играть рейтинговую</h2><p>{game.opponent.avatar} {game.opponent.name} · рейтинг {game.opponent.rating}</p><p>{game.opponent.style}</p><p>“{game.opponent.quote}”</p><p>Уровень: {game.opponent.levelLabel}</p><div className='mt-3 grid w-[480px] grid-cols-8 border border-slate-500'>{board.map((row, r) => row.map((piece, c) => { const sq = 'abcdefgh'[c] + (8 - r); const dark = (r + c) % 2; return <button key={sq} onClick={() => clickSquare(sq)} className={`h-14 w-14 text-3xl ${dark ? 'bg-slate-700' : 'bg-slate-300 text-black'}`}>{piece ? PIECES[piece.color + piece.type] : ''}</button> }))}</div><div className='mt-2 flex gap-2'><button className='rounded bg-rose-700 px-3 py-2' onClick={() => finishGame('loss', 'resign')}>Сдаться</button><button className='rounded bg-slate-700 px-3 py-2' onClick={() => setScreen('menu')}>Меню</button></div><h3 className='mt-3 font-bold'>Цель партии</h3>{game.goals.map((g) => <div key={g.id}>• {g.title} (+{g.rewardXp} XP)</div>)}</main>
}

export default App
export { getLeague, createOfflineOpponent, generateMatchGoals, getBotMove, BOT_LEVELS }
