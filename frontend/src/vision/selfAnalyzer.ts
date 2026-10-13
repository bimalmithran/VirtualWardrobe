import { WORKING_MAX_SIDE } from '../config/models';
import type { SelfReading } from '../domain/types';
import { encodePNG, loadRGBAFit } from '../image/pixels';
import type { BackgroundRemover } from './backgroundRemoval';
import { assessQuality, MAX_BRIGHTNESS, MIN_BRIGHTNESS } from './junkFilter';
import { readSelf } from './personColouring';
import type { Photo } from './pipeline';

export interface AnalyzedSelfPhoto {
  /** The user cut out from the background. */
  png: Uint8Array;
  reading: SelfReading;
}

/** Turns a photo of the user into a cutout and a skin/hair reading, entirely on the phone. */
export interface SelfAnalyzer {
  analyze(photo: Photo): Promise<AnalyzedSelfPhoto>;
}

export class OnDeviceSelfAnalyzer implements SelfAnalyzer {
  constructor(private readonly remover: BackgroundRemover) {}

  async analyze(photo: Photo): Promise<AnalyzedSelfPhoto> {
    const working = await loadRGBAFit(photo.uri, photo.width, photo.height, WORKING_MAX_SIDE);
    // Skin colour is only as good as the light it was shot in; blur matters much less here.
    const { brightness } = assessQuality(working);
    if (brightness < MIN_BRIGHTNESS) throw new Error('The photo is too dark to read your skin tone. Face a window in daylight.');
    if (brightness > MAX_BRIGHTNESS) throw new Error('The photo is overexposed. Avoid direct sun or flash on your face.');

    const { cutout, coverage } = await this.remover.removeBackground(photo.uri, working);
    if (coverage < 0.03) throw new Error('No person found in the photo. Make sure you fill a good part of the frame.');
    const reading = readSelf(cutout);
    if (!reading) throw new Error("Not enough skin is visible. Use a photo where your face is clearly shown, without filters.");
    return { png: encodePNG(cutout), reading };
  }
}
