import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import Color from 'colorjs.io';
import { fromWorker } from 'observable-webworker';
import * as rxjs from 'rxjs';
import { AudioSamples, SpectrogramWork } from '../common';

const colormap = Color.range('#440154', '#fde725', { outputSpace: 'sRGB' })
const colormapArr = Array.from({ length: 101 }, (_x, i) => Array.from((colormap(i / 100) as unknown as Color).srgb))
const powerToColor = (x: number) => colormapArr[Math.min(Math.max(0, Math.round(100 + 20 * Math.log10(x))), 100)]

@Component({
  selector: 'app-audio-spectrogram',
  templateUrl: './audio-spectrogram.component.html',
  styleUrls: ['./audio-spectrogram.component.css']
})
export class AudioSpectrogramComponent implements OnChanges, AfterViewInit {
  @ViewChild('spectrogram_canvas') spectrogramCanvas?: ElementRef<HTMLCanvasElement>
  @Input() timeStep: number = 1200
  @Input() fftLgWindowSize: number = 15
  get fftWindowSize(): number { return 2 ** this.fftLgWindowSize }
  /** samples per pixel */
  @Input() audioVizScale: number = 400; // TODO: change to seconds per pixel
  #audioData?: AudioSamples
  #spectrogram?: Float32Array[]
  get audioData(): AudioSamples | undefined { return this.#audioData }
  @Input() set audioData(x: AudioSamples | undefined) {
    this.#audioData = x
    this.#spectrogram = undefined
  }
  get spectrogram(): Promise<ReadonlyArray<Float32Array> | undefined> {
    if (this.#spectrogram) return Promise.resolve(this.#spectrogram)
    if (!this.audioData) return Promise.resolve(undefined)
    const work: SpectrogramWork = {
      timeStep: this.timeStep,
      audioSamples: Float32Array.from(this.audioData.samples),
      fftWindowSize: this.fftWindowSize,
      gausWindowSigma: 0.2,
    }
    console.log('submit work', work);
    return rxjs.firstValueFrom(fromWorker<SpectrogramWork, Float32Array[]>(
      () => new Worker(new URL('./spectrogram.worker', import.meta.url)),
      rxjs.of(work),
      (input) => [input.audioSamples.buffer],
    )).then((spec) => {
      this.#spectrogram = spec;
      return spec
    })
  }

  async drawAudioViz() {
    const start = performance.now()
    const spectrogram = await this.spectrogram
    if (spectrogram && this.spectrogramCanvas) {
      const waveCanvas = this.spectrogramCanvas.nativeElement;
      waveCanvas.width = Math.floor(waveCanvas.parentElement!.clientWidth)
      waveCanvas.height = Math.floor(waveCanvas.parentElement!.clientHeight)
      const waveCanvasCtx = waveCanvas.getContext('2d')!

      const logRenderFreqMin = Math.log(20)
      const logRenderFreqMax = Math.log(this.audioData!.sampleRate / 2)

      const specFreqMax = this.audioData!.sampleRate / 2
      const renderYMax = waveCanvas.height
      const logBkScale = Math.log(specFreqMax / (this.fftWindowSize / 2))
      const bucket_add = logBkScale - logRenderFreqMin
      const bucket_mul = renderYMax / (logRenderFreqMax - logRenderFreqMin)
      const bucketToY = (bucket: number): number => (Math.log(bucket) + bucket_add) * bucket_mul
      const bucketYSize = (bucket: number): number => (Math.log(bucket + 1) - Math.log(bucket)) * bucket_mul

      const image = new ImageData(waveCanvas.width, waveCanvas.height)
      const setPixel = (x: number, y: number, color: number[]) => {
        y = image.height - y
        const start = y * (image.width * 4) + x * 4
        image.data[start + 0] = color[0] * 255
        image.data[start + 1] = color[1] * 255
        image.data[start + 2] = color[2] * 255
        image.data[start + 3] = 255
      }

      for (let x = 0; x < Math.min(image.width, spectrogram.length * this.timeStep / this.audioVizScale); x++) {
        let spec_x = spectrogram[Math.round((x * this.audioVizScale / this.timeStep))]
        if (!spec_x) continue
        for (let y = 0; y < image.height; y++) {
          const yLogFreq = ((y / image.height) * (logRenderFreqMax - logRenderFreqMin)) + logRenderFreqMin
          const bucket = Math.exp(yLogFreq) * ((this.fftWindowSize / 2) / specFreqMax)
          setPixel(x, y, powerToColor(spec_x[Math.round(bucket)]))
        }
      }

      waveCanvasCtx.putImageData(image, 0, 0)
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
