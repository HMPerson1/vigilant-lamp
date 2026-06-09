import type { AudioSamples } from '../model/project';

export type { AudioSamples } from '../model/project';

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
