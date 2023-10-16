import { FocusOrigin } from '@angular/cdk/a11y';
import { CdkPortalOutlet, Portal } from '@angular/cdk/portal';
import { Component, ElementRef, NgZone, ViewChild, signal } from '@angular/core';
import { MatDrawer } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { supported as browserFsApiSupported, fileOpen, fileSave } from 'browser-fs-access';
import * as Mousetrap from 'mousetrap';
import * as rxjs from 'rxjs';
import { AudioContextService } from './services/audio-context.service';
import { AudioSamples, audioSamplesDuration } from './common';
import { downsampleAudio, loadAudio } from './load-audio';
import { ProjectService } from './services/project.service';
import { Meter, ModalSpectrogramEdit, PitchLabelType, StartTranscribing } from './ui-common';
import { AudioVisualizationComponent } from './audio-visualization/audio-visualization.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  constructor(
    private readonly snackBar: MatSnackBar,
    readonly project: ProjectService,
    private readonly audioContextSvc: AudioContextService,
    titleService: Title,
    ngZone: NgZone,
  ) {
    rxjs.combineLatest({ unsaved: project.isUnsaved$, name: this.#projectName$ }).forEach(({ unsaved, name }) =>
      titleService.setTitle(`${name ?? '(unsaved project)'}${unsaved ? '*' : ''} - Vigilant Lamp`)
    );
    project.isUnsaved$.forEach(unsaved => {
      if (unsaved) {
        addEventListener('beforeunload', beforeUnloadListener);
      } else {
        removeEventListener('beforeunload', beforeUnloadListener);
      }
    })

    Mousetrap.bind('esc', () => ngZone.run(() => { this.uiMode?.cancel() }));
    Mousetrap.bind('mod+s', () => ngZone.run(() => { if (this.project.project) { this.saveProject() } return false }));
    Mousetrap.bind('mod+z', () => ngZone.run(() => { project.undo() }));
    Mousetrap.bind('mod+shift+z', () => ngZone.run(() => { project.redo() }));
  }

  readonly TIME_STEP_INPUT_MAX = 5

  readonly secCtx = window.isSecureContext
  readonly coi = window.crossOriginIsolated
  readonly hwCcur = navigator.hardwareConcurrency
  readonly browserFsApiSupported = browserFsApiSupported

  get audioContext() { return this.audioContextSvc.audioContext }

  specPitchMin: number = 12
  specPitchMax: number = 108
  // TODO: move ^^ to new component
  specDbMin: number = -60
  specDbMax: number = -20
  specLgWindowSize: number = 12
  specTimeStepInput: number = 3
  get specTimeStep(): number { return 2 ** (this.TIME_STEP_INPUT_MAX - this.specTimeStepInput) }
  specLgExtraPad: number = 0
  showPitchGrid: boolean = false;
  userShowBeatGrid: boolean = false;
  pitchLabelType: PitchLabelType = 'sharp';

  @ViewChild('audioVizContainer') audioVizContainer!: AudioVisualizationComponent;

  #projectName$ = new rxjs.Subject<string | undefined>();
  #projectFileHandle?: FileSystemFileHandle;
  get projectFileHandle() { return this.#projectFileHandle }
  set projectFileHandle(p) {
    this.#projectFileHandle = p;
    this.#projectName$.next(p?.name);
  }

  get hasProject(): boolean { return !!this.project.project }
  get hasProjectMeter(): boolean { return this.project.project?.meter?.state !== 'unset' }

  get audioData(): AudioSamples | undefined { return this.project.project?.audio }
  audioBuffer?: AudioBuffer;
  loading?: 'new' | 'open'

  playheadPos = signal(0);

  visCursor = "auto";
  /** offset space of `visElem` */
  visMouseX?: number;
  /** offset space of `visElem` */
  visMouseY?: number;
  userShowCrosshair: boolean = true;
  get showCrosshair(): boolean { return this.uiMode?.mode !== 'timing' && this.userShowCrosshair }
  showOvertones: boolean = false;

  debug_downsample: number = 0;

  meterPanelExpanded: boolean = false;
  get displayedMeter(): Partial<Meter> | undefined { return this.meterPanelExpanded ? this.liveMeter : this.userShowBeatGrid ? this.project.project?.meter : undefined }
  liveMeter?: Partial<Meter>;

  transcribePanelExpanded: boolean = false;

  uiMode: UiMode;
  get activePartIdx() { return this.uiMode && this.uiMode.mode === 'noting' ? this.uiMode.partIdx : undefined; }

  sidenavWidth = 360;
  private settingsPanelResizeObserver = new ResizeObserver(([{ borderBoxSize }]) => { this.sidenavWidth = borderBoxSize[0].inlineSize });
  @ViewChild('settings_panel') set settingsPanel(elemRef: ElementRef<HTMLElement>) {
    this.settingsPanelResizeObserver.disconnect();
    this.settingsPanelResizeObserver.observe(elemRef.nativeElement);
  }

  async newProject() {
    this.loading = 'new'
    try {
      const fh = await fileOpen({ description: "Audio Files", mimeTypes: ["audio/*"], id: 'project-new-audio' })
      const audioFile = new Uint8Array(await fh.arrayBuffer());
      this.audioBuffer = await loadAudio(audioFile.slice().buffer, this.audioContext.sampleRate)
      const audioData = await downsampleAudio(this.audioBuffer, this.audioContext.sampleRate)
      this.project.newProject(audioFile, audioData)
      this.projectFileHandle = undefined;
      this.audioVizContainer.onAudioLoad(this.audioBuffer.duration);
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
      this.project.markSaved();
      this.projectFileHandle = projectFile.handle
      this.audioVizContainer.onAudioLoad(audioSamplesDuration(this.project.project!.audio));
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
      ) ?? undefined
      this.project.markSaved();
    } catch (e) {
      console.log("error save project:", e);
      if (!isUserAbortException(e)) {
        this.snackBar.open(`Error saving project: ${e}`);
      }
    }
  }

  @ViewChild('visElem', { read: ElementRef }) visElem!: ElementRef<HTMLElement>;
  @ViewChild('drawer') drawer!: MatDrawer;
  @ViewChild('drawer', { read: ElementRef }) drawerElem!: ElementRef<HTMLElement>;
  @ViewChild('portalOutlet') portalOutlet!: CdkPortalOutlet;

  private async _doModal<T>(drawerContents: Portal<any>, openedVia: FocusOrigin | undefined, donePromise: Promise<T>, doneClick?: () => void): Promise<T | undefined> {
    if (this.drawer.opened) throw new Error('already modal picking');
    try {
      this.portalOutlet.portal = drawerContents;
      this.drawer.open(openedVia);
      this.drawerElem.nativeElement.focus();
      this.uiMode = { mode: 'timing', doneClick, cancel: () => { this.drawer.close() }, };
      return await Promise.race([
        donePromise,
        rxjs.firstValueFrom(this.drawer.closedStart, { defaultValue: undefined }).then(() => undefined),
      ]);
    } finally {
      this.uiMode = undefined;
      this.drawer.close().then(v => { if (v === 'close') this.portalOutlet.detach() });
    }
  }

  readonly modalSpectrogramEdit: ModalSpectrogramEdit = {
    click: async (
      drawerContents: Portal<any>,
      openedVia: FocusOrigin | undefined,
      accept: (v: number) => boolean,
      onInput: (v: number | undefined) => void
    ): Promise<number | undefined> => {
      onInput(undefined);
      const onInputSub = rxjs.merge(
        rxjs.fromEvent(this.visElem.nativeElement, 'mousemove').pipe(rxjs.map(this.event2time), rxjs.map(v => accept(v) ? v : undefined), rxjs.distinctUntilChanged()),
        rxjs.fromEvent(this.visElem.nativeElement, 'mouseleave').pipe(rxjs.map(() => undefined)),
      ).subscribe(v => {
        this.visCursor = v !== undefined ? "pointer" : "auto";
        onInput(v);
      });
      const donePromise = rxjs.firstValueFrom(rxjs.fromEvent(this.visElem.nativeElement, 'click').pipe(rxjs.map(this.event2time), rxjs.filter(accept)));
      try {
        return await this._doModal(drawerContents, openedVia, donePromise);
      } finally {
        onInputSub.unsubscribe();
        this.visCursor = "auto";
      }
    },

    drag: async (
      drawerContents: Portal<any>,
      openedVia: FocusOrigin | undefined,
      cursorStyle: 'grab' | 'resize',
      interpretDrag: (start: number, end: number) => number | undefined,
      onInput: (v: number) => void
    ): Promise<number | undefined> => {
      if (cursorStyle === 'grab') this.visCursor = 'grab';
      let accumDrag = 0;
      let dragStart: number | undefined;
      let mouseInbounds = false;
      onInput(0);
      const onInputSub = rxjs.merge(
        rxjs.fromEvent(this.visElem.nativeElement, 'mousedown'),
        rxjs.fromEvent(this.visElem.nativeElement, 'mousemove'),
        rxjs.fromEvent(this.visElem.nativeElement, 'mouseleave'),
        rxjs.fromEvent(document, 'mouseup'),
      ).subscribe(ev => {
        switch (ev.type) {
          case 'mousedown':
            if ((ev as MouseEvent).button !== 0) break;
            if (dragStart === undefined) dragStart = this.event2time(ev);
            if (cursorStyle === 'grab') this.visCursor = 'grabbing';
            mouseInbounds = true;
            break;
          case 'mousemove':
            const v = this.event2time(ev);
            let cursorOk: boolean;
            if (dragStart !== undefined) {
              const drag = interpretDrag(dragStart, v);
              onInput(accumDrag + (drag ?? 0));
              cursorOk = drag !== undefined;
            } else {
              cursorOk = interpretDrag(v, v) !== undefined;
            }
            if (cursorStyle === 'resize') this.visCursor = cursorOk ? 'ew-resize' : 'auto';
            mouseInbounds = true;
            break;
          case 'mouseleave':
            if (dragStart !== undefined) onInput(accumDrag);
            mouseInbounds = false;
            break;
          case 'mouseup':
            if (dragStart !== undefined && mouseInbounds) accumDrag += interpretDrag(dragStart, this.event2time(ev)) ?? 0;
            dragStart = undefined;
            if (cursorStyle === 'grab') this.visCursor = 'grab';
            mouseInbounds = false;
            break;
        }
      });
      let resolveDone!: () => void;
      const doneClicked = new Promise<void>(resolve => resolveDone = resolve);
      try {
        return await this._doModal(drawerContents, openedVia, doneClicked.then(() => accumDrag), resolveDone)
      } finally {
        onInputSub.unsubscribe();
        this.visCursor = "auto";
      }
    },
  }

  private readonly event2time = (event: Event) => {
    const visBounds = this.visElem.nativeElement.getBoundingClientRect();
    return this.audioVizContainer.x2time((event as MouseEvent).clientX - visBounds.x);
  }

  readonly startTranscribing: StartTranscribing = (partIdx: number) => {
    this.uiMode = { mode: 'noting', partIdx, cancel: () => { this.uiMode = undefined }, };
  }
}

const isUserAbortException = (e: unknown) => (e instanceof DOMException && e.name === "AbortError" && e.message === "The user aborted a request.");

// https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
const beforeUnloadListener = (ev: BeforeUnloadEvent) => { ev.preventDefault(); return (ev.returnValue = ""); }

type UiMode
  = undefined
  | { mode: 'timing'; doneClick?: () => void; cancel: () => void; }
  | { mode: 'noting'; partIdx: number; cancel: () => void; };
