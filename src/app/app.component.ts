import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
// @ts-ignore
import * as wav from 'wav-decoder';
import * as lodash from 'lodash';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements AfterViewInit {
  title = 'vigilant-lamp'
  coi = window.crossOriginIsolated
  @ViewChild('spectrogram_canvas') spectrogramCanvas!: ElementRef<HTMLCanvasElement>
  @ViewChild('waveform_canvas') waveformCanvas!: ElementRef<HTMLCanvasElement>
  audioWavData?: { sampleRate: number, channelData: ReadonlyArray<Float32Array> };
  /** samples per pixel */
  audioVizScale: number = 400;

  ngAfterViewInit(): void {
  }

  drawAudioViz(): void {
    // TODO: put this in a component with change detection hooks
    if (this.audioWavData) {
      const specCanvas = this.spectrogramCanvas.nativeElement;
      specCanvas.width = specCanvas.parentElement!.clientWidth
      const specCanvasCtx = specCanvas.getContext('2d')!
      specCanvasCtx.fillRect(10, 10, specCanvas.width - 20, 30)

      const waveCanvas = this.waveformCanvas.nativeElement;
      waveCanvas.width = waveCanvas.parentElement!.clientWidth
      const waveCanvasCtx = waveCanvas.getContext('2d')!
      
      const samplesL = this.audioWavData.channelData[0]
      const samplesR = this.audioWavData.channelData[1]

      const tmp = new Float32Array(this.audioVizScale)
      waveCanvasCtx.save()
      waveCanvasCtx.lineWidth = 1
      waveCanvasCtx.translate(0.5, waveCanvas.height/2 + 0.5)
      waveCanvasCtx.beginPath()
      waveCanvasCtx.moveTo(0,0)
      waveCanvasCtx.lineTo(samplesL.length / this.audioVizScale,0)
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
      waveCanvasCtx.stroke()
    }
  }

  onFileSelected(event: Event) {
    const fileInput = event.target as HTMLInputElement
    const reader = new FileReader()
    reader.onload = async (e) => {
      this.audioWavData = await wav.decode(e.target!.result as Buffer)
      console.log(this.audioWavData!.channelData.length);
      console.log(this.audioWavData!.channelData[0].length);
      window.requestAnimationFrame(() => this.drawAudioViz())
    }
    reader.readAsArrayBuffer(fileInput.files![0])
  }
}
