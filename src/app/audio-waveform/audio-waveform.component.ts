import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import * as lodash from 'lodash';
import { AudioSamples } from '../common';

@Component({
  selector: 'app-audio-waveform',
  templateUrl: './audio-waveform.component.html',
  styleUrls: ['./audio-waveform.component.css']
})
export class AudioWaveformComponent implements OnChanges, AfterViewInit {
  @ViewChild('waveform_canvas') waveformCanvas?: ElementRef<HTMLCanvasElement>
  /** samples per pixel */
  @Input() audioVizScale: number = 400; // TODO: change to seconds per pixel
  @Input() audioData?: AudioSamples

  drawAudioViz(): void {
    // FIXME: 1 sample / pixel doesn't render correctly
    if (this.audioData && this.waveformCanvas) {
      const waveCanvas = this.waveformCanvas.nativeElement;
      waveCanvas.width = waveCanvas.parentElement!.clientWidth
      const waveCanvasCtx = waveCanvas.getContext('2d')!
      const samples = this.audioData.samples

      const tmp = new Float32Array(this.audioVizScale)
      waveCanvasCtx.save()
      waveCanvasCtx.lineWidth = 1
      waveCanvasCtx.translate(0.5, waveCanvas.height / 2 + 0.5)
      waveCanvasCtx.beginPath()
      waveCanvasCtx.moveTo(0, 0)
      waveCanvasCtx.lineTo(samples.length / this.audioVizScale, 0) // TODO: hack
      waveCanvasCtx.stroke()
      waveCanvasCtx.scale(1, -waveCanvas.height / 2.2)
      waveCanvasCtx.beginPath()
      for (let x = 0; x < Math.ceil(samples.length / this.audioVizScale); x++) {
        const chunkSampleStart = x * this.audioVizScale
        tmp.set(samples.subarray(chunkSampleStart, chunkSampleStart + this.audioVizScale))

        const low = lodash.min(tmp)!
        const high = lodash.max(tmp)!
        waveCanvasCtx.moveTo(x, low)
        waveCanvasCtx.lineTo(x, high)
      }
      waveCanvasCtx.restore()
      waveCanvasCtx.stroke()
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
  }
  ngAfterViewInit(): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
  }
}
