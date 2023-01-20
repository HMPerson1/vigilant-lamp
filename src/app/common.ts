import { clamp } from "lodash-es"

export type AudioSamples = { sampleRate: number, samples: Float32Array }

export type SpectrogramWork = {
  audioData: AudioSamples;
  timeMin: number;
  timeMax: number;
  pitchMin: number;
  pitchMax: number;
  timeStep: number;
  fftLgWindowSize: number;
  canvasWidth: number;
  canvasHeight: number;
}

export type SpectrogramTileJs = {
  timeMin: number;
  timeMax: number;
  pitchMin: number;
  pitchMax: number;
  width: number;
  pixels: Float32Array;
}

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
