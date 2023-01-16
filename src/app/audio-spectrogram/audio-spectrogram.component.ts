import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { AudioSamples, doScrollZoom } from '../common';
import * as wasm_module from '../../../wasm/pkg';

@Component({
  selector: 'app-audio-spectrogram',
  templateUrl: './audio-spectrogram.component.html',
  styleUrls: ['./audio-spectrogram.component.css']
})
export class AudioSpectrogramComponent implements OnChanges, AfterViewInit {
  @ViewChild('spectrogram_canvas') spectrogramCanvas?: ElementRef<HTMLCanvasElement>

  @Input() timeMin: number = 0;
  @Input() timeMax: number = 30;
  @Output() timeMinChange = new EventEmitter<number>()
  @Output() timeMaxChange = new EventEmitter<number>()
  @Input() pitchMin: number = 16;
  @Input() pitchMax: number = 136;
  @Output() pitchMinChange = new EventEmitter<number>()
  @Output() pitchMaxChange = new EventEmitter<number>()
  @Input() specDbMin: number = -80
  @Input() specDbMax: number = -20

  get fftWindowSize(): number { return 2 ** this.fftLgWindowSize }
  @Input() timeStep: number = 2;
  #audioData?: AudioSamples
  #spectrogram?: wasm_module.SpectrogramRenderer
  get audioData(): AudioSamples | undefined { return this.#audioData }
  #fftLgWindowSize: number = 14
  get fftLgWindowSize(): number { return this.#fftLgWindowSize }
  @Input() set fftLgWindowSize(x: number) {
    this.#fftLgWindowSize = x
    this.#spectrogram = undefined
  }
  @Input() set audioData(x: AudioSamples | undefined) {
    this.#audioData = x
    this.#spectrogram = undefined
  }
  get spectrogram(): wasm_module.SpectrogramRenderer | undefined {
    if (!this.audioData) return undefined
    if (!this.#spectrogram) {
      this.#spectrogram = new wasm_module.SpectrogramRenderer(this.audioData.samples, this.audioData.sampleRate, this.fftWindowSize, 0.2)
    }
    return this.#spectrogram
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
    const start = performance.now()
    if (this.spectrogram && this.audioData && this.spectrogramCanvas) {
      const waveCanvas = this.spectrogramCanvas.nativeElement;
      waveCanvas.width = Math.floor(waveCanvas.parentElement!.clientWidth)
      waveCanvas.height = Math.floor(waveCanvas.parentElement!.clientHeight)
      const waveCanvasCtx = waveCanvas.getContext('2d')!

      // TODO: db range changes shouldn't need recomputing ffts
      const rendered = this.spectrogram.render(
        waveCanvas.width / this.timeStep, waveCanvas.height,
        this.pitchMin, this.pitchMax,
        this.timeMin * this.audioData.sampleRate, this.timeMax * this.audioData.sampleRate,
        this.specDbMin, this.specDbMax,
      )

      waveCanvasCtx.imageSmoothingEnabled = false
      waveCanvasCtx.drawImage(await createImageBitmap(rendered, { imageOrientation: 'flipY' }), 0, 0, waveCanvas.width, waveCanvas.height)
    }
    const end = performance.now()
    console.log(end - start);
  }

  ngOnChanges(changes: SimpleChanges): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
  }
  ngAfterViewInit(): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
  }
}
