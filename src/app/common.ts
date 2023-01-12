export type AudioSamples = { sampleRate: number, samples: Float32Array }

export type SpectrogramWork = { 
  /// in samples
  timeStep: number,
  /// in samples
  fftWindowSize: number,
  gausWindowSigma: number,
  audioSamples: Float32Array,
}

export function genGaussianWindow(N: number, sigma: number): Float32Array {
  const ret = new Float32Array(N)
  for (let i = 0; i < ret.length; i++) {
    ret[i] = Math.exp((-1/2) * ((i - N/2)/(sigma * N / 2)) ** 2)
  }
  return ret
}
