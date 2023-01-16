import { Component, NgZone } from '@angular/core';
import * as lodash from 'lodash-es';
// @ts-ignore
import * as wav from 'wav-decoder';
import { AudioSamples } from './common';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  constructor(private ngZone: NgZone) { }

  title = 'vigilant-lamp'
  coi = window.crossOriginIsolated

  audioData?: AudioSamples
  specPitchMin: number = 16
  specPitchMax: number = 136
  vizTimeMin: number = 0
  vizTimeMax: number = 30
  specDbMin: number = -80
  specDbMax: number = -20
  specLgWindowSize: number = 12
  specTimeStepInput: number = 8
  get specTimeStep(): number { return 16 - this.specTimeStepInput }
  audioContext?: AudioContext
  audioFile?: ArrayBuffer | AudioBuffer
  audioBufSrcNode?: AudioBufferSourceNode | null

  onFileSelected(event: Event) {
    const fileInput = event.target as HTMLInputElement
    if (fileInput.files?.length) {
      const reader = new FileReader()
      reader.onload = async (e) => {
        this.audioFile = e.target!.result as ArrayBuffer
        const audioWavData = await wav.decode(this.audioFile) // TODO: accept more file types
        this.audioData = await new Promise((resolve) => {
          const samples = lodash.unzipWith(audioWavData.channelData, (...ss) => lodash.mean(ss))
          // TODO: allow picking one channel
          resolve({ sampleRate: audioWavData.sampleRate, samples: Float32Array.from(samples) })
        })
        this.vizTimeMin = 0
        this.vizTimeMax = this.audioData.samples.length / this.audioData.sampleRate
      }
      reader.readAsArrayBuffer(fileInput.files[0])
    }
  }

  async startPlayback() {
    if (!this.audioFile) {
      return
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext()
    }
    if (this.audioFile instanceof ArrayBuffer) {
      this.audioFile = await this.audioContext.decodeAudioData(this.audioFile)
    }
    if (this.audioBufSrcNode) {
      this.stopPlayback()
    }
    this.audioBufSrcNode = new AudioBufferSourceNode(this.audioContext, { buffer: this.audioFile })
    // WebAudio callbacks don't trigger change detection (yet)
    this.audioBufSrcNode.onended = () => this.ngZone.run(() => this.stopPlayback())
    this.audioBufSrcNode.connect(this.audioContext.destination)
    this.audioBufSrcNode.start(0)
  }
  stopPlayback() {
    if (this.audioBufSrcNode) {
      this.audioBufSrcNode.onended = null
      this.audioBufSrcNode.stop()
      this.audioBufSrcNode = undefined
    }
  }
}
