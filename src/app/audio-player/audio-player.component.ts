import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { MatTooltip } from '@angular/material/tooltip';
import * as Mousetrap from 'mousetrap';
import { animationFrames, Subscription } from 'rxjs';
import { AudioContextService } from '../services/audio-context.service';

@Component({
  selector: 'app-audio-player',
  templateUrl: './audio-player.component.html',
  imports: [MatIconButton, MatTooltip, MatIcon, MatSlider, MatSliderThumb, FormField]
})
export class AudioPlayerComponent {
  public readonly audioBuffer = input<AudioBuffer | undefined>();
  public readonly playheadPos = signal(0);
  public seekPlayhead(v: number) {
    this.playheadPos.set(v);
    if (this.isPlaying()) {
      this.stopPlayback()
      this.startPlayback()
    }
  }

  constructor() {
    Mousetrap.bind("space", () => { this.playPauseClicked(); return false; })
    const gainNode = this.#audioContext.createGain()
    gainNode.connect(this.#audioContext.destination)
    this.#audioOutput = gainNode;

    effect(() => {
      const v = this.#volumePct();
      // https://www.dr-lex.be/info-stuff/volumecontrols.html
      const amplitude = 1e-2 * Math.exp(Math.LN10 * 2e-2 * Math.max(v, 10)) * Math.min(v / 10, 1);
      gainNode.gain.linearRampToValueAtTime(amplitude, this.#audioContext.currentTime + 0.01);
    });
  }

  readonly #audioContext = inject(AudioContextService).audioContext;
  readonly #audioOutput: GainNode;

  /** defined iff currently playing */
  readonly #playbackState = signal<PlaybackState | undefined>(undefined);
  isPlaying(): boolean { return !!this.#playbackState(); }

  playPauseClicked() {
    const playbackState = this.#playbackState();
    if (playbackState !== undefined) {
      // pause
      this.playheadPos.set(this.#audioContext.currentTime - (playbackState.startTime - playbackState.startOffset))
      this.stopPlayback()
    } else {
      // play
      this.startPlayback()
    }
  }
  stopClicked() {
    this.playheadPos.set(0)
    this.stopPlayback()
  }

  startPlayback() {
    const audioBuffer = this.audioBuffer();
    if (!audioBuffer) return;
    const bufferAudioNode = new AudioBufferSourceNode(this.#audioContext, { buffer: audioBuffer })
    bufferAudioNode.onended = () => this.stopClicked()
    bufferAudioNode.connect(this.#audioOutput)
    const startTime = this.#audioContext.currentTime;
    const startOffset = this.playheadPos();
    bufferAudioNode.start(startTime, startOffset);

    const playheadUpdateSub = animationFrames().subscribe(() => {
      const ctxtOutputTs = this.#audioContext.getOutputTimestamp();
      if (ctxtOutputTs.performanceTime === 0) return; // if the audio context has not yet started
      const contextTime = (performance.now() - ctxtOutputTs.performanceTime!) / 1000 + ctxtOutputTs.contextTime!;
      this.playheadPos.set(Math.max(0, contextTime - startTime) + startOffset);
    });

    this.#playbackState.set({ bufferAudioNode, startTime, startOffset, playheadUpdateSub });
  }
  stopPlayback() {
    const playbackState = this.#playbackState();
    if (playbackState !== undefined) {
      this.#playbackState.set(undefined);
      playbackState.bufferAudioNode.onended = null;
      playbackState.bufferAudioNode.stop();
      playbackState.playheadUpdateSub.unsubscribe();
    }
  }

  #savedVolumePct: number = 100;
  #volumePct = signal(100);
  volumePctForm = form(this.#volumePct);
  readonly muted = computed(() => this.#volumePct() === 0);

  muteClicked() {
    if (this.muted()) {
      this.#volumePct.set(this.#savedVolumePct !== 0 ? this.#savedVolumePct : 1);
      this.#savedVolumePct = 0;
    } else {
      this.#savedVolumePct = this.#volumePct();
      this.#volumePct.set(0);
    }
  }
}

type PlaybackState = {
  bufferAudioNode: AudioBufferSourceNode,
  playheadUpdateSub: Subscription,
  startTime: number,
  startOffset: number,
}
