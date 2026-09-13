import { C } from '../theme';
import { tileShadow } from './Tile';

/**
 * Footage sits inside a cream frame drawn like one big tile: same face, same layered edge,
 * with a small red label strip along the top where a tile would say "Capital".
 */
export const Frame: React.FC<{
  width: number; height: number; label: string; body: string; radius?: number; children?: React.ReactNode;
}> = ({ width, height, label, body, radius = 18, children }) => {
  const pad = Math.round(width * 0.012) + 6;
  const strip = Math.round(pad * 2.4);
  return (
    <div style={{
      width, height, borderRadius: radius, position: 'relative', boxSizing: 'border-box',
      background: `linear-gradient(165deg, ${C.tile} 0%, ${C.tile2} 100%)`, boxShadow: tileShadow(width * 0.35, 1.1),
    }}>
      <div style={{
        position: 'absolute', left: pad, right: pad, top: pad, height: strip, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: body, fontSize: strip * 0.42, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: C.red,
      }}>
        <span>{label}</span>
        <span style={{ color: C.ink2, letterSpacing: '.12em' }}>Mahgeong</span>
      </div>
      <div style={{ position: 'absolute', left: pad, right: pad, top: pad + strip, bottom: pad, overflow: 'hidden', borderRadius: Math.max(6, radius - 8), background: C.panel2, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.12)' }}>
        {children}
      </div>
    </div>
  );
};
