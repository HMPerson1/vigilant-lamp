import { clamp } from "lodash-es";

export type Tagged<K extends string, T> = { type: K, val: T }

export type AudioSamples = { sampleRate: number, samples: Float32Array }

export type SpecWorkerMsg =
  Tagged<"audioData", AudioSamples> |
  Tagged<"fftLgWindowSize", number> |
  Tagged<"work", SpectrogramWork>

export type SpecTileWindow = {
  timeMin: number;
  timeMax: number;
  pitchMin: number;
  pitchMax: number;
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

export function genGaussianWindow(N: number, sigma: number): Float32Array {
  const ret = new Float32Array(N)
  for (let i = 0; i < ret.length; i++) {
    ret[i] = Math.exp((-1 / 2) * ((i - N / 2) / (sigma * N / 2)) ** 2)
  }
  return ret
}

export function pitch2freq(pitch: number): number {
  return 440 * (2 ** ((pitch - 69) / 12))
}

export function freq2pitch(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440)
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

export function isNotUndefined<T>(x?: T): x is T { return x !== undefined }
