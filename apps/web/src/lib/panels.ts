import 'server-only'
import { getSnapshot } from '@/lib/content/snapshot'
export type LandingPanel = {
  id: string; mediaSrc: string; mime: string; width: number; height: number; alt: string;
  focalX: number; focalY: number;
  scrim: 'none' | 'bottom' | 'full' | 'top';
  anchor: 'bottom-left' | 'bottom-center' | 'center' | 'top-left';
  heightMode: 'full' | 'tall' | 'half';
  headline: string; body: string | null; ctaLabel: string | null; ctaHref: string | null
}
export const getLandingPanelsSafe = async (): Promise<readonly LandingPanel[]> => getSnapshot().panels
