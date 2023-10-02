import { FocusOrigin } from '@angular/cdk/a11y';
import { Portal } from '@angular/cdk/portal';
import * as t from 'io-ts';
import { clamp } from "lodash-es";
import { Lens } from 'monocle-ts';
import { Observable, combineLatest } from "rxjs";
import { AudioSamples, t_Uint8Array } from "./common";
import { Signal, WritableSignal, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

// TODO: tempo changes? time sig changes?

export const PULSES_PER_BEAT = 96;

export interface Note extends t.TypeOf<typeof Note> { }
export const Note = t.readonly(t.type({
  /** in pulses */
  start: t.number,
  /** in pulses */
  length: t.number,
  /** in MIDI pitch */
  pitch: t.number,
  notation: t.union([t.undefined, t.null]), // TODO
}));

export enum Instruments {
  DEFAULT = 'default_synth',
}

export interface Part extends t.TypeOf<typeof Part> { }
export const Part = t.readonly(t.type({
  notes: t.readonlyArray(Note),
  name: t.string,
  instrument: t.literal(Instruments.DEFAULT), // TODO: instruments?
  /// #ff0000
  color: t.string,
  /// 0...1
  gain: t.number,
  visible: t.boolean,
}));
export const PartLens = Lens.fromProp<Part>();
export const defaultPart: Part = {
  notes: [],
  name: 'New Part',
  instrument: Instruments.DEFAULT,
  color: '#0000ff',
  gain: 1,
  visible: true,
};

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

export const time2beat = (meter: Meter, t: number): number => (t - meter.startOffset) * meter.bpm / 60;
export const beat2time = (meter: Meter, b: number): number => b * 60 / meter.bpm + meter.startOffset;
export const time2pulse = (meter: Meter, t: number): number => time2beat(meter, t) * PULSES_PER_BEAT;
export const pulse2time = (meter: Meter, p: number): number => beat2time(meter, p / PULSES_PER_BEAT);

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

export function resizeSignal(elem: Element, options?: ResizeObserverOptions): Signal<ResizeObserverEntry | undefined> {
  return toSignal(resizeObservable(elem, options));
}

export function doScrollZoom(
  signalMin: WritableSignal<number>, signalMax: WritableSignal<number>,
  clampMin: number, clampMax: number, rangeMin: number,
  zoomRate: number, scrollRate: number,
  wheelDelta: number, zoom: boolean, centerPosFrac: number
) {
  let rangeMax = clampMax - clampMin
  let valMin = signalMin()
  let valRange = signalMax() - valMin
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
  signalMin.set(valMin)
  signalMax.set(valMin + valRange)
}

export function doScrollZoomTime(
  signalMin: WritableSignal<number>, signalMax: WritableSignal<number>,
  clampMax: number, wheelDelta: number, zoom: boolean, centerPosFrac: number
) {
  doScrollZoom(
    signalMin, signalMax,
    0, clampMax, 1 / 1000, 1 / 400, 1 / 1600,
    wheelDelta, zoom, centerPosFrac,
  )
}

export const PITCH_MAX = 136;

// export function doScrollZoomPitch<PropMin extends string, PropMax extends string>(
//   obj: { [x in PropMin | PropMax]: number }, propMin: PropMin, propMax: PropMax,
//   aspectRatio: number, wheelDelta: number, zoom: boolean, centerPosFrac: number
// ) {
//   doScrollZoom(
//     obj, propMin, propMax,
//     0, PITCH_MAX, 6, 1 / 400, -1 / 1600 * aspectRatio,
//     wheelDelta, zoom, centerPosFrac,
//   )
// }

export interface ModalSpectrogramEdit {
  click: (
    drawerContents: Portal<any>,
    openedVia: FocusOrigin | undefined,
    accept: (v: number) => boolean,
    onInput: (v: number | undefined) => void,
  ) => Promise<number | undefined>;
  drag: (
    drawerContents: Portal<any>,
    openedVia: FocusOrigin | undefined,
    cursorStyle: 'grab' | 'resize',
    interpretDrag: (start: number, end: number) => number | undefined,
    onInput: (v: number) => void,
  ) => Promise<number | undefined>;
}
export interface StartTranscribing {
  (partIdx: number): void;
}

export interface TranscribeModeState {
  partIdx: number;
  cancel: () => void;
}

// love too have an extremely normal fp ecosystem
export const indexReadonlyArray: <T>(i: number) => Lens<ReadonlyArray<T>, T> =
  i => new Lens(
    s => s[i],
    a => s => {
      if (a === s[i]) return s;
      const s2 = [...s];
      s2[i] = a;
      return s2;
    },
  )

export const imageDataToBitmapFast = (image: ImageData, canvasComposite: boolean = false): Promise<ImageBitmap> =>
  createImageBitmap(image, { colorSpaceConversion: 'none', premultiplyAlpha: canvasComposite ? undefined : 'none' })

export const mkTranslateX = (s: Signal<number | undefined>) => computed(() => { const v = s(); return v !== undefined ? `translateX(${v}px)` : undefined; });
