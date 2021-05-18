const POLL_RATE = 10000;

const PIECE_NAMES = {
  P: "♟ Pawn",
  N: "♞ Knight",
  B: "♝ Bishop",
  R: "♜ Rook",
  Q: "♛ Queen",
  K: "♚ King",
};

const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);

const makeBoard = () => [...new Array(8)].map(() => new Array(8).fill(0));

const fileToStr = (file) => String.fromCharCode(file + "a".charCodeAt(0));
const rankToStr = (rank) => String.fromCharCode(rank + "1".charCodeAt(0));
const strToFile = (file) => file.charCodeAt(0) - "a".charCodeAt(0);
const strToRank = (rank) => rank.charCodeAt(0) - "1".charCodeAt(0);

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

  update(game, color) {
    getPlayerMoves(game, color)
      .map((move) => convertMoveToDestination(move, color))
      .forEach((x) => this.push(x.piece, x.square));
  }
}

class Stats {
  constructor() {
    this.gamesPlayed = 0;
    this.progress = 0;
    this.timeElapsed = 0;
  }

  update(game, boards, color) {
    const squares = Object.values(boards.boards).flat(2);
    const progress = squares.filter((x) => x > 0).length / squares.length;
    this.gamesPlayed += 1;
    this.progress = progress;
    this.timeElapsed += getElapsedTime(game, color);
  }
}

const renderCell = (cell, rank, file) => {
  const parity = (rank + file) % 2;
  const squareType = cell > 0 ? "completed" : parity === 0 ? "dark" : "light";
  return `<td class="square square-${squareType}"></td>`;
};

const renderCoordinateLabel = (label, elementType) =>
  `<td class="coordinate-label coordinate-label__${elementType}">${label}</td>`;

const renderRow = (row, rank) => {
  const rankStr = renderCoordinateLabel(rankToStr(rank), "rank");
  const cells = row.map((x, i) => renderCell(x, rank, colToFile(i)));
  const contents = [...cells, rankStr].join("\n");
  return `<tr>\n${contents}\n</tr>`;
};

const renderCoordinatesFiles = () => {
  const fileLabels = Array.from(Array(8), (_, i) => fileToStr(i));
  const fileStrs = fileLabels.map((label) =>
    renderCoordinateLabel(label, "file")
  );
  const emptyStr = renderCoordinateLabel("", "file");
  const contents = [...fileStrs, emptyStr].join("\n");
  return `<tr>\n${contents}\n</tr>`;
};

const renderBoard = (board, piece) => {
  const filesStr = renderCoordinatesFiles();
  const rows = board.map((x, i) => renderRow(x, rowToRank(i)));
  const contents = [...rows, filesStr].join("\n");
  const header = '<table class="board">\n<tbody>\n';
  const footer = "\n</tbody>\n</table>\n";
  const title = `<div class="piece-name">${PIECE_NAMES[piece]}</div>`;
  return `${header}${contents}${footer}${title}`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const lichessExportGames = async (userId, queryParams) => {
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
  games.reverse();

  return games;
};

async function* generateGames(userId, startUtcTimestamp) {
  let lastCreatedAt = startUtcTimestamp;

  while (true) {
    const queryParams = { since: lastCreatedAt, pgnInJson: true, clocks: true };
    const games = await lichessExportGames(userId, queryParams);

    if (games.length === 0) {
      await sleep(POLL_RATE);
      continue;
    }

    lastCreatedAt = Math.max(...games.map((x) => x.createdAt));

    for (const game of games) {
      if (game.speed === "correspondence") continue;
      if (!hasOwn(game, "clock")) continue;
      if (!hasOwn(game.clock, "totalTime")) continue;

      yield game;
    }

    await sleep(POLL_RATE);
  }
}

/** Determine total elapsed times for each player by parsing game PGN.

  Parses the PGN to extract { [%clk hh:mm:ss] } annotations.
  */
function parsePgnClocks(game) {
  const pattern = /%clk (?<hh>\d{1,2}):(?<mm>\d{1,2}):(?<ss>\d{1,2})/g;
  const times = [...game.pgn.matchAll(pattern)]
    .map((x) => x.groups)
    .map((x) => ({
      hh: parseInt(x.hh, 10),
      mm: parseInt(x.mm, 10),
      ss: parseInt(x.ss, 10),
    }))
    .map((x) => x.hh * 60 * 60 + x.mm * 60 + x.ss);
  const plies = times.length;

  // Zero time elapsed if black did not play a move.
  if (plies < 2) return { white: 0, black: 0 };

  // Determine start times.
  const startWhite = times[0];
  const startBlack = times[1];

  // Determine end times.
  const endTimes = times.slice(-2);
  const endWhite = endTimes[plies % 2];
  const endBlack = endTimes[(plies + 1) % 2];

  // Determine increments per move.
  // If berserk, do not increment.
  const initialTime = game.clock.initial;
  const whiteBerserk = startWhite * 2 === initialTime;
  const blackBerserk = startBlack * 2 === initialTime;
  const whiteIncrement = whiteBerserk ? 0 : game.clock.increment;
  const blackIncrement = blackBerserk ? 0 : game.clock.increment;

  // Determine total increment bonus.
  // On lichess, first two plies do not add increment.
  // Furthermore, if the final move ends the game abruptly
  // without giving the opponent a chance to reply
  // (e.g. mate, stalemate, fifty-move rule),
  // then lichess does not apply increment to the clocks on that final move.
  // If otherwise
  // (e.g. resignation, draw offer, timeout),
  // then the final move does indeed have increment applied.
  // NOTE: For simplicity, we will assume extra increment.
  const numWhiteMoves = Math.floor((plies + 1) / 2);
  const numBlackMoves = Math.floor(plies / 2);
  const bonusWhite = (numWhiteMoves - 1) * whiteIncrement;
  const bonusBlack = (numBlackMoves - 1) * blackIncrement;

  // Elapsed time is difference on clocks + increment bonus.
  const elapsedWhite = startWhite - endWhite + bonusWhite;
  const elapsedBlack = startBlack - endBlack + bonusBlack;

  const elapsed = { white: elapsedWhite, black: elapsedBlack };
  return elapsed;
}

/** Obtain elapsed time.

* This can be customized for specific speedrun requirements.
*/
function getElapsedTime(game, color) {
  // Method 1:
  // Unfortunately, lichess does not give precise clocks for this method.
  // return game.clock.totalTime;
  //
  // Method 2:
  // Slightly more precise.
  // return (game.lastMoveAt - game.createdAt) / 1000;
  //
  // Method 3:
  // This method parses the PGN to extract { [%clk hh:mm:ss] } annotations.
  const elapsed = parsePgnClocks(game);
  return elapsed.white + elapsed.black;
}

const getPlayerColor = (game, userId) =>
  hasOwn(game.players.white, "user") && game.players.white.user.id === userId
    ? "white"
    : hasOwn(game.players.black, "user") &&
      game.players.black.user.id === userId
    ? "black"
    : null;

function getPlayerMoves(game, color) {
  const parity = { white: 0, black: 1 }[color];
  const moves = game.moves.split(" ");
  return moves.filter((_, i) => i % 2 === parity);
}

function convertMoveToDestination(move, color) {
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
}

const intToStr = (x) =>
  x.toLocaleString(undefined, { minimumIntegerDigits: 2 });

const formatHHMMSS = (seconds) => {
  let s = seconds;
  const hh = Math.floor(s / 3600);
  s %= 3600;
  const mm = Math.floor(s / 60);
  s %= 60;
  const ss = Math.floor(s);
  return `${intToStr(hh)}:${intToStr(mm)}:${intToStr(ss)}`;
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

const refreshStats = (stats) => {
  const totalProgress = document.getElementById("total-progress");
  const gamesPlayed = document.getElementById("games-played");
  const timeTaken = document.getElementById("time-taken");
  const timeElapsedStr = formatHHMMSS(stats.timeElapsed);

  totalProgress.style.width = `${stats.progress * 100}%`;
  gamesPlayed.innerText = `Games played: ${stats.gamesPlayed}`;
  timeTaken.innerText = `Time taken: ${timeElapsedStr}`;
};

const runMainLoop = async (userId, startUtcTimestamp) => {
  const boards = new Boards();
  const stats = new Stats();

  for await (const game of generateGames(userId, startUtcTimestamp)) {
    console.debug(game);

    const color = getPlayerColor(game, userId);
    boards.update(game, color);
    stats.update(game, boards, color);

    refreshBoards(boards);
    refreshStats(stats);
  }
};

const initForms = () => {
  const startDateInput = document.getElementById("start-date");
  const startTimeInput = document.getElementById("start-time");

  const tzOffset = new Date().getTimezoneOffset() * 60 * 1000;
  const localISOString = new Date(Date.now() - tzOffset).toISOString();
  const date = localISOString.substring(0, 10);
  const time = localISOString.substring(11, 16);

  startDateInput.value = date;
  startTimeInput.value = time;
};

const getFormData = () => {
  const userId = document.getElementById("username").value.toLowerCase();
  const startDate = document.getElementById("start-date").value;
  const startTime = document.getElementById("start-time").value;

  const startDatetime = new Date(`${startDate} ${startTime}`);
  const startUtcTimestamp = startDatetime.getTime();

  return [userId, startUtcTimestamp];
};

let isRunning = false;

const onStartClick = () => {
  if (isRunning) {
    return;
  }

  isRunning = true;

  // Disable start button.
  const startButton = document.getElementById("btn-start-stop");
  startButton.disabled = true;

  // Hide controls.
  // const controls = document.getElementById("controls");
  // controls.style.display = "none";

  const [userId, startUtcTimestamp] = getFormData();
  runMainLoop(userId, startUtcTimestamp);
};

const main = () => {
  initForms();
  refreshBoards(new Boards());
  refreshStats(new Stats());

  const startButton = document.getElementById("btn-start-stop");
  startButton.addEventListener("click", onStartClick, false);
};

window.onload = main;

// TODO UI: buttons for refresh, "auto-refresh" toggle switch
// TODO UI: flip boards icon button
// TODO lichess: rate-limit
// TODO lichess: Get real-time users status (for quick check)
// TODO lichess: Export ongoing game of a user
// TODO lichess: Stream moves of a game
