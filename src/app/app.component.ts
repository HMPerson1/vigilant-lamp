import { coerceNumberProperty } from '@angular/cdk/coercion';
import { Component, NgZone } from '@angular/core';
import { fileOpen } from 'browser-fs-access';
import * as lodash from 'lodash';
import * as Mousetrap from 'mousetrap';
import { animationFrames, Subscription } from 'rxjs';
import { AudioSamples } from './common';
import { loadAudio } from './load-audio';
import { PitchLabelType } from './ui-common';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  constructor(private ngZone: NgZone) {
    Mousetrap.bind("space", () => { ngZone.run(() => this.playPauseClicked()); return false; })
    const gainNode = this.audioContext.createGain()
    gainNode.connect(this.audioContext.destination)
    this.audioOutput = gainNode;
  }
  readonly TIME_STEP_INPUT_MAX = 5

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
  get specTimeStep(): number { return 2 ** (this.TIME_STEP_INPUT_MAX - this.specTimeStepInput) }
  specLgExtraPad: number = 0
  showPitchGrid: boolean = false;
  pitchLabelType: PitchLabelType = 'sharp';
  audioFile?: AudioBuffer
  audioData?: AudioSamples
  loading: boolean = false;

  // TODO: refactor into separate component
  audioContext: AudioContext = new AudioContext()
  savedVolumePct: number = 100;
  volumePct: number = 100;
  get muted(): boolean { return this.volumePct == 0 };
  audioOutput: GainNode;
  audioBufSrcNode?: AudioBufferSourceNode; // defined iff currently playing
  playbackStartTime: number = 0;
  playheadPos: number = 0;
  playheadUpdateSub?: Subscription;

  visCursorX?: number;
  showCrosshair: boolean = true;
  showOvertones: boolean = false;

  debug_downsample: number = 0;

  async onProjectNew(event: Event) {
    const fh = await fileOpen({ description: "Audio Files", mimeTypes: ["audio/*"], id: 'project-new-audio' })
    this.loading = true
    const loaded = await loadAudio(fh, this.audioContext.sampleRate)
    this.audioFile = loaded.audioBuffer
    this.audioData = loaded.audioData
    this.vizTimeMin = 0
    this.vizTimeMax = this.audioData.timeLen
    this.loading = false
  }

  onProjectLoad(event: Event) {
  }

  onProjectSave(event: Event, saveAs = false) {
  }

  muteClicked() {
    if (this.muted) {
      this.setVolume(this.savedVolumePct)
    } else {
      this.savedVolumePct = this.volumePct
      this.setVolume(0)
    }
  }
  setVolume(v: number) {
    this.volumePct = v
    this.audioOutput.gain.linearRampToValueAtTime(this.volumePct / 100, this.audioContext.currentTime + 0.01)
  }

  playPauseClicked() {
    if (!this.audioFile) {
      return
    }
    if (this.audioBufSrcNode) {
      // pause
      this.playheadPos = this.audioContext.currentTime - this.playbackStartTime
      this.stopPlayback()
    } else {
      // play
      this.startPlayback()
    }
  }
  stopClicked() {
    this.playheadPos = 0;
    this.stopPlayback()
  }
  startPlayback() {
    this.audioBufSrcNode = new AudioBufferSourceNode(this.audioContext, { buffer: this.audioFile })
    // WebAudio callbacks don't trigger change detection (yet)
    this.audioBufSrcNode.onended = () => this.ngZone.run(() => this.stopClicked())
    this.audioBufSrcNode.connect(this.audioOutput)
    this.playbackStartTime = this.audioContext.currentTime + 0.005
    this.audioBufSrcNode.start(this.playbackStartTime, this.playheadPos)
    this.playbackStartTime -= this.playheadPos
    this.playheadUpdateSub = animationFrames().subscribe((_x) => {
      this.playheadPos = this.audioContext.currentTime - this.playbackStartTime
    })
  }
  stopPlayback() {
    if (this.audioBufSrcNode) {
      this.audioBufSrcNode.onended = null
      this.audioBufSrcNode.stop()
      this.audioBufSrcNode = undefined
    }
    if (this.playheadUpdateSub) {
      this.playheadUpdateSub.unsubscribe()
      this.playheadUpdateSub = undefined
    }
  }

  onWaveformClick(event: MouseEvent) {
    if (!this.audioFile) return;
    event.preventDefault()

    const pos = event.offsetX / (event.target! as HTMLElement).clientWidth * (this.vizTimeMax - this.vizTimeMin) + this.vizTimeMin;
    this.playheadPos = lodash.clamp(pos, 0, this.audioFile.duration)
    if (this.audioBufSrcNode) {
      this.stopPlayback()
      this.startPlayback()
    }
  }

  evVal = (ev: Event) => coerceNumberProperty((ev.target! as HTMLInputElement).value)
}
