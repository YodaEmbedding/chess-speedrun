const POLL_RATE = 10000;

const makeBoard = () => [...new Array(8)].map(() => new Array(8).fill(0));

const sanToRankFile = (square) => {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = square.charCodeAt(1) - "1".charCodeAt(0);
  return [rank, file];
};

class Boards {
  constructor() {
    const pieces = ["P", "N", "B", "R", "Q", "K"];
    this.boards = Object.fromEntries(pieces.map((x) => [x, makeBoard()]));
  }

  push(piece, square) {
    const [rank, file] = sanToRankFile(square);
    this.boards[piece][rank][file] += 1;
  }
}

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

const main = async () => {
  const userId = "sicariusnoctis";
  let lastCreatedAt = 1620542213419;

  const boards = new Boards();

  // while (true) {
  for (let i = 0; i < 2; i += 1) {
    const queryParams = { since: lastCreatedAt };
    const games = await lichessExportGames(userId, queryParams);

    if (games.length === 0) {
      await sleep(POLL_RATE);
      continue;
    }

    lastCreatedAt = Math.max(...games.map((x) => x.createdAt));

    const destinations = games.flatMap((game) => {
      const color = getPlayerColor(game, userId);
      const moves = getPlayerMoves(game, color);
      return moves.map((move) => convertMoveToDestination(move, color));
    });

    destinations.forEach((x) => boards.push(x.piece, x.square));

    games.forEach((x) => console.log(x));
    console.log(destinations.map((x) => `${x.piece}${x.square}`).join(" "));
    console.log(boards.boards);

    await sleep(POLL_RATE);
  }
};

main();

// TODO UI: boards display
// TODO UI: userId, startTime
// TODO UI: start, stop, refresh, "auto-refresh" toggle switch
// TODO refactor: loop
// TODO lichess: rate-limit
// TODO lichess: Get real-time users status (for quick check)
// TODO lichess: Export ongoing game of a user
// TODO lichess: Stream moves of a game
