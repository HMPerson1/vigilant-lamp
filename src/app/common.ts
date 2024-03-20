import * as t from 'io-ts';
import { fromRefinement } from 'io-ts-types/fromRefinement';

export const t_Uint8Array = fromRefinement("Uint8Array", (u): u is Uint8Array => u instanceof Uint8Array);
export const t_Float32Array = new t.Type<Float32Array, Uint8Array, Uint8Array>(
  "Float32Array",
  (u): u is Float32Array => u instanceof Float32Array,
  (i, ctx) => t.success(new Float32Array(i.slice().buffer)),
  (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
);

export interface AudioSamples extends t.TypeOf<typeof AudioSamples> { }
export const AudioSamples = t.readonly(t.type({
  sampleRate: t.number,
  samples: t_Uint8Array.pipe(t_Float32Array),
  samples_ds2: t_Uint8Array.pipe(t_Float32Array),
  samples_ds4: t_Uint8Array.pipe(t_Float32Array),
}));

export const audioSamplesDuration = (a: AudioSamples): number => a.samples.length / a.sampleRate;

export type SpecFftParams = { lgWindowSize: number, lgExtraPad: number }

export type SpecWorkerMsg =
  Tagged<"audioData", AudioSamples> |
  Tagged<"fftParams", SpecFftParams> |
  Tagged<"work", SpectrogramWork>

export type SpecTileWindow = {
  timeMin: number;
  timeMax: number;
  pitchMin: number;
  pitchMax: number;
};

export class SpecTileWindowExt implements SpecTileWindow {
  timeMin: number;
  timeMax: number;
  pitchMin: number;
  pitchMax: number;
  get timeRange(): number { return this.timeMax - this.timeMin }
  get pitchRange(): number { return this.pitchMax - this.pitchMin }

  constructor(obj: SpecTileWindow) {
    this.timeMin = obj.timeMin;
    this.timeMax = obj.timeMax;
    this.pitchMin = obj.pitchMin;
    this.pitchMax = obj.pitchMax;
  }
}

export class GenSpecTile<T extends { width: number, height: number } = { width: number, height: number }> extends SpecTileWindowExt {
  get width() { return this.inner.width; }
  get height() { return this.inner.height; }
  get pixelsPerTime() { return this.width / this.timeRange; }
  get pixelsPerPitch() { return this.height / this.pitchRange; }

  constructor(window: SpecTileWindow, public readonly inner: T) {
    super(window);
  }

  pitch2y(pitch: number) { return (1 - (pitch - this.pitchMin) / this.pitchRange) * this.height; }
  y2pitch(y: number) { return (1 - y / this.height) * this.pitchRange + this.pitchMin; }

  time2x(time: number) { return (time - this.timeMin) / this.timeRange * this.width; }
  x2time(x: number) { return x / this.width * this.timeRange + this.timeMin; }
}

export type RenderWindowParams = SpecTileWindow & {
  canvasWidth: number;
  canvasHeight: number;
};

export type SpectrogramWork = RenderWindowParams & {
  timeStep: number;
  mode: number;
}

export type SpectrogramTileJs = SpecTileWindow & {
  width: number;
  pixels: Float32Array;
}

type TypedArrayTypeLike<U> = {
  new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): U;
  readonly BYTES_PER_ELEMENT: number;
};

type TypedArrayLike = {
  byteLength: number;
  buffer: ArrayBufferLike;
  byteOffset: number;
};

export function reinterpretTypedArray<U>(t: TypedArrayLike, ty: TypedArrayTypeLike<U>): U {
  if (t.byteLength % ty.BYTES_PER_ELEMENT != 0) throw new Error("incompatible length")
  const newLen = t.byteLength / ty.BYTES_PER_ELEMENT
  return new ty(t.buffer, t.byteOffset, newLen)
}

export type Tagged<K extends string, T> = { type: K, val: T }

export function tag<K extends string, T>(k: K): (v: T) => Tagged<K, T> { return v => { return { type: k, val: v } } }
