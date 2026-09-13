import { useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from '../theme';

const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Scene transition: a wall of small cream tiles that clears from the top-left corner
 * (direction "in") or fills towards the bottom-right (direction "out"), each tile a
 * little ahead of or behind its neighbours so the edge is ragged like a dealt table.
 */
export const TileWipe: React.FC<{ frames: number; direction: 'in' | 'out'; startAt?: number; cell?: number }> = ({ frames, direction, startAt = 0, cell = 72 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = Math.min(1, Math.max(0, (frame - startAt) / frames));
  if (direction === 'in' && t >= 1) return null;
  if (direction === 'out' && t <= 0) return null;
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  const tiles: React.ReactNode[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const d = ((x + y) / (cols + rows - 2)) * 0.75 + hash(x, y) * 0.25;
      const shown = direction === 'in' ? d > t : d < t;
      if (!shown) continue;
      tiles.push(
        <div key={`${x},${y}`} style={{
          position: 'absolute', left: x * cell, top: y * cell, width: cell - 3, height: cell - 3, borderRadius: cell * 0.09,
          background: `linear-gradient(165deg, ${C.tile} 0%, ${C.tile2} 100%)`,
          boxShadow: `inset 0 0 0 1px rgba(255,255,255,.6), 2px 3px 0 ${C.edge}, 3px 4px 0 ${C.edge2}`,
        }} />,
      );
    }
  }
  return <div style={{ position: 'absolute', inset: 0, background: C.feltDark2, pointerEvents: 'none' }}>{tiles}</div>;
};
