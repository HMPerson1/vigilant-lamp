import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
// @ts-ignore
import * as ft from 'fourier-transform/asm'
import * as lodash from 'lodash';
import Color from 'colorjs.io'
import { AudioData, genGaussianWindow } from '../common';

@Component({
  selector: 'app-audio-spectrogram',
  templateUrl: './audio-spectrogram.component.html',
  styleUrls: ['./audio-spectrogram.component.css']
})
export class AudioSpectrogramComponent implements OnChanges, AfterViewInit {
  @ViewChild('spectrogram_canvas') spectrogramCanvas?: ElementRef<HTMLCanvasElement>
  /** samples per pixel */
  @Input() audioVizScale: number = 400; // TODO: change to seconds per pixel
  @Input() audioData?: AudioData

  drawAudioViz(): void {
    if (this.audioData && this.spectrogramCanvas) {
      const waveCanvas = this.spectrogramCanvas.nativeElement;
      waveCanvas.width = waveCanvas.parentElement!.clientWidth
      const waveCanvasCtx = waveCanvas.getContext('2d')!
      const samples = this.audioData.samples

      const timeStep = 12000
      const fftWindowSize = 2**12
      const window = genGaussianWindow(fftWindowSize, fftWindowSize / 8)
      const colormap = Color.range('#440154','#fde725', { outputSpace: 'sRGB' })
      const gainToColor = (x: number) => {
        x = (100 + 20 * Math.log10(x))/100
        return colormap(Math.max(0, x))
      }

      const tmp = new Float32Array(fftWindowSize)
      waveCanvasCtx.save()
      waveCanvasCtx.translate(0, waveCanvas.height)
      waveCanvasCtx.scale(1 / (this.audioVizScale), -fftWindowSize / (2 * waveCanvas.height))
      waveCanvasCtx.fillStyle = 'red'
      for (let t = 0; t + fftWindowSize < samples.length; t += timeStep) {
        tmp.set(samples.subarray(t, t + fftWindowSize))
        for (let i = 0; i < tmp.length; i++) {
          tmp[i] *= window[i]
        }
        const spec = ft(tmp) as Array<number>

        for (let y = 0; y < spec.length; y++) {
          const power = spec[y];
          waveCanvasCtx.fillStyle = gainToColor(power).toString()
          waveCanvasCtx.fillRect(t, y, timeStep, 1)
        }
      }
      waveCanvasCtx.restore()
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
  }
  ngAfterViewInit(): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
  }
}
