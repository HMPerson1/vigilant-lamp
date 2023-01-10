import { Component, ElementRef, NgZone, ViewChild } from '@angular/core';
import * as lodash from 'lodash';
import { ChangeDetectorRef } from '@angular/core';
// @ts-ignore
import * as wav from 'wav-decoder';
import { AudioData } from './common';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  constructor(private ngZone: NgZone) { }

  title = 'vigilant-lamp'
  coi = window.crossOriginIsolated

  audioData?: AudioData
  /** samples per pixel */
  audioVizScale: number = 400
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
