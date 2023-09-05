import { FocusOrigin } from '@angular/cdk/a11y';
import { Portal } from '@angular/cdk/portal';
import * as t from 'io-ts';
import { clamp } from "lodash-es";
import { Lens } from 'monocle-ts';
import { Observable } from "rxjs";
import { AudioSamples, t_Uint8Array } from "./common";

// TODO: pulses per quarter? beat?
// TODO: tempo changes? time sig changes?

export interface Note extends t.TypeOf<typeof Note> { }
export const Note = t.readonly(t.type({
  /** in MIDI pulses at 96 ppq */
  start: t.number,
  /** in MIDI pulses at 96 ppq */
  length: t.number,
  /** in MIDI pitch */
  pitch: t.number,
  notation: t.undefined, // TODO
}));

export interface Part extends t.TypeOf<typeof Part> { }
export const Part = t.readonly(t.type({
  notes: t.readonlyArray(Note),
}));

export interface Meter extends t.TypeOf<typeof Meter> { }
export const Meter = t.readonly(t.type({
  state: t.union([t.literal('unset'), t.literal('active'), t.literal('locked')]),
  startOffset: t.number,
  bpm: t.number,
  measureLength: t.number,
  subdivision: t.number,
}));
export const MeterLens = Lens.fromProp<Meter>();
export const defaultMeter: Meter = {
  state: 'unset',
  startOffset: 0,
  bpm: 120,
  measureLength: 4,
  subdivision: 2,
}

export const time2beat = (meter: Meter, t: number): number =>
  (t - meter.startOffset) * meter.bpm / 60;
export const beat2time = (meter: Meter, b: number): number =>
  b * 60 / meter.bpm + meter.startOffset;

export interface Project extends t.TypeOf<typeof Project> { }
export const Project = t.readonly(t.type({
  audioFile: t_Uint8Array,
  audio: AudioSamples,
  meter: Meter,
  parts: t.readonlyArray(Part),
}));
export const ProjectLens = Lens.fromPath<Project>();

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

type MouseObservables = {
  mousedown: Observable<number>;
  mousemove: Observable<number | undefined>;
  mouseup: Observable<number | undefined>;
  click: Observable<number>;
};

export type ModalPickFromSpectrogramFn = (
  drawerContents: Portal<any>,
  openedVia: FocusOrigin | undefined,
  onInput: (a: MouseObservables) => Promise<number>,
) => Promise<number | undefined>;
