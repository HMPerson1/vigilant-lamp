import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import * as wasm_module from '../../../wasm/pkg';
import { AudioSamples } from '../common';
import { doScrollZoomTime } from '../ui-common';

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
  #audioData?: AudioSamples;
  #wasmAudioBuffer?: wasm_module.AudioBuffer;
  get audioData(): AudioSamples | undefined { return this.#audioData; }
  @Input() set audioData(v: AudioSamples | undefined) {
    this.#audioData = v;
    if (v) {
      this.#wasmAudioBuffer?.free();
      this.#wasmAudioBuffer = new wasm_module.AudioBuffer(v.samples, v.sampleRate);
    } else {
      this.#wasmAudioBuffer = undefined;
    }
  }


  onWheel(event: WheelEvent) {
    if (!this.waveformCanvas) {
      console.error("scroll event before view rendered???");
      return
    }
    const waveCanvas = this.waveformCanvas.nativeElement;
    event.preventDefault()
    // TODO: scroll pixel/line/page ???

    const delta = event.deltaX + event.deltaY
    if (delta) {
      doScrollZoomTime(
        this, 'timeMin', 'timeMax', this.audioData?.timeLen,
        delta, event.ctrlKey, event.offsetX / waveCanvas.width
      )
      this.timeMinChange.emit(this.timeMin)
      this.timeMaxChange.emit(this.timeMax)
    }
  }
  drawAudioViz(): void {
    if (this.#wasmAudioBuffer && this.waveformCanvas) {
      const waveCanvas = this.waveformCanvas.nativeElement;
      waveCanvas.width = waveCanvas.parentElement!.clientWidth
      waveCanvas.height = waveCanvas.parentElement!.clientHeight
      const waveCanvasCtx = waveCanvas.getContext('2d')!

      const imageData = wasm_module.render_waveform(this.#wasmAudioBuffer, this.timeMin, this.timeMax, waveCanvas.width, waveCanvas.height);
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
