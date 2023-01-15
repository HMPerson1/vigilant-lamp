import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { AudioSamples } from '../common';
import * as wasm_module from '../../../wasm/pkg';
import { clamp } from 'lodash';

@Component({
  selector: 'app-audio-spectrogram',
  templateUrl: './audio-spectrogram.component.html',
  styleUrls: ['./audio-spectrogram.component.css']
})
export class AudioSpectrogramComponent implements OnChanges, AfterViewInit {
  @ViewChild('spectrogram_canvas') spectrogramCanvas?: ElementRef<HTMLCanvasElement>
  get fftWindowSize(): number { return 2 ** this.fftLgWindowSize }
  /** samples per pixel */
  @Input() audioVizScale: number = 400; // TODO: change to seconds per pixel
  @Input() timeStep: number = 2;
  @Input() pitchMin: number = 16;
  @Input() pitchMax: number = 136;
  @Output() pitchMinChange = new EventEmitter<number>()
  @Output() pitchMaxChange = new EventEmitter<number>()
  @Input() specDbMin: number = -80
  @Input() specDbMax: number = -20
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
    event.preventDefault()
    // TODO: scroll pixel/line/page ???

    const [deltaX, deltaY] = event.shiftKey ? [event.deltaY, event.deltaX] : [event.deltaX, event.deltaY]
    if (deltaY) {
      let pitchRange = this.pitchMax - this.pitchMin
      let pitchMin = this.pitchMin
      if (event.ctrlKey) {
        let newPitchRange = pitchRange * (2 ** (deltaY / 200));
        newPitchRange = clamp(newPitchRange, 12, 120)
        const deltaPitchRange = newPitchRange - pitchRange;
        pitchRange = newPitchRange
        pitchMin -= (1 - (event.offsetY / this.spectrogramCanvas.nativeElement.height)) * deltaPitchRange
      } else {
        pitchMin += pitchRange * (deltaY / 800)
      }

      pitchMin = clamp(pitchMin, 16, 136 - pitchRange)
      this.pitchMin = pitchMin
      this.pitchMax = pitchMin + pitchRange
      this.pitchMinChange.emit(this.pitchMin)
      this.pitchMaxChange.emit(this.pitchMax)
    }
    if (deltaX) {
      // TODO
      // this.audioVizScale += deltaX / 2

      // this.audioVizScale = clamp(this.audioVizScale, 2, 1000)
    }
  }


  async drawAudioViz() {
    const start = performance.now()
    if (this.spectrogram && this.spectrogramCanvas) {
      const waveCanvas = this.spectrogramCanvas.nativeElement;
      waveCanvas.width = Math.floor(waveCanvas.parentElement!.clientWidth)
      waveCanvas.height = Math.floor(waveCanvas.parentElement!.clientHeight)
      const waveCanvasCtx = waveCanvas.getContext('2d')!

      const rendered = this.spectrogram.render(
        waveCanvas.width / this.timeStep, waveCanvas.height,
        this.pitchMin, this.pitchMax,
        0, waveCanvas.width * this.audioVizScale,
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
