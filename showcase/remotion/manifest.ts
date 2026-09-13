export interface Media {
  kind: 'image' | 'video';
  /** Path under showcase/public, e.g. 'shots/02-daily-desktop.png'. */
  src: string;
  /** Video only: seconds into the clip to start. */
  startSec?: number;
  /** Natural pixel size of the capture. */
  w: number;
  h: number;
}

export interface Feature {
  id: string;
  /** Short eyebrow naming what the scene is about: Daily, Hints, Share. */
  kind: string;
  title: string;
  blurb: string;
  media: { desktop: Media; phone: Media };
}

export interface Manifest {
  title: string;
  tagline: string;
  features: Feature[];
  outroLine: string;
  cta: string;
}

export { MANIFEST } from './manifest.generated';
