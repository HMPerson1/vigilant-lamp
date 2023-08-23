import { Component, EventEmitter, Input, NgZone, Output } from '@angular/core';
import * as Mousetrap from 'mousetrap';
import { Subscription, animationFrames } from 'rxjs';
import { AudioContextService } from '../audio-context.service';

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
    if (this.audioBufSrcNode) {
      this.stopPlayback()
      this.startPlayback()
    }
  }
  @Output() playheadPosChange = new EventEmitter<number>();
  playbackStartTime: number = 0;
  playheadUpdateSub?: Subscription;

  playPauseClicked() {
    if (!this.audioBuffer) {
      return
    }
    if (this.audioBufSrcNode) {
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
    this.audioBufSrcNode = new AudioBufferSourceNode(this.audioContext, { buffer: this.audioBuffer })
    // WebAudio callbacks don't trigger change detection (yet)
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
    this.audioOutput.gain.linearRampToValueAtTime(this.volumePct / 100, this.audioContext.currentTime + 0.01)
  }
  get muted(): boolean { return this.volumePct == 0 };

  muteClicked() {
    if (this.muted) {
      this.volumePct = this.savedVolumePct
    } else {
      this.savedVolumePct = this.volumePct
      this.volumePct = 0
    }
  }
}
