import { Component, NgZone } from '@angular/core';
import { AudioSamples } from './common';
import { loadAudio } from './load-audio';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  constructor(private ngZone: NgZone) { }
  audioContext: AudioContext = new AudioContext()

  title = 'vigilant-lamp'
  secCtx = window.isSecureContext
  coi = window.crossOriginIsolated
  hwCcur = navigator.hardwareConcurrency

  specPitchMin: number = 12
  specPitchMax: number = 108
  vizTimeMin: number = 0
  vizTimeMax: number = 30
  specDbMin: number = -60
  specDbMax: number = -20
  specLgWindowSize: number = 12
  specTimeStepInput: number = 3
  specLgExtraPad: number = 0
  get specTimeStep(): number { return 2 ** (5 - this.specTimeStepInput) }
  audioFile?: AudioBuffer
  audioData?: AudioSamples
  audioBufSrcNode?: AudioBufferSourceNode | null

  async onFileSelected(event: Event) {
    const fileInput = event.target as HTMLInputElement
    if (fileInput.files?.length) {
      const loaded = await loadAudio(fileInput.files[0], this.audioContext.sampleRate)
      this.audioFile = loaded.audioBuffer
      this.audioData = loaded.audioData
      this.vizTimeMin = 0
      this.vizTimeMax = this.audioData.samples.length / this.audioData.sampleRate
    }
  }

  startPlayback() {
    if (!this.audioFile) {
      return
    }
    if (this.audioBufSrcNode) {
      this.stopPlayback()
    }
    this.audioBufSrcNode = new AudioBufferSourceNode(this.audioContext, { buffer: this.audioFile })
    // WebAudio callbacks don't trigger change detection (yet)
    this.audioBufSrcNode.onended = () => this.ngZone.run(() => this.stopPlayback())
    this.audioBufSrcNode.connect(this.audioContext.destination)
    this.audioBufSrcNode.start()
  }
  stopPlayback() {
    if (this.audioBufSrcNode) {
      this.audioBufSrcNode.onended = null
      this.audioBufSrcNode.stop()
      this.audioBufSrcNode = undefined
    }
  }
}
