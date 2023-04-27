import { type Socket, io } from "socket.io-client";

export type Board = {
  id: number;
  positions: Array<number>;
  winner: number | null;
  winningLine: Array<number> | null;
};

export type Game = {
  id: number;
  boards: Array<Board>;
  winner: BoardPiece | null;
  winningLine: Array<number> | null;
  nextPiece: BoardPiece;
  winnerUsername: string | null;
};

export type SanitizedPlayer = {
  uuid: string;
  username: string | null;
  playingFor: BoardPiece;
  score: number;
  online: boolean;
};

export enum BoardPiece {
  DRAW,
  X,
  O
}

type Move = {
  boardId: number;
  squareId: number;
};


let currentGame: Game;
let timeOfLastMove = new Date();

// HotSalsa has an account with Xs, BelleRocks99 is Os
const botUsername = process.env.gamer as "HotSalsa22" | "BelleRocks99";
console.log("Username " + process.env.gamer);
let playingFor: BoardPiece = botUsername === "HotSalsa22" ? BoardPiece.X : BoardPiece.O;

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io("wss://staging.tictacyo.live", { auth: { username: botUsername }});

socket.on('playerInformation', (uuid, username, playingFor) => {
  playingFor = playingFor;
});

const generateMoves = (game: Game) => {
  let moves = [];

  for (let boardId = 0; boardId < 9; boardId++) {
    // Skip the loop iteration if the board has a winner
    if (game.boards[boardId].winner !== null) {
      continue;
    }

    for (let squareId = 0; squareId < 9; squareId++) {
      if (game.boards[boardId].positions[squareId] === 0) {
        moves.push({ boardId, squareId });
      }
    }
  }

  return moves;
};

const simulateMove = (game: Game, move: Move) => {
  let newGame = JSON.parse(JSON.stringify(game));
  newGame.boards[move.boardId].positions[move.squareId] = playingFor;
  newGame.nextPiece = playingFor === BoardPiece.X ? BoardPiece.O : BoardPiece.X;

  updateBoardWinners(newGame.boards[move.boardId]); // mutates the new game to set its winners

  return newGame;
};

const scoreMove = (game: Game, depth: number) => {
  let score = 0;

  for (let board of game.boards) {
    if (board.winner === playingFor) {
      score += 10;
    } else if (board.winner === (playingFor === BoardPiece.X ? BoardPiece.O : BoardPiece.X)) {
      score -= 10;
    }
  }

  return score;
};

const minimax = (game: Game, depth: number, isMaximizing: boolean) => {
  if (depth === 0 || game.winner !== null) {
    return scoreMove(game, depth);
  }

  let bestValue;
  let allPossibleMoves = generateMoves(game);

  if (isMaximizing) {
    bestValue = -Infinity;
    for (let move of allPossibleMoves) {
      let childGame = simulateMove(game, move);
      let childValue = minimax(childGame, depth - 1, false);
      bestValue = Math.max(bestValue, childValue);
    }
  } else {
    bestValue = Infinity;
    for (let move of allPossibleMoves) {
      let childGame = simulateMove(game, move);
      let childValue = minimax(childGame, depth - 1, true);
      bestValue = Math.min(bestValue, childValue);
    }
  }

  return bestValue;
};

const chooseBestMove = (game: Game, depth: number) => {
  let bestValue = -Infinity;
  let bestMoves: Move[] = [];

  let allPossibleMoves = generateMoves(game);
  for (let move of allPossibleMoves) {
    let childGame = simulateMove(game, move);
    let childValue = minimax(childGame, depth - 1, false);

    if (childValue > bestValue) {
      bestValue = childValue;
      bestMoves = [move];
    } else if (childValue === bestValue) {
      bestMoves.push(move);
    }
  }

  if (bestMoves.length > 0) {
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  return null;
};

const makeIntelligentMove = () => {
  if (currentGame === null) return;

  const start = performance.now();
  let bestMove = chooseBestMove(currentGame, /* depth= */ 3);
  if (bestMove) {
    socket.emit('clientUpdate', currentGame.id, bestMove.boardId, bestMove.squareId, playingFor);
  }
  const end = performance.now();

  console.log(`Move took ${end-start}ms`);
};

setInterval(() => {
  let currentTime = new Date();
  let timeSinceLastMove = currentTime.getTime() - timeOfLastMove.getTime();

  if (timeSinceLastMove > 6000) {
    console.log("Dispatched forced move");
    makeIntelligentMove();
  }
}, 5000);

socket.on('update', (gameId, boardId, squareId, updatedPiece, username) => {
  if (username !== botUsername) {
    timeOfLastMove = new Date();
  }

  currentGame.boards[boardId].positions[squareId] = updatedPiece;
  if (updatedPiece !== playingFor) makeIntelligentMove();
});

socket.on('end', (gameId, boardId, winner, winningLine) => {
  if (boardId === null) return;
  
  currentGame.boards[boardId].winner = winner;
  currentGame.boards[boardId].winningLine = winningLine;
});

socket.on('history', (gameHistory) => {
  currentGame = gameHistory[gameHistory.length-1];
});

export interface ServerToClientEvents {
  playerInformation: (uuid: string, username: string | null, playingFor: BoardPiece) => void;
  history: (gameHistory: Array<Game>) => void;
  playerList: (playerList: Array<SanitizedPlayer>) => void;
  update: (gameId: number, boardId: number, squareId: number, updatedPiece: BoardPiece, username: string) => void;
  end: (gameId: number, boardId: number | null, winner: BoardPiece, winningLine: Array<number> | null, winnerUsername: string) => void;
  emote: (playerUuid: string, emoteSlug: string) => void;
}

export interface ClientToServerEvents {
  clientUpdate: (gameId: number, boardId: number, squareId: number, updatedPiece: BoardPiece) => void;
  requestUsername: (username: string, callback: (response: { code: number, message: string}) => void) => void;
  emote: (emoteSlug: string) => void;
}

const updateBoardWinners = (board) => {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (let line of lines) {
    const [a, b, c] = line;
    if (board.positions[a] && board.positions[a] === board.positions[b] && board.positions[a] === board.positions[c]) {
      board.winner = board.positions[a];
      board.winningLine = line;
      return;
    }
  }

  if (board.positions.every((position) => position !== 0)) {
    board.winner = BoardPiece.DRAW;
  }
};