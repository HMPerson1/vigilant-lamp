import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { fromInput } from 'observable-from-input';
import { fromWorker } from 'observable-webworker';
import { animationFrameScheduler, combineLatest, debounceTime, distinctUntilChanged, filter, from, map, merge, mergeMap, Observable, of, scan, switchMap } from 'rxjs';
import * as wasm_module from '../../../wasm/pkg';
import { AudioSamples, doScrollZoom, isNotUndefined, RenderWindowParams, SpecTileWindow, SpectrogramTileJs, SpectrogramWork, SpecWorkerMsg, tag } from '../common';
import { resizeObservable } from '../ui-utils';

const mkSpectrogramWorker = () => new Worker(new URL('./spectrogram.worker', import.meta.url));

type RenderParams = RenderWindowParams & {
  specDbMin: number;
  specDbMax: number;
}

type SpecTileWasm = SpecTileWindow & {
  tile: wasm_module.SpectrogramTile;
}

type SpecTileBitmap = SpecTileWindow & {
  bitmap: ImageBitmap;
}

@Component({
  selector: 'app-audio-spectrogram',
  templateUrl: './audio-spectrogram.component.html',
  styleUrls: ['./audio-spectrogram.component.css']
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

    const audioDataDef$ = this.audioData$.pipe(filter(isNotUndefined));

    const specCanvas$ = this.spectrogramCanvas$.pipe(filter(isNotUndefined))
    const specCanvasSize$ = specCanvas$.pipe(switchMap(canvas => resizeObservable(canvas.nativeElement.parentElement!, { box: 'device-pixel-content-box' })))
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
      lgExtraPad: this.fftLgExtraPad$.pipe(map(x => Math.max(x, 0)), distinctUntilChanged())
    })

    const hiresTileWork$: Observable<SpectrogramWork> = combineLatest({
      timeStep: this.timeStep$,
      ...renderWinParam$s
    })
    // TODO: inefficient; can request just the dirty rect
    const loresTileWork$: Observable<SpectrogramWork> = combineLatest({
      timeStep: of(32),
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
      return {
        timeMin: tile.timeMin,
        timeMax: tile.timeMax,
        pitchMin: tile.pitchMin,
        pitchMax: tile.pitchMax,
        bitmap: await createImageBitmap(tile.tile.render(specDbMin, specDbMax), { imageOrientation: 'flipY' }),
      };
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
    }).pipe(debounceTime(0, animationFrameScheduler)).subscribe(render => {
      if (!this.spectrogramCanvas) return

      const specCanvas = this.spectrogramCanvas.nativeElement
      specCanvas.width = render.canvasWidth
      specCanvas.height = render.canvasHeight
      const specCanvasCtx = specCanvas.getContext('2d')!
      specCanvasCtx.imageSmoothingEnabled = false
      specCanvasCtx.fillStyle = 'gray'
      specCanvasCtx.fillRect(0, 0, specCanvas.width, specCanvas.height)

      this.renderTile(render, render.loresTileBmp, specCanvasCtx);
      this.renderTile(render, render.hiresTileBmp, specCanvasCtx);
    })
  }

  private renderTile(render: RenderWindowParams, tile: SpecTileBitmap, specCanvasCtx: CanvasRenderingContext2D) {
    const timePerRealPixel = (render.timeMax - render.timeMin) / render.canvasWidth;
    const timePerTilePixel = (tile.timeMax - tile.timeMin) / tile.bitmap.width;
    const xScale = timePerTilePixel / timePerRealPixel;
    const xOffset = (render.timeMin - tile.timeMin + timePerTilePixel / 2) / timePerRealPixel;

    const pitchRangeReal = render.pitchMax - render.pitchMin;
    const pitchRangeTile = tile.pitchMax - tile.pitchMin;
    const yScale = pitchRangeTile / pitchRangeReal;
    const pitchToPixel = pitchRangeReal / render.canvasHeight;
    const yOffset = (render.pitchMax - tile.pitchMax) / pitchToPixel;

    specCanvasCtx.drawImage(tile.bitmap, -xOffset, yOffset, tile.bitmap.width * xScale, tile.bitmap.height * yScale);
  }

  onWheel(event: WheelEvent) {
    if (!this.spectrogramCanvas) {
      console.log("scroll event before view rendered???");
      return
    }
    const specCanvas = this.spectrogramCanvas.nativeElement;
    event.preventDefault()
    // TODO: scroll pixel/line/page ???

    const zoomRate = 1 / 400
    const timeScrollRate = zoomRate / 4;
    const [deltaX, deltaY] = event.shiftKey ? [event.deltaY, event.deltaX] : [event.deltaX, event.deltaY]
    if (deltaY) {
      doScrollZoom(
        this, 'pitchMin', 'pitchMax',
        0, 136, 6, zoomRate, -timeScrollRate * (specCanvas.width / specCanvas.height),
        deltaY, event.ctrlKey, 1 - event.offsetY / specCanvas.height)
      this.pitchMinChange.emit(this.pitchMin)
      this.pitchMaxChange.emit(this.pitchMax)
    }
    if (deltaX) {
      const timeClampMax = this.audioData ? this.audioData.samples.length / this.audioData.sampleRate : 30

      doScrollZoom(
        this, 'timeMin', 'timeMax',
        0, timeClampMax, .25, zoomRate, timeScrollRate,
        deltaX, event.ctrlKey, event.offsetX / specCanvas.width)
      this.timeMinChange.emit(this.timeMin)
      this.timeMaxChange.emit(this.timeMax)
    }
  }
}

// NB: design decision to NOT store FFT results since the memory consumption would be too high

// perf timings on my machine: (2 sig figs)
// fft + rasterize (2^16 window; 1502 * 908) 1470     ms
// fft + rasterize (2^13 window; 1502 * 908)  295     ms
// fft + rasterize (2^10 window; 1502 * 908)  175     ms
// fft + rasterize (2^16 window;   48 * 908)   50     ms
// fft + rasterize (2^13 window;   48 * 908)   10.5   ms
// fft + rasterize (2^10 window;   48 * 908)    6.7   ms
// await createImageBitmap (1502 * 908)         2.2   ms 
// specCanvasCtx.drawImage                      0.020 ms
