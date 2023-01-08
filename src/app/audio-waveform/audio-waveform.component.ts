import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import * as lodash from 'lodash';

type AudioData = { sampleRate: number, channelData: ReadonlyArray<Float32Array> }

@Component({
  selector: 'app-audio-waveform',
  templateUrl: './audio-waveform.component.html',
  styleUrls: ['./audio-waveform.component.css']
})
export class AudioWaveformComponent implements OnChanges, AfterViewInit {
  @ViewChild('waveform_canvas') waveformCanvas?: ElementRef<HTMLCanvasElement>
  /** samples per pixel */
  @Input() audioVizScale: number = 400; // TODO: change to seconds per pixel
  @Input() audioWavData?: AudioData

  drawAudioViz(): void {
    if (this.audioWavData && this.waveformCanvas) {
      const waveCanvas = this.waveformCanvas.nativeElement;
      waveCanvas.width = waveCanvas.parentElement!.clientWidth
      const waveCanvasCtx = waveCanvas.getContext('2d')!

      const samplesL = this.audioWavData.channelData[0]
      const samplesR = this.audioWavData.channelData[1]

      const tmp = new Float32Array(this.audioVizScale)
      waveCanvasCtx.save()
      waveCanvasCtx.lineWidth = 1
      waveCanvasCtx.translate(0.5, waveCanvas.height / 2 + 0.5)
      waveCanvasCtx.beginPath()
      waveCanvasCtx.moveTo(0, 0)
      waveCanvasCtx.lineTo(samplesL.length / this.audioVizScale, 0)
      waveCanvasCtx.stroke()
      waveCanvasCtx.scale(1, -waveCanvas.height / 2.2)
      waveCanvasCtx.beginPath()
      for (let x = 0; x < Math.floor(samplesL.length / this.audioVizScale); x++) {
        for (let i = 0; i < tmp.length; i++) {
          tmp[i] = (samplesL[i + x * this.audioVizScale] + samplesR[i + x * this.audioVizScale]) / 2
        }

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
    console.log(changes);
    window.requestAnimationFrame(() => this.drawAudioViz())
  }
  ngAfterViewInit(): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
  }

}
