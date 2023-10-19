import { Component, DestroyRef, ElementRef, Input, ViewChild, computed, effect, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { fromWorker } from 'observable-webworker';
import { BehaviorSubject, combineLatest, map, merge, mergeMap, scan } from 'rxjs';
import * as wasm_module from '../../../wasm/pkg';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';
import { GenSpecTile, SpecFftParams, SpecTileWindow, SpecWorkerMsg, SpectrogramTileJs, SpectrogramWork, tag } from '../common';
import { ProjectService } from '../services/project.service';
import { elemBoxSizeSignal, imageDataToBitmapFast } from '../ui-common';

const mkSpectrogramWorker = () => new Worker(new URL('./spectrogram.worker', import.meta.url));

type SpecTileWasm = SpecTileWindow & {
  tile: wasm_module.SpectrogramTile;
}

type SpecTileBitmap = GenSpecTile<ImageBitmap>
type SpecTileCanvas = GenSpecTile<HTMLCanvasElement>

@Component({
  selector: 'app-audio-spectrogram',
  templateUrl: './audio-spectrogram.component.html',
  styles: [':host{display:block; position: absolute; inset: 0}'],
})
export class AudioSpectrogramComponent {
  @ViewChild('spectrogram_canvas') set spectrogramCanvas(v: ElementRef<HTMLCanvasElement>) { this.#spectrogramCanvas.set(v.nativeElement) }
  readonly #spectrogramCanvas = signal<HTMLCanvasElement | undefined>(undefined);

  @Input() set specDbMin(v: number) { this.#specDbMin$.next(v) }
  @Input() set specDbMax(v: number) { this.#specDbMax$.next(v) }
  readonly #specDbMin$ = new BehaviorSubject(-80);
  readonly #specDbMax$ = new BehaviorSubject(-20);

  @Input() set timeStep(v: number) { this.#timeStep$.set(v) }
  @Input() set fftLgWindowSize(v: number) { this.#fftLgWindowSize$.set(v) }
  @Input() set fftLgExtraPad(v: number) { this.#fftLgExtraPad$.set(v) }
  readonly #timeStep$ = signal(2);
  readonly #fftLgWindowSize$ = signal(14);
  readonly #fftLgExtraPad$ = signal(0);

  @Input() debug_downsample: number = 0;

  constructor(project: ProjectService, private readonly viewport: AudioVisualizationComponent, hostElem: ElementRef<HTMLElement>, destroyRef: DestroyRef) {
    const canvasSize = elemBoxSizeSignal(hostElem.nativeElement, 'device-pixel-content-box');
    const viewportParams = computed<SpecTileWindow>(() => ({
      timeMin: viewport.timeMin(), timeMax: viewport.timeMax(),
      pitchMin: viewport.pitchMin(), pitchMax: viewport.pitchMax(),
    }));

    const toWasm = scan<SpectrogramTileJs, SpecTileWasm, undefined>((prev, tileJs) => {
      prev?.tile.free();
      return {
        timeMin: tileJs.timeMin,
        timeMax: tileJs.timeMax,
        pitchMin: tileJs.pitchMin,
        pitchMax: tileJs.pitchMax,
        tile: wasm_module.SpectrogramTile.from_inner(tileJs.width, tileJs.pixels)
      };
    }, undefined);
    // TODO: cancellation??
    const hiresTile$ = fromWorker<SpecWorkerMsg, SpectrogramTileJs>(
      mkSpectrogramWorker,
      merge(
        project.projectAudio$.pipe(map(tag("audioData"))),
        toObservable(computed<SpecFftParams>(() => (
          { lgWindowSize: this.#fftLgWindowSize$(), lgExtraPad: this.#fftLgExtraPad$() }
        ))).pipe(map(tag("fftParams"))),
        toObservable(computed<SpectrogramWork>(() => (
          {
            ...viewportParams(),
            canvasWidth: canvasSize().inlineSize, canvasHeight: canvasSize().blockSize,
            timeStep: this.#timeStep$(), mode: 0,
          }
        ))).pipe(map(tag("work"))),
      ),
    ).pipe(toWasm);
    const loresTile$ = fromWorker<SpecWorkerMsg, SpectrogramTileJs>(
      mkSpectrogramWorker,
      merge(
        project.projectAudio$.pipe(map(tag("audioData"))),
        toObservable(computed<SpecFftParams>(() => (
          { lgWindowSize: this.#fftLgWindowSize$(), lgExtraPad: Math.min(this.#fftLgExtraPad$(), 0) }
        ))).pipe(map(tag("fftParams"))),
        toObservable(computed<SpectrogramWork>(() => (
          {
            ...viewportParams(),
            canvasWidth: canvasSize().inlineSize, canvasHeight: canvasSize().blockSize,
            timeStep: 32, mode: 0,
          }
        ))).pipe(map(tag("work"))),
      ),
    ).pipe(toWasm);

    const tileWasmToBmp = mergeMap(async ({ tile, specDbMin, specDbMax }) => {
      return new GenSpecTile(tile, await imageDataToBitmapFast(tile.tile.render(specDbMin, specDbMax), true));
    });
    const hiresTileBmp$ = toSignal(combineLatest({
      tile: hiresTile$,
      specDbMin: this.#specDbMin$,
      specDbMax: this.#specDbMax$,
    }).pipe(tileWasmToBmp));
    const loresTileBmp$ = toSignal(combineLatest({
      tile: loresTile$,
      specDbMin: this.#specDbMin$,
      specDbMax: this.#specDbMax$,
    }).pipe(tileWasmToBmp));

    effect(() => {
      const specCanvas = this.#spectrogramCanvas();
      const loresTileBmp = loresTileBmp$();
      const hiresTileBmp = hiresTileBmp$();
      if (!specCanvas || (!loresTileBmp && !hiresTileBmp)) return;

      specCanvas.width = canvasSize().inlineSize;
      specCanvas.height = canvasSize().blockSize;
      const specCanvasCtx = specCanvas.getContext('2d', { alpha: false })!
      specCanvasCtx.imageSmoothingEnabled = false
      specCanvasCtx.fillStyle = 'gray'
      specCanvasCtx.fillRect(0, 0, specCanvas.width, specCanvas.height)

      const canvasTile = new GenSpecTile(viewportParams(), specCanvas);
      if (loresTileBmp) renderTile(canvasTile, loresTileBmp, specCanvasCtx);
      if (hiresTileBmp) renderTile(canvasTile, hiresTileBmp, specCanvasCtx);
    });
  }

  readonly canvasBoxTransform = computed(() => `translate(${this.viewport.viewportOffsetX()}px,${this.viewport.viewportOffsetY()}px)`);
}

function renderTile(render: SpecTileCanvas, tile: SpecTileBitmap, specCanvasCtx: CanvasRenderingContext2D) {
  const xScale = render.pixelsPerTime / tile.pixelsPerTime;
  const xOffset = render.time2x(tile.timeMin) - .5 * xScale;
  const yScale = render.pixelsPerPitch / tile.pixelsPerPitch;
  const yOffset = render.pitch2y(tile.pitchMax);
  specCanvasCtx.drawImage(tile.inner, xOffset, yOffset, tile.width * xScale, tile.height * yScale);
}

// NB: design decision to NOT store FFT results since the memory consumption would be too high

// perf timings on my machine: (event to paint latency) (2 sig figs)
// fft + rasterize (2^16 window; 1502 * 908) 1620     ms
// fft + rasterize (2^13 window; 1502 * 908)  257     ms
// fft + rasterize (2^10 window; 1502 * 908)  106     ms
// fft + rasterize (2^16 window;   48 * 908)   61     ms
// fft + rasterize (2^13 window;   48 * 908)   17     ms
// fft + rasterize (2^10 window;   48 * 908)    8     ms
// change db scale              (1502 * 908)    4.5   ms
// scroll view horizontal                       4.0   ms
// scroll view vertical                         1.7   ms
// await createImageBitmap (1502 * 908)         2.1   ms 
// await createImageBitmap (  48 * 908)         0.11  ms 
// specCanvasCtx.drawImage                      0.020 ms
