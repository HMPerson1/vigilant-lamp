export type Tagged<K extends string, T> = { type: K, val: T }

export class AudioSamples {
  readonly sampleRate: number;
  readonly samples: Float32Array;
  get timeLen(): number { return this.samples.length / this.sampleRate; }

  constructor(sampleRate: number, samples: Float32Array) {
    this.sampleRate = sampleRate;
    this.samples = samples;
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
  inner: T;
  get width() { return this.inner.width; }
  get height() { return this.inner.height; }
  get timePerPixel() { return this.timeRange / this.width; }
  get pitchPerPixel() { return this.pitchRange / this.height; }

  constructor(window: SpecTileWindow, inner: T) {
    super(window);
    this.inner = inner;
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
}

export type SpectrogramTileJs = SpecTileWindow & {
  width: number;
  pixels: Float32Array;
}

export function tag<K extends string, T>(k: K): (v: T) => Tagged<K, T> { return v => { return { type: k, val: v } } }

export function isNotUndefined<T>(x?: T): x is T { return x !== undefined }
