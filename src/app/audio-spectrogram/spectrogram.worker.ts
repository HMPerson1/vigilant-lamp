/// <reference lib="webworker" />
console.log('worker init 1')
// @ts-ignore
import { DoWork, runWorker } from 'observable-webworker';
import { Observable, ReplaySubject, withLatestFrom } from 'rxjs';
import { debounceTime, map } from 'rxjs/operators';
import { SpectrogramTileJs, SpectrogramWork } from '../common';

export class Spectrogram implements DoWork<SpectrogramWork, SpectrogramTileJs> {
  wasm_module = import('../../../wasm/pkg')
  public work(input$: Observable<SpectrogramWork>): Observable<SpectrogramTileJs> {
    const eventBuf: ReplaySubject<SpectrogramWork> = new ReplaySubject()
    input$.subscribe(eventBuf)
    return new Observable((subscriber) => {
      this.wasm_module.then((wasm_module) => {
        eventBuf.pipe(
          debounceTime(0),
          map((work) => {
            // TODO: round time min to time per step
            const timePerPixel = (work.timeMax - work.timeMin) / work.canvasWidth;
            const timePerStep = timePerPixel * work.timeStep;
            const stepCount = Math.ceil((work.canvasWidth - .5) / work.timeStep + .5)
            const renderTimeMin = work.timeMin + timePerPixel / 2;
            const renderTimeMax = renderTimeMin + stepCount * timePerStep;

            // TODO(perf): in theory this can be re-used
            const renderer = new wasm_module.SpectrogramRenderer(work.audioData.samples, work.audioData.sampleRate, 2 ** work.fftLgWindowSize, 0.2)
            // TODO: decreasing time step could be more efficient
            const tile = renderer.render(
              stepCount, work.canvasHeight,
              work.pitchMin, work.pitchMax,
              renderTimeMin, renderTimeMax)
            renderer.free()
            return {
              timeMin: renderTimeMin,
              timeMax: renderTimeMax,
              pitchMin: work.pitchMin,
              pitchMax: work.pitchMax,
              width: tile.width,
              pixels: tile.into_inner()
            }
          })
        ).subscribe(subscriber)
      })
    })
  }
  selectTransferables(output: SpectrogramTileJs): Transferable[] {
    return [output.pixels.buffer]
  }
}

runWorker(Spectrogram);
