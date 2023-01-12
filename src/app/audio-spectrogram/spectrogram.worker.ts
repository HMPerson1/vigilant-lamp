/// <reference lib="webworker" />
// @ts-ignore
import * as ft from 'fourier-transform/asm';
import { DoWork, runWorker } from 'observable-webworker';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { genGaussianWindow, SpectrogramWork } from '../common';

export class Spectrogram implements DoWork<SpectrogramWork, Float32Array[]> {
  public work(input$: Observable<SpectrogramWork>): Observable<Float32Array[]> {
    return input$.pipe(
      map(({ timeStep, fftWindowSize, gausWindowSigma, audioSamples }) => {
        const window = genGaussianWindow(fftWindowSize, gausWindowSigma)
        const tmp = new Float32Array(fftWindowSize)
        return Array.from({ length: Math.ceil(audioSamples.length / timeStep) }, (_x, i) => {
          const t = i * timeStep
          tmp.set(audioSamples.subarray(t, t + fftWindowSize))
          tmp.fill(0, Math.min(audioSamples.length, t + fftWindowSize))
          for (let i = 0; i < tmp.length; i++) {
            tmp[i] *= window[i]
          }
          return Float32Array.from(ft(tmp), (gain) => 20 * Math.log10(gain))
        })
      })
    );
  }
  selectTransferables(output: Float32Array[]): Transferable[] {
    return output.map((x) => x.buffer)
  }
}

runWorker(Spectrogram);
