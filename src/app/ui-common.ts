import * as t from 'io-ts';
import { clamp } from "lodash-es";
import { Observable } from "rxjs";
import { AudioSamples, t_Uint8Array } from "./common";


export type Note = t.TypeOf<typeof Note>;
export const Note = t.readonly(t.type({
  /** in MIDI pulses at 96 ppq */
  start: t.number,
  /** in MIDI pulses at 96 ppq */
  length: t.number,
  /** in MIDI pitch */
  pitch: t.number,
  notation: t.undefined, // TODO
}));

export type Part = t.TypeOf<typeof Part>;
export const Part = t.readonly(t.type({
  notes: t.readonlyArray(Note),
}));

export type Project = t.TypeOf<typeof Project>;
export const Project = t.type({
  audioFile: t_Uint8Array,
  audio: AudioSamples,
  bpm: t.number,
  startOffset: t.number,
  parts: t.readonlyArray(Part),
});

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
  clampMax: number, wheelDelta: number, zoom: boolean, centerPosFrac: number
) {
  doScrollZoom(
    obj, propMin, propMax,
    0, clampMax, 1 / 1000, 1 / 400, 1 / 1600,
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
