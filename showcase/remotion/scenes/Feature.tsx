import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Felt } from '../components/Felt';
import { Frame } from '../components/Frame';
import { TileWipe } from '../components/TileWipe';
import { C, FEATURE_FRAMES } from '../theme';
import type { Feature as FeatureDef } from '../manifest';
import type { Fonts } from '../Showcase';

/** Footage in a tile-shaped frame; the copy takes the rest. Portrait uses the phone capture. */
export const Feature: React.FC<{ feature: FeatureDef; index: number; count: number; fonts: Fonts }> = ({ feature, index, count, fonts }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const unit = Math.min(width, height);
  const media = portrait ? feature.media.phone : feature.media.desktop;

  // Landscape: frame takes ~60% of the width. Portrait: the phone capture stands full height on the left, copy on the right.
  const pad = Math.round(unit * 0.02) + 12;
  const strip = Math.round((Math.round(unit * 0.012) + 6) * 2.4);
  let frameW: number, frameH: number;
  if (portrait) {
    frameH = Math.round(height * 0.62);
    frameW = Math.round((frameH - pad * 2 - strip) * media.w / media.h + pad * 2);
  } else {
    frameW = Math.round(width * 0.6);
    frameH = Math.round((frameW - pad * 2) * media.h / media.w + pad * 2 + strip);
  }
  const innerW = frameW - pad * 2;
  const scale = innerW / media.w;

  const slide = spring({ frame, fps, config: { damping: 15, stiffness: 110 } });
  const textIn = spring({ frame: frame - 8, fps, config: { damping: 15, stiffness: 110 } });
  const drift = interpolate(frame, [0, FEATURE_FRAMES], [0, -unit * 0.012]);

  const mediaStyle: React.CSSProperties = { width: media.w, height: media.h, transform: `scale(${scale})`, transformOrigin: 'top left', display: 'block' };
  const shot = media.kind === 'video'
    ? <OffthreadVideo src={staticFile(media.src)} startFrom={Math.round((media.startSec ?? 0) * fps)} muted style={mediaStyle} />
    : <Img src={staticFile(media.src)} style={mediaStyle} />;

  const copy = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: unit * 0.022, transform: `translateY(${(1 - textIn) * unit * 0.05}px)`, opacity: textIn }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: unit * 0.014, fontFamily: fonts.body, fontWeight: 800, fontSize: unit * 0.024, letterSpacing: '.16em', textTransform: 'uppercase', color: C.red }}>
        <span style={{ background: C.red, color: C.tile, borderRadius: 4, padding: `${unit * 0.004}px ${unit * 0.01}px`, fontVariantNumeric: 'tabular-nums' }}>{index + 1} / {count}</span>
        <span>{feature.kind}</span>
      </div>
      <div style={{ fontFamily: fonts.display, fontWeight: 900, fontSize: portrait ? unit * 0.072 : unit * 0.075, lineHeight: 1.02, color: C.ink, letterSpacing: '-.01em', textWrap: 'balance' as never }}>
        {feature.title}
      </div>
      <div style={{ fontFamily: fonts.body, fontWeight: 500, fontSize: portrait ? unit * 0.04 : unit * 0.036, lineHeight: 1.38, color: C.ink2, maxWidth: portrait ? width * 0.9 : width * 0.32 }}>
        {feature.blurb}
      </div>
    </div>
  );

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Felt />
      {portrait ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 0.06, padding: unit * 0.06, boxSizing: 'border-box' }}>
          <div style={{ transform: `translateY(${(1 - slide) * -unit * 0.12}px)` }}>
            <Frame width={frameW} height={frameH} label={feature.kind} body={fonts.body}>{shot}</Frame>
          </div>
          <div style={{ width: Math.min(width * 0.88, frameW * 1.6) }}>{copy}</div>
        </div>
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: unit * 0.07, padding: unit * 0.05, boxSizing: 'border-box' }}>
          <div style={{ transform: `translateX(${(1 - slide) * -unit * 0.15 + drift}px)` }}>
            <Frame width={frameW} height={frameH} label={feature.kind} body={fonts.body}>{shot}</Frame>
          </div>
          <div style={{ flex: 1, maxWidth: width * 0.32 }}>{copy}</div>
        </div>
      )}
      <TileWipe frames={12} direction="in" />
      <TileWipe frames={12} direction="out" startAt={FEATURE_FRAMES - 12} />
    </AbsoluteFill>
  );
};
