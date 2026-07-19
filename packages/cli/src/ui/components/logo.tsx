import { Box, Text } from "ink";
import { useEffect, useMemo, useState } from "react";
import { type Theme, useTheme } from "../theme";

const ART = [
  "█ █ █▄ █ █▀▀ █   █▀█ ▀█▀ █▄ ▄█ █▀▀ █▀▄",
  "█ █ █ ▀█ █   █   █▀█  █  █ ▀ █ █▀  █ █",
  "▀▀▀ ▀  ▀ ▀▀▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀   ▀ ▀▀▀ ▀▀ ",
];
const GRID = ART.map((line) => [...line]);
const ROWS = GRID.length;
const INTRO_MS = 900;
const INTRO_SPREAD_MS = 550;
const SWEEP_MS = 1000;
const SWEEP_EVERY_MS = 7000;
const TILT = 2;
const HALF = 2.4;
const LIGHTER: Record<string, string> = { "█": "▒", "▓": "░" };
const HALF_BLOCKS = new Set(["▀", "▄"]);

type Phase = "intro" | "idle" | "sweep";

function cellAt(
  character: string,
  row: number,
  column: number,
  phase: Phase,
  elapsed: number,
  delay: number,
  theme: Theme,
) {
  if (character === " " || phase === "idle") {
    return { character, color: theme.primary, dim: false };
  }
  if (phase === "intro") {
    const time = elapsed - delay;
    if (time < 0) return { character: " ", color: theme.primary, dim: false };
    if (time < 110) {
      return {
        character: HALF_BLOCKS.has(character) ? character : "░",
        color: theme.gray,
        dim: theme.dimSecondary,
      };
    }
    if (time < 220) {
      return {
        character: HALF_BLOCKS.has(character) ? character : "▒",
        color: theme.gray,
        dim: theme.dimSecondary,
      };
    }
    return { character, color: theme.primary, dim: false };
  }

  const ease = 1 - (1 - elapsed / SWEEP_MS) ** 3;
  const min = -TILT * ROWS - HALF;
  const max = GRID[0].length + HALF;
  const position = min + ease * (max - min);
  const distance = Math.abs(column - (ROWS - 1 - row) * TILT - position);
  if (distance <= HALF && 1 - distance / HALF > 0.35) {
    if (HALF_BLOCKS.has(character)) {
      return { character, color: theme.gray, dim: theme.dimSecondary };
    }
    return { character: LIGHTER[character] ?? character, color: theme.primary, dim: false };
  }
  return { character, color: theme.primary, dim: false };
}

function renderRow(row: number, phase: Phase, elapsed: number, delays: number[], theme: Theme) {
  const segments: Array<{ text: string; color?: string; dim: boolean; start: number }> = [];
  GRID[row].forEach((character, column) => {
    const cell = cellAt(character, row, column, phase, elapsed, delays[column], theme);
    const last = segments.at(-1);
    if (last && ((last.color === cell.color && last.dim === cell.dim) || cell.character === " ")) {
      last.text += cell.character;
    } else {
      segments.push({ text: cell.character, color: cell.color, dim: cell.dim, start: column });
    }
  });
  return segments.map((segment) => (
    <Text key={`${row}-${segment.start}`} color={segment.color} dimColor={segment.dim}>
      {segment.text}
    </Text>
  ));
}

export function Logo() {
  const theme = useTheme();
  const animated = Boolean(process.stdout.isTTY);
  const delays = useMemo(
    () => GRID.map((row) => row.map(() => Math.random() * INTRO_SPREAD_MS)),
    [],
  );
  const [phase, setPhase] = useState<Phase>(animated ? "intro" : "idle");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!animated) return;
    if (phase === "idle") {
      const timeout = setTimeout(() => {
        setElapsed(0);
        setPhase("sweep");
      }, SWEEP_EVERY_MS);
      return () => clearTimeout(timeout);
    }
    const duration = phase === "intro" ? INTRO_MS : SWEEP_MS;
    const started = Date.now();
    const interval = setInterval(() => {
      const next = Date.now() - started;
      if (next >= duration) {
        setElapsed(0);
        setPhase("idle");
      } else {
        setElapsed(next);
      }
    }, 33);
    return () => clearInterval(interval);
  }, [animated, phase]);

  return (
    <Box flexDirection="column" flexShrink={0}>
      {GRID.map((_, row) => (
        <Text key={ART[row]}>{renderRow(row, phase, elapsed, delays[row], theme)}</Text>
      ))}
    </Box>
  );
}
