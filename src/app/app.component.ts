import { FocusOrigin } from '@angular/cdk/a11y';
import { CdkPortalOutlet, Portal } from '@angular/cdk/portal';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { MatDrawer } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { supported as browserFsApiSupported, fileOpen, fileSave } from 'browser-fs-access';
import * as lodash from 'lodash-es';
import * as rxjs from 'rxjs';
import { AudioContextService } from './audio-context.service';
import { AudioSamples, audioSamplesDuration } from './common';
import { downsampleAudio, loadAudio } from './load-audio';
import { ProjectService } from './project.service';
import { Meter, ModalPickFromSpectrogramFn, PitchLabelType } from './ui-common';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  constructor(private snackBar: MatSnackBar, readonly project: ProjectService, private audioContextSvc: AudioContextService, private titleService: Title) { }

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
  userShowBeatGrid: boolean = false;
  pitchLabelType: PitchLabelType = 'sharp';

  #projectFileHandle?: FileSystemFileHandle;
  get projectFileHandle() { return this.#projectFileHandle }
  set projectFileHandle(p) {
    this.#projectFileHandle = p;
    this.titleService.setTitle(`${p?.name || '(unsaved project)'} - Vigilant Lamp`);
  }

  get hasProject(): boolean { return !!this.project.project }
  get hasProjectMeter(): boolean { return this.project.project?.meter?.state !== 'unset' }

  get audioData(): AudioSamples | undefined { return this.project.project?.audio }
  audioBuffer?: AudioBuffer;
  loading?: 'new' | 'open'

  playheadPos: number = 0;

  /** offset space of `visElem` */
  visMouseX = new rxjs.BehaviorSubject<number | undefined>(undefined);
  showCrosshair: boolean = true;
  showOvertones: boolean = false;

  debug_downsample: number = 0;

  meterPanelExpanded: boolean = false;
  get displayedMeter(): Partial<Meter> | undefined { return this.meterPanelExpanded ? this.liveMeter : this.userShowBeatGrid ? this.project.project?.meter : undefined }
  liveMeter?: Partial<Meter>;

  async newProject() {
    // TODO: track if modified; warn if losing data
    this.loading = 'new'
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
      console.log("error new project:", e);
      if (!isUserAbortException(e)) {
        this.snackBar.open(`Error creating a new project: ${e}`);
      }
    }
    this.loading = undefined
  }

  async loadProject() {
    this.loading = 'open'
    try {
      const projectFile = await fileOpen({ description: "Vigilant Lamp files", extensions: [".vtlamp"], id: 'project' })
      await this.project.fromBlob(projectFile)
      this.projectFileHandle = projectFile.handle
      this.vizTimeMin = 0
      this.vizTimeMax = audioSamplesDuration(this.project.project!.audio)
      this.audioBuffer = await loadAudio(this.project.project!.audioFile.slice().buffer, this.audioContext.sampleRate)
    } catch (e) {
      console.log("error load project:", e);
      if (!isUserAbortException(e)) {
        this.snackBar.open(`Error opening project: ${e}`);
      }
    }
    this.loading = undefined
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
      console.log("error save project:", e);
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

  @ViewChild('visElem') visElem!: ElementRef<HTMLElement>;
  @ViewChild('drawer') drawer!: MatDrawer;
  @ViewChild('drawer', { read: ElementRef }) drawerElem!: ElementRef<HTMLElement>;
  @ViewChild('portalOutlet') portalOutlet!: CdkPortalOutlet;
  modalState?: { drawerCancel: () => void; visClick: (x: number) => void };

  modalPickFromSpectrogram: ModalPickFromSpectrogramFn = async (drawerContents: Portal<any>, onInput: Partial<rxjs.Observer<number | undefined>>, openedVia?: FocusOrigin): Promise<number | undefined> => {
    if (this.drawer.opened) throw new Error('already modal picking');
    if (!this.visElem.nativeElement) throw new Error('template broke');
    const x2time = (x: number) => {
      const visBounds = this.visElem.nativeElement.getBoundingClientRect();
      return x / visBounds.width * (this.vizTimeMax - this.vizTimeMin) + this.vizTimeMin;
    }
    let onInputSub: rxjs.Subscription | undefined;

    try {
      this.portalOutlet.portal = drawerContents;
      this.drawer.open(openedVia);
      this.drawerElem.nativeElement?.focus();

      onInputSub = this.visMouseX.pipe(rxjs.map(x => x !== undefined ? x2time(x) : undefined)).subscribe(onInput)

      let cancelResolve!: () => void;
      const cancelButtonClick = new Promise<number | undefined>(resolve => { cancelResolve = () => resolve(undefined); });

      let visClickResolve!: (x: number) => void;
      const visClick = new Promise<number | undefined>(resolve => { visClickResolve = resolve });

      this.modalState = { visClick: visClickResolve, drawerCancel: cancelResolve };
      const res = await Promise.race<number | undefined>([
        visClick,
        cancelButtonClick,
        rxjs.firstValueFrom(this.drawer.closedStart, { defaultValue: undefined }).then(() => undefined),
      ]);

      if (res === undefined) {
        // cancelled
        return undefined;
      } else {
        return x2time(res);
      }
    } finally {
      this.modalState = undefined;
      onInputSub?.unsubscribe();
      this.drawer.close().then(() => this.portalOutlet.detach());
    }
  }

  onVisClick(event: MouseEvent) {
    if (!this.modalState) return;
    this.modalState.visClick(event.offsetX);
    event.preventDefault();
    event.stopPropagation();
  }
}

const isUserAbortException = (e: unknown) => (e instanceof DOMException && e.name === "AbortError" && e.message === "The user aborted a request.");
