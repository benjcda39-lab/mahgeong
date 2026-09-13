import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont as loadFraunces } from '@remotion/google-fonts/Fraunces';
import { loadFont as loadAlegreya } from '@remotion/google-fonts/AlegreyaSans';
import { Intro } from './scenes/Intro';
import { Feature } from './scenes/Feature';
import { Outro } from './scenes/Outro';
import { FEATURE_FRAMES, INTRO_FRAMES, OUTRO_FRAMES } from './theme';
import type { Manifest } from './manifest';

const display = loadFraunces('normal', { weights: ['700', '900'], subsets: ['latin'] }).fontFamily;
loadFraunces('italic', { weights: ['900'], subsets: ['latin'] });
const body = loadAlegreya('normal', { weights: ['500', '700', '800'], subsets: ['latin'] }).fontFamily;

export type Fonts = { display: string; body: string };

export const totalFrames = (m: Manifest): number => INTRO_FRAMES + m.features.length * FEATURE_FRAMES + OUTRO_FRAMES;

export const Showcase: React.FC<{ manifest: Manifest }> = ({ manifest }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = totalFrames(manifest);
  const outroStart = INTRO_FRAMES + manifest.features.length * FEATURE_FRAMES;
  const volume = interpolate(frame, [0, fps * 0.5, total - fps * 2.5, total], [0, 0.85, 0.85, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fonts = { display, body };

  return (
    <AbsoluteFill>
      <Audio src={staticFile('music/mahgeong-theme.wav')} volume={volume} />
      <Sequence from={0} durationInFrames={INTRO_FRAMES}>
        <Intro title={manifest.title} tagline={manifest.tagline} fonts={fonts} />
      </Sequence>
      {manifest.features.map((f, i) => (
        <Sequence key={f.id} from={INTRO_FRAMES + i * FEATURE_FRAMES} durationInFrames={FEATURE_FRAMES}>
          <Feature feature={f} index={i} count={manifest.features.length} fonts={fonts} />
        </Sequence>
      ))}
      <Sequence from={outroStart} durationInFrames={OUTRO_FRAMES}>
        <Outro title={manifest.title} line={manifest.outroLine} cta={manifest.cta} fonts={fonts} />
      </Sequence>
    </AbsoluteFill>
  );
};
