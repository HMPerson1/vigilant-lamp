export type Tagged<K extends string, T> = { type: K, val: T }

export class AudioSamples {
  get timeLen(): number { return this.samples.length / this.sampleRate; }

  constructor(
    public readonly sampleRate: number,
    public readonly samples: Float32Array,
    public readonly samples_ds2: Float32Array,
    public readonly samples_ds4: Float32Array
  ) { }

  intoPrim() {
    return {
      sampleRate: this.sampleRate,
      samples: reinterpretTypedArray(this.samples, Uint8Array),
      samples_ds2: reinterpretTypedArray(this.samples_ds2, Uint8Array),
      samples_ds4: reinterpretTypedArray(this.samples_ds4, Uint8Array),
    };
  }

  static fromPrim(o: ReturnType<AudioSamples['intoPrim']>): AudioSamples {
    return new AudioSamples(
      o.sampleRate,
      new Float32Array(o.samples.slice().buffer),
      new Float32Array(o.samples_ds2.slice().buffer),
      new Float32Array(o.samples_ds4.slice().buffer),
    );
  }
}

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

export class GenSpecTile<T extends { width: number, height: number }> extends SpecTileWindowExt {
  get width() { return this.inner.width; }
  get height() { return this.inner.height; }
  get timePerPixel() { return this.timeRange / this.width; }
  get pitchPerPixel() { return this.pitchRange / this.height; }

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

export function tag<K extends string, T>(k: K): (v: T) => Tagged<K, T> { return v => { return { type: k, val: v } } }

export function isNotUndefined<T>(x?: T): x is T { return x !== undefined }
