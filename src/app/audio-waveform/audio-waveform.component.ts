import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import * as wasm_module from '../../../wasm/pkg';
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
        0, timeClampMax, 1 / 1000, zoomRate, timeScrollRate,
        delta, event.ctrlKey, event.offsetX / waveCanvas.width)
      this.timeMinChange.emit(this.timeMin)
      this.timeMaxChange.emit(this.timeMax)
    }
  }
  drawAudioViz(): void {
    if (this.audioData && this.waveformCanvas) {
      const waveCanvas = this.waveformCanvas.nativeElement;
      waveCanvas.width = waveCanvas.parentElement!.clientWidth
      waveCanvas.height = waveCanvas.parentElement!.clientHeight
      const waveCanvasCtx = waveCanvas.getContext('2d')!

      // TODO(perf): copy audio into wasm once
      const wasmAudioBuffer = new wasm_module.AudioBuffer(this.audioData.samples, this.audioData.sampleRate);
      const imageData = wasm_module.render_waveform(wasmAudioBuffer, this.timeMin, this.timeMax, waveCanvas.width, waveCanvas.height);
      wasmAudioBuffer.free()
      waveCanvasCtx.putImageData(imageData, 0, 0);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
  }
  ngAfterViewInit(): void {
    window.requestAnimationFrame(() => this.drawAudioViz())
  }
}
