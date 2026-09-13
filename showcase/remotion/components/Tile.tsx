import { C } from '../theme';

/** The layered edge the game draws under every tile, scaled to the tile's width. */
export const tileShadow = (w: number, lift = 1): string => {
  const e = Math.max(3, Math.round(w * 0.05));
  return [
    'inset 0 0 0 1px rgba(255,255,255,.7)',
    'inset 0 -2px 0 rgba(120,100,60,.15)',
    `${e}px ${e * 1.2}px 0 ${C.edge}`,
    `${e * 1.2}px ${e * 1.4}px 0 ${C.edge2}`,
    `${e * 1.8 * lift}px ${e * 2.4 * lift}px ${e * 2.8 * lift}px rgba(40,30,10,.38)`,
  ].join(', ');
};

/**
 * A mahjong tile, 104:132 like the game. `kind` is the small uppercase label at the top,
 * `children` the face. Face colour and font are the caller's, so a tile can carry a letter
 * of the title as easily as a capital.
 */
export const Tile: React.FC<{
  width: number; kind?: string; kindColor?: string; style?: React.CSSProperties; children?: React.ReactNode; lift?: number;
}> = ({ width, kind, kindColor = C.ink2, style, children, lift = 1 }) => {
  const height = Math.round(width * 132 / 104);
  return (
    <div style={{
      width, height, borderRadius: Math.round(width * 0.085), position: 'relative', boxSizing: 'border-box',
      background: `linear-gradient(165deg, ${C.tile} 0%, ${C.tile2} 100%)`,
      boxShadow: tileShadow(width, lift), color: C.ink,
      display: 'flex', alignItems: 'center', justifyContent: 'center', ...style,
    }}>
      {kind ? (
        <span style={{
          position: 'absolute', top: width * 0.07, left: 0, right: 0, textAlign: 'center',
          fontSize: Math.max(8, width * 0.1), fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: kindColor,
        }}>{kind}</span>
      ) : null}
      {children}
    </div>
  );
};
