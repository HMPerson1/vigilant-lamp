import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { fromInput } from 'observable-from-input';
import { fromWorker } from 'observable-webworker';
import { combineLatest, debounceTime, filter, map, Observable, switchMap } from 'rxjs';
import * as wasm_module from '../../../wasm/pkg';
import { AudioSamples, doScrollZoom, isNotUndefined, SpectrogramTileJs, SpectrogramWork } from '../common';
import { resizeObservable } from '../ui-utils';


@Component({
  selector: 'app-audio-spectrogram',
  templateUrl: './audio-spectrogram.component.html',
  styleUrls: ['./audio-spectrogram.component.css']
})
export class AudioSpectrogramComponent implements OnChanges, AfterViewInit {
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
  @Input() pitchMin: number = 16;
  @Input() pitchMax: number = 136;
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
  get fftWindowSize(): number { return 2 ** this.fftLgWindowSize }

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

    const specCanvas$ = this.spectrogramCanvas$.pipe(filter(isNotUndefined))
    const specCanvasSize$ = specCanvas$.pipe(switchMap(canvas => resizeObservable(canvas.nativeElement.parentElement!, { box: 'device-pixel-content-box' })))
    const canvasWidth$ = specCanvasSize$.pipe(map(x => x.devicePixelContentBoxSize[0].inlineSize));
    const canvasHeight$ = specCanvasSize$.pipe(map(x => x.devicePixelContentBoxSize[0].blockSize));
    const specWork$: Observable<SpectrogramWork> = combineLatest({
      audioData: this.audioData$.pipe(filter(isNotUndefined)),
      timeMin: this.timeMin$,
      timeMax: this.timeMax$,
      pitchMin: this.pitchMin$,
      pitchMax: this.pitchMax$,
      timeStep: this.timeStep$,
      fftLgWindowSize: this.fftLgWindowSize$,
      canvasWidth: canvasWidth$,
      canvasHeight: canvasHeight$,
    }).pipe(debounceTime(0))

    // TODO: cancellation??
    const hiresTile$ = fromWorker<SpectrogramWork, SpectrogramTileJs>(
      () => new Worker(new URL('./spectrogram.worker', import.meta.url)),
      specWork$,
    )

    combineLatest({
      timeMin: this.timeMin$,
      timeMax: this.timeMax$,
      pitchMin: this.pitchMin$,
      pitchMax: this.pitchMax$,
      jsTile: hiresTile$,
      specDbMin: this.specDbMin$,
      specDbMax: this.specDbMax$,
      canvasWidth: canvasWidth$,
      canvasHeight: canvasHeight$,
    }).pipe(debounceTime(0)).subscribe((render) => window.requestAnimationFrame(async () => {
      if (!this.spectrogramCanvas) return

      // TODO(perf): could probably do this copy into wasm just once
      const tile = wasm_module.SpectrogramTile.from_inner(render.jsTile.width, render.jsTile.pixels)
      const image = tile.render(render.specDbMin, render.specDbMax)
      tile.free()

      const timePerRealPixel = (render.timeMax - render.timeMin) / render.canvasWidth;
      const timePerTilePixel = (render.jsTile.timeMax - render.jsTile.timeMin) / render.jsTile.width;
      const xScale = timePerTilePixel / timePerRealPixel;
      const xOffset = (render.timeMin - render.jsTile.timeMin + timePerTilePixel / 2) / timePerRealPixel

      const pitchRangeReal = render.pitchMax - render.pitchMin;
      const pitchRangeTile = render.jsTile.pitchMax - render.jsTile.pitchMin;
      const yScale = pitchRangeTile / pitchRangeReal
      const pitchToPixel = pitchRangeReal / render.canvasHeight
      const yOffset = (render.pitchMax - render.jsTile.pitchMax) / pitchToPixel

      const specCanvas = this.spectrogramCanvas.nativeElement
      specCanvas.width = render.canvasWidth
      specCanvas.height = render.canvasHeight
      const specCanvasCtx = specCanvas.getContext('2d')!
      specCanvasCtx.imageSmoothingEnabled = false

      const bitmap = await createImageBitmap(image, { imageOrientation: 'flipY' });
      specCanvasCtx.drawImage(bitmap, -xOffset, yOffset, bitmap.width * xScale, bitmap.height * yScale)
    }))
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
        16, 136, 6, zoomRate, -timeScrollRate * (specCanvas.width / specCanvas.height),
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


  async drawAudioViz() {
    // const start = performance.now()
    // if (this.spectrogram && this.audioData && this.spectrogramCanvas) {
    //   const waveCanvas = this.spectrogramCanvas.nativeElement;
    //   waveCanvas.width = Math.floor(waveCanvas.parentElement!.clientWidth)
    //   waveCanvas.height = Math.floor(waveCanvas.parentElement!.clientHeight)
    //   const waveCanvasCtx = waveCanvas.getContext('2d')!

    //   // TODO: db range changes shouldn't need recomputing ffts
    //   const rendered = this.spectrogram.render(
    //     waveCanvas.width / this.timeStep, waveCanvas.height,
    //     this.pitchMin, this.pitchMax,
    //     this.timeMin * this.audioData.sampleRate, this.timeMax * this.audioData.sampleRate,
    //     this.specDbMin, this.specDbMax,
    //   )

    //   waveCanvasCtx.imageSmoothingEnabled = false
    //   waveCanvasCtx.drawImage(await createImageBitmap(rendered, { imageOrientation: 'flipY' }), 0, 0, waveCanvas.width, waveCanvas.height)
    // }
    // const end = performance.now()
    // console.log(end - start);
  }

  ngOnChanges(changes: SimpleChanges): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
  }
  ngAfterViewInit(): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
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
