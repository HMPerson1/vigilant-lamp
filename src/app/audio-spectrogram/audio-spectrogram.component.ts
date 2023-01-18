import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { AudioSamples, doScrollZoom, isNotUndefined, SpectrogramWork } from '../common';
import * as wasm_module from '../../../wasm/pkg';
import { combineLatest, filter, map, Observable, switchMap } from 'rxjs';
import { fromInput } from 'observable-from-input';
import { isObject, isUndefined } from 'lodash-es';
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
    const specCanvasSize$ = specCanvas$.pipe(switchMap(canvas => resizeObservable(canvas.nativeElement.parentElement!, {box: 'device-pixel-content-box'})))
    const specWork$: Observable<SpectrogramWork> = combineLatest({
      audioData: this.audioData$.pipe(filter(isNotUndefined)),
      timeMin: this.timeMin$,
      timeMax: this.timeMax$,
      pitchMin: this.pitchMin$,
      pitchMax: this.pitchMax$,
      specDbMin: this.specDbMin$,
      specDbMax: this.specDbMax$,
      timeStep: this.timeStep$,
      fftLgWindowSize: this.fftLgWindowSize$,
      canvasWidth: specCanvasSize$.pipe(map(x => x.devicePixelContentBoxSize[0].inlineSize)),
      canvasHeight: specCanvasSize$.pipe(map(x => x.devicePixelContentBoxSize[0].blockSize)),
    })

    // TODO: cancellation??
    specWork$.subscribe((work) => window.requestAnimationFrame(async () => {
      if (!this.spectrogramCanvas) return
      const sampleRate = work.audioData.sampleRate;
      const renderer = new wasm_module.SpectrogramRenderer(work.audioData.samples, sampleRate, 2 ** work.fftLgWindowSize, 0.2)
      // TODO: descreasing time step or changing db shouldn't require
      const image = renderer.render(
        work.canvasWidth / work.timeStep, work.canvasHeight,
        work.pitchMin, work.pitchMax,
        work.timeMin * sampleRate, work.timeMax * sampleRate,
        work.specDbMin, work.specDbMax)
      renderer.free()

      const specCanvas = this.spectrogramCanvas.nativeElement;
      specCanvas.width = work.canvasWidth
      specCanvas.height = work.canvasHeight
      const specCanvasCtx = specCanvas.getContext('2d')!
      specCanvasCtx.imageSmoothingEnabled = false
      specCanvasCtx.drawImage(await createImageBitmap(image, { imageOrientation: 'flipY' }), 0, 0, specCanvas.width, specCanvas.height)
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
        16, 136, 12, zoomRate, -timeScrollRate * (specCanvas.width / specCanvas.height),
        deltaY, event.ctrlKey, 1 - event.offsetY / specCanvas.height)
      this.pitchMinChange.emit(this.pitchMin)
      this.pitchMaxChange.emit(this.pitchMax)
    }
    if (deltaX) {
      const timeClampMax = this.audioData ? this.audioData.samples.length / this.audioData.sampleRate : 30

      doScrollZoom(
        this, 'timeMin', 'timeMax',
        0, timeClampMax, 1 / 4, zoomRate, timeScrollRate,
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
