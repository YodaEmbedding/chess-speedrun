const POLL_RATE = 10000;

const PIECE_NAMES = {
  P: "♟ Pawn",
  N: "♞ Knight",
  B: "♝ Bishop",
  R: "♜ Rook",
  Q: "♛ Queen",
  K: "♚ King",
};

const makeBoard = () => [...new Array(8)].map(() => new Array(8).fill(0));

const sanToRankFile = (square) => {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = square.charCodeAt(1) - "1".charCodeAt(0);
  return [rank, file];
};

const rankToRow = (rank) => 7 - rank;
const rowToRank = (row) => 7 - row;
const fileToCol = (file) => file;
const colToFile = (col) => col;

class Boards {
  constructor() {
    const pieces = ["P", "N", "B", "R", "Q", "K"];
    this.boards = Object.fromEntries(pieces.map((x) => [x, makeBoard()]));
  }

  push(piece, square) {
    const [rank, file] = sanToRankFile(square);
    this.boards[piece][rankToRow(rank)][fileToCol(file)] += 1;
  }
}

const renderCell = (cell, rank, file) => {
  const parity = (rank + file) % 2;
  const squareType = cell > 0 ? "completed" : parity === 0 ? "dark" : "light";
  return `<td class="square square-${squareType}"></td>`;
};

const renderRow = (row, rank) =>
  `<tr>\n${row
    .map((x, i) => renderCell(x, rank, colToFile(i)))
    .join("\n")}\n</tr>`;

const renderBoard = (board, piece) =>
  `<table class="board">\n<tbody>\n${board
    .map((x, i) => renderRow(x, rowToRank(i)))
    .join("\n")}\n</tbody>\n</table>\n<div class="piece-name">${
    PIECE_NAMES[piece]
  }</div>`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const lichessExportGames = async (userId, queryParams) => {
  console.log("lichessExportGames()");

  const baseUrl = "https://lichess.org/api/games/user/";
  const params = new URLSearchParams(queryParams);
  const response = await fetch(`${baseUrl}${userId}?${params}`, {
    headers: { Accept: "application/x-ndjson" },
  });

  if (response.status === 429) {
    // Rate limit.
    await sleep(60000);
    return [];
  }

  if (!response.ok) {
    throw new Error("Network response was not ok.");
  }

  const text = await response.text();
  const lines = text.trim().split("\n");
  const games = lines.filter((x) => x !== "").map(JSON.parse);

  return games;
};

async function* generateGames(userId, startTime) {
  let lastCreatedAt = startTime;

  // while (true) {
  for (let i = 0; i < 1; i += 1) {
    const queryParams = { since: lastCreatedAt };
    const games = await lichessExportGames(userId, queryParams);

    if (games.length === 0) {
      await sleep(POLL_RATE);
      continue;
    }

    lastCreatedAt = Math.max(...games.map((x) => x.createdAt));

    for (const game of games) {
      yield game;
    }

    await sleep(POLL_RATE);
  }
}

const getPlayerColor = (game, userId) =>
  game.players.white.user.id === userId
    ? "white"
    : game.players.black.user.id === userId
    ? "black"
    : null;

const getPlayerMoves = (game, color) => {
  const parity = { white: 0, black: 1 }[color];
  const moves = game.moves.split(" ");
  return moves.filter((_, i) => i % 2 === parity);
};

const convertMoveToDestination = (move, color) => {
  // NOTE: Test cases: O-O# O-O-O++ Raxe1+ e8=Q dxc3 Nbd2 N@c3 @c2.

  if (color !== "white" && color !== "black")
    throw new Error(`Unknown color ${color}.`);

  const castlingPattern = /^((O-O(-O)?)|(o-o(-o)?)|(0-0(-0)?))((\+{1,2})|#)?$/;
  const pattern = /^@?([PNBRQK]?)[a-h1-8@]?x?([a-h][1-8])(=[NBRQ])?((\+{1,2})|#)?$/;
  let match = null;
  const isWhite = color === "white";

  // Handle castling.
  match = move.match(castlingPattern);
  if (match !== null) {
    const side = { 3: "K", 5: "Q" }[match[1].length.toString()];
    const piece = "K";
    const square = (side === "K" ? "g" : "c") + (isWhite ? "1" : "8");
    return { piece, square };
  }

  // Handle regular move.
  match = move.match(pattern);
  if (match !== null) {
    const piece = match[1] === "" ? "P" : match[1];
    const square = match[2];
    return { piece, square };
  }

  throw new Error(`Cannot parse move ${move}.`);
};

const updateBoards = (boards, game, color) => {
  getPlayerMoves(game, color)
    .map((move) => convertMoveToDestination(move, color))
    .forEach((x) => boards.push(x.piece, x.square));
};

const refreshBoards = (boards) => {
  const pieces = ["P", "N", "B", "R", "Q", "K"];
  const boardWrappers = document.getElementsByClassName("board-wrapper");
  pieces.forEach((piece, i) => {
    const wrapper = boardWrappers[i];
    const board = boards.boards[piece];
    wrapper.innerHTML = renderBoard(board, piece);
  });
};

const main = async () => {
  const userId = "sicariusnoctis";
  const startTime = 1620542213419;
  const boards = new Boards();

  for await (const game of generateGames(userId, startTime)) {
    console.log(game);

    const color = getPlayerColor(game, userId);
    updateBoards(boards, game, color);
    refreshBoards(boards);
  }
};

window.onload = main;

// TODO UI: boards display
// TODO UI: userId, startTime
// TODO UI: start, stop, refresh, "auto-refresh" toggle switch
// TODO UI: progress bars
// TODO UI: flip boards icon button
// TODO refactor: loop
// TODO lichess: rate-limit
// TODO lichess: Get real-time users status (for quick check)
// TODO lichess: Export ongoing game of a user
// TODO lichess: Stream moves of a game
