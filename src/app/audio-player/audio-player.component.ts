import { Component, EventEmitter, Input, NgZone, Output } from '@angular/core';
import * as Mousetrap from 'mousetrap';
import { Subscription, animationFrames } from 'rxjs';
import { AudioContextService } from '../services/audio-context.service';

@Component({
  selector: 'app-audio-player',
  templateUrl: './audio-player.component.html',
})
export class AudioPlayerComponent {
  constructor(private ngZone: NgZone, private audioContextSvc: AudioContextService) {
    Mousetrap.bind("space", () => { ngZone.run(() => this.playPauseClicked()); return false; })
    const gainNode = this.audioContext.createGain()
    gainNode.connect(this.audioContext.destination)
    this.audioOutput = gainNode;
  }

  get audioContext() { return this.audioContextSvc.audioContext }
  audioOutput: GainNode;
  @Input() audioBuffer?: AudioBuffer;
  /** defined iff currently playing */
  audioBufSrcNode?: AudioBufferSourceNode;
  get isPlaying(): boolean { return !!this.audioBufSrcNode; }

  #playheadPos: number = 0;
  get internalPlayheadPos(): number { return this.#playheadPos }
  set internalPlayheadPos(v: number) {
    this.#playheadPos = v;
    this.playheadPosChange.emit(this.#playheadPos);
  }
  @Input() set playheadPos(v: number) {
    // exact fp equality: don't restart if this was a change initiated by us
    if (v === this.#playheadPos) return;
    this.#playheadPos = v;
    if (this.isPlaying) {
      this.stopPlayback()
      this.startPlayback()
    }
  }
  @Output() playheadPosChange = new EventEmitter<number>();
  playbackStartTime: number = 0;
  playheadUpdateSub?: Subscription;

  playPauseClicked() {
    if (this.isPlaying) {
      // pause
      this.internalPlayheadPos = this.audioContext.currentTime - this.playbackStartTime
      this.stopPlayback()
    } else {
      // play
      this.startPlayback()
    }
  }
  stopClicked() {
    this.internalPlayheadPos = 0;
    this.stopPlayback()
  }

  startPlayback() {
    if (!this.audioBuffer) return;
    this.audioBufSrcNode = new AudioBufferSourceNode(this.audioContext, { buffer: this.audioBuffer })
    // zone.js doesn't support WebAudio (https://github.com/angular/angular/issues/31736)
    this.audioBufSrcNode.onended = () => this.ngZone.run(() => this.stopClicked())
    this.audioBufSrcNode.connect(this.audioOutput)
    this.playbackStartTime = this.audioContext.currentTime
    this.audioBufSrcNode.start(this.playbackStartTime, this.internalPlayheadPos)
    this.playbackStartTime -= this.internalPlayheadPos
    this.playheadUpdateSub = animationFrames().subscribe((_x) => {
      this.internalPlayheadPos = this.audioContext.currentTime - this.playbackStartTime
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

  savedVolumePct: number = 100;
  #volumePct: number = 100;
  get volumePct(): number { return this.#volumePct; }
  set volumePct(v: number) {
    this.#volumePct = v;
    // https://www.dr-lex.be/info-stuff/volumecontrols.html
    const amplitude = 1e-2 * Math.exp(Math.LN10 * 2e-2 * Math.max(v, 10)) * Math.min(v / 10, 1);
    this.audioOutput.gain.linearRampToValueAtTime(amplitude, this.audioContext.currentTime + 0.01);
  }
  get muted(): boolean { return this.volumePct === 0 }

  onVolumeChange() {
    if (this.volumePct !== 0) this.savedVolumePct = this.volumePct;
  }

  muteClicked() {
    if (this.muted) {
      this.volumePct = this.savedVolumePct
    } else {
      this.savedVolumePct = this.volumePct
      this.volumePct = 0
    }
  }
}
