import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Felt } from '../components/Felt';
import { Tile } from '../components/Tile';
import { TileWipe } from '../components/TileWipe';
import { C } from '../theme';
import type { Fonts } from '../Showcase';

// A plausible No. 1 result: mostly clean, one hint, one wrong guess.
const MARKS = 'ggggggggrgggggygggg'.slice(0, 18).split('');
const MARK_COLOR: Record<string, string> = { g: C.green, y: C.gold, r: C.red };

export const Outro: React.FC<{ title: string; line: string; cta: string; fonts: Fonts }> = ({ title, line, cta, fonts }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const unit = Math.min(width, height);
  const letters = title.toUpperCase().split('');
  const red = new Set([3, 4, 5]);
  const tileW = Math.min(Math.round((width * 0.8) / letters.length) - 8, Math.round(unit * 0.1));
  const cell = Math.round(unit * 0.052);
  const lineIn = interpolate(frame, [44, 62], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ctaIn = interpolate(frame, [62, 78], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Felt dark />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 0.045, padding: unit * 0.06, boxSizing: 'border-box', textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {letters.map((ch, i) => {
            const s = spring({ frame: frame - 4 - i * 2, fps, config: { damping: 12, stiffness: 160 } });
            return (
              <div key={i} style={{ transform: `scale(${s})` }}>
                <Tile width={tileW}>
                  <span style={{ fontFamily: fonts.display, fontWeight: 900, fontStyle: red.has(i) ? 'italic' : 'normal', fontSize: tileW * 0.78, lineHeight: 1, color: red.has(i) ? C.red : C.ink, marginTop: tileW * 0.04 }}>{ch}</span>
                </Tile>
              </div>
            );
          })}
        </div>

        {/* the result grid, one square per pair, popping in row by row */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(6, ${cell}px)`, gap: Math.round(cell * 0.18) }}>
          {MARKS.map((m, i) => {
            const s = spring({ frame: frame - 18 - i * 1.6, fps, config: { damping: 10, stiffness: 200 } });
            return <div key={i} style={{ width: cell, height: cell, borderRadius: cell * 0.18, background: MARK_COLOR[m], transform: `scale(${s})`, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.18)' }} />;
          })}
        </div>

        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: portrait ? unit * 0.066 : unit * 0.062, lineHeight: 1.1, color: C.cream, maxWidth: width * 0.86, opacity: lineIn, transform: `translateY(${(1 - lineIn) * unit * 0.02}px)`, textWrap: 'balance' as never }}>
          {line}
        </div>

        <div style={{
          opacity: ctaIn, background: C.red, color: C.tile, borderRadius: 10, padding: `${unit * 0.018}px ${unit * 0.04}px`,
          fontFamily: fonts.body, fontWeight: 800, fontSize: unit * 0.036, letterSpacing: '.06em', boxShadow: '0 10px 30px rgba(0,0,0,.4)',
          transform: `translateY(${(1 - ctaIn) * unit * 0.02}px)`,
        }}>
          {cta}
        </div>
      </div>
      <TileWipe frames={12} direction="in" />
    </AbsoluteFill>
  );
};
