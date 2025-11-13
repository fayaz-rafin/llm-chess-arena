"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type PieceType = "pawn" | "rook" | "knight" | "bishop" | "queen" | "king";
type PieceColor = "white" | "black";
type Piece = {
  type: PieceType;
  color: PieceColor;
};
type BoardState = (Piece | null)[][];
type Move = {
  from: [number, number];
  to: [number, number];
};

type MoveResponse = {
  move?: Move | null;
  message?: string;
};

type MoveSummary = {
  color: PieceColor;
  piece: Piece;
  from: [number, number];
  to: [number, number];
  captured: Piece | null;
  notation: string;
};

const PIECE_LABEL: Record<PieceType, string> = {
  pawn: "Pawn",
  rook: "Rook",
  knight: "Knight",
  bishop: "Bishop",
  queen: "Queen",
  king: "King",
};

const PIECE_IMAGE_MAP: Record<PieceColor, Record<PieceType, string>> = {
  white: {
    pawn: "/chess-pieces/W_Pawn.png",
    rook: "/chess-pieces/W_Rook.png",
    knight: "/chess-pieces/W_Knight.png",
    bishop: "/chess-pieces/W_Bishop.png",
    queen: "/chess-pieces/W_Queen.png",
    king: "/chess-pieces/W_King.png",
  },
  black: {
    pawn: "/chess-pieces/B_Pawn.png",
    rook: "/chess-pieces/B_Rook.png",
    knight: "/chess-pieces/B_Knight.png",
    bishop: "/chess-pieces/B_Bishop.png",
    queen: "/chess-pieces/B_Queen.png",
    king: "/chess-pieces/B_King.png",
  },
};

const getSquareName = (row: number, col: number) =>
  `${String.fromCharCode(65 + col)}${8 - row}`;

class ChessGame {
  board: BoardState;
  turn: PieceColor;
  moves: string[];
  gameOver: boolean;
  winner: PieceColor | null;

  constructor() {
    this.board = this.initBoard();
    this.turn = "white";
    this.moves = [];
    this.gameOver = false;
    this.winner = null;
  }

  private initBoard(): BoardState {
    const board: BoardState = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => null)
    );

    for (let i = 0; i < 8; i += 1) {
      board[1][i] = { type: "pawn", color: "black" };
      board[6][i] = { type: "pawn", color: "white" };
    }

    const backRow: PieceType[] = [
      "rook",
      "knight",
      "bishop",
      "queen",
      "king",
      "bishop",
      "knight",
      "rook",
    ];

    for (let i = 0; i < 8; i += 1) {
      board[0][i] = { type: backRow[i], color: "black" };
      board[7][i] = { type: backRow[i], color: "white" };
    }

    return board;
  }

  serializeBoard(): BoardState {
    return this.board.map((row) =>
      row.map((square) => (square ? { ...square } : null))
    );
  }

  getPossibleMoves(row: number, col: number): Move["to"][] {
    const piece = this.board[row][col];
    if (!piece || piece.color !== this.turn) return [];

    const moves: Move["to"][] = [];

    switch (piece.type) {
      case "pawn": {
        const direction = piece.color === "white" ? -1 : 1;
        const startRow = piece.color === "white" ? 6 : 1;

        if (this.isValid(row + direction, col) && !this.board[row + direction][col]) {
          moves.push([row + direction, col]);
          if (
            row === startRow &&
            this.isValid(row + 2 * direction, col) &&
            !this.board[row + 2 * direction][col]
          ) {
            moves.push([row + 2 * direction, col]);
          }
        }

        [-1, 1].forEach((dc) => {
          if (this.isValid(row + direction, col + dc)) {
            const target = this.board[row + direction][col + dc];
            if (target && target.color !== piece.color) {
              moves.push([row + direction, col + dc]);
            }
          }
        });
        break;
      }
      case "knight": {
        const deltas = [
          [-2, -1],
          [-2, 1],
          [-1, -2],
          [-1, 2],
          [1, -2],
          [1, 2],
          [2, -1],
          [2, 1],
        ];
        deltas.forEach(([dr, dc]) => {
          const newRow = row + dr;
          const newCol = col + dc;
          if (this.isValid(newRow, newCol)) {
            const target = this.board[newRow][newCol];
            if (!target || target.color !== piece.color) {
              moves.push([newRow, newCol]);
            }
          }
        });
        break;
      }
      case "bishop":
        this.addLineMoves(moves, row, col, [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]);
        break;
      case "rook":
        this.addLineMoves(moves, row, col, [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]);
        break;
      case "queen":
        this.addLineMoves(moves, row, col, [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]);
        break;
      case "king": {
        const deltas = [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        deltas.forEach(([dr, dc]) => {
          const newRow = row + dr;
          const newCol = col + dc;
          if (this.isValid(newRow, newCol)) {
            const target = this.board[newRow][newCol];
            if (!target || target.color !== piece.color) {
              moves.push([newRow, newCol]);
            }
          }
        });
        break;
      }
      default:
        break;
    }

    return moves;
  }

  private addLineMoves(
    moves: Move["to"][],
    row: number,
    col: number,
    directions: Array<[number, number]>
  ) {
    const piece = this.board[row][col];
    if (!piece) return;

    directions.forEach(([dr, dc]) => {
      let newRow = row + dr;
      let newCol = col + dc;

      while (this.isValid(newRow, newCol)) {
        const target = this.board[newRow][newCol];
        if (!target) {
          moves.push([newRow, newCol]);
        } else {
          if (target.color !== piece.color) {
            moves.push([newRow, newCol]);
          }
          break;
        }
        newRow += dr;
        newCol += dc;
      }
    });
  }

  private isValid(row: number, col: number) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  makeMove(fromRow: number, fromCol: number, toRow: number, toCol: number): MoveSummary | null {
    const piece = this.board[fromRow][fromCol];
    if (!piece) return null;

    const movingPiece: Piece = { ...piece };
    const captured = this.board[toRow][toCol];
    const capturedCopy = captured ? { ...captured } : null;

    this.board[toRow][toCol] = piece;
    this.board[fromRow][fromCol] = null;

    const squareName = getSquareName(toRow, toCol);
    let notation = `${PIECE_LABEL[piece.type]} ${squareName}`;
    if (capturedCopy) {
      notation += ` × ${PIECE_LABEL[capturedCopy.type]}`;
    }

    const colorLabel = piece.color === "white" ? "White" : "Black";
    this.moves.push(`${colorLabel} ${notation}`);

    const summary: MoveSummary = {
      color: piece.color,
      piece: movingPiece,
      from: [fromRow, fromCol],
      to: [toRow, toCol],
      captured: capturedCopy,
      notation,
    };

    if (capturedCopy?.type === "king") {
      this.gameOver = true;
      this.winner = piece.color;
      return summary;
    }

    this.turn = this.turn === "white" ? "black" : "white";
    return summary;
  }

  getAllPossibleMoves(): Move[] {
    const result: Move[] = [];

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = this.board[row][col];
        if (piece && piece.color === this.turn) {
          const moves = this.getPossibleMoves(row, col);
          moves.forEach(([toRow, toCol]) => {
            result.push({ from: [row, col], to: [toRow, toCol] });
          });
        }
      }
    }

    return result;
  }
}

const BOARD_SIZE = 8;
const SQUARE_SIZE = 1;
const BOARD_OFFSET = (BOARD_SIZE - 1) / 2;
const MOVE_DELAY_MS = 1500;

const CUSTOM_PRESET_ID = "custom";

const sanitizeId = (value: string) =>
  value.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 120);

const resolveHostSegment = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl);
    return sanitizeId(url.host || "litellm");
  } catch {
    return sanitizeId(baseUrl);
  }
};

type ModelPreset = {
  id: string;
  label: string;
  model: string;
  baseUrl: string;
};

const MODEL_PRESETS: ReadonlyArray<ModelPreset> = [
  {
    id: "openai-gpt-4o",
    label: "OpenAI · GPT-4o",
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "openai-gpt-5",
    label: "OpenAI · GPT-5",
    model: "gpt-5",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "anthropic-claude-4.5-sonnet",
    label: "Anthropic · Claude 4.5 Sonnet",
    model: "claude-4.5-sonnet",
    baseUrl: "https://api.anthropic.com/v1",
  },
  {
    id: "google-gemini-2.5-flash",
    label: "Google · Gemini 2.5 Flash",
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  {
    id: "google-gemini-2.5-pro",
    label: "Google · Gemini 2.5 Pro",
    model: "gemini-2.5-pro",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  {
    id: CUSTOM_PRESET_ID,
    label: "Custom configuration…",
    model: "",
    baseUrl: "",
  },
];

const DEFAULT_PRESET = MODEL_PRESETS[0]!;

type LlmConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

export default function Home() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const piecesRef = useRef<Record<string, THREE.Mesh>>({});
  const angleRef = useRef(0);
  const requestRef = useRef<number | null>(null);
  const gameRef = useRef<ChessGame | null>(null);
  const isPlayingRef = useRef(false);
  const sceneReadyRef = useRef(false);
  const moveListRef = useRef<HTMLDivElement | null>(null);
  const turnInProgressRef = useRef(false);

  const [status, setStatus] = useState("Initializing arena...");
  const [isPlaying, setIsPlaying] = useState(false);
  const [moveLog, setMoveLog] = useState<string[]>([]);
  const [moveHistory, setMoveHistory] = useState<MoveSummary[]>([]);
  const [capturedByWhite, setCapturedByWhite] = useState<Piece[]>([]);
  const [capturedByBlack, setCapturedByBlack] = useState<Piece[]>([]);
  const [whitePresetId, setWhitePresetId] = useState(DEFAULT_PRESET.id);
  const [blackPresetId, setBlackPresetId] = useState(DEFAULT_PRESET.id);
  const [whiteConfig, setWhiteConfig] = useState<LlmConfig>({
    apiKey: "",
    model: DEFAULT_PRESET.model,
    baseUrl: DEFAULT_PRESET.baseUrl,
  });
  const [blackConfig, setBlackConfig] = useState<LlmConfig>({
    apiKey: "",
    model: DEFAULT_PRESET.model,
    baseUrl: DEFAULT_PRESET.baseUrl,
  });
  const [moveDelay, setMoveDelay] = useState(MOVE_DELAY_MS);
  const [dynamicPresets, setDynamicPresets] = useState<ModelPreset[]>([]);
  const [liteLlmBaseUrl, setLiteLlmBaseUrl] = useState("");
  const [liteLlmApiKey, setLiteLlmApiKey] = useState("");
  const [liteLlmStatus, setLiteLlmStatus] = useState<string | null>(null);
  const [isLoadingLiteLlm, setIsLoadingLiteLlm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allPresets = useMemo(() => {
    const seen = new Set<string>();
    const merged: ModelPreset[] = [];

    dynamicPresets.forEach((preset) => {
      if (!seen.has(preset.id)) {
        merged.push(preset);
        seen.add(preset.id);
      }
    });

    MODEL_PRESETS.forEach((preset) => {
      if (!seen.has(preset.id)) {
        merged.push(preset);
        seen.add(preset.id);
      }
    });

    return merged;
  }, [dynamicPresets]);

  const updateFromGame = useCallback((game: ChessGame) => {
    if (game.gameOver) {
      const winnerLabel = game.winner
        ? `${game.winner.charAt(0).toUpperCase() + game.winner.slice(1)} wins!`
        : "Game over";
      setStatus(winnerLabel);
    } else {
      const turnLabel = `${game.turn.charAt(0).toUpperCase() + game.turn.slice(1)} to move`;
      setStatus(turnLabel);
    }

    setMoveLog((game.moves.slice(-12) || []).reverse());
  }, []);

  const clearPieces = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    Object.values(piecesRef.current).forEach((mesh) => {
      scene.remove(mesh);
    });

    piecesRef.current = {};
  }, []);

  const createPieceMesh = useCallback((type: PieceType, color: PieceColor) => {
    let geometry: THREE.BufferGeometry;

    switch (type) {
      case "pawn":
        geometry = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 12);
        break;
      case "rook":
        geometry = new THREE.BoxGeometry(0.5, 0.8, 0.5);
        break;
      case "knight":
        geometry = new THREE.ConeGeometry(0.3, 0.8, 5);
        break;
      case "bishop":
        geometry = new THREE.ConeGeometry(0.25, 1, 12);
        break;
      case "queen":
        geometry = new THREE.SphereGeometry(0.35, 16, 16);
        break;
      case "king":
      default:
        geometry = new THREE.CylinderGeometry(0.25, 0.35, 1, 12);
        break;
    }

    const material = new THREE.MeshStandardMaterial({
      color: color === "white" ? 0xffffff : 0x333333,
      roughness: 0.4,
      metalness: 0.3,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  }, []);

  const initPieces = useCallback((game: ChessGame) => {
    const scene = sceneRef.current;
    if (!scene) return;

    clearPieces();

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const square = game.board[row][col];
        if (square) {
          const key = `${row}-${col}`;
          const piece = createPieceMesh(square.type, square.color);
          piece.position.set(
            col * SQUARE_SIZE - BOARD_OFFSET,
            0.5,
            row * SQUARE_SIZE - BOARD_OFFSET
          );
          piece.userData = { row, col, type: square.type, color: square.color };
          scene.add(piece);
          piecesRef.current[key] = piece;
        }
      }
    }
  }, [clearPieces, createPieceMesh]);

  const movePieceInScene = useCallback(
    (fromRow: number, fromCol: number, toRow: number, toCol: number) => {
      const scene = sceneRef.current;
      if (!scene) return;

      const fromKey = `${fromRow}-${fromCol}`;
      const toKey = `${toRow}-${toCol}`;

      const target = piecesRef.current[toKey];
      if (target) {
        scene.remove(target);
        delete piecesRef.current[toKey];
      }

      const piece = piecesRef.current[fromKey];
      if (piece) {
        piece.position.set(
          toCol * SQUARE_SIZE - BOARD_OFFSET,
          0.5,
          toRow * SQUARE_SIZE - BOARD_OFFSET
        );
        piece.userData.row = toRow;
        piece.userData.col = toCol;
        piecesRef.current[toKey] = piece;
        delete piecesRef.current[fromKey];
      }
    },
    []
  );

  const fetchLlmMove = useCallback(
    async (
      turn: PieceColor,
      legalMoves: Move[],
      board: BoardState,
      history: string[],
      config: LlmConfig
    ): Promise<Move> => {
      const payload = {
        turn,
        legalMoves,
        board,
        history,
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
      };

      const response = await fetch("/api/llm-move", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data: MoveResponse & { error?: string } = await response.json();

      if (!response.ok) {
        const errorMessage = data.error || `LLM route returned ${response.status}`;
        throw new Error(errorMessage);
      }

      if (!data?.move?.from || !data.move.to) {
        throw new Error(data.error || "LLM did not return a valid move");
      }

      const serializedMove = JSON.stringify(data.move);
      const isLegal = legalMoves.some(
        (move) => JSON.stringify(move) === serializedMove
      );

      if (!isLegal) {
        throw new Error("LLM returned an illegal move");
      }

      return data.move;
    },
    []
  );

  const scheduleNextTurn = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playNextTurn = useCallback(async () => {
    if (turnInProgressRef.current) {
      return;
    }

    turnInProgressRef.current = true;

    try {
      const game = gameRef.current;
      if (!game || game.gameOver || !isPlayingRef.current) {
        return;
      }

      const legalMoves = game.getAllPossibleMoves();
      if (legalMoves.length === 0) {
        game.gameOver = true;
        const winner = game.turn === "white" ? "black" : "white";
        game.winner = winner;
        const winnerLabel = winner.charAt(0).toUpperCase() + winner.slice(1);
        setStatus(`${winnerLabel} wins by stalemate!`);
        setIsPlaying(false);
        isPlayingRef.current = false;
        return;
      }

      const config = game.turn === "white" ? whiteConfig : blackConfig;
      setStatus(`Consulting ${game.turn} LLM (${config.model})...`);

      let move: Move;
      try {
        move = await fetchLlmMove(
          game.turn,
          legalMoves,
          game.serializeBoard(),
          [...game.moves],
          config
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to get move from LLM";
        setError(`${game.turn === "white" ? "White" : "Black"} LLM error: ${errorMessage}`);
        setIsPlaying(false);
        isPlayingRef.current = false;
        setStatus(`Game stopped: ${errorMessage}`);
        return;
      }

      const [fromRow, fromCol] = move.from;
      const [toRow, toCol] = move.to;
      movePieceInScene(fromRow, fromCol, toRow, toCol);
      const summary = game.makeMove(fromRow, fromCol, toRow, toCol);
      if (summary) {
        setMoveHistory((prev) => [...prev, summary]);
        if (summary.captured) {
          const capturedPiece = summary.captured;
          if (summary.color === "white") {
            setCapturedByWhite((prev) => [...prev, capturedPiece]);
          } else {
            setCapturedByBlack((prev) => [...prev, capturedPiece]);
          }
        }
      }
      updateFromGame(game);

      if (!game.gameOver && isPlayingRef.current) {
        if (scheduleNextTurn.current) {
          clearTimeout(scheduleNextTurn.current);
        }
        scheduleNextTurn.current = setTimeout(playNextTurn, moveDelay);
      } else if (game.gameOver) {
        setIsPlaying(false);
        isPlayingRef.current = false;
      }
    } finally {
      turnInProgressRef.current = false;
    }
  }, [blackConfig, fetchLlmMove, moveDelay, movePieceInScene, updateFromGame, whiteConfig]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(5, 8, 5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0x4ecdc4, 1.2, 100);
    pointLight.position.set(0, 10, 0);
    scene.add(pointLight);

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const isLight = (row + col) % 2 === 0;
        const geometry = new THREE.BoxGeometry(SQUARE_SIZE, 0.2, SQUARE_SIZE);
        const material = new THREE.MeshStandardMaterial({
          color: isLight ? 0xeeeed2 : 0x769656,
          roughness: 0.8,
          metalness: 0.1,
        });
        const square = new THREE.Mesh(geometry, material);
        square.position.set(
          col * SQUARE_SIZE - BOARD_OFFSET,
          -0.1,
          row * SQUARE_SIZE - BOARD_OFFSET
        );
        square.receiveShadow = true;
        scene.add(square);
      }
    }

    const animate = () => {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;

      angleRef.current += 0.002;
      const radius = 10;
      cameraRef.current.position.x = Math.sin(angleRef.current) * radius;
      cameraRef.current.position.z = Math.cos(angleRef.current) * radius;
      cameraRef.current.lookAt(0, 0, 0);

      rendererRef.current.render(sceneRef.current, cameraRef.current);
      requestRef.current = requestAnimationFrame(animate);
    };

    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);
    requestRef.current = requestAnimationFrame(animate);

    const game = new ChessGame();
    gameRef.current = game;
    initPieces(game);
    updateFromGame(game);
    setMoveHistory([]);
    setCapturedByWhite([]);
    setCapturedByBlack([]);
    sceneReadyRef.current = true;

    return () => {
      isPlayingRef.current = false;
      turnInProgressRef.current = false;
      if (scheduleNextTurn.current) {
        clearTimeout(scheduleNextTurn.current);
      }

      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }

      window.removeEventListener("resize", handleResize);

      clearPieces();

      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (rendererRef.current.domElement.parentNode) {
          rendererRef.current.domElement.parentNode.removeChild(
            rendererRef.current.domElement
          );
        }
      }

      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, [clearPieces, initPieces, updateFromGame]);

  useEffect(() => {
    if (!isPlaying) {
      isPlayingRef.current = false;
      return;
    }

    if (sceneReadyRef.current) {
      isPlayingRef.current = true;
      playNextTurn();
    }
  }, [isPlaying, playNextTurn]);

  useEffect(() => {
    if (moveListRef.current) {
      moveListRef.current.scrollTop = moveListRef.current.scrollHeight;
    }
  }, [moveHistory]);

  const handleStart = () => {
    if (!sceneReadyRef.current || isPlayingRef.current) return;

    // Validate API keys and models
    const whiteApiKey = whiteConfig.apiKey.trim();
    const blackApiKey = blackConfig.apiKey.trim();
    const whiteModel = whiteConfig.model.trim();
    const blackModel = blackConfig.model.trim();

    if (!whiteApiKey || !whiteModel) {
      setError("White LLM: API key and model are required");
      setStatus("Cannot start: White LLM configuration is incomplete");
      return;
    }

    if (!blackApiKey || !blackModel) {
      setError("Black LLM: API key and model are required");
      setStatus("Cannot start: Black LLM configuration is incomplete");
      return;
    }

    setError(null);
    isPlayingRef.current = true;
    setIsPlaying(true);
    playNextTurn();
  };

  const handlePause = () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (scheduleNextTurn.current) {
      clearTimeout(scheduleNextTurn.current);
      scheduleNextTurn.current = null;
    }
  };

  const handleReset = () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    turnInProgressRef.current = false;
    setError(null);

    if (!sceneReadyRef.current) return;

    const game = new ChessGame();
    gameRef.current = game;
    initPieces(game);
    setMoveHistory([]);
    setCapturedByWhite([]);
    setCapturedByBlack([]);
    updateFromGame(game);
  };

  const handleConfigChange = (
    color: PieceColor,
    field: keyof LlmConfig,
    value: string
  ) => {
    if (color === "white") {
      setWhiteConfig((prev) => ({ ...prev, [field]: value }));
      if (field !== "apiKey") {
        setWhitePresetId(CUSTOM_PRESET_ID);
      }
    } else {
      setBlackConfig((prev) => ({ ...prev, [field]: value }));
      if (field !== "apiKey") {
        setBlackPresetId(CUSTOM_PRESET_ID);
      }
    }
    // Clear error when user updates configuration
    setError(null);
  };

  const handlePresetChange = useCallback(
    (color: PieceColor, presetId: string) => {
      const preset = allPresets.find((entry) => entry.id === presetId);
      const resolvedId = preset ? preset.id : CUSTOM_PRESET_ID;

      if (color === "white") {
        setWhitePresetId(resolvedId);
        if (preset && preset.id !== CUSTOM_PRESET_ID) {
          setWhiteConfig((prev) => ({
            ...prev,
            model: preset.model,
            baseUrl: preset.baseUrl,
          }));
        }
      } else {
        setBlackPresetId(resolvedId);
        if (preset && preset.id !== CUSTOM_PRESET_ID) {
          setBlackConfig((prev) => ({
            ...prev,
            model: preset.model,
            baseUrl: preset.baseUrl,
          }));
        }
      }
    },
    [allPresets]
  );

  const whiteIsCustom = whitePresetId === CUSTOM_PRESET_ID;
  const blackIsCustom = blackPresetId === CUSTOM_PRESET_ID;

  const loadLiteLlmModels = useCallback(async () => {
    const trimmedBase = liteLlmBaseUrl.trim();
    if (!trimmedBase) {
      setLiteLlmStatus("Enter a LiteLLM base URL first.");
      return;
    }

    setIsLoadingLiteLlm(true);
    setLiteLlmStatus("Fetching models from LiteLLM...");

    try {
      const response = await fetch("/api/litellm/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          baseUrl: trimmedBase,
          apiKey: liteLlmApiKey.trim() || undefined,
        }),
      });

      const payload: {
        baseUrl?: string;
        models?: Array<{
          id: string;
          label?: string;
          provider?: string | null;
        }>;
        message?: string;
        error?: string;
      } = await response.json();

      if (!response.ok) {
        setLiteLlmStatus(payload.error || `LiteLLM request failed (${response.status}).`);
        return;
      }

      const normalizedBase = payload.baseUrl ?? trimmedBase;
      const hostSegment = resolveHostSegment(normalizedBase);
      const models = payload.models ?? [];

      const nextPresets: ModelPreset[] = models.map((model) => {
        const prettyLabel = [model.provider, model.label || model.id]
          .filter(Boolean)
          .join(" · ");
        return {
          id: `litellm-${hostSegment}-${sanitizeId(model.id)}`,
          label: prettyLabel || model.id,
          model: model.id,
          baseUrl: normalizedBase,
        };
      });

      setDynamicPresets(nextPresets);
      setLiteLlmStatus(`Loaded ${nextPresets.length} model${nextPresets.length === 1 ? "" : "s"} from LiteLLM.`);
    } catch (error) {
      setLiteLlmStatus(
        error instanceof Error
          ? `Failed to fetch from LiteLLM: ${error.message}`
          : "Failed to fetch from LiteLLM."
      );
    } finally {
      setIsLoadingLiteLlm(false);
    }
  }, [liteLlmApiKey, liteLlmBaseUrl]);

  useEffect(() => {
    setWhitePresetId((current) => {
      if (current === CUSTOM_PRESET_ID) return current;
      return allPresets.some((preset) => preset.id === current)
        ? current
        : CUSTOM_PRESET_ID;
    });
    setBlackPresetId((current) => {
      if (current === CUSTOM_PRESET_ID) return current;
      return allPresets.some((preset) => preset.id === current)
        ? current
        : CUSTOM_PRESET_ID;
    });
  }, [allPresets]);

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        color: "#ffffff",
      }}
    >
      <div ref={containerRef} className="h-full w-full" />

      <div
        className="pointer-events-auto absolute left-6 top-6 flex max-h-[calc(100vh-3rem)] w-[min(24rem,90vw)] flex-col overflow-hidden rounded-xl border border-white/10 bg-black/60 text-sm shadow-2xl backdrop-blur-lg"
      >
        <div className="flex-1 overflow-y-auto p-6 pr-3">
          <h1 className="text-2xl font-semibold">♟️ LLM Chess Arena ♟️</h1>
          <p className="mt-2 text-teal-300">{status}</p>
          {error && (
            <div className="mt-2 rounded-md bg-red-500/20 border border-red-500/50 p-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="mt-4 space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-white/50">Battle Controls</p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                <button
                  onClick={handleStart}
                  className="rounded-md bg-teal-400 px-3 py-2 font-semibold text-slate-900 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:bg-slate-500"
                  disabled={isPlaying || !whiteConfig.apiKey.trim() || !blackConfig.apiKey.trim() || !whiteConfig.model.trim() || !blackConfig.model.trim()}
                >
                  Start Battle
                </button>
                <button
                  onClick={handlePause}
                  className="rounded-md bg-white/10 px-3 py-2 transition hover:bg-white/20"
                  disabled={!isPlaying}
                >
                  Pause
                </button>
                <button
                  onClick={handleReset}
                  className="rounded-md bg-white/10 px-3 py-2 transition hover:bg-white/20"
                >
                  Reset
                </button>
              </div>
            </div>

            <div>
              <label className="flex items-center justify-between text-xs uppercase tracking-wide text-white/50">
                Turn Delay (ms)
                <input
                  type="number"
                  min={250}
                  step={250}
                  value={moveDelay}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isNaN(value)) {
                      setMoveDelay(MOVE_DELAY_MS);
                      return;
                    }
                    setMoveDelay(Math.max(250, value));
                  }}
                  className="ml-2 w-20 rounded bg-white/10 px-2 py-1 text-right text-white placeholder-white/40 focus:outline-none"
                />
              </label>
            </div>

            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-white/50">White LLM</p>
              <select
                value={whitePresetId}
                onChange={(event) =>
                  handlePresetChange("white", event.target.value)
                }
                className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white focus:outline-none"
              >
                {allPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <input
                type="password"
                placeholder="API key"
                value={whiteConfig.apiKey}
                onChange={(event) =>
                  handleConfigChange("white", "apiKey", event.target.value)
                }
                className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none"
              />
              <input
                type="text"
                placeholder="Model ID"
                value={whiteConfig.model}
                onChange={(event) =>
                  handleConfigChange("white", "model", event.target.value)
                }
                disabled={!whiteIsCustom}
                className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              <input
                type="text"
                placeholder="Base URL"
                value={whiteConfig.baseUrl}
                onChange={(event) =>
                  handleConfigChange("white", "baseUrl", event.target.value)
                }
                disabled={!whiteIsCustom}
                className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="text-[11px] text-white/40">
                {whiteIsCustom
                  ? "Set a custom model ID and base URL for this side."
                  : "Preset locks the model and base URL. Choose Custom to edit manually."}
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-white/50">Black LLM</p>
              <select
                value={blackPresetId}
                onChange={(event) =>
                  handlePresetChange("black", event.target.value)
                }
                className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white focus:outline-none"
              >
                {allPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <input
                type="password"
                placeholder="API key"
                value={blackConfig.apiKey}
                onChange={(event) =>
                  handleConfigChange("black", "apiKey", event.target.value)
                }
                className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none"
              />
              <input
                type="text"
                placeholder="Model ID"
                value={blackConfig.model}
                onChange={(event) =>
                  handleConfigChange("black", "model", event.target.value)
                }
                disabled={!blackIsCustom}
                className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              <input
                type="text"
                placeholder="Base URL"
                value={blackConfig.baseUrl}
                onChange={(event) =>
                  handleConfigChange("black", "baseUrl", event.target.value)
                }
                disabled={!blackIsCustom}
                className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="text-[11px] text-white/40">
                {blackIsCustom
                  ? "Set a custom model ID and base URL for this side."
                  : "Preset locks the model and base URL. Choose Custom to edit manually."}
              </p>
            </div>
          </div>

          <div className="mt-5 max-h-60 overflow-y-auto rounded-lg bg-white/5 p-3 text-xs text-white/80">
            {moveLog.length === 0 ? (
              <p className="text-white/40">No moves yet. Start the battle to see the action.</p>
            ) : (
              moveLog.map((move, index) => (
                <div
                  key={`${move}-${index}`}
                  className="border-l-2 border-teal-400/80 pl-2"
                >
                  {move}
                </div>
              ))
            )}
          </div>

          <p className="mt-4 text-[11px] text-white/40">
            Provide API keys for two different LLMs (or the same model twice) to let
            them duel automatically. Keys are stored only in your browser and sent
            directly to the move-selection API route for each turn.
          </p>
        </div>
      </div>

      <div
        className="pointer-events-auto absolute right-6 top-6 flex max-h-[calc(100vh-3rem)] w-[min(24rem,90vw)] flex-col overflow-hidden rounded-xl border border-white/10 bg-black/60 text-sm shadow-2xl backdrop-blur-lg"
      >
        <div className="flex-1 overflow-y-auto p-6 pl-3">
          <h2 className="text-xl font-semibold">Battle Log</h2>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-white/50">Moves</p>
            <div
              ref={moveListRef}
              className="mt-2 max-h-72 overflow-y-auto rounded-lg bg-white/5 p-3 pr-4"
            >
              <ol className="space-y-3 text-sm text-white/80">
                {moveHistory.length === 0 ? (
                  <li className="text-white/40">No moves played yet.</li>
                ) : (
                  moveHistory.map((entry, index) => {
                    const moveNumber = Math.floor(index / 2) + 1;
                    const colorLabel = entry.color === "white" ? "White" : "Black";
                    return (
                      <li key={`${entry.notation}-${index}`} className="flex gap-2">
                        <span className="min-w-[2.5rem] text-xs text-white/40">#{moveNumber}</span>
                        <div className="flex-1">
                          <p className="font-medium text-white">
                            {colorLabel} · {entry.notation}
                          </p>
                          {entry.captured && (
                            <p className="text-[11px] text-white/50">
                              Captured {PIECE_LABEL[entry.captured.type]}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })
                )}
              </ol>
            </div>
          </div>

          <div className="mt-6 space-y-6 border-t border-white/10 pt-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-white/50">Captured by White</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {capturedByWhite.length === 0 ? (
                  <span className="text-[11px] text-white/40">None yet.</span>
                ) : (
                  capturedByWhite.map((piece, index) => (
                    <div key={`white-captured-${piece.type}-${index}`} className="flex items-center gap-1 rounded bg-white/10 px-2 py-1">
                      <img
                        src={PIECE_IMAGE_MAP[piece.color][piece.type]}
                        alt={`${piece.color} ${piece.type}`}
                        className="h-6 w-6 object-contain"
                      />
                      <span className="text-[11px] text-white/70">{PIECE_LABEL[piece.type]}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-white/50">Captured by Black</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {capturedByBlack.length === 0 ? (
                  <span className="text-[11px] text-white/40">None yet.</span>
                ) : (
                  capturedByBlack.map((piece, index) => (
                    <div key={`black-captured-${piece.type}-${index}`} className="flex items-center gap-1 rounded bg-white/10 px-2 py-1">
                      <img
                        src={PIECE_IMAGE_MAP[piece.color][piece.type]}
                        alt={`${piece.color} ${piece.type}`}
                        className="h-6 w-6 object-contain"
                      />
                      <span className="text-[11px] text-white/70">{PIECE_LABEL[piece.type]}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
