import { Component, NgZone } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { supported as browserFsApiSupported, fileOpen, fileSave } from 'browser-fs-access';
import * as lodash from 'lodash-es';
import * as Mousetrap from 'mousetrap';
import { Subscription, animationFrames } from 'rxjs';
import { AudioSamples, audioSamplesDuration } from './common';
import { downsampleAudio, loadAudio } from './load-audio';
import { ProjectSettingsDialogComponent } from './project-settings-dialog/project-settings-dialog.component';
import { ProjectService } from './project.service';
import { PitchLabelType } from './ui-common';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  constructor(private ngZone: NgZone, private dialog: MatDialog, private project: ProjectService) {
    Mousetrap.bind("space", () => { ngZone.run(() => this.playPauseClicked()); return false; })
    const gainNode = this.audioContext.createGain()
    gainNode.connect(this.audioContext.destination)
    this.audioOutput = gainNode;
  }
  readonly TIME_STEP_INPUT_MAX = 5

  readonly title = 'vigilant-lamp'
  readonly secCtx = window.isSecureContext
  readonly coi = window.crossOriginIsolated
  readonly hwCcur = navigator.hardwareConcurrency
  readonly browserFsApiSupported = browserFsApiSupported

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

  projectFileHandle?: FileSystemFileHandle;
  get hasProject(): boolean { return !!this.project.project }
  get audioData(): AudioSamples | undefined { return this.project.project?.audio }
  audioBuffer?: AudioBuffer;
  loading: boolean = false;

  // TODO: refactor into separate component
  audioContext: AudioContext = new AudioContext()
  audioOutput: GainNode;
  savedVolumePct: number = 100;
  #volumePct: number = 100;
  get volumePct(): number { return this.#volumePct; }
  set volumePct(v: number) {
    this.#volumePct = v;
    this.audioOutput.gain.linearRampToValueAtTime(this.volumePct / 100, this.audioContext.currentTime + 0.01)
  }
  get muted(): boolean { return this.volumePct == 0 };
  audioBufSrcNode?: AudioBufferSourceNode; // defined iff currently playing
  playbackStartTime: number = 0;
  playheadPos: number = 0;
  playheadUpdateSub?: Subscription;

  visCursorX?: number;
  showCrosshair: boolean = true;
  showOvertones: boolean = false;

  debug_downsample: number = 0;

  async newProject() {
    // TODO: track if modified; warn if losing data
    this.loading = true
    try {
      const fh = await fileOpen({ description: "Audio Files", mimeTypes: ["audio/*"], id: 'project-new-audio' })
      const audioFile = new Uint8Array(await fh.arrayBuffer());
      this.audioBuffer = await loadAudio(audioFile.slice().buffer, this.audioContext.sampleRate)
      const audioData = await downsampleAudio(this.audioBuffer, this.audioContext.sampleRate)
      this.project.newProject(audioFile, audioData)
      this.projectFileHandle = undefined;
      this.vizTimeMin = 0
      this.vizTimeMax = this.audioBuffer.duration
    } catch (e) {
      // TODO: show toast
      console.log(e);
    }
    this.loading = false
  }

  async loadProject() {
    this.loading = true
    try {
      const projectFile = await fileOpen({ description: "Vigilant Lamp files", extensions: [".vtlamp"], id: 'project' })
      this.projectFileHandle = projectFile.handle
      await this.project.fromBlob(projectFile)
      this.vizTimeMin = 0
      this.vizTimeMax = audioSamplesDuration(this.project.project!.audio)
      this.audioBuffer = await loadAudio(this.project.project!.audioFile.slice().buffer, this.audioContext.sampleRate)
    } catch (e) {
      // TODO: show toast
      console.log(e);
    }
    this.loading = false
  }

  async saveProject(saveAs = false) {
    try {
      this.projectFileHandle = await fileSave(
        this.project.intoBlob(),
        { description: "Vigilant Lamp file", extensions: [".vtlamp"], id: 'project' },
        saveAs ? null : this.projectFileHandle,
      ) || undefined
    } catch (e) {
      // TODO: show toast
      console.log(e);
      alert("TODO: error saving");
    }
  }

  openSettings() {
    if (!this.project.project) return;
    const dialogRef = this.dialog.open(ProjectSettingsDialogComponent);
    dialogRef.afterClosed().subscribe((v) => console.log("dialog closed:", v));
  }

  muteClicked() {
    if (this.muted) {
      this.volumePct = this.savedVolumePct
    } else {
      this.savedVolumePct = this.volumePct
      this.volumePct = 0
    }
  }

  playPauseClicked() {
    if (!this.audioBuffer) {
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
    this.audioBufSrcNode = new AudioBufferSourceNode(this.audioContext, { buffer: this.audioBuffer })
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
    if (!this.audioBuffer) return;
    event.preventDefault()

    const pos = event.offsetX / (event.target! as HTMLElement).clientWidth * (this.vizTimeMax - this.vizTimeMin) + this.vizTimeMin;
    this.playheadPos = lodash.clamp(pos, 0, this.audioBuffer.duration)
    if (this.audioBufSrcNode) {
      this.stopPlayback()
      this.startPlayback()
    }
  }
}
