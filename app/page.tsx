"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

let persistedCameraAngle = 0;

// --- Geometry Generators ---
const GEOMETRY_CACHE: Record<string, THREE.BufferGeometry> = {};

const getLatheGeometry = (points: [number, number][]) => {
  const key = JSON.stringify(points);
  if (GEOMETRY_CACHE[key]) return GEOMETRY_CACHE[key];

  const vectorPoints = points.map(([r, y]) => new THREE.Vector2(r, y));
  const geometry = new THREE.LatheGeometry(vectorPoints, 32);
  geometry.computeVertexNormals();
  GEOMETRY_CACHE[key] = geometry;
  return geometry;
};

// Standard base profile for all pieces
const BASE_PROFILE: [number, number][] = [
  [0.35, 0],
  [0.35, 0.05],
  [0.32, 0.08],
  [0.30, 0.12],
  [0.28, 0.15],
];

// Helper to merge base with piece profile
const withBase = (profile: [number, number][], startY: number) => {
  const adjustedProfile = profile.map(([r, y]) => [r, y + startY] as [number, number]);
  return [...BASE_PROFILE, ...adjustedProfile];
};

const getPawnGeometry = () =>
  getLatheGeometry(
    withBase(
      [
        [0.20, 0], // Stem bottom
        [0.15, 0.3], // Stem mid
        [0.12, 0.45], // Neck
        [0.18, 0.46], // Collar bottom
        [0.18, 0.49], // Collar top
        [0.10, 0.50], // Neck top
        [0.22, 0.65], // Head equator
        [0, 0.80],    // Head top
      ],
      0.15
    )
  );

const getRookGeometry = () =>
  getLatheGeometry([
    // Base (Tiered rings)
    [0.32, 0],
    [0.32, 0.05],
    [0.28, 0.08], // Step in
    [0.30, 0.12], // Ring 1 out
    [0.30, 0.15], // Ring 1 vert
    [0.26, 0.18], // Ring 1 in
    [0.28, 0.21], // Ring 2 out
    [0.28, 0.23], // Ring 2 vert
    [0.20, 0.25], // Ring 2 in / Stem start
    
    // Stem (Tapered cylinder)
    [0.17, 0.50], // Middle neck
    [0.18, 0.60], // Top of stem
    
    // Neck Ring (The collar below the turret)
    [0.24, 0.63], // Ring out
    [0.24, 0.66], // Ring vert
    [0.19, 0.69], // Ring in

    // Turret Base (Flare)
    [0.28, 0.82], // Flare out
    [0.28, 0.90], // Turret solid wall
    [0.20, 0.90], // Inner rim floor
    [0.20, 0.85], // Inside cup depth
    [0, 0.85],    // Center floor
  ]);

const getBishopGeometry = () =>
  getLatheGeometry([
    // Base (Smooth tiered style)
    [0.34, 0],
    [0.34, 0.04],
    [0.30, 0.07], 
    [0.32, 0.10], 
    [0.32, 0.14],
    [0.26, 0.18], // Smooth curve in

    // Stem (Elongated concave curve)
    [0.20, 0.25],
    [0.15, 0.45], // Waist
    [0.18, 0.62], // Widen gently

    // Collar (Disc)
    [0.24, 0.64], // Flare under collar
    [0.26, 0.66], // Collar outer rim
    [0.26, 0.69], // Collar thickness
    [0.20, 0.70], // Collar top in

    // Head (Miter - rounded egg shape)
    [0.20, 0.70], 
    [0.25, 0.80], // Bulge
    [0.22, 0.95], // Taper
    [0.10, 1.05], // Top narrow

    // Finial
    [0.08, 1.07],
    [0, 1.10],
  ]);

const getQueenGeometry = () =>
  getLatheGeometry([
    // Base (Tiered and Bulbous)
    [0.34, 0],
    [0.34, 0.05], // Bottom rim
    [0.30, 0.08], // Step in
    [0.32, 0.12], // Step out
    [0.32, 0.15], // Base vertical
    [0.25, 0.20], // Curve in start
    [0.30, 0.25], // Belly bulge
    [0.30, 0.30], // Belly vertical
    [0.16, 0.50], // Stem taper narrowest
    [0.18, 0.65], // Stem widen top

    // Collar (Double Ring)
    [0.22, 0.66], // Under ring 1
    [0.24, 0.68], // Ring 1 out
    [0.24, 0.70], // Ring 1 vert
    [0.20, 0.71], // Ring 1 in
    [0.23, 0.73], // Ring 2 out
    [0.23, 0.76], // Ring 2 vert
    [0.18, 0.77], // Ring 2 in / Neck

    // Crown Head
    [0.18, 0.80], // Neck start
    [0.28, 0.95], // Crown flare
    [0.28, 0.98], // Crown rim height
    [0.15, 0.98], // Inside rim flat
    [0.15, 0.95], // Inner cup
    [0, 0.95],    // Center floor (for dome to sit on)
  ]);

const getKingGeometry = () =>
  getLatheGeometry([
    // Base (Tiered and Bulbous - matching Queen style)
    [0.34, 0],
    [0.34, 0.05], // Bottom rim
    [0.30, 0.08], // Step in
    [0.32, 0.12], // Step out
    [0.32, 0.15], // Base vertical
    [0.25, 0.20], // Curve in start
    [0.30, 0.25], // Belly bulge
    [0.30, 0.30], // Belly vertical
    [0.17, 0.50], // Stem taper narrowest
    [0.19, 0.65], // Stem widen top

    // Collar (Double Ring)
    [0.23, 0.66], // Under ring 1
    [0.25, 0.68], // Ring 1 out
    [0.25, 0.70], // Ring 1 vert
    [0.21, 0.71], // Ring 1 in
    [0.24, 0.73], // Ring 2 out
    [0.24, 0.76], // Ring 2 vert
    [0.19, 0.77], // Ring 2 in / Neck

    // Head (Inverted Cone Crown)
    [0.19, 0.80], // Neck start
    [0.30, 0.96], // Flare out (Crown)
    [0.30, 1.00], // Crown rim vertical
    [0.26, 1.02], // Slope in to dome
    
    // Top Dome (The "hat" inside the crown)
    [0.15, 1.03], // Dome base
    [0.18, 1.06], // Dome bulge
    [0.12, 1.10], // Dome taper
    [0.08, 1.12], // Finial connector base
    [0, 1.12],    // Center
  ]);

const getKnightHeadGeometry = () => {
  if (GEOMETRY_CACHE["knight-head"]) return GEOMETRY_CACHE["knight-head"];

  const shape = new THREE.Shape();
  
  // Stylized Knight profile based on reference (segmented mane, vents, blocky snout)
  
  // Start at bottom back
  shape.moveTo(-0.2, -0.1);
  
  // Mane (Back of neck) with "teeth" segments
  const teethCount = 8;
  let tx = -0.22;
  let ty = -0.05;
  
  // Curve up and forward
  for (let i = 0; i < teethCount; i++) {
    const progress = i / teethCount;
    // Curve the spine forward as we go up
    const nextTx = -0.2 + Math.sin(progress * 1.2) * 0.15; 
    const nextTy = ty + 0.12;
    
    // Tooth outward (back/up)
    shape.lineTo(tx - 0.08, ty + 0.04);
    // Tooth inward (next base)
    shape.lineTo(nextTx, nextTy);
    
    tx = nextTx;
    ty = nextTy;
  }
  
  // Top of head / Crest
  shape.lineTo(0.1, 0.95); 
  
  // Forehead slope down
  shape.lineTo(0.25, 0.85);
  
  // Eye/Brow ridge area
  shape.lineTo(0.3, 0.82);
  shape.lineTo(0.35, 0.7);
  
  // Snout bridge
  shape.lineTo(0.48, 0.55);
  
  // Snout nose tip (flat vertical)
  shape.lineTo(0.45, 0.45);
  
  // Mouth/Jaw undercut
  shape.lineTo(0.35, 0.4);
  
  // Cheek/Jaw curve
  shape.lineTo(0.25, 0.35);
  
  // Neck front curve
  shape.bezierCurveTo(0.28, 0.25, 0.32, 0.1, 0.2, -0.1);
  
  // Close at base
  shape.lineTo(-0.2, -0.1);

  // 3 Vents (Diagonal Slots) - modeled as holes
  const createVent = (x: number, y: number) => {
    const hole = new THREE.Path();
    const w = 0.12;
    const h = 0.03;
    const slant = 0.08;
    
    // Draw a slanted rectangle
    hole.moveTo(x, y);
    hole.lineTo(x + w, y + slant);
    hole.lineTo(x + w, y + slant + h);
    hole.lineTo(x, y + h);
    hole.lineTo(x, y);
    shape.holes.push(hole);
  };
  
  // Position vents along the neck
  createVent(-0.05, 0.15);
  createVent(0.0, 0.30);
  createVent(0.05, 0.45);

  const extrudeSettings = {
    steps: 1,
    depth: 0.18, // Thickness
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.01,
    bevelSegments: 3,
  };

  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.center();
  GEOMETRY_CACHE["knight-head"] = geometry;
  return geometry;
};

// Base geometry for Knight (since it uses extrude head on lathe base)
const getKnightBaseGeometry = () =>
  getLatheGeometry(BASE_PROFILE);

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
    id: "google-gemini-3-pro",
    label: "Google · Gemini 3 Pro",
    model: "gemini-3-pro-preview",
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
  const piecesRef = useRef<Record<string, THREE.Object3D>>({});
  const angleRef = useRef(persistedCameraAngle);
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
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const isDrawerOpen = isControlsOpen || isLogOpen;

  const closeDrawers = useCallback(() => {
    setIsControlsOpen(false);
    setIsLogOpen(false);
  }, []);

  const openControlsPanel = useCallback(() => {
    setIsControlsOpen(true);
    setIsLogOpen(false);
  }, []);

  const openLogPanel = useCallback(() => {
    setIsLogOpen(true);
    setIsControlsOpen(false);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = isDrawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawers();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeDrawers, isDrawerOpen]);

  const handleKeyToggle = (
    event: { key: string; preventDefault: () => void },
    action: () => void
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };

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
    const material = new THREE.MeshStandardMaterial({
      color: color === "white" ? 0xffffff : 0x222222,
      roughness: 0.5,
      metalness: 0.4,
    });

    let mesh: THREE.Object3D;

    if (type === "knight") {
      const group = new THREE.Group();

      const baseGeo = getKnightBaseGeometry();
      const base = new THREE.Mesh(baseGeo, material);
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);

      const headGeo = getKnightHeadGeometry();
      const head = new THREE.Mesh(headGeo, material);
      // Center of extruded geometry is at (0,0,0).
      // Approximate height of head is 0.9. Base is 0.15 height.
      // Shift head up.
      head.position.y = 0.55;
      
      // Rotate to face forward
      // Extrude is in XY plane. Thickness along Z.
      // White (row 7, +Z) faces -Z (toward 0). 
      // Black (row 0, -Z) faces +Z (toward 7).
      // If shape faces +X (right) in XY plane:
      // Rotate Y +90 deg -> Faces -Z?
      //   X becomes -Z.
      //   Y stays Y.
      //   Z becomes X.
      // So if shape points +X, rotating +90 Y makes it point -Z (White's direction).
      // Rotating -90 Y makes it point +Z (Black's direction).
      head.rotation.y = color === "white" ? Math.PI / 2 : -Math.PI / 2;
      
      head.castShadow = true;
      head.receiveShadow = true;
      group.add(head);

      mesh = group;
    } else if (type === "rook") {
      const group = new THREE.Group();
      const bodyGeo = getRookGeometry();
      const body = new THREE.Mesh(bodyGeo, material);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      // Add crenellations using cylinder segments
      const crenellationCount = 6;
      const outerRadius = 0.28;
      const innerRadius = 0.20;
      const height = 0.12;
      const startY = 0.90;
      
      // Arc length for each merlon (tooth)
      // Total circle is 2*PI. We have 6 teeth and 6 gaps.
      // Let's say teeth covers 60% of space.
      const totalAngle = Math.PI * 2;
      const segmentAngle = totalAngle / crenellationCount;
      const toothAngle = segmentAngle * 0.6;
      
      const crenGeo = new THREE.CylinderGeometry(outerRadius, outerRadius, height, 16, 1, true, 0, toothAngle);
      
      // We need a thick wall, not just a thin shell. 
      // CylinderGeometry is a shell if openEnded is false, but it has top/bottom caps.
      // It doesn't have thickness.
      // We can construct a shape and extrude it, or simpler: 
      // Use RingGeometry extruded? No.
      // Use a custom shape for the "C" profile (pie slice) and extrude it up.
      
      const shape = new THREE.Shape();
      shape.absarc(0, 0, outerRadius, 0, toothAngle, false);
      shape.lineTo(Math.cos(toothAngle) * innerRadius, Math.sin(toothAngle) * innerRadius);
      shape.absarc(0, 0, innerRadius, toothAngle, 0, true);
      shape.lineTo(outerRadius, 0);
      
      const extrudeSettings = {
        depth: height,
        bevelEnabled: false,
        curveSegments: 4
      };
      
      const toothGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      // Extrude goes along Z axis by default. We want Y.
      // Rotate X -90 deg.
      toothGeometry.rotateX(-Math.PI / 2);
      // Correct position: Extrude starts at Z=0 and goes to Z=depth.
      // After rotation X -90: starts Y=0 goes Y=depth.
      
      for (let i = 0; i < crenellationCount; i++) {
        const angle = i * segmentAngle;
        const tooth = new THREE.Mesh(toothGeometry, material);
        
        // We need to rotate each tooth around the center Y axis
        tooth.rotation.y = angle;
        tooth.position.y = startY;
        
        tooth.castShadow = true;
        tooth.receiveShadow = true;
        group.add(tooth);
      }
      mesh = group;
    } else if (type === "queen") {
      const group = new THREE.Group();
      const bodyGeo = getQueenGeometry();
      const body = new THREE.Mesh(bodyGeo, material);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      // Add crown points (coronet)
      const pointCount = 8;
      const radius = 0.26; // Matched to new rim radius
      const height = 0.98; // Top of rim
      
      for (let i = 0; i < pointCount; i++) {
        const angle = (i / pointCount) * Math.PI * 2;
        // Use smaller, sharper cones for points
        const coneGeo = new THREE.ConeGeometry(0.05, 0.15, 8); 
        const spike = new THREE.Mesh(coneGeo, material);
        spike.position.set(
          Math.cos(angle) * radius,
          height + 0.05, // Sit on top of rim
          Math.sin(angle) * radius
        );
        // Tilt outward to match flare
        // Calculate vector from center to position
        const spikePos = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const axis = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
        spike.rotateOnAxis(axis, 0.2); // Tilt out
        
        spike.castShadow = true;
        spike.receiveShadow = true;
        group.add(spike);
      }

      // Central Dome and Finial
      const domeGeo = new THREE.SphereGeometry(0.14, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2); // Hemisphere
      const dome = new THREE.Mesh(domeGeo, material);
      dome.position.y = 0.95; // Sit on center floor
      dome.castShadow = true;
      dome.receiveShadow = true;
      group.add(dome);

      const finialGeo = new THREE.SphereGeometry(0.06, 12, 12);
      const finial = new THREE.Mesh(finialGeo, material);
      finial.position.y = 0.95 + 0.14 + 0.04; // On top of dome
      finial.castShadow = true;
      finial.receiveShadow = true;
      group.add(finial);

      mesh = group;
    } else if (type === "king") {
      const group = new THREE.Group();
      
      const bodyGeo = getKingGeometry();
      const body = new THREE.Mesh(bodyGeo, material);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      // Cross Finial
      const crossGroup = new THREE.Group();
      crossGroup.position.y = 1.12; // Sits on top of the lathe geometry

      // Small connector orb
      const connectorGeo = new THREE.SphereGeometry(0.06, 8, 8);
      const connector = new THREE.Mesh(connectorGeo, material);
      connector.position.y = 0.04;
      connector.castShadow = true;
      crossGroup.add(connector);

      // Cross vertical
      const crossVGeo = new THREE.BoxGeometry(0.06, 0.22, 0.06);
      const crossV = new THREE.Mesh(crossVGeo, material);
      crossV.position.y = 0.15;
      crossV.castShadow = true;
      crossGroup.add(crossV);
      
      // Cross horizontal
      const crossHGeo = new THREE.BoxGeometry(0.16, 0.06, 0.06);
      const crossH = new THREE.Mesh(crossHGeo, material);
      crossH.position.y = 0.15;
      crossH.castShadow = true;
      crossGroup.add(crossH);

      group.add(crossGroup);

      mesh = group;
    } else if (type === "bishop") {
      const group = new THREE.Group();
      const bodyGeo = getBishopGeometry();
      const body = new THREE.Mesh(bodyGeo, material);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      // Diagonal cut (Cleft)
      // Use a smaller box that stays within the head volume mostly
      const cleftGeo = new THREE.BoxGeometry(0.04, 0.25, 0.25);
      const cleftMat = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a, 
        roughness: 0.9,
        metalness: 0.1
      });
      const cleft = new THREE.Mesh(cleftGeo, cleftMat);
      
      // Position: Centered vertically on the head, shifted forward (+Z)
      // Rotated to cut diagonally
      cleft.position.set(0, 0.90, 0.12);
      cleft.rotation.x = -Math.PI / 4; // 45 degree angle
      
      cleft.castShadow = false;
      cleft.receiveShadow = true;
      group.add(cleft);
      mesh = group;
    } else {
      let geometry: THREE.BufferGeometry;
      switch (type) {
        case "pawn": geometry = getPawnGeometry(); break;
        default: geometry = getPawnGeometry(); break;
      }
      const m = new THREE.Mesh(geometry, material);
      m.castShadow = true;
      m.receiveShadow = true;
      mesh = m;
    }

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
            0, // Sit directly on board
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
          0, // Sit directly on board
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
      persistedCameraAngle = angleRef.current;
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

  const ControlPanelContent = () => (
    <>
      <h1 className="text-2xl font-semibold">♟️ LLM Chess Arena ♟️</h1>
      <p className="mt-2 text-teal-300">{status}</p>
      {error && (
        <div className="mt-2 rounded-md border border-red-500/50 bg-red-500/20 p-2 text-xs text-red-300">
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
              disabled={
                isPlaying ||
                !whiteConfig.apiKey.trim() ||
                !blackConfig.apiKey.trim() ||
                !whiteConfig.model.trim() ||
                !blackConfig.model.trim()
              }
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
            onChange={(event) => handlePresetChange("white", event.target.value)}
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
            onChange={(event) => handleConfigChange("white", "apiKey", event.target.value)}
            className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Model ID"
            value={whiteConfig.model}
            onChange={(event) => handleConfigChange("white", "model", event.target.value)}
            disabled={!whiteIsCustom}
            className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <input
            type="text"
            placeholder="Base URL"
            value={whiteConfig.baseUrl}
            onChange={(event) => handleConfigChange("white", "baseUrl", event.target.value)}
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
            onChange={(event) => handlePresetChange("black", event.target.value)}
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
            onChange={(event) => handleConfigChange("black", "apiKey", event.target.value)}
            className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Model ID"
            value={blackConfig.model}
            onChange={(event) => handleConfigChange("black", "model", event.target.value)}
            disabled={!blackIsCustom}
            className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <input
            type="text"
            placeholder="Base URL"
            value={blackConfig.baseUrl}
            onChange={(event) => handleConfigChange("black", "baseUrl", event.target.value)}
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

      <p className="mt-4 text-[11px] text-white/40">
        Provide API keys for two different LLMs (or the same model twice) to let
        them duel automatically. Keys are stored only in your browser and sent
        directly to the move-selection API route for each turn.
      </p>
    </>
  );

  const BattleLogContent = () => (
    <>
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
                <div
                  key={`white-captured-${piece.type}-${index}`}
                  className="flex items-center gap-1 rounded bg-white/10 px-2 py-1"
                >
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
                <div
                  key={`black-captured-${piece.type}-${index}`}
                  className="flex items-center gap-1 rounded bg-white/10 px-2 py-1"
                >
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
    </>
  );

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        color: "#ffffff",
      }}
    >
      <div ref={containerRef} className="h-full w-full" />

      <style>
        {`
          .no-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
        `}
      </style>

      <div className="pointer-events-none absolute top-4 left-1/2 z-20 w-[90vw] max-w-sm -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-center text-xs text-white md:hidden">
        {status}
      </div>

      {isDrawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={closeDrawers}
          role="button"
          tabIndex={0}
          aria-label="Close panels"
          onKeyDown={(event) => handleKeyToggle(event, closeDrawers)}
        />
      )}

      <div
        className={`md:hidden fixed inset-x-0 bottom-0 z-50 transform transition-transform duration-300 ${
          isControlsOpen ? "translate-y-0" : "translate-y-full"
        }`}
        aria-hidden={!isControlsOpen}
      >
        <div className="rounded-t-3xl border border-white/10 bg-black/80 p-5 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white/80">LLM Controls</p>
            <button
              onClick={closeDrawers}
              className="rounded-full bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
            >
              Close
            </button>
          </div>
          <div className="mt-4 max-h-[70vh] overflow-y-auto pr-2 no-scrollbar">
            <ControlPanelContent />
          </div>
        </div>
      </div>

      <div
        className={`md:hidden fixed inset-x-0 bottom-0 z-50 transform transition-transform duration-300 ${
          isLogOpen ? "translate-y-0" : "translate-y-full"
        }`}
        aria-hidden={!isLogOpen}
      >
        <div className="rounded-t-3xl border border-white/10 bg-black/80 p-5 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white/80">Battle Log</p>
            <button
              onClick={closeDrawers}
              className="rounded-full bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
            >
              Close
            </button>
          </div>
          <div className="mt-4 max-h-[70vh] overflow-y-auto pr-2 no-scrollbar">
            <BattleLogContent />
          </div>
        </div>
      </div>

      <div className="md:hidden fixed inset-x-0 bottom-5 z-30 flex items-center justify-between px-6">
        <button
          onClick={openControlsPanel}
          className="flex items-center gap-2 rounded-full bg-white/15 px-5 py-3 text-sm font-semibold text-white shadow-xl backdrop-blur"
          aria-label="Open controls"
          tabIndex={0}
          onKeyDown={(event) => handleKeyToggle(event, openControlsPanel)}
        >
          ⚙️ Controls
        </button>
        <button
          onClick={openLogPanel}
          className="flex items-center gap-2 rounded-full bg-teal-400/90 px-5 py-3 text-sm font-semibold text-slate-900 shadow-xl backdrop-blur"
          aria-label="Open battle log"
          tabIndex={0}
          onKeyDown={(event) => handleKeyToggle(event, openLogPanel)}
        >
          📜 Log
        </button>
      </div>

      <div
        className="pointer-events-auto absolute left-6 top-6 hidden max-h-[calc(100vh-3rem)] w-[min(24rem,90vw)] flex-col overflow-hidden rounded-xl border border-white/10 bg-black/60 text-sm shadow-2xl backdrop-blur-lg md:flex"
      >
        <div className="flex-1 overflow-y-auto p-6 pr-3 no-scrollbar">
          <ControlPanelContent />
        </div>
      </div>

      <div
        className="pointer-events-auto absolute right-6 top-6 hidden max-h-[calc(100vh-3rem)] w-[min(24rem,90vw)] flex-col overflow-hidden rounded-xl border border-white/10 bg-black/60 text-sm shadow-2xl backdrop-blur-lg md:flex"
      >
        <div className="flex-1 overflow-y-auto p-6 pl-3">
          <BattleLogContent />
        </div>
      </div>
    </div>
  );
}
