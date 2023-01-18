import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import * as lodash from 'lodash-es';
import { AudioSamples, doScrollZoom } from '../common';

@Component({
  selector: 'app-audio-waveform',
  templateUrl: './audio-waveform.component.html',
  styleUrls: ['./audio-waveform.component.css']
})
export class AudioWaveformComponent implements OnChanges, AfterViewInit {
  @ViewChild('waveform_canvas') waveformCanvas?: ElementRef<HTMLCanvasElement>
  @Input() timeMin: number = 0;
  @Input() timeMax: number = 30;
  @Output() timeMinChange = new EventEmitter<number>()
  @Output() timeMaxChange = new EventEmitter<number>()
  @Input() audioData?: AudioSamples

  onWheel(event: WheelEvent) {
    if (!this.waveformCanvas) {
      console.log("scroll event before view rendered???");
      return
    }
    const waveCanvas = this.waveformCanvas.nativeElement;
    event.preventDefault()
    // TODO: scroll pixel/line/page ???

    const zoomRate = 1 / 400
    const timeScrollRate = zoomRate / 4;
    const delta = event.deltaX + event.deltaY
    const timeClampMax = this.audioData ? this.audioData.samples.length / this.audioData.sampleRate : 30

    if (delta) {
      doScrollZoom(
        this, 'timeMin', 'timeMax',
        0, timeClampMax, 1 / 4, zoomRate, timeScrollRate,
        delta, event.ctrlKey, event.offsetX / waveCanvas.width)
      this.timeMinChange.emit(this.timeMin)
      this.timeMaxChange.emit(this.timeMax)
    }
  }
  drawAudioViz(): void {
    // FIXME: 1 sample / pixel doesn't render correctly
    if (this.audioData && this.waveformCanvas) {
      const waveCanvas = this.waveformCanvas.nativeElement;
      waveCanvas.width = waveCanvas.parentElement!.clientWidth
      waveCanvas.height = waveCanvas.parentElement!.clientHeight
      const waveCanvasCtx = waveCanvas.getContext('2d')!
      const samples = this.audioData.samples

      const timeRange = this.timeMax - this.timeMin
      const samplesPerPixel = timeRange * this.audioData.sampleRate / waveCanvas.width

      waveCanvasCtx.save()
      waveCanvasCtx.lineWidth = 1
      waveCanvasCtx.translate(0.5, waveCanvas.height / 2 + 0.5)
      waveCanvasCtx.beginPath()
      waveCanvasCtx.moveTo(0, 0)
      waveCanvasCtx.lineTo(samples.length / samplesPerPixel, 0) // TODO: hack
      waveCanvasCtx.stroke()
      waveCanvasCtx.scale(1, -waveCanvas.height / 2.2)
      waveCanvasCtx.beginPath()
      for (let x = 0; x < waveCanvas.width; x++) {
        const chunkSampleStart = x * samplesPerPixel + this.timeMin * this.audioData.sampleRate
        const chunk = samples.subarray(Math.round(chunkSampleStart), Math.round(chunkSampleStart + samplesPerPixel))

        const low = lodash.min(chunk)!
        const high = lodash.max(chunk)!
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
