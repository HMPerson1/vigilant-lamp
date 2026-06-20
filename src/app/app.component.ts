import { FocusOrigin } from '@angular/cdk/a11y';
import { CdkPortalOutlet, Portal } from '@angular/cdk/portal';
import { Component, ElementRef, NgZone, ViewChild, computed, effect, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatDrawer } from '@angular/material/sidenav';
import { Title } from '@angular/platform-browser';
import * as Mousetrap from 'mousetrap';
import * as rxjs from 'rxjs';
import { Meter, audioSamplesDuration } from '../model/project';
import { AudioVisualizationComponent } from './audio-visualization/audio-visualization.component';
import { AudioContextService } from './services/audio-context.service';
import { ProjectService } from './services/project.service';
import { ModalSpectrogramEdit, PitchLabelType, StartTranscribing } from './ui-common';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class AppComponent {
  constructor(
    readonly project: ProjectService,
    private readonly audioContextSvc: AudioContextService,
    titleService: Title,
    ngZone: NgZone,
  ) {
    const globalIsUnsaved = computed(() => project.currentProjectRaw()?.isUnsaved() ?? false);
    effect(() => {
      titleService.setTitle(`${this.projectFilename() ?? '(unsaved project)'}${globalIsUnsaved() ? '*' : ''} - Vigilant Lamp`)
    });
    effect(() => {
      if (globalIsUnsaved()) {
        addEventListener('beforeunload', beforeUnloadListener);
      } else {
        removeEventListener('beforeunload', beforeUnloadListener);
      }
    });
    project.currentProject$.pipe(rxjs.switchMap(projHolder => projHolder.partIdxInvalidated$)).subscribe(() => this.uiModeAsNoting()?.cancel());
    project.currentProject$.subscribe(projectHolder => this.audioVizContainer.onAudioLoad(audioSamplesDuration(projectHolder.project().audio)));

    Mousetrap.bind('esc', () => ngZone.run(() => { this.uiMode()?.cancel() }));
  }

  readonly TIME_STEP_INPUT_MAX = 5

  readonly secCtx = window.isSecureContext
  readonly coi = window.crossOriginIsolated
  readonly hwCcur = navigator.hardwareConcurrency
  readonly outputSampleRate = this.audioContextSvc.audioContext.sampleRate;

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

  readonly projectFilename = signal<string | undefined>(undefined);

  readonly hasProjectMeter = computed(() => !!this.project.currentProjectRaw()?.project().meter)

  readonly audioBuffer = signal<AudioBuffer | undefined>(undefined);

  readonly playheadPos = signal(0);

  visCursor = "auto";
  /** offset space of `visElem` */
  visMouseX?: number;
  /** offset space of `visElem` */
  visMouseY?: number;
  readonly userShowCrosshair = signal(true);
  readonly showCrosshair = computed(() => this.uiMode()?.mode !== 'timing' && this.userShowCrosshair());
  showOvertones: boolean = false;

  debug_downsample: number = 0;

  meterPanelExpanded: boolean = false;
  get displayedMeter(): Partial<Meter> | undefined { return this.meterPanelExpanded ? this.liveMeter : this.userShowBeatGrid ? this.project.currentProjectRaw()?.project().meter : undefined }
  liveMeter?: Partial<Meter>;

  transcribePanelExpanded: boolean = false;

  readonly uiMode = signal<UiMode>(undefined);
  readonly uiModeAsNoting = computed(() => { const m = this.uiMode(); return m?.mode === 'noting' ? m : undefined });
  readonly uiModeAsTiming = computed(() => { const m = this.uiMode(); return m?.mode === 'timing' ? m : undefined });
  readonly activePartIdx = computed(() => this.uiModeAsNoting()?.partIdx);
  readonly activePartLabel = computed(() => { const a = this.activePartIdx(); return a !== undefined ? this.project.currentProjectRaw()?.project().parts[a].name : undefined; });

  sidenavWidth = 360;
  private settingsPanelResizeObserver = new ResizeObserver(([{ borderBoxSize }]) => { this.sidenavWidth = borderBoxSize[0].inlineSize });
  @ViewChild('settings_panel') set settingsPanel(elemRef: ElementRef<HTMLElement>) {
    this.settingsPanelResizeObserver.disconnect();
    this.settingsPanelResizeObserver.observe(elemRef.nativeElement);
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
      this.uiMode.set({ mode: 'timing', doneClick, cancel: () => { this.drawer.close() }, });
      return await Promise.race([
        donePromise,
        rxjs.firstValueFrom(this.drawer.closedStart, { defaultValue: undefined }).then(() => undefined),
      ]);
    } finally {
      this.uiMode.set(undefined);
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
    this.uiMode.set({ mode: 'noting', partIdx, cancel: () => { this.uiMode.set(undefined) }, });
  }
}

// https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
const beforeUnloadListener = (ev: BeforeUnloadEvent) => { ev.preventDefault(); return (ev.returnValue = ""); }

type UiMode
  = undefined
  | { mode: 'timing'; doneClick?: () => void; cancel: () => void; }
  | { mode: 'noting'; partIdx: number; cancel: () => void; };
