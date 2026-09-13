import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Felt } from '../components/Felt';
import { Tile } from '../components/Tile';
import { TileWipe } from '../components/TileWipe';
import { C, INTRO_FRAMES } from '../theme';
import type { Fonts } from '../Showcase';

/** Country tiles that drift up behind the title, like a deal being cleared. */
const BACKDROP = ['Canberra', 'Lima', 'Riga', 'Accra', 'Oslo', 'Doha', 'Suva', 'Malé', 'Apia', 'Kyiv', 'Rome', 'Baku', 'Tunis', 'Quito', 'Hanoi', 'Cairo'];

export const Intro: React.FC<{ title: string; tagline: string; fonts: Fonts }> = ({ title, tagline, fonts }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const unit = Math.min(width, height);
  const letters = title.toUpperCase().split('');
  const red = new Set([3, 4, 5]); // G E O
  const tileW = Math.min(Math.round((width * 0.9) / letters.length) - 8, Math.round(unit * 0.15));
  const taglineIn = interpolate(frame, [42, 62], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Felt dark />
      {BACKDROP.map((name, i) => {
        const cols = portrait ? 3 : 6;
        const x = ((i % cols) + 0.5) * (width / cols) + (Math.floor(i / cols) % 2 ? width / cols / 2 : 0) - width * 0.04;
        const y0 = height * 1.1 + (Math.floor(i / cols)) * unit * 0.28;
        const y = y0 - frame * (unit * 0.0035) * (1 + (i % 3) * 0.25);
        const w = Math.round(unit * (portrait ? 0.13 : 0.085));
        return (
          <div key={name} style={{ position: 'absolute', left: x - w / 2, top: y, opacity: 0.28, transform: `rotate(${((i % 5) - 2) * 3}deg)` }}>
            <Tile width={w} kind="Capital" kindColor={C.red}>
              <span style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: w * 0.19, marginTop: w * 0.12 }}>{name}</span>
            </Tile>
          </div>
        );
      })}

      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 0.05 }}>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {letters.map((ch, i) => {
            const s = spring({ frame: frame - 6 - i * 4, fps, config: { damping: 11, stiffness: 150 } });
            const drop = (1 - s) * -unit * 0.35;
            return (
              <div key={i} style={{ transform: `translateY(${drop}px) rotate(${(1 - s) * (i % 2 ? 8 : -8)}deg)`, opacity: Math.min(1, s * 2) }}>
                <Tile width={tileW} lift={1.4}>
                  <span style={{
                    fontFamily: fonts.display, fontWeight: 900, fontStyle: red.has(i) ? 'italic' : 'normal',
                    fontSize: tileW * 0.78, lineHeight: 1, color: red.has(i) ? C.red : C.ink, marginTop: tileW * 0.04,
                    textShadow: '0 1px 0 rgba(255,255,255,.8)',
                  }}>{ch}</span>
                </Tile>
              </div>
            );
          })}
        </div>
        <div style={{
          fontFamily: fonts.body, fontWeight: 500, fontSize: portrait ? unit * 0.052 : unit * 0.05, color: C.cream, textAlign: 'center',
          maxWidth: width * 0.86, opacity: taglineIn, transform: `translateY(${(1 - taglineIn) * unit * 0.02}px)`, textShadow: '0 2px 0 rgba(0,0,0,.35)',
        }}>
          {tagline}
        </div>
      </div>

      <TileWipe frames={14} direction="in" />
      <TileWipe frames={12} direction="out" startAt={INTRO_FRAMES - 12} />
    </AbsoluteFill>
  );
};
