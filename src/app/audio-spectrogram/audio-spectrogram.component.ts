import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import Color from 'colorjs.io';
import { fromWorker } from 'observable-webworker';
import * as rxjs from 'rxjs';
import { AudioSamples, SpectrogramWork } from '../common';
import * as wasm_module from '../../../wasm/pkg';

@Component({
  selector: 'app-audio-spectrogram',
  templateUrl: './audio-spectrogram.component.html',
  styleUrls: ['./audio-spectrogram.component.css']
})
export class AudioSpectrogramComponent implements OnChanges, AfterViewInit {
  @ViewChild('spectrogram_canvas') spectrogramCanvas?: ElementRef<HTMLCanvasElement>
  @Input() timeStep: number = 1200
  @Input() fftLgWindowSize: number = 14
  get fftWindowSize(): number { return 2 ** this.fftLgWindowSize }
  /** samples per pixel */
  @Input() audioVizScale: number = 400; // TODO: change to seconds per pixel
  @Input() freqMin: number = 20;
  @Input() freqMax: number = 20000;
  #audioData?: AudioSamples
  #spectrogram?: wasm_module.SpectrogramRenderer
  get audioData(): AudioSamples | undefined { return this.#audioData }
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

  async drawAudioViz() {
    const start = performance.now()
    if (this.spectrogram && this.spectrogramCanvas) {
      const waveCanvas = this.spectrogramCanvas.nativeElement;
      waveCanvas.width = Math.floor(waveCanvas.parentElement!.clientWidth)
      waveCanvas.height = Math.floor(waveCanvas.parentElement!.clientHeight)
      const waveCanvasCtx = waveCanvas.getContext('2d')!

      const rendered = this.spectrogram.render(
        waveCanvas.width / 8, waveCanvas.height,
        this.freqMin, this.freqMax,
        0, waveCanvas.width * this.audioVizScale,
        -80, -20,
      )

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
