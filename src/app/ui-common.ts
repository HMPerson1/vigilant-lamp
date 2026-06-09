import { FocusOrigin } from '@angular/cdk/a11y';
import { Portal } from '@angular/cdk/portal';
import { Signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { absurd } from 'fp-ts/function';
import { Lens } from 'monocle-ts';
import { Observable, map } from "rxjs";
import { Part } from '../model/project';

// TODO: tempo changes? time sig changes?

export type PitchLabelType = 'none' | 'midi' | 'sharp' | 'flat';

// https://stackoverflow.com/a/65789933
export function resizeObservable(elem: Element, options?: ResizeObserverOptions): Observable<ResizeObserverEntry> {
  return new Observable(subscriber => {
    var ro = new ResizeObserver(entries => subscriber.next(entries[0]));
    ro.observe(elem, options);
    return () => ro.unobserve(elem)
  });
}

/** is (0,0) until resize observer first fires (usually when elem is first rendered) */
export function elemBoxSizeSignal(elem: Element, box: ResizeObserverBoxOptions = 'content-box'): Signal<ResizeObserverSize> {
  const mapFn: (v: ResizeObserverEntry) => ResizeObserverSize =
    box === 'border-box' ? v => v.borderBoxSize[0] :
      box === 'content-box' ? v => v.contentBoxSize[0] :
        box === 'device-pixel-content-box' ? v => v.devicePixelContentBoxSize[0] :
          absurd(box)
  return toSignal(resizeObservable(elem, { box }).pipe(map(mapFn)), { initialValue: { blockSize: 0, inlineSize: 0 } });
}

export function resizeSignal(elem: Element, options?: ResizeObserverOptions): Signal<ResizeObserverEntry | undefined> {
  return toSignal(resizeObservable(elem, options));
}

// ~21.1 kHz
export const PITCH_MAX = 136;

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
    a => s => a === s[i] ? s : s.with(i, a),
  )

export const imageDataToBitmapFast = (image: ImageData, canvasComposite: boolean = false): Promise<ImageBitmap> =>
  createImageBitmap(image, { colorSpaceConversion: 'none', premultiplyAlpha: canvasComposite ? undefined : 'none' })

export const mkTranslateX = (s: Signal<number | undefined>) => computed(() => { const v = s(); return v !== undefined ? `translateX(${v}px)` : undefined; });
export const mkTranslateY = (s: Signal<number | undefined>) => computed(() => { const v = s(); return v !== undefined ? `translateY(${v}px)` : undefined; });
export interface Viewport {
  x2time(x: number): number;
  time2x(t: number): number;
  y2pitch(y: number): number;
  pitch2y(p: number): number;
}

export function sortPartsDisplay(parts: ReadonlyArray<Part>): (Part & { idx: number })[] {
  return parts.map((p, i) => ({ ...p, idx: i })).sort((a, b) => a.displayIndex - b.displayIndex);
}
