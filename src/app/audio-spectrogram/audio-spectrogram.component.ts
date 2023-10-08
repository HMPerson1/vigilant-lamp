import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { fromInput } from 'observable-from-input';
import { fromWorker } from 'observable-webworker';
import { Observable, asapScheduler, combineLatest, debounceTime, distinctUntilChanged, filter, from, map, merge, mergeMap, of, scan, switchMap } from 'rxjs';
import * as wasm_module from '../../../wasm/pkg';
import { AudioSamples, GenSpecTile, RenderWindowParams, SpecTileWindow, SpecWorkerMsg, SpectrogramTileJs, SpectrogramWork, isNotUndefined, tag } from '../common';
import { imageDataToBitmapFast, resizeObservable } from '../ui-common';

const mkSpectrogramWorker = () => new Worker(new URL('./spectrogram.worker', import.meta.url));

type SpecTileWasm = SpecTileWindow & {
  tile: wasm_module.SpectrogramTile;
}

type SpecTileBitmap = GenSpecTile<ImageBitmap>
type SpecTileCanvas = GenSpecTile<HTMLCanvasElement>

@Component({
  selector: 'app-audio-spectrogram',
  templateUrl: './audio-spectrogram.component.html',
})
export class AudioSpectrogramComponent {
  @ViewChild('spectrogram_canvas') spectrogramCanvas?: ElementRef<HTMLCanvasElement>;
  spectrogramCanvas$: Observable<ElementRef<HTMLCanvasElement> | undefined>;

  @Input() audioData?: AudioSamples;
  audioData$: Observable<AudioSamples | undefined>;
  @Input() timeMin: number = 0;
  @Input() timeMax: number = 30;
  @Output() timeMinChange = new EventEmitter<number>();
  @Output() timeMaxChange = new EventEmitter<number>();
  timeMin$: Observable<number>;
  timeMax$: Observable<number>;
  @Input() pitchMin: number = 12;
  @Input() pitchMax: number = 108;
  @Output() pitchMinChange = new EventEmitter<number>();
  @Output() pitchMaxChange = new EventEmitter<number>();
  pitchMin$: Observable<number>;
  pitchMax$: Observable<number>;
  @Input() specDbMin: number = -80;
  @Input() specDbMax: number = -20;
  specDbMin$: Observable<number>;
  specDbMax$: Observable<number>;

  @Input() timeStep: number = 2;
  timeStep$: Observable<number>;
  @Input() fftLgWindowSize: number = 14;
  fftLgWindowSize$: Observable<number>;
  @Input() fftLgExtraPad: number = 0;
  fftLgExtraPad$: Observable<number>;

  @Input() debug_downsample: number = 0;

  constructor() {
    const toObs = fromInput(this);
    this.spectrogramCanvas$ = toObs('spectrogramCanvas')
    this.audioData$ = toObs('audioData')
    this.timeMin$ = toObs('timeMin')
    this.timeMax$ = toObs('timeMax')
    this.pitchMin$ = toObs('pitchMin')
    this.pitchMax$ = toObs('pitchMax')
    this.specDbMin$ = toObs('specDbMin')
    this.specDbMax$ = toObs('specDbMax')
    this.timeStep$ = toObs('timeStep')
    this.fftLgWindowSize$ = toObs('fftLgWindowSize')
    this.fftLgExtraPad$ = toObs('fftLgExtraPad')

    const debug_downsample$ = toObs('debug_downsample')

    const audioDataDef$ = this.audioData$.pipe(filter(isNotUndefined));

    const specCanvasDef$ = this.spectrogramCanvas$.pipe(filter(isNotUndefined))
    const specCanvasSize$ = specCanvasDef$.pipe(switchMap(canvas => resizeObservable(canvas.nativeElement, { box: 'device-pixel-content-box' })))
    const canvasWidth$ = specCanvasSize$.pipe(map(x => x.devicePixelContentBoxSize[0].inlineSize));
    const canvasHeight$ = specCanvasSize$.pipe(map(x => x.devicePixelContentBoxSize[0].blockSize));

    const renderWinParam$s: { [K in keyof RenderWindowParams]: Observable<RenderWindowParams[K]> } = {
      timeMin: this.timeMin$,
      timeMax: this.timeMax$,
      pitchMin: this.pitchMin$,
      pitchMax: this.pitchMax$,
      canvasWidth: canvasWidth$,
      canvasHeight: canvasHeight$,
    }

    const hiresFftParams$ = combineLatest({
      lgWindowSize: this.fftLgWindowSize$,
      lgExtraPad: this.fftLgExtraPad$
    })
    const loresFftParams$ = combineLatest({
      lgWindowSize: this.fftLgWindowSize$,
      lgExtraPad: this.fftLgExtraPad$.pipe(map(x => Math.min(x, 0)), distinctUntilChanged())
    })

    const hiresTileWork$: Observable<SpectrogramWork> = combineLatest({
      timeStep: this.timeStep$,
      mode: debug_downsample$,
      ...renderWinParam$s
    })
    // TODO: inefficient; can request just the dirty rect
    const loresTileWork$: Observable<SpectrogramWork> = combineLatest({
      timeStep: of(32),
      mode: debug_downsample$,
      ...renderWinParam$s
    })

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
        audioDataDef$.pipe(map(tag("audioData"))),
        hiresFftParams$.pipe(map(tag("fftParams"))),
        hiresTileWork$.pipe(debounceTime(0), map(tag("work"))),
      ),
    ).pipe(toWasm)
    const loresTile$ = fromWorker<SpecWorkerMsg, SpectrogramTileJs>(
      mkSpectrogramWorker,
      merge(
        audioDataDef$.pipe(map(tag("audioData"))),
        loresFftParams$.pipe(map(tag("fftParams"))),
        loresTileWork$.pipe(map(tag("work"))),
      ),
    ).pipe(toWasm)

    const tileWasmToBmp = mergeMap(({ tile, specDbMin, specDbMax }) => from((async () => {
      return new GenSpecTile(tile, await imageDataToBitmapFast(tile.tile.render(specDbMin, specDbMax), true));
    })()));
    const hiresTileBmp$: Observable<SpecTileBitmap> = combineLatest({
      tile: hiresTile$,
      specDbMin: this.specDbMin$,
      specDbMax: this.specDbMax$,
    }).pipe(tileWasmToBmp)
    const loresTileBmp$: Observable<SpecTileBitmap> = combineLatest({
      tile: loresTile$,
      specDbMin: this.specDbMin$,
      specDbMax: this.specDbMax$,
    }).pipe(tileWasmToBmp)

    combineLatest({
      hiresTileBmp: hiresTileBmp$,
      loresTileBmp: loresTileBmp$,
      ...renderWinParam$s
    }).pipe(debounceTime(0, asapScheduler)).subscribe(winParams => {
      if (!this.spectrogramCanvas) return

      const specCanvas = this.spectrogramCanvas.nativeElement
      specCanvas.width = winParams.canvasWidth
      specCanvas.height = winParams.canvasHeight
      const specCanvasCtx = specCanvas.getContext('2d', { alpha: false })!
      specCanvasCtx.imageSmoothingEnabled = false
      specCanvasCtx.fillStyle = 'gray'
      specCanvasCtx.fillRect(0, 0, specCanvas.width, specCanvas.height)

      const canvasTile = new GenSpecTile(winParams, specCanvas);
      renderTile(canvasTile, winParams.loresTileBmp, specCanvasCtx);
      renderTile(canvasTile, winParams.hiresTileBmp, specCanvasCtx);
    })
  }
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
