/// <reference lib="webworker" />
import { DoWork, runWorker } from 'observable-webworker';
import { combineLatest, Observable, ObservedValueOf, ReplaySubject } from 'rxjs';
import { debounceTime, map, scan } from 'rxjs/operators';
import { AudioSamples, SpecFftParams, SpectrogramTileJs, SpectrogramWork, SpecWorkerMsg } from '../common';

export class Spectrogram implements DoWork<SpecWorkerMsg, SpectrogramTileJs> {
  wasm_module = import('../../../wasm/pkg')
  public work(input$: Observable<SpecWorkerMsg>): Observable<SpectrogramTileJs> {
    const audioData$ = new ReplaySubject<AudioSamples>(1)
    const fftParams$ = new ReplaySubject<SpecFftParams>(1)
    const work$ = new ReplaySubject<SpectrogramWork>(1)
    input$.subscribe(msg => {
      switch (msg.type) {
        case 'audioData': audioData$.next(msg.val); break;
        case 'fftParams': fftParams$.next(msg.val); break;
        case 'work': work$.next(msg.val); break;
        default: const _n: never = msg;
      }
    })
    return new Observable((subscriber) => {
      this.wasm_module.then((wasm_module) => {
        const wasmAudioBuffer$ = audioData$.pipe(scan<AudioSamples, InstanceType<typeof wasm_module.AudioBuffer>, undefined>(
          (last, audioData) => {
            last?.free();
            return new wasm_module.PreprocessedAudio(audioData.samples, audioData.samples_ds2, audioData.samples_ds4, audioData.sampleRate);
          }, undefined))
        const rendererParams$ = combineLatest({ wasmPprAudio: wasmAudioBuffer$, fftParams: fftParams$ });
        const renderer$ = rendererParams$.pipe(scan<ObservedValueOf<typeof rendererParams$>, InstanceType<typeof wasm_module.SpectrogramRenderer>, undefined>(
          (last, { wasmPprAudio, fftParams }) => {
            last?.free();
            const usedLgWindowSize = Math.ceil(fftParams.lgWindowSize + fftParams.lgExtraPad)
            return new wasm_module.SpectrogramRenderer(
              wasmPprAudio,
              2 ** usedLgWindowSize,
              0.2 / (2 ** (usedLgWindowSize - fftParams.lgWindowSize)),
            );
          }, undefined))
        combineLatest({ renderer: renderer$, work: work$ }).pipe(
          debounceTime(0),
          map(({ renderer, work }) => {
            const timePerPixel = (work.timeMax - work.timeMin) / work.canvasWidth;
            const timePerStep = timePerPixel * work.timeStep;
            const stepMin = Math.floor(work.timeMin / timePerStep + .5)
            const stepMax = Math.ceil(work.timeMax / timePerStep - .5) + 1
            const renderTimeMin = stepMin * timePerStep;
            const renderTimeMax = stepMax * timePerStep;

            // TODO: decreasing time step could be more efficient
            const tile = renderer.render(
              stepMax - stepMin, work.canvasHeight,
              work.pitchMin, work.pitchMax,
              renderTimeMin, renderTimeMax)

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
