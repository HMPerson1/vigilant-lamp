/// <reference lib="webworker" />
console.log('worker init 1')
// @ts-ignore
import { DoWork, runWorker } from 'observable-webworker';
import { Observable, ReplaySubject, withLatestFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { SpectrogramWork } from '../common';

export class Spectrogram implements DoWork<SpectrogramWork, Float32Array[]> {
  wasm_module = import('../../../wasm/pkg')
  public work(input$: Observable<SpectrogramWork>): Observable<Float32Array[]> {
    console.log('work called');
    const eventBuf: ReplaySubject<SpectrogramWork> = new ReplaySubject()
    input$.subscribe(eventBuf)
    return new Observable((subscriber) => {
      // this.wasm_module.then((wasm_module) => {
      //   eventBuf.pipe(
      //     map(({ timeStep, fftWindowSize, gausWindowSigma, audioSamples }) => {
      //       console.log(audioSamples.length);
      //       const t_start = performance.now()
      //       const ret = wasm_module.compute_spectrogram_sync(timeStep, Math.floor(Math.log2(fftWindowSize)), gausWindowSigma, audioSamples)
      //       const t_end = performance.now()
      //       console.log(t_end-t_start)
      //       return ret
      //     })
      //   ).subscribe(subscriber)
      // })
    })
  }
  selectTransferables(output: Float32Array[]): Transferable[] {
    return output.map((x) => x.buffer)
  }
}

runWorker(Spectrogram);
