import { clamp } from "lodash-es";
import { Observable } from "rxjs";
import { AudioSamples } from "./common";

export class Project {
  constructor(
    public readonly audioFile: ArrayBuffer,
    public readonly audio: AudioSamples,
    public readonly bpm: number,
    public readonly startOffset: number,
    public readonly parts: ReadonlyArray<Part>,
  ) { }

  intoPrim() {
    return {
      audioFile: new Uint8Array(this.audioFile),
      audio: this.audio.intoPrim(),
      bpm: this.bpm,
      startOffset: this.startOffset,
      parts: this.parts,
    };
  }

  static fromPrim(o: ReturnType<Project['intoPrim']>): Project {
    return new Project(o.audioFile.slice().buffer, AudioSamples.fromPrim(o.audio), o.bpm, o.startOffset, o.parts)
  }
}

export type Part = Readonly<{
  notes: ReadonlyArray<Note>;
}>

export type Note = Readonly<{
  /** in MIDI pulses at 96 ppq */
  start: number;
  /** in MIDI pulses at 96 ppq */
  length: number;
  /** in MIDI pitch */
  pitch: number;
  notation?: {}; // TODO
}>

export type PitchLabelType = 'none' | 'midi' | 'sharp' | 'flat';

// https://stackoverflow.com/a/65789933
export function resizeObservable(elem: Element, options?: ResizeObserverOptions): Observable<ResizeObserverEntry> {
  return new Observable(subscriber => {
    var ro = new ResizeObserver(entries => subscriber.next(entries[0]));
    ro.observe(elem, options);
    return () => ro.unobserve(elem)
  });
}

export function doScrollZoom<PropMin extends string, PropMax extends string>(
  obj: { [x in PropMin | PropMax]: number }, propMin: PropMin, propMax: PropMax,
  clampMin: number, clampMax: number, rangeMin: number,
  zoomRate: number, scrollRate: number,
  wheelDelta: number, zoom: boolean, centerPosFrac: number
) {
  let rangeMax = clampMax - clampMin
  let valRange = obj[propMax] - obj[propMin]
  let valMin = obj[propMin]
  if (zoom) {
    let newValRange = valRange * (2 ** (wheelDelta * zoomRate));
    newValRange = clamp(newValRange, rangeMin, rangeMax)
    const deltaValRange = newValRange - valRange;
    valRange = newValRange
    valMin -= centerPosFrac * deltaValRange
  } else {
    valMin += valRange * (wheelDelta * scrollRate)
  }

  valMin = clamp(valMin, clampMin, clampMax - valRange)
  obj[propMin] = valMin
  obj[propMax] = valMin + valRange
}

export function doScrollZoomTime<PropMin extends string, PropMax extends string>(
  obj: { [x in PropMin | PropMax]: number }, propMin: PropMin, propMax: PropMax,
  clampMax: number | undefined, wheelDelta: number, zoom: boolean, centerPosFrac: number
) {
  doScrollZoom(
    obj, propMin, propMax,
    0, clampMax || 30, 1 / 1000, 1 / 400, 1 / 1600,
    wheelDelta, zoom, centerPosFrac,
  )
}

export const PITCH_MAX = 136;

export function doScrollZoomPitch<PropMin extends string, PropMax extends string>(
  obj: { [x in PropMin | PropMax]: number }, propMin: PropMin, propMax: PropMax,
  aspectRatio: number, wheelDelta: number, zoom: boolean, centerPosFrac: number
) {
  doScrollZoom(
    obj, propMin, propMax,
    0, PITCH_MAX, 6, 1 / 400, -1 / 1600 * aspectRatio,
    wheelDelta, zoom, centerPosFrac,
  )
}
