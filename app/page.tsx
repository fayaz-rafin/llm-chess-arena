"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

let persistedCameraAngle = 0;

// --- Scene Animation ---
type SceneTween = {
  object: THREE.Object3D;
  delay: number;
  duration: number;
  elapsed: number;
  /** Receives raw progress 0..1; easing is applied inside the closure. */
  update: (progress: number) => void;
  onComplete?: () => void;
};

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

const setPieceOpacity = (object: THREE.Object3D, opacity: number) => {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((material) => {
        material.transparent = true;
        material.opacity = opacity;
      });
    }
  });
};

// --- Geometry Generators ---
const GEOMETRY_CACHE: Record<string, THREE.BufferGeometry> = {};

// Subdivide the lathe profile with Catmull-Rom so long curves render silky
// smooth, while short segments (rings, collars, rims) keep their crisp edges.
const smoothProfile = (points: [number, number][]) => {
  const result: [number, number][] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const [r0, y0] = points[i];
    const [r1, y1] = points[i + 1];
    result.push([r0, y0]);

    const segmentLength = Math.hypot(r1 - r0, y1 - y0);
    if (segmentLength < 0.09) continue;

    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 2)];
    const curve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(prev[0], prev[1], 0),
        new THREE.Vector3(r0, y0, 0),
        new THREE.Vector3(r1, y1, 0),
        new THREE.Vector3(next[0], next[1], 0),
      ],
      false,
      "catmullrom",
      0.2
    );

    // Never let smoothing invent vertical gaps between profile points —
    // that is what made heads/battlements look like they were floating.
    const yMin = Math.min(y0, y1);
    const yMax = Math.max(y0, y1);
    const subdivisions = Math.min(6, Math.ceil(segmentLength / 0.05));
    for (let step = 1; step < subdivisions; step += 1) {
      const t = 1 / 3 + (step / subdivisions) * (1 / 3);
      const sample = curve.getPoint(t);
      result.push([
        Math.max(0, sample.x),
        THREE.MathUtils.clamp(sample.y, yMin, yMax),
      ]);
    }
  }

  result.push(points[points.length - 1]);
  return result;
};

const getLatheGeometry = (points: [number, number][]) => {
  const key = `v2:${JSON.stringify(points)}`;
  if (GEOMETRY_CACHE[key]) return GEOMETRY_CACHE[key];

  const vectorPoints = smoothProfile(points).map(
    ([r, y]) => new THREE.Vector2(r, y)
  );
  const geometry = new THREE.LatheGeometry(vectorPoints, 96);
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
        [0.20, 0],
        [0.16, 0.28],
        [0.13, 0.42],
        [0.17, 0.46], // Collar
        [0.17, 0.50],
        [0.13, 0.52], // Continuous neck into ball — no thin gap
        [0.20, 0.62],
        [0.22, 0.70],
        [0.16, 0.78],
        [0, 0.82],
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
    // Tiered Staunton base
    [0.34, 0],
    [0.34, 0.045],
    [0.30, 0.075],
    [0.32, 0.11],
    [0.32, 0.155],
    [0.27, 0.19],

    // Concave stem — narrow waist, flares into collar
    [0.19, 0.28],
    [0.14, 0.46],
    [0.16, 0.58],

    // Double collar ring (small ring + wide disc)
    [0.20, 0.605],
    [0.24, 0.625],
    [0.24, 0.655],
    [0.19, 0.665],
    [0.235, 0.685],
    [0.235, 0.715],
    [0.175, 0.725],

    // Bulbous mitre head — elongated egg
    [0.175, 0.74],
    [0.22, 0.82],
    [0.245, 0.92],
    [0.22, 1.02],
    [0.14, 1.08],
    [0.06, 1.10],
    [0, 1.105],
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
  if (GEOMETRY_CACHE["knight-head-v7"]) return GEOMETRY_CACHE["knight-head-v7"];

  // One solid mesh: pedestal + neck + head. No separate floating parts.
  const parts: THREE.BufferGeometry[] = [];

  // Pedestal base (flared + double collar)
  const pedestal = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.34, 0),
      new THREE.Vector2(0.34, 0.05),
      new THREE.Vector2(0.30, 0.08),
      new THREE.Vector2(0.32, 0.12),
      new THREE.Vector2(0.32, 0.15),
      new THREE.Vector2(0.26, 0.19),
      new THREE.Vector2(0.22, 0.22),
      new THREE.Vector2(0.24, 0.245),
      new THREE.Vector2(0.24, 0.27),
      new THREE.Vector2(0.20, 0.285),
      new THREE.Vector2(0.23, 0.31),
      new THREE.Vector2(0.23, 0.335),
      new THREE.Vector2(0.18, 0.35),
    ],
    48
  );
  parts.push(pedestal);

  // Round neck — overlaps the pedestal collar so there is no seam gap
  const neck = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.17, 0.30),
      new THREE.Vector2(0.165, 0.38),
      new THREE.Vector2(0.15, 0.48),
      new THREE.Vector2(0.145, 0.56),
      new THREE.Vector2(0.155, 0.62),
    ],
    48
  );
  parts.push(neck);

  // Main skull
  const skull = new THREE.SphereGeometry(0.155, 40, 32);
  skull.scale(1.15, 1.05, 1.0);
  skull.translate(0.05, 0.70, 0);
  parts.push(skull);

  // Cheek / jaw
  const jaw = new THREE.SphereGeometry(0.1, 28, 22);
  jaw.scale(1.35, 0.75, 1.05);
  jaw.translate(0.12, 0.61, 0);
  parts.push(jaw);

  // Muzzle
  const muzzle = new THREE.CylinderGeometry(0.048, 0.085, 0.2, 28);
  muzzle.rotateZ(-Math.PI / 2);
  muzzle.translate(0.24, 0.65, 0);
  parts.push(muzzle);

  // Nose tip
  const nose = new THREE.SphereGeometry(0.055, 24, 20);
  nose.scale(1.15, 0.85, 0.9);
  nose.translate(0.35, 0.65, 0);
  parts.push(nose);

  // Chin
  const chin = new THREE.SphereGeometry(0.04, 16, 14);
  chin.scale(1.4, 0.7, 0.95);
  chin.translate(0.28, 0.59, 0);
  parts.push(chin);

  // Brow — subtle, not a horn ridge
  const brow = new THREE.SphereGeometry(0.055, 18, 14);
  brow.scale(1.2, 0.4, 1.1);
  brow.translate(0.1, 0.78, 0);
  parts.push(brow);

  // Short rounded ears seated into the skull (cones read as horns)
  ([-1, 1] as const).forEach((side) => {
    const ear = new THREE.SphereGeometry(0.038, 14, 12);
    ear.scale(0.55, 1.15, 0.45);
    ear.translate(0.02, 0.82, side * 0.07);
    ear.rotateZ(-0.55);
    ear.rotateX(side * 0.35);
    parts.push(ear);
  });

  // Mane ridge
  const maneCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.1, 0.34, 0),
    new THREE.Vector3(-0.15, 0.44, 0),
    new THREE.Vector3(-0.16, 0.55, 0),
    new THREE.Vector3(-0.13, 0.66, 0),
    new THREE.Vector3(-0.07, 0.76, 0),
    new THREE.Vector3(-0.02, 0.80, 0),
  ]);
  const maneTube = new THREE.TubeGeometry(maneCurve, 40, 0.055, 16, false);
  const manePos = maneTube.attributes.position;
  for (let i = 0; i < manePos.count; i += 1) {
    const y = manePos.getY(i);
    const ridge = 1 + Math.sin(y * 26) * 0.16;
    const x = manePos.getX(i);
    const z = manePos.getZ(i);
    manePos.setX(i, x - (ridge - 1) * 0.03);
    manePos.setZ(i, z * ridge);
  }
  maneTube.computeVertexNormals();
  parts.push(maneTube);

  // Soft mane scallops — keep them flush so they don't spike like horns
  for (let i = 0; i < 7; i += 1) {
    const t = i / 6;
    const point = maneCurve.getPoint(t);
    const tooth = new THREE.SphereGeometry(0.038 - t * 0.008, 12, 10);
    tooth.scale(0.5, 0.35, 1.1);
    tooth.translate(point.x - 0.01, point.y, 0);
    parts.push(tooth);
  }

  ([-1, 1] as const).forEach((side) => {
    const socket = new THREE.SphereGeometry(0.028, 14, 12);
    socket.scale(0.9, 0.75, 0.55);
    socket.translate(0.14, 0.73, side * 0.12);
    parts.push(socket);
  });

  const merged = mergeGeometries(parts, false);
  parts.forEach((geo) => geo.dispose());

  if (!merged) {
    return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }

  const positions = merged.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);

    ([-1, 1] as const).forEach((side) => {
      const dx = x - 0.14;
      const dy = y - 0.73;
      const dz = z - side * 0.11;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 0.012) {
        const push = (0.012 - d2) * 2.2;
        positions.setZ(i, z - side * push);
      }
    });

    if (x > 0.22 && x < 0.34 && y > 0.57 && y < 0.63) {
      positions.setY(i, y - 0.012 * Math.sin(((x - 0.22) / 0.12) * Math.PI));
    }
  }

  merged.computeVertexNormals();
  merged.computeBoundingBox();
  const bbox = merged.boundingBox!;
  merged.translate(0, -bbox.min.y, -(bbox.min.z + bbox.max.z) / 2);

  GEOMETRY_CACHE["knight-head-v7"] = merged;
  return merged;
};

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
  attemptsUsed?: number;
  fallback?: boolean;
  rateLimited?: boolean;
  note?: string;
};

type MoveSummary = {
  color: PieceColor;
  piece: Piece;
  from: [number, number];
  to: [number, number];
  captured: Piece | null;
  notation: string;
};

type ReplayMeta = {
  clientMatchId: string;
  startedAt: string;
  whiteModel: string;
  blackModel: string;
};

type ReplayEvent =
  | {
      t: "match_start";
      at: string;
      clientMatchId: string;
      whiteModel: string;
      blackModel: string;
    }
  | {
      t: "turn_request";
      at: string;
      ply: number;
      turn: PieceColor;
      model: string;
      legalMovesCount: number;
      boardAscii: string;
    }
  | {
      t: "llm_decision";
      at: string;
      ply: number;
      move: Move;
      attemptsUsed?: number;
      fallback?: boolean;
      rateLimited?: boolean;
      note?: string;
    }
  | {
      t: "move";
      at: string;
      ply: number;
      color: PieceColor;
      notation: string;
      from: [number, number];
      to: [number, number];
    }
  | {
      t: "capture";
      at: string;
      ply: number;
      color: PieceColor;
      piece: PieceType;
      value: number;
    }
  | {
      t: "game_over";
      at: string;
      winner: PieceColor;
      reason: string;
    };

type ReplayJson = {
  meta: ReplayMeta;
  endedAt: string;
  winner: PieceColor;
  turns: number;
  events: ReplayEvent[];
};

type ReplaySummary = {
  id: string;
  clientMatchId: string;
  startedAt: string;
  endedAt: string;
  winner: PieceColor;
  turns: number;
  whiteModel: string;
  blackModel: string;
};

type ReplayDetail = ReplaySummary & {
  replayText: string;
  replayJson: ReplayJson;
};

const PIECE_LABEL: Record<PieceType, string> = {
  pawn: "Pawn",
  rook: "Rook",
  knight: "Knight",
  bishop: "Bishop",
  queen: "Queen",
  king: "King",
};

const PIECE_VALUE: Record<PieceType, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

const boardToAscii = (board: BoardState) =>
  board
    .map((row) =>
      row
        .map((square) => {
          if (!square) return ".";
          const symbol = square.type.charAt(0).toLowerCase();
          return square.color === "white" ? symbol.toUpperCase() : symbol;
        })
        .join(" ")
    )
    .join("\n");

const formatReplayText = (
  events: ReplayEvent[],
  meta: ReplayMeta,
  endedAt: string,
  winner: PieceColor,
  turns: number
) => {
  const lines: string[] = [];
  lines.push("LLM Chess Arena Replay");
  lines.push(`Start: ${meta.startedAt}`);
  lines.push(`End: ${endedAt}`);
  lines.push(`White: ${meta.whiteModel}`);
  lines.push(`Black: ${meta.blackModel}`);
  lines.push(`Winner: ${winner}`);
  lines.push(`Total moves: ${turns}`);
  lines.push("");

  events.forEach((event) => {
    switch (event.t) {
      case "match_start":
        lines.push(
          `Match start (${event.at}) | id=${event.clientMatchId} | White=${event.whiteModel} | Black=${event.blackModel}`
        );
        break;
      case "turn_request":
        lines.push(
          `Ply ${event.ply}: ${event.turn} to move | model=${event.model} | legalMoves=${event.legalMovesCount}`
        );
        lines.push(event.boardAscii);
        break;
      case "llm_decision": {
        const fromSquare = getSquareName(event.move.from[0], event.move.from[1]);
        const toSquare = getSquareName(event.move.to[0], event.move.to[1]);
        const flags = [
          event.fallback ? "fallback" : null,
          event.rateLimited ? "rate_limited" : null,
        ]
          .filter(Boolean)
          .join(", ");
        lines.push(
          `Decision (ply ${event.ply}): ${fromSquare} -> ${toSquare}` +
            (event.attemptsUsed ? ` | attempts=${event.attemptsUsed}` : "") +
            (flags ? ` | ${flags}` : "") +
            (event.note ? ` | note=${event.note}` : "")
        );
        break;
      }
      case "move": {
        const fromSquare = getSquareName(event.from[0], event.from[1]);
        const toSquare = getSquareName(event.to[0], event.to[1]);
        lines.push(
          `Move (ply ${event.ply}): ${event.color} ${event.notation} (${fromSquare} -> ${toSquare})`
        );
        break;
      }
      case "capture":
        lines.push(
          `Capture (ply ${event.ply}): ${event.color} captured ${PIECE_LABEL[event.piece]} (value ${event.value})`
        );
        break;
      case "game_over":
        lines.push(`Game Over: ${event.winner} wins (${event.reason})`);
        break;
      default:
        break;
    }
  });

  return lines.join("\n");
};

const readJson = async <T,>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.trim().slice(0, 120);
    throw new Error(
      `Unexpected response (${response.status}): ${preview || "non-JSON"}`
    );
  }
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
            if (
              target &&
              target.color !== piece.color &&
              target.type !== "king"
            ) {
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
            if (!target) {
              moves.push([newRow, newCol]);
              return;
            }

            if (
              target.color !== piece.color &&
              target.type !== "king"
            ) {
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
            if (!target) {
              moves.push([newRow, newCol]);
              return;
            }

            if (
              target.color !== piece.color &&
              target.type !== "king"
            ) {
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
            if (target.type !== "king") {
              moves.push([newRow, newCol]);
            }
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

    // In chess, you cannot capture the king. Treat any such move as a terminal
    // state (checkmate-like) without removing the king from the board.
    if (capturedCopy?.type === "king") {
      const squareName = getSquareName(toRow, toCol);
      const colorLabel = piece.color === "white" ? "White" : "Black";
      const notation = `${PIECE_LABEL[piece.type]} ${squareName} #`;

      this.moves.push(`${colorLabel} ${notation}`);
      this.gameOver = true;
      this.winner = piece.color;

      return {
        color: piece.color,
        piece: movingPiece,
        from: [fromRow, fromCol],
        to: [toRow, toCol],
        captured: null,
        notation,
      };
    }

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

type ModelPreset = {
  id: string;
  label: string;
  model: string;
};

const comparePresetsAlphabetically = (a: ModelPreset, b: ModelPreset): number => {
  if (a.id === CUSTOM_PRESET_ID) return 1;
  if (b.id === CUSTOM_PRESET_ID) return -1;
  const byLabel = a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  if (byLabel !== 0) return byLabel;
  return a.model.toLowerCase().localeCompare(b.model.toLowerCase());
};

const sortPresetsAlphabetically = (presets: ModelPreset[]): ModelPreset[] =>
  [...presets].sort(comparePresetsAlphabetically);

const OPENROUTER_CREDITS_URL = "https://openrouter.ai/settings/credits";

const isOpenRouterCreditsError = (message: string) =>
  /insufficient credits|never purchased credits|purchase more credits/i.test(message);

const presetMatchesModelSearch = (preset: ModelPreset, rawQuery: string): boolean => {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${preset.label} ${preset.model}`.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => haystack.includes(token));
};

type ModelSideControlsProps = {
  title: string;
  searchAriaLabel: string;
  selectAriaLabel: string;
  allPresets: ModelPreset[];
  selectedPresetId: string;
  onSelectPresetId: (presetId: string) => void;
  modelValue: string;
  onModelValueChange: (value: string) => void;
  isCustom: boolean;
  disabled: boolean;
};

const ModelSideControls = memo(function ModelSideControls({
  title,
  searchAriaLabel,
  selectAriaLabel,
  allPresets,
  selectedPresetId,
  onSelectPresetId,
  modelValue,
  onModelValueChange,
  isCustom,
  disabled,
}: ModelSideControlsProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPresets = useMemo(() => {
    const alwaysShowIds = new Set<string>([CUSTOM_PRESET_ID, selectedPresetId]);
    const matched = allPresets.filter(
      (preset) =>
        presetMatchesModelSearch(preset, searchQuery) || alwaysShowIds.has(preset.id)
    );
    return sortPresetsAlphabetically(matched);
  }, [allPresets, searchQuery, selectedPresetId]);

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  }, []);

  const handleSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onSelectPresetId(event.target.value);
    },
    [onSelectPresetId]
  );

  const handleModelInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onModelValueChange(event.target.value);
    },
    [onModelValueChange]
  );

  const isWhiteSide = title.toLowerCase().includes("white");

  return (
    <div className="rounded-2xl border border-[var(--hairline)] bg-[rgba(243,237,226,0.03)] p-4">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`inline-block h-3 w-3 rounded-full border ${
            isWhiteSide
              ? "border-[rgba(243,237,226,0.4)] bg-[var(--ivory)]"
              : "border-[rgba(243,237,226,0.35)] bg-[#1d1712]"
          }`}
        />
        <p className="text-sm font-semibold text-[var(--ivory)]">{title}</p>
      </div>
      <div className="mt-3 space-y-2.5">
        <input
          type="search"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search models…"
          autoComplete="off"
          disabled={disabled}
          aria-label={searchAriaLabel}
          className="field"
        />
        <select
          value={selectedPresetId}
          onChange={handleSelectChange}
          className="field"
          aria-label={selectAriaLabel}
        >
          {filteredPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        {isCustom && (
          <input
            type="text"
            placeholder="Model id (e.g. openai/gpt-4o)"
            value={modelValue}
            onChange={handleModelInputChange}
            aria-label={`Custom model id for ${title}`}
            className="field font-mono text-xs"
          />
        )}
        {!isCustom && modelValue && (
          <p className="truncate px-1 font-mono text-[11px] text-[var(--ivory-faint)]">
            {modelValue}
          </p>
        )}
      </div>
    </div>
  );
});

const MODEL_PRESETS: ReadonlyArray<ModelPreset> = [
  {
    id: "openrouter-openai-gpt-4o",
    label: "OpenRouter · OpenAI / GPT-4o",
    model: "openai/gpt-4o",
  },
  {
    id: "openrouter-openai-gpt-5",
    label: "OpenRouter · OpenAI / GPT-5",
    model: "openai/gpt-5",
  },
  {
    id: "openrouter-anthropic-claude-sonnet-4.5",
    label: "OpenRouter · Anthropic / Claude Sonnet 4.5",
    model: "anthropic/claude-sonnet-4.5",
  },
  {
    id: "openrouter-google-gemini-2.5-flash",
    label: "OpenRouter · Google / Gemini 2.5 Flash",
    model: "google/gemini-2.5-flash",
  },
  {
    id: "openrouter-google-gemini-2.5-pro",
    label: "OpenRouter · Google / Gemini 2.5 Pro",
    model: "google/gemini-2.5-pro",
  },
  {
    id: CUSTOM_PRESET_ID,
    label: "Custom model id…",
    model: "",
  },
];

const DEFAULT_PRESET = MODEL_PRESETS[0]!;

type LlmConfig = {
  model: string;
};

export default function Home() {
  const router = useRouter();
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
  const replayEventsRef = useRef<ReplayEvent[]>([]);
  const replayMetaRef = useRef<ReplayMeta | null>(null);
  const replayTurnRef = useRef(0);
  const replaySavedRef = useRef(false);
  const replayIndexRef = useRef(0);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayMovesRef = useRef<Move[]>([]);
  const isReplayModeRef = useRef(false);
  const isReplayPlayingRef = useRef(false);
  const tweensRef = useRef<SceneTween[]>([]);
  const reducedMotionRef = useRef(false);

  const [status, setStatus] = useState("Initializing arena...");
  const [isPlaying, setIsPlaying] = useState(false);
  const [moveLog, setMoveLog] = useState<string[]>([]);
  const [moveHistory, setMoveHistory] = useState<MoveSummary[]>([]);
  const [capturedByWhite, setCapturedByWhite] = useState<Piece[]>([]);
  const [capturedByBlack, setCapturedByBlack] = useState<Piece[]>([]);
  const [whitePresetId, setWhitePresetId] = useState(DEFAULT_PRESET.id);
  const [blackPresetId, setBlackPresetId] = useState(DEFAULT_PRESET.id);
  const [whiteConfig, setWhiteConfig] = useState<LlmConfig>({
    model: DEFAULT_PRESET.model,
  });
  const [blackConfig, setBlackConfig] = useState<LlmConfig>({
    model: DEFAULT_PRESET.model,
  });
  const [moveDelay, setMoveDelay] = useState(MOVE_DELAY_MS);
  const [moveDelayInput, setMoveDelayInput] = useState(String(MOVE_DELAY_MS));
  const [dynamicPresets, setDynamicPresets] = useState<ModelPreset[]>([]);
  const [isLoadingOpenRouterModels, setIsLoadingOpenRouterModels] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const isDrawerOpen = isControlsOpen || isLogOpen;
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replayMoves, setReplayMoves] = useState<Move[]>([]);
  const [replayDetail, setReplayDetail] = useState<ReplayDetail | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [activeReplayId, setActiveReplayId] = useState<string | null>(null);

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

  const nowIso = useCallback(() => new Date().toISOString(), []);

  const appendReplayEvent = useCallback((event: ReplayEvent) => {
    replayEventsRef.current.push(event);
  }, []);

  const resetReplayLog = useCallback((clearMeta: boolean) => {
    replayEventsRef.current = [];
    replayTurnRef.current = 0;
    replaySavedRef.current = false;
    if (clearMeta) {
      replayMetaRef.current = null;
    }
  }, []);

  const startReplayLog = useCallback(() => {
    const whiteModel = whiteConfig.model.trim();
    const blackModel = blackConfig.model.trim();
    const clientMatchId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = nowIso();

    resetReplayLog(true);
    const meta: ReplayMeta = {
      clientMatchId,
      startedAt,
      whiteModel,
      blackModel,
    };
    replayMetaRef.current = meta;
    appendReplayEvent({
      t: "match_start",
      at: startedAt,
      clientMatchId,
      whiteModel,
      blackModel,
    });
  }, [
    appendReplayEvent,
    blackConfig.model,
    nowIso,
    resetReplayLog,
    whiteConfig.model,
  ]);

  const saveReplay = useCallback(
    async (game: ChessGame, reason: string) => {
      if (replaySavedRef.current) return;
      const meta = replayMetaRef.current;
      if (!meta || !game.winner) return;

      const endedAt = nowIso();
      appendReplayEvent({
        t: "game_over",
        at: endedAt,
        winner: game.winner,
        reason,
      });

      const payload = {
        meta,
        endedAt,
        winner: game.winner,
        turns: game.moves.length,
        events: replayEventsRef.current,
        replayText: formatReplayText(
          replayEventsRef.current,
          meta,
          endedAt,
          game.winner,
          game.moves.length
        ),
      };

      replaySavedRef.current = true;

      try {
        const response = await fetch("/api/replays", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          console.warn("Replay save failed", data?.error || response.status);
          replaySavedRef.current = false;
        }
      } catch (error) {
        console.warn("Replay save error", error);
        replaySavedRef.current = false;
      }
    },
    [appendReplayEvent, nowIso]
  );

  const stopReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    replayMovesRef.current = replayMoves;
  }, [replayMoves]);

  

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = isDrawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    setMoveDelayInput(String(moveDelay));
  }, [moveDelay]);

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

    return sortPresetsAlphabetically(merged);
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

  // Immediately settle any in-flight tweens for an object (used when a new
  // animation must take over, or the piece is being removed).
  const finishTweensFor = useCallback((object: THREE.Object3D) => {
    tweensRef.current = tweensRef.current.filter((tween) => {
      if (tween.object !== object) return true;
      tween.update(1);
      tween.onComplete?.();
      return false;
    });
  }, []);

  const clearPieces = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Flush pending tweens so dying capture animations don't try to touch
    // pieces after a reset.
    tweensRef.current.forEach((tween) => {
      tween.update(1);
      tween.onComplete?.();
    });
    tweensRef.current = [];

    Object.values(piecesRef.current).forEach((mesh) => {
      scene.remove(mesh);
    });

    piecesRef.current = {};
  }, []);

  const createPieceMesh = useCallback((type: PieceType, color: PieceColor) => {
    // Lacquered boxwood / ebony: clearcoat gives the polished tournament sheen
    const material =
      color === "white"
        ? new THREE.MeshPhysicalMaterial({
            color: 0xe9dfc8,
            roughness: 0.32,
            metalness: 0.0,
            clearcoat: 0.55,
            clearcoatRoughness: 0.28,
            sheen: 0.25,
            sheenColor: new THREE.Color(0xfff4dd),
            envMapIntensity: 1.15,
          })
        : new THREE.MeshPhysicalMaterial({
            color: 0x181109,
            roughness: 0.24,
            metalness: 0.0,
            clearcoat: 0.85,
            clearcoatRoughness: 0.18,
            envMapIntensity: 1.6,
          });

    let mesh: THREE.Object3D;

    if (type === "knight") {
      const headGeo = getKnightHeadGeometry();
      const head = new THREE.Mesh(headGeo, material);
      head.rotation.y = color === "white" ? Math.PI / 2 : -Math.PI / 2;
      head.castShadow = true;
      head.receiveShadow = true;
      mesh = head;
    } else if (type === "rook") {
      const group = new THREE.Group();
      const bodyGeo = getRookGeometry();
      bodyGeo.computeBoundingBox();
      const bodyTop = bodyGeo.boundingBox?.max.y ?? 0.9;
      const body = new THREE.Mesh(bodyGeo, material);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      // Battlements embedded into the turret rim (overlap kills the float gap)
      const crenellationCount = 6;
      const outerRadius = 0.28;
      const innerRadius = 0.20;
      const height = 0.14;
      const startY = bodyTop - 0.04;
      const totalAngle = Math.PI * 2;
      const segmentAngle = totalAngle / crenellationCount;
      const toothAngle = segmentAngle * 0.6;

      const shape = new THREE.Shape();
      shape.absarc(0, 0, outerRadius, 0, toothAngle, false);
      shape.lineTo(Math.cos(toothAngle) * innerRadius, Math.sin(toothAngle) * innerRadius);
      shape.absarc(0, 0, innerRadius, toothAngle, 0, true);
      shape.lineTo(outerRadius, 0);

      const toothGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
        curveSegments: 6,
      });
      toothGeometry.rotateX(-Math.PI / 2);

      for (let i = 0; i < crenellationCount; i++) {
        const tooth = new THREE.Mesh(toothGeometry, material);
        tooth.rotation.y = i * segmentAngle;
        tooth.position.y = startY;
        tooth.castShadow = true;
        tooth.receiveShadow = true;
        group.add(tooth);
      }
      mesh = group;
    } else if (type === "queen") {
      const group = new THREE.Group();
      const bodyGeo = getQueenGeometry();
      bodyGeo.computeBoundingBox();
      const rimY = bodyGeo.boundingBox?.max.y ?? 0.98;
      const body = new THREE.Mesh(bodyGeo, material);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const pointCount = 8;
      const radius = 0.26;
      // Cone is centered: base at -h/2, tip at +h/2. Embed the base into the rim.
      const spikeHeight = 0.16;
      for (let i = 0; i < pointCount; i++) {
        const angle = (i / pointCount) * Math.PI * 2;
        const coneGeo = new THREE.ConeGeometry(0.045, spikeHeight, 10);
        const spike = new THREE.Mesh(coneGeo, material);
        spike.position.set(
          Math.cos(angle) * radius,
          rimY + spikeHeight * 0.2,
          Math.sin(angle) * radius
        );
        const axis = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
        spike.rotateOnAxis(axis, 0.18);
        spike.castShadow = true;
        spike.receiveShadow = true;
        group.add(spike);
      }

      const domeGeo = new THREE.SphereGeometry(0.14, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const dome = new THREE.Mesh(domeGeo, material);
      dome.position.y = rimY - 0.04;
      dome.castShadow = true;
      dome.receiveShadow = true;
      group.add(dome);

      const finialGeo = new THREE.SphereGeometry(0.055, 14, 14);
      const finial = new THREE.Mesh(finialGeo, material);
      finial.position.y = rimY + 0.12;
      finial.castShadow = true;
      finial.receiveShadow = true;
      group.add(finial);

      mesh = group;
    } else if (type === "king") {
      const group = new THREE.Group();
      const bodyGeo = getKingGeometry();
      bodyGeo.computeBoundingBox();
      const topY = bodyGeo.boundingBox?.max.y ?? 1.12;
      const body = new THREE.Mesh(bodyGeo, material);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const crossGroup = new THREE.Group();
      // Embed the cross base into the crown so it doesn't float
      crossGroup.position.y = topY - 0.04;

      const connectorGeo = new THREE.SphereGeometry(0.055, 10, 10);
      const connector = new THREE.Mesh(connectorGeo, material);
      connector.position.y = 0.03;
      connector.castShadow = true;
      crossGroup.add(connector);

      const crossVGeo = new THREE.BoxGeometry(0.06, 0.22, 0.06);
      const crossV = new THREE.Mesh(crossVGeo, material);
      crossV.position.y = 0.14;
      crossV.castShadow = true;
      crossGroup.add(crossV);

      const crossHGeo = new THREE.BoxGeometry(0.16, 0.06, 0.06);
      const crossH = new THREE.Mesh(crossHGeo, material);
      crossH.position.y = 0.14;
      crossH.castShadow = true;
      crossGroup.add(crossH);

      group.add(crossGroup);
      mesh = group;
    } else if (type === "bishop") {
      const group = new THREE.Group();
      const bodyGeo = getBishopGeometry();
      bodyGeo.computeBoundingBox();
      const topY = bodyGeo.boundingBox?.max.y ?? 1.1;
      const body = new THREE.Mesh(bodyGeo, material);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      // Finial sits on the mitre tip with overlap
      const finialGeo = new THREE.SphereGeometry(0.05, 24, 24);
      const finial = new THREE.Mesh(finialGeo, material);
      finial.position.y = topY + 0.02;
      finial.castShadow = true;
      group.add(finial);

      // Mitre slit on the upper crown
      const slitMat = new THREE.MeshPhysicalMaterial({
        color: color === "white" ? 0x5a4a38 : 0x030201,
        roughness: 1,
        metalness: 0,
      });
      const slitGeo = new THREE.BoxGeometry(0.04, 0.16, 0.02);
      const slit = new THREE.Mesh(slitGeo, slitMat);
      slit.position.set(0, topY - 0.08, 0.1);
      slit.rotation.x = -0.85;
      slit.castShadow = false;
      slit.receiveShadow = true;
      group.add(slit);

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

    // Stretch toward Staunton proportions: taller silhouettes read as real
    // tournament pieces instead of squat game tokens.
    mesh.scale.set(1.06, 1.28, 1.06);

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

  const resetBoard = useCallback(() => {
    if (!sceneReadyRef.current) return;
    const game = new ChessGame();
    gameRef.current = game;
    initPieces(game);
    setMoveHistory([]);
    setCapturedByWhite([]);
    setCapturedByBlack([]);
    updateFromGame(game);
  }, [initPieces, updateFromGame]);

  const loadReplay = useCallback(
    async (id: string) => {
      if (!id) return;
      setReplayError(null);
      stopReplayTimer();
      setIsReplayPlaying(false);
      isReplayPlayingRef.current = false;
      isPlayingRef.current = false;
      setIsPlaying(false);
      turnInProgressRef.current = false;
      replayIndexRef.current = 0;

      try {
        const response = await fetch(`/api/replays/${id}`);
        const payload = await readJson<{
          replay?: ReplayDetail;
          error?: string;
        }>(response);

        if (!response.ok || !payload.replay) {
          throw new Error(payload.error || "Replay not found");
        }

        const replay = payload.replay;
        const events = replay.replayJson?.events ?? [];
        const moves = events
          .filter((event) => event.t === "move")
          .map((event) => ({
            from: event.from,
            to: event.to,
          }));

        setReplayDetail(replay);
        setReplayMoves(moves);
        setIsReplayMode(true);
        setActiveReplayId(replay.id);
        resetBoard();
        setStatus("Replay loaded. Ready to play.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load replay";
        setReplayError(message);
        setStatus("Failed to load replay");
      }
    },
    [resetBoard, setStatus, stopReplayTimer]
  );

  const exitReplay = useCallback(() => {
    stopReplayTimer();
    setIsReplayPlaying(false);
    setIsReplayMode(false);
    setReplayDetail(null);
    setReplayMoves([]);
    setReplayError(null);
    setActiveReplayId(null);
    replayIndexRef.current = 0;
    resetBoard();
    setStatus("Ready for a new battle.");
    router.push("/");
  }, [resetBoard, router, stopReplayTimer]);

  const movePieceInScene = useCallback(
    (fromRow: number, fromCol: number, toRow: number, toCol: number) => {
      const scene = sceneRef.current;
      if (!scene) return;

      const fromKey = `${fromRow}-${fromCol}`;
      const toKey = `${toRow}-${toCol}`;

      // Board bookkeeping happens immediately; only the visuals are deferred.
      const target = piecesRef.current[toKey];
      if (target) {
        delete piecesRef.current[toKey];
      }

      const piece = piecesRef.current[fromKey];
      const toPosition = new THREE.Vector3(
        toCol * SQUARE_SIZE - BOARD_OFFSET,
        0,
        toRow * SQUARE_SIZE - BOARD_OFFSET
      );

      if (piece) {
        piece.userData.row = toRow;
        piece.userData.col = toCol;
        piecesRef.current[toKey] = piece;
        delete piecesRef.current[fromKey];
      }

      if (!piece || reducedMotionRef.current) {
        if (target) {
          finishTweensFor(target);
          scene.remove(target);
        }
        piece?.position.copy(toPosition);
        return;
      }

      finishTweensFor(piece);
      const fromPosition = piece.position.clone();
      fromPosition.y = 0;
      const travel = new THREE.Vector3().subVectors(toPosition, fromPosition);

      // Knights leap over the field; everyone else glides with a gentle lift,
      // like a hand picking the piece up and placing it down.
      const isKnight = piece.userData.type === "knight";
      const lift = isKnight ? 0.85 : 0.16;
      const moveDuration = isKnight ? 0.55 : 0.45;

      tweensRef.current.push({
        object: piece,
        delay: 0,
        duration: moveDuration,
        elapsed: 0,
        update: (progress) => {
          const t = easeInOutCubic(progress);
          piece.position.set(
            fromPosition.x + travel.x * t,
            Math.sin(t * Math.PI) * lift,
            fromPosition.z + travel.z * t
          );
        },
        onComplete: () => {
          piece.position.copy(toPosition);
        },
      });

      if (target) {
        finishTweensFor(target);

        // Knock the victim over: it topples away from the attacker, sinks
        // through the board, and fades out.
        const fallDirection =
          travel.lengthSq() > 0.0001
            ? travel.clone().setY(0).normalize()
            : new THREE.Vector3(0, 0, 1);
        const toppleAxis = new THREE.Vector3()
          .crossVectors(new THREE.Vector3(0, 1, 0), fallDirection)
          .normalize();
        const restingQuaternion = target.quaternion.clone();
        const knockQuaternion = new THREE.Quaternion();
        const basePosition = target.position.clone();
        basePosition.y = 0;

        tweensRef.current.push({
          object: target,
          // Start falling as the attacker arrives on the square
          delay: moveDuration * 0.55,
          duration: 0.5,
          elapsed: 0,
          update: (progress) => {
            const t = easeOutQuart(progress);
            knockQuaternion.setFromAxisAngle(
              toppleAxis,
              t * (Math.PI / 2) * 1.05
            );
            target.quaternion.copy(knockQuaternion).multiply(restingQuaternion);
            target.position.set(
              basePosition.x + fallDirection.x * t * 0.35,
              -t * 0.32,
              basePosition.z + fallDirection.z * t * 0.35
            );
            setPieceOpacity(target, Math.max(0, 1 - progress * 1.2));
          },
          onComplete: () => {
            scene.remove(target);
          },
        });
      }
    },
    [finishTweensFor]
  );

  const playNextReplayMove = useCallback(() => {
    const game = gameRef.current;
    if (!game || !isReplayModeRef.current || !isReplayPlayingRef.current) {
      return;
    }

    const moves = replayMovesRef.current;
    const nextIndex = replayIndexRef.current;

    if (nextIndex >= moves.length) {
      setIsReplayPlaying(false);
      setStatus("Replay finished.");
      return;
    }

    const move = moves[nextIndex];
    replayIndexRef.current = nextIndex + 1;

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

    if (game.gameOver || replayIndexRef.current >= moves.length) {
      setIsReplayPlaying(false);
      isReplayPlayingRef.current = false;
      setStatus("Replay finished.");
      return;
    }

    replayTimerRef.current = setTimeout(playNextReplayMove, moveDelay);
  }, [moveDelay, movePieceInScene, updateFromGame]);

  const fetchLlmMove = useCallback(
    async (
      turn: PieceColor,
      legalMoves: Move[],
      board: BoardState,
      history: string[],
      config: LlmConfig
    ): Promise<{ move: Move; meta: MoveResponse }> => {
      const payload = {
        turn,
        legalMoves,
        board,
        history,
        model: config.model,
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

      return { move: data.move, meta: data };
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
        void saveReplay(game, "stalemate");
        return;
      }

      const config = game.turn === "white" ? whiteConfig : blackConfig;
      setStatus(`Consulting ${game.turn} LLM (${config.model})...`);

      const ply = replayTurnRef.current + 1;
      replayTurnRef.current = ply;

      if (replayMetaRef.current) {
        appendReplayEvent({
          t: "turn_request",
          at: nowIso(),
          ply,
          turn: game.turn,
          model: config.model,
          legalMovesCount: legalMoves.length,
          boardAscii: boardToAscii(game.serializeBoard()),
        });
      }

      let decision: { move: Move; meta: MoveResponse };
      try {
        decision = await fetchLlmMove(
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

      if (replayMetaRef.current) {
        appendReplayEvent({
          t: "llm_decision",
          at: nowIso(),
          ply,
          move: decision.move,
          attemptsUsed: decision.meta.attemptsUsed,
          fallback: decision.meta.fallback,
          rateLimited: decision.meta.rateLimited,
          note: decision.meta.note,
        });
      }

      const move = decision.move;
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
      if (summary && replayMetaRef.current) {
        appendReplayEvent({
          t: "move",
          at: nowIso(),
          ply,
          color: summary.color,
          notation: summary.notation,
          from: summary.from,
          to: summary.to,
        });
        if (summary.captured) {
          appendReplayEvent({
            t: "capture",
            at: nowIso(),
            ply,
            color: summary.color,
            piece: summary.captured.type,
            value: PIECE_VALUE[summary.captured.type],
          });
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
        void saveReplay(game, "checkmate");
      }
    } finally {
      turnInProgressRef.current = false;
    }
  }, [
    appendReplayEvent,
    blackConfig,
    fetchLlmMove,
    moveDelay,
    movePieceInScene,
    nowIso,
    saveReplay,
    updateFromGame,
    whiteConfig,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0b09);
    scene.fog = new THREE.Fog(0x0d0b09, 14, 30);
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Studio environment map so lacquered piece materials pick up realistic
    // reflections instead of flat shading.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    scene.environmentIntensity = 0.4;
    pmremGenerator.dispose();

    const ambientLight = new THREE.AmbientLight(0xfff2dd, 0.35);
    scene.add(ambientLight);

    // Warm key light, like a tournament hall spotlight
    const directionalLight = new THREE.DirectionalLight(0xffe8c4, 1.4);
    directionalLight.position.set(8, 16, 8);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(2048, 2048);
    directionalLight.shadow.camera.left = -8;
    directionalLight.shadow.camera.right = 8;
    directionalLight.shadow.camera.top = 8;
    directionalLight.shadow.camera.bottom = -8;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.bias = -0.0004;
    directionalLight.shadow.radius = 4;
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0xd9a441, 1.4, 100);
    pointLight.position.set(0, 10, 0);
    scene.add(pointLight);

    const rimLight = new THREE.DirectionalLight(0x6b7fa3, 0.35);
    rimLight.position.set(-12, 6, -12);
    scene.add(rimLight);

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const isLight = (row + col) % 2 === 0;
        const geometry = new THREE.BoxGeometry(SQUARE_SIZE, 0.2, SQUARE_SIZE);
        const material = new THREE.MeshStandardMaterial({
          color: isLight ? 0xe8dfcd : 0x4a3527,
          roughness: isLight ? 0.65 : 0.55,
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

    // Board plinth: a dark walnut frame under the squares
    const plinthGeometry = new THREE.BoxGeometry(
      BOARD_SIZE * SQUARE_SIZE + 0.7,
      0.35,
      BOARD_SIZE * SQUARE_SIZE + 0.7
    );
    const plinthMaterial = new THREE.MeshStandardMaterial({
      color: 0x241811,
      roughness: 0.5,
      metalness: 0.25,
    });
    const plinth = new THREE.Mesh(plinthGeometry, plinthMaterial);
    plinth.position.y = -0.28;
    plinth.receiveShadow = true;
    scene.add(plinth);

    // Faint floor disc so the board reads as a stage
    const floorGeometry = new THREE.CircleGeometry(16, 48);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x12100c,
      roughness: 0.95,
      metalness: 0,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.46;
    floor.receiveShadow = true;
    scene.add(floor);

    reducedMotionRef.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const clock = new THREE.Clock();

    const animate = () => {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;

      const delta = Math.min(clock.getDelta(), 0.1);

      if (tweensRef.current.length > 0) {
        const remaining: SceneTween[] = [];
        tweensRef.current.forEach((tween) => {
          tween.elapsed += delta;
          if (tween.elapsed < tween.delay) {
            remaining.push(tween);
            return;
          }
          const progress = Math.min(
            1,
            (tween.elapsed - tween.delay) / tween.duration
          );
          tween.update(progress);
          if (progress >= 1) {
            tween.onComplete?.();
          } else {
            remaining.push(tween);
          }
        });
        tweensRef.current = remaining;
      }

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
    resetReplayLog(true);
    sceneReadyRef.current = true;

    return () => {
      persistedCameraAngle = angleRef.current;
      isPlayingRef.current = false;
      turnInProgressRef.current = false;
      if (scheduleNextTurn.current) {
        clearTimeout(scheduleNextTurn.current);
      }
      if (replayTimerRef.current) {
        clearTimeout(replayTimerRef.current);
        replayTimerRef.current = null;
      }
      isReplayPlayingRef.current = false;

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
  }, [clearPieces, initPieces, resetReplayLog, updateFromGame]);

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

    if (isReplayMode) {
      if (isReplayPlaying) return;
      setReplayError(null);
      setIsReplayPlaying(true);
      isReplayPlayingRef.current = true;
      playNextReplayMove();
      return;
    }

    // Validate models
    const whiteModel = whiteConfig.model.trim();
    const blackModel = blackConfig.model.trim();

    if (!whiteModel) {
      setError("White LLM: model is required");
      setStatus("Cannot start: White LLM configuration is incomplete");
      return;
    }

    if (!blackModel) {
      setError("Black LLM: model is required");
      setStatus("Cannot start: Black LLM configuration is incomplete");
      return;
    }

    setError(null);
    const game = gameRef.current;
    if (!replayMetaRef.current && game && game.moves.length === 0) {
      startReplayLog();
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
    playNextTurn();
  };

  const handlePause = () => {
    if (isReplayMode) {
      setIsReplayPlaying(false);
      isReplayPlayingRef.current = false;
      stopReplayTimer();
      return;
    }
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
    setReplayError(null);

    if (isReplayMode) {
      setIsReplayPlaying(false);
      isReplayPlayingRef.current = false;
      replayIndexRef.current = 0;
      stopReplayTimer();
      if (!sceneReadyRef.current) return;
      resetBoard();
      setStatus("Replay reset.");
      return;
    }

    resetReplayLog(true);
    setIsReplayPlaying(false);
    replayIndexRef.current = 0;
    stopReplayTimer();

    if (!sceneReadyRef.current) return;
    resetBoard();
  };

  const handleRandomMatchup = useCallback(() => {
    if (isPlayingRef.current) return;

    const eligiblePresets = allPresets.filter(
      (preset) => preset.id !== CUSTOM_PRESET_ID && preset.model.trim().length > 0
    );
    if (eligiblePresets.length === 0) return;

    const pickRandomPreset = () =>
      eligiblePresets[Math.floor(Math.random() * eligiblePresets.length)]!;

    const whitePreset = pickRandomPreset();
    let blackPreset = pickRandomPreset();

    if (eligiblePresets.length > 1) {
      let safety = 0;
      while (blackPreset.id === whitePreset.id && safety < 10) {
        blackPreset = pickRandomPreset();
        safety += 1;
      }
    }

    setWhitePresetId(whitePreset.id);
    setBlackPresetId(blackPreset.id);
    setWhiteConfig((prev) => ({ ...prev, model: whitePreset.model }));
    setBlackConfig((prev) => ({ ...prev, model: blackPreset.model }));
    setError(null);
  }, [allPresets]);

  const handleConfigChange = (
    color: PieceColor,
    field: keyof LlmConfig,
    value: string
  ) => {
    if (color === "white") {
      setWhiteConfig((prev) => ({ ...prev, [field]: value }));
      setWhitePresetId(CUSTOM_PRESET_ID);
    } else {
      setBlackConfig((prev) => ({ ...prev, [field]: value }));
      setBlackPresetId(CUSTOM_PRESET_ID);
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
          }));
        }
      } else {
        setBlackPresetId(resolvedId);
        if (preset && preset.id !== CUSTOM_PRESET_ID) {
          setBlackConfig((prev) => ({
            ...prev,
            model: preset.model,
          }));
        }
      }
    },
    [allPresets]
  );

  const whiteIsCustom = whitePresetId === CUSTOM_PRESET_ID;
  const blackIsCustom = blackPresetId === CUSTOM_PRESET_ID;

  const loadOpenRouterModels = useCallback(async () => {
    setIsLoadingOpenRouterModels(true);

    try {
      const response = await fetch("/api/openrouter/models", {
        method: "GET",
        cache: "no-store",
      });

      const payload: {
        models?: Array<{
          id: string;
          label?: string;
          provider?: string | null;
        }>;
        error?: string;
      } = await response.json();

      if (!response.ok) {
        console.warn(
          payload.error || `OpenRouter request failed (${response.status}).`
        );
        return;
      }

      const models = payload.models ?? [];
      const sorted = [...models].sort((a, b) => {
        const aLabel = [a.provider, a.label || a.id].filter(Boolean).join(" · ");
        const bLabel = [b.provider, b.label || b.id].filter(Boolean).join(" · ");
        const byLabel = aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
        if (byLabel !== 0) return byLabel;
        return a.id.toLowerCase().localeCompare(b.id.toLowerCase());
      });

      const nextPresets: ModelPreset[] = sorted.map((model) => {
        const prettyLabel = [model.provider, model.label || model.id]
          .filter(Boolean)
          .join(" · ");
        return {
          id: `openrouter-${sanitizeId(model.id)}`,
          label: prettyLabel || model.id,
          model: model.id,
        };
      });

      setDynamicPresets(nextPresets);
    } catch (error) {
      console.warn("Failed to fetch OpenRouter models", error);
    } finally {
      setIsLoadingOpenRouterModels(false);
    }
  }, []);

  const handleRefreshOpenRouterModels = useCallback(() => {
    void loadOpenRouterModels();
  }, [loadOpenRouterModels]);

  useEffect(() => {
    if (dynamicPresets.length > 0) return;
    if (isLoadingOpenRouterModels) return;
    void loadOpenRouterModels();
  }, [dynamicPresets.length, isLoadingOpenRouterModels, loadOpenRouterModels]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const replayId = new URLSearchParams(window.location.search).get("replay");
    if (!replayId) return;
    if (replayId === activeReplayId) return;
    void loadReplay(replayId);
  }, [activeReplayId, loadReplay]);

  useEffect(() => {
    isReplayModeRef.current = isReplayMode;
  }, [isReplayMode]);

  useEffect(() => {
    isReplayPlayingRef.current = isReplayPlaying;
  }, [isReplayPlaying]);

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

  const isLive = isReplayMode ? isReplayPlaying : isPlaying;

  const ControlPanelContent = () => (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">The Arena</p>
          <h1 className="panel-title mt-1 text-[1.7rem] leading-tight text-[var(--ivory)]">
            LLM Chess
          </h1>
        </div>
        <a
          href="/replays"
          className="btn btn-ghost px-3 py-1.5 text-xs"
          aria-label="Browse saved replays"
        >
          Replays
        </a>
      </div>

      <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-[var(--hairline)] bg-[rgba(243,237,226,0.04)] px-3.5 py-2.5">
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${
            isLive ? "live-dot bg-[var(--brass)]" : "bg-[var(--ivory-faint)]"
          }`}
        />
        <p className="min-w-0 truncate text-[13px] text-[var(--ivory-dim)]">{status}</p>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-[rgba(176,72,60,0.4)] bg-[rgba(176,72,60,0.12)] p-3 text-xs text-[#e8a79e]">
          <p className="whitespace-pre-wrap">{error}</p>
          {isOpenRouterCreditsError(error) && (
            <p className="mt-2 border-t border-[rgba(176,72,60,0.3)] pt-2 text-[11px]">
              This comes from your OpenRouter account (API usage is billed there). Add
              credits or confirm your key matches the right account:{" "}
              <a
                href={OPENROUTER_CREDITS_URL}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[var(--brass-bright)] underline underline-offset-2 hover:text-[var(--brass)]"
              >
                openrouter.ai/settings/credits
              </a>
            </p>
          )}
        </div>
      )}
      {replayError && (
        <div className="mt-3 rounded-xl border border-[rgba(217,164,65,0.4)] bg-[rgba(217,164,65,0.1)] p-3 text-xs text-[var(--brass-bright)]">
          {replayError}
        </div>
      )}
      {isReplayMode && replayDetail && (
        <div className="mt-3 rounded-xl border border-[var(--hairline)] bg-[rgba(243,237,226,0.04)] p-3 text-xs text-[var(--ivory-dim)]">
          <p className="eyebrow">Replay mode</p>
          <p className="mt-1.5 font-medium text-[var(--ivory)]">
            {replayDetail.whiteModel} vs {replayDetail.blackModel}
          </p>
          <p className="mt-1">
            Winner: {replayDetail.winner} · Moves: {replayDetail.turns}
          </p>
        </div>
      )}

      <div className="mt-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleStart}
            className="btn btn-primary flex-1"
            disabled={
              isReplayMode
                ? isReplayPlaying || replayMoves.length === 0
                : isPlaying ||
                  !whiteConfig.model.trim() ||
                  !blackConfig.model.trim()
            }
            aria-label="Start battle"
          >
            {isReplayMode ? "Play Replay" : "Start Battle"}
          </button>
          <button
            onClick={handlePause}
            className="btn btn-ghost"
            disabled={isReplayMode ? !isReplayPlaying : !isPlaying}
            aria-label="Pause battle"
          >
            Pause
          </button>
          <button
            onClick={handleReset}
            className="btn btn-ghost"
            aria-label="Reset game"
          >
            Reset
          </button>
          {isReplayMode && (
            <button
              onClick={exitReplay}
              className="btn btn-ghost"
              aria-label="Exit replay"
            >
              Exit Replay
            </button>
          )}
        </div>

        <div className="space-y-3 border-t border-[var(--hairline)] pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">Matchup</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRandomMatchup}
                className="btn btn-ghost px-3 py-1 text-[11px]"
                disabled={isPlaying || isReplayMode}
                aria-label="Pick a random matchup"
              >
                Randomize
              </button>
              <button
                type="button"
                onClick={handleRefreshOpenRouterModels}
                disabled={isLoadingOpenRouterModels || isPlaying || isReplayMode}
                className="btn btn-ghost px-3 py-1 text-[11px]"
                aria-label="Refresh OpenRouter model list from the API"
              >
                {isLoadingOpenRouterModels ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          <ModelSideControls
            title="White"
            searchAriaLabel="Filter white model list by label or model id"
            selectAriaLabel="Model preset for white pieces"
            allPresets={allPresets}
            selectedPresetId={whitePresetId}
            onSelectPresetId={(presetId) => handlePresetChange("white", presetId)}
            modelValue={whiteConfig.model}
            onModelValueChange={(value) => handleConfigChange("white", "model", value)}
            isCustom={whiteIsCustom}
            disabled={isPlaying || isReplayMode}
          />

          <ModelSideControls
            title="Black"
            searchAriaLabel="Filter black model list by label or model id"
            selectAriaLabel="Model preset for black pieces"
            allPresets={allPresets}
            selectedPresetId={blackPresetId}
            onSelectPresetId={(presetId) => handlePresetChange("black", presetId)}
            modelValue={blackConfig.model}
            onModelValueChange={(value) => handleConfigChange("black", "model", value)}
            isCustom={blackIsCustom}
            disabled={isPlaying || isReplayMode}
          />
        </div>

        <div className="border-t border-[var(--hairline)] pt-4">
          <label className="flex items-center justify-between gap-3">
            <span className="eyebrow">Turn delay (ms)</span>
            <input
              type="number"
              min={250}
              step={250}
              value={moveDelayInput}
              onChange={(event) => {
                setMoveDelayInput(event.target.value);
              }}
              onBlur={() => {
                const raw = moveDelayInput.trim();
                const parsed = Number(raw);
                if (!raw || Number.isNaN(parsed)) {
                  setMoveDelay(MOVE_DELAY_MS);
                  return;
                }
                setMoveDelay(Math.max(250, Math.floor(parsed)));
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.currentTarget.blur();
              }}
              className="field w-24 text-right"
              aria-label="Turn delay in milliseconds"
            />
          </label>
        </div>
      </div>
    </>
  );

  const materialScore = (pieces: Piece[]) =>
    pieces.reduce((total, piece) => total + PIECE_VALUE[piece.type], 0);

  const whiteScore = materialScore(capturedByWhite);
  const blackScore = materialScore(capturedByBlack);

  const CapturedRow = ({
    label,
    pieces,
    score,
    lead,
  }: {
    label: string;
    pieces: Piece[];
    score: number;
    lead: boolean;
  }) => (
    <div className="rounded-xl border border-[var(--hairline)] bg-[rgba(243,237,226,0.03)] p-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        <span
          className={`font-mono text-xs ${
            lead && score > 0
              ? "font-semibold text-[var(--brass-bright)]"
              : "text-[var(--ivory-faint)]"
          }`}
        >
          {score > 0 ? `+${score}` : "—"}
        </span>
      </div>
      <div className="mt-2 flex min-h-7 flex-wrap items-center gap-1">
        {pieces.map((piece, index) => (
          <img
            key={`${label}-${piece.type}-${index}`}
            src={PIECE_IMAGE_MAP[piece.color][piece.type]}
            alt={`${piece.color} ${piece.type}`}
            title={PIECE_LABEL[piece.type]}
            className="pop-in h-7 w-7 object-contain"
          />
        ))}
      </div>
    </div>
  );

  const BattleLogContent = () => (
    <>
      <div className="flex items-baseline justify-between">
        <h2 className="panel-title text-xl text-[var(--ivory)]">Battle Log</h2>
        <span className="font-mono text-[11px] text-[var(--ivory-faint)]">
          {moveHistory.length} {moveHistory.length === 1 ? "ply" : "plies"}
        </span>
      </div>

      <div
        ref={moveListRef}
        className="log-scroll mt-4 max-h-72 overflow-y-auto rounded-xl border border-[var(--hairline)] bg-[rgba(243,237,226,0.03)] p-3"
      >
        <ol className="space-y-1 text-sm">
          {moveHistory.length === 0 ? (
            <li className="py-6 text-center text-xs text-[var(--ivory-faint)]">
              Moves will appear here once the battle begins.
            </li>
          ) : (
            moveHistory.map((entry, index) => {
              const moveNumber = Math.floor(index / 2) + 1;
              const isWhiteMove = entry.color === "white";
              return (
                <li
                  key={`${entry.notation}-${index}`}
                  className="log-entry flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[rgba(243,237,226,0.05)]"
                >
                  <span className="w-7 shrink-0 text-right font-mono text-[11px] text-[var(--ivory-faint)]">
                    {moveNumber}.
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full border ${
                      isWhiteMove
                        ? "border-[rgba(243,237,226,0.4)] bg-[var(--ivory)]"
                        : "border-[rgba(243,237,226,0.35)] bg-[#1d1712]"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ivory)]">
                    {entry.notation}
                  </span>
                  {entry.captured && (
                    <span className="pop-in shrink-0 rounded-full bg-[rgba(176,72,60,0.18)] px-2 py-0.5 text-[10px] font-medium text-[#e8a79e]">
                      ×{PIECE_LABEL[entry.captured.type]}
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ol>
      </div>

      <div className="mt-4 space-y-2.5">
        <CapturedRow
          label="White captures"
          pieces={capturedByWhite}
          score={whiteScore}
          lead={whiteScore > blackScore}
        />
        <CapturedRow
          label="Black captures"
          pieces={capturedByBlack}
          score={blackScore}
          lead={blackScore > whiteScore}
        />
      </div>
    </>
  );

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[var(--ink)] text-[var(--ivory)]">
      <div ref={containerRef} className="h-full w-full" />

      {/* Soft vignette so the board reads as a lit stage */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 45%, transparent 55%, rgba(13,11,9,0.55) 100%)",
        }}
      />

      <div className="pointer-events-none absolute top-4 left-1/2 z-20 flex w-[90vw] max-w-sm -translate-x-1/2 items-center justify-center gap-2 rounded-full border border-[var(--hairline)] bg-[rgba(13,11,9,0.75)] px-4 py-2 backdrop-blur-xl md:hidden">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            isLive ? "live-dot bg-[var(--brass)]" : "bg-[var(--ivory-faint)]"
          }`}
        />
        <span className="truncate text-xs text-[var(--ivory-dim)]">{status}</span>
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
        <div className="panel rounded-t-3xl p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Controls</p>
            <button
              onClick={closeDrawers}
              className="btn btn-ghost px-3 py-1 text-xs"
              aria-label="Close controls"
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
        <div className="panel rounded-t-3xl p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Battle Log</p>
            <button
              onClick={closeDrawers}
              className="btn btn-ghost px-3 py-1 text-xs"
              aria-label="Close battle log"
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
          className="btn btn-ghost bg-[rgba(13,11,9,0.8)] px-5 py-3 backdrop-blur-xl"
          aria-label="Open controls"
          tabIndex={0}
          onKeyDown={(event) => handleKeyToggle(event, openControlsPanel)}
        >
          Controls
        </button>
        <button
          onClick={openLogPanel}
          className="btn btn-primary px-5 py-3"
          aria-label="Open battle log"
          tabIndex={0}
          onKeyDown={(event) => handleKeyToggle(event, openLogPanel)}
        >
          Log
        </button>
      </div>

      <div className="panel rise-in pointer-events-auto absolute left-6 top-6 z-20 hidden max-h-[calc(100vh-3rem)] w-[min(23rem,90vw)] flex-col overflow-hidden rounded-2xl text-sm md:flex">
        <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
          <ControlPanelContent />
        </div>
      </div>

      <div
        className="panel rise-in pointer-events-auto absolute right-6 top-6 z-20 hidden max-h-[calc(100vh-3rem)] w-[min(22rem,90vw)] flex-col overflow-hidden rounded-2xl text-sm md:flex"
        style={{ animationDelay: "0.12s" }}
      >
        <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
          <BattleLogContent />
        </div>
      </div>
    </div>
  );
}
