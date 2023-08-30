import { ChangeDetectorRef, Component } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { supported as browserFsApiSupported, fileOpen, fileSave } from 'browser-fs-access';
import * as lodash from 'lodash-es';
import { Iso } from 'monocle-ts';
import { AudioContextService } from './audio-context.service';
import { AudioSamples, audioSamplesDuration } from './common';
import { downsampleAudio, loadAudio } from './load-audio';
import { ProjectService } from './project.service';
import { Meter, PitchLabelType, ProjectLens, defaultMeter } from './ui-common';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  constructor(private snackBar: MatSnackBar, readonly project: ProjectService, private audioContextSvc: AudioContextService, private titleService: Title, changeDetRef: ChangeDetectorRef) {
    this.projectMeterProxy = new ProjectMeterProxy(project, changeDetRef)
  }

  readonly TIME_STEP_INPUT_MAX = 5

  readonly secCtx = window.isSecureContext
  readonly coi = window.crossOriginIsolated
  readonly hwCcur = navigator.hardwareConcurrency
  readonly browserFsApiSupported = browserFsApiSupported

  get audioContext() { return this.audioContextSvc.audioContext }

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
  showBeatGrid: boolean = false;
  pitchLabelType: PitchLabelType = 'sharp';
  projectMeterProxy: ProjectMeterProxy;

  #projectFileHandle?: FileSystemFileHandle;
  get projectFileHandle() { return this.#projectFileHandle }
  set projectFileHandle(p) {
    this.#projectFileHandle = p;
    this.titleService.setTitle(`${p?.name || '(unsaved project)'} - Vigilant Lamp`);
  }

  get hasProject(): boolean { return !!this.project.project }
  get audioData(): AudioSamples | undefined { return this.project.project?.audio }
  audioBuffer?: AudioBuffer;
  loading: boolean = false;

  playheadPos: number = 0;

  visPointerX?: number; // TODO: rename to pointer?
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
      console.log("error new project:")
      console.log(e);
      if (!isUserAbortException(e)) {
        this.snackBar.open(`Error creating a new project: ${e}`);
      }
    }
    this.loading = false
  }

  async loadProject() {
    this.loading = true
    try {
      const projectFile = await fileOpen({ description: "Vigilant Lamp files", extensions: [".vtlamp"], id: 'project' })
      await this.project.fromBlob(projectFile)
      this.projectFileHandle = projectFile.handle
      this.vizTimeMin = 0
      this.vizTimeMax = audioSamplesDuration(this.project.project!.audio)
      this.audioBuffer = await loadAudio(this.project.project!.audioFile.slice().buffer, this.audioContext.sampleRate)
    } catch (e) {
      console.log("error load project:")
      console.log(e);
      if (!isUserAbortException(e)) {
        this.snackBar.open(`Error opening project: ${e}`);
      }
    }
    this.loading = false
  }

  async saveProject(saveAs = false) {
    try {
      this.projectFileHandle = await fileSave(
        this.project.intoBlob(),
        { description: "Vigilant Lamp file", extensions: [".vtlamp"], id: 'project' },
        saveAs ? null : this.projectFileHandle,
        true,
      ) || undefined
    } catch (e) {
      console.log("error save project:")
      console.log(e);
      if (!isUserAbortException(e)) {
        this.snackBar.open(`Error saving project: ${e}`);
      }
    }
  }

  onWaveformClick(event: MouseEvent) {
    if (!this.audioBuffer) return;
    event.preventDefault()

    const pos = event.offsetX / (event.target! as HTMLElement).clientWidth * (this.vizTimeMax - this.vizTimeMin) + this.vizTimeMin;
    this.playheadPos = lodash.clamp(pos, 0, this.audioBuffer.duration)
  }
}

const isUserAbortException = (e: unknown) => (e instanceof DOMException && e.name === "AbortError" && e.message === "The user aborted a request.");

const meterproxyfield = (useFusionTag: boolean = false) => <T extends { [K in keyof Meter]?: any }>(target: T & { project: ProjectService }, propertyKey: keyof Meter, a: TypedPropertyDescriptor<number | undefined>) => {
  const lens0 = ProjectLens(['meter', propertyKey]);
  const lens = propertyKey === 'startOffset' ? lens0.composeIso(new Iso(x => x * 1000, x => x / 1000)) : lens0;
  let changeDetHack = false; // https://github.com/angular/angular/issues/13063
  a.get = function () {
    // if (changeDetHack) return null as any;
    // TODO: aaaaaaaaaaaa
    const project: any = (this as any).project.project;
    const ret = project ? lens.get(project) : undefined;
    console.log(`${propertyKey} -> ${ret}`);
    return ret;
  }
  a.set = function (v: number | undefined | null) {
    console.log(`${propertyKey} <- ${v}`);
    // const changeDetRef = (this as any).changeDetRef as ChangeDetectorRef;
    changeDetHack = true;
    // changeDetRef.detectChanges()
    changeDetHack = false;
    if (v !== undefined && v !== null) ((this as any).project as ProjectService).modify(lens.set(v), useFusionTag ? propertyKey : undefined);
  }
}

class ProjectMeterProxy {
  constructor(readonly project: ProjectService, readonly changeDetRef: ChangeDetectorRef) { }
  @meterproxyfield(true) accessor bpm: number | undefined;
  @meterproxyfield(true) accessor startOffset: number | undefined;
  @meterproxyfield() accessor measureLength: number | undefined;
  @meterproxyfield() accessor subdivision: number | undefined;
}
