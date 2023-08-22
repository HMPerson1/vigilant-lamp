import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { fromInput } from 'observable-from-input';
import { Observable, animationFrameScheduler, combineLatest, debounceTime, filter, map, scan, switchMap } from 'rxjs';
import * as wasm_module from '../../../wasm/pkg';
import { AudioSamples, audioSamplesDuration, isNotUndefined } from '../common';
import { doScrollZoomTime, resizeObservable } from '../ui-common';

@Component({
  selector: 'app-audio-waveform',
  templateUrl: './audio-waveform.component.html',
  styleUrls: ['./audio-waveform.component.css']
})
export class AudioWaveformComponent {
  @ViewChild('waveform_canvas') waveformCanvas?: ElementRef<HTMLCanvasElement>
  waveformCanvas$: Observable<ElementRef<HTMLCanvasElement> | undefined>;
  @Input() audioData?: AudioSamples;
  audioData$: Observable<AudioSamples | undefined>;
  @Input() timeMin: number = 0;
  @Input() timeMax: number = 30;
  @Output() timeMinChange = new EventEmitter<number>();
  @Output() timeMaxChange = new EventEmitter<number>();
  timeMin$: Observable<number>;
  timeMax$: Observable<number>;

  @Input() cursorX?: number;

  constructor() {
    const toObs = fromInput(this);
    this.waveformCanvas$ = toObs('waveformCanvas')
    this.audioData$ = toObs('audioData')
    this.timeMin$ = toObs('timeMin')
    this.timeMax$ = toObs('timeMax')

    const audioDataDef$ = this.audioData$.pipe(filter(isNotUndefined));
    const wasmAudioBuffer$ = audioDataDef$.pipe(scan<AudioSamples, wasm_module.AudioBuffer, undefined>(
      (last, audioData) => {
        last?.free();
        return new wasm_module.AudioBuffer(audioData.samples, audioData.sampleRate);
      }, undefined));

    const waveCanvasDef$ = this.waveformCanvas$.pipe(filter(isNotUndefined))
    const waveCanvasSize$ = waveCanvasDef$.pipe(switchMap(canvas => resizeObservable(canvas.nativeElement, { box: 'device-pixel-content-box' })))
    const canvasWidth$ = waveCanvasSize$.pipe(map(x => x.devicePixelContentBoxSize[0].inlineSize));
    const canvasHeight$ = waveCanvasSize$.pipe(map(x => x.devicePixelContentBoxSize[0].blockSize));

    combineLatest({
      wasmAudioBuffer: wasmAudioBuffer$,
      timeMin: this.timeMin$,
      timeMax: this.timeMax$,
      canvasWidth: canvasWidth$,
      canvasHeight: canvasHeight$,
    }).pipe(debounceTime(0, animationFrameScheduler)).subscribe(({ wasmAudioBuffer, timeMin, timeMax, canvasWidth, canvasHeight }) => {
      if (!this.waveformCanvas) return;
      const waveCanvas = this.waveformCanvas.nativeElement;
      waveCanvas.width = canvasWidth
      waveCanvas.height = canvasHeight
      const waveCanvasCtx = waveCanvas.getContext('2d')!

      const imageData = wasm_module.render_waveform(wasmAudioBuffer, timeMin, timeMax, waveCanvas.width, waveCanvas.height);
      waveCanvasCtx.putImageData(imageData, 0, 0);
    })
  }


  onWheel(event: WheelEvent) {
    if (!this.waveformCanvas) {
      console.error("scroll event before view rendered???");
      return
    }
    const waveCanvas = this.waveformCanvas.nativeElement;
    event.preventDefault()
    // TODO: scroll pixel/line/page ???

    const delta = event.deltaX + event.deltaY
    if (delta) {
      doScrollZoomTime(
        this, 'timeMin', 'timeMax', this.audioData ? audioSamplesDuration(this.audioData) : 30,
        delta, event.ctrlKey, event.offsetX / waveCanvas.clientWidth
      )
      this.timeMinChange.emit(this.timeMin)
      this.timeMaxChange.emit(this.timeMax)
    }
  }
}
