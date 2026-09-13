import { Composition } from 'remotion';
import { Showcase, totalFrames } from './Showcase';
import { MANIFEST } from './manifest';
import { FPS } from './theme';

export const Root: React.FC = () => (
  <>
    <Composition id="Landscape" component={Showcase} durationInFrames={totalFrames(MANIFEST)} fps={FPS} width={1920} height={1080} defaultProps={{ manifest: MANIFEST }} />
    <Composition id="Portrait" component={Showcase} durationInFrames={totalFrames(MANIFEST)} fps={FPS} width={1080} height={1920} defaultProps={{ manifest: MANIFEST }} />
  </>
);
