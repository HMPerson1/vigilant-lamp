import { CdkPortalOutlet } from '@angular/cdk/portal';
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
  userShowCrosshair: boolean = true;
  get showCrosshair(): boolean { return this.modalState !== undefined ? false : this.userShowCrosshair }
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

  @ViewChild('visElem', { read: ElementRef }) visElem!: ElementRef<HTMLElement>;
  @ViewChild('drawer') drawer!: MatDrawer;
  @ViewChild('drawer', { read: ElementRef }) drawerElem!: ElementRef<HTMLElement>;
  @ViewChild('portalOutlet') portalOutlet!: CdkPortalOutlet;
  modalState?: { drawerCancel: () => void };

  // TODO: click vs drag should probably be two different things
  modalPickFromSpectrogram: ModalPickFromSpectrogramFn = async (drawerContents, openedVia, onInput): Promise<number | undefined> => {
    if (this.drawer.opened) throw new Error('already modal picking');
    const event2time = (event: MouseEvent) => {
      const visBounds = this.visElem.nativeElement.getBoundingClientRect();
      return (event.clientX - visBounds.x) / visBounds.width * (this.vizTimeMax - this.vizTimeMin) + this.vizTimeMin;
    }
    const modalEnd = new rxjs.Subject<void>();

    try {
      this.portalOutlet.portal = drawerContents;
      this.drawer.open(openedVia);
      this.drawerElem.nativeElement.focus();

      const inputEnd = onInput({
        mousedown:
          rxjs.fromEvent(this.visElem.nativeElement, 'mousedown')
            .pipe(rxjs.takeUntil(modalEnd), rxjs.map(ev => event2time(ev as MouseEvent))),
        mousemove:
          rxjs.merge(
            rxjs.fromEvent(this.visElem.nativeElement, 'mousemove').pipe(rxjs.map(ev => event2time(ev as MouseEvent))),
            rxjs.fromEvent(this.visElem.nativeElement, 'mouseleave').pipe(rxjs.map(() => undefined)),
          ).pipe(rxjs.takeUntil(modalEnd)),
        mouseup:
          rxjs.fromEvent(this.visElem.nativeElement, 'mouseup')
            .pipe(rxjs.takeUntil(modalEnd), rxjs.map(ev => {
              const visBounds = this.visElem.nativeElement.getBoundingClientRect();
              if (lodash.inRange((ev as MouseEvent).clientX, visBounds.left, visBounds.right)) {
                return event2time(ev as MouseEvent);
              } else {
                return undefined;
              }
            })),
        click:
          rxjs.fromEvent(this.visElem.nativeElement, 'click')
            .pipe(rxjs.takeUntil(modalEnd), rxjs.map(ev => event2time(ev as MouseEvent))),
      });

      let cancelResolve!: () => void;
      const cancelButtonClick = new Promise<number | undefined>(resolve => { cancelResolve = () => resolve(undefined); });

      this.modalState = { drawerCancel: cancelResolve };
      return await Promise.race<number | undefined>([
        inputEnd,
        cancelButtonClick,
        rxjs.firstValueFrom(this.drawer.closedStart, { defaultValue: undefined }).then(() => undefined),
      ]);
    } finally {
      this.modalState = undefined;
      this.drawer.close().then(() => this.portalOutlet.detach());
      modalEnd.next();
      modalEnd.complete();
    }
  }

  onVisClick(event: MouseEvent) {
    if (!this.modalState) return;
    event.preventDefault();
    event.stopPropagation();
  }
}

const isUserAbortException = (e: unknown) => (e instanceof DOMException && e.name === "AbortError" && e.message === "The user aborted a request.");
