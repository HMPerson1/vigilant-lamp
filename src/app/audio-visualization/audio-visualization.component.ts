import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EnvironmentInjector, EventEmitter, HostListener, Input, Output, Signal, ViewChild, WritableSignal, computed, runInInjectionContext, signal } from '@angular/core';
import * as lodash from 'lodash-es';
import * as rxjs from 'rxjs';
import { PITCH_MAX, elemBoxSizeSignal, mkTranslateX, mkTranslateY } from '../ui-common';

@Component({
  selector: 'app-audio-visualization',
  templateUrl: './audio-visualization.component.html',
  styleUrls: ['./audio-visualization.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioVisualizationComponent {
  readonly #canvasWidth = signal(1);
  readonly #canvasHeight = signal(1);
  readonly canvasWidth = this.#canvasWidth.asReadonly();
  readonly canvasHeight = this.#canvasHeight.asReadonly();
  readonly #viewportOffsetX = signal(0); // always an exact integer
  readonly #viewportOffsetY = signal(0); // always an exact integer
  readonly viewportOffsetX = this.#viewportOffsetX.asReadonly();
  readonly viewportOffsetY = this.#viewportOffsetY.asReadonly();

  readonly #realViewportSize: WritableSignal<Signal<ResizeObserverSize> | undefined> = signal(undefined);
  readonly viewportSize = computed(() => {
    const r = this.#realViewportSize();
    return r !== undefined ? r() : { inlineSize: 0, blockSize: 0 };
  });

  readonly #audioDuration = signal(30);
  readonly audioDuration = this.#audioDuration.asReadonly();

  readonly pxPerTime = computed(() => this.#canvasWidth() / this.audioDuration());
  readonly pxPerPitch = computed(() => this.#canvasHeight() / PITCH_MAX);
  readonly timePerPx = computed(() => this.audioDuration() / this.#canvasWidth());
  readonly pitchPerPx = computed(() => PITCH_MAX / this.#canvasHeight());

  readonly timeRange = computed(() => this.viewportSize().inlineSize * this.timePerPx());
  readonly pitchRange = computed(() => this.viewportSize().blockSize * this.pitchPerPx());
  readonly timeMin = computed(() => this.viewportOffsetX() * this.timePerPx());
  readonly timeMax = computed(() => this.timeMin() + this.timeRange());
  readonly pitchMin = computed(() => PITCH_MAX - ((this.viewportOffsetY() + this.viewportSize().blockSize) * this.pitchPerPx()));
  readonly pitchMax = computed(() => this.pitchMin() + this.pitchRange());

  readonly #visMouseX = signal<number | undefined>(undefined);
  readonly #visMouseY = signal<number | undefined>(undefined);
  readonly visMouseX = this.#visMouseX.asReadonly();
  readonly visMouseY = this.#visMouseY.asReadonly();

  @Input({ required: true }) playheadPos!: Signal<number>;
  readonly _playheadTransform = mkTranslateX(computed(() => Math.round(this.time2x(this.playheadPos()))));
  readonly _crosshairXTransform = mkTranslateX(this.visMouseX);
  readonly _crosshairYTransform = mkTranslateY(this.visMouseY);

  @Input() showCrosshair = true;
  @Output() playheadSeek: EventEmitter<number> = new EventEmitter();

  constructor(private readonly environmentInjector: EnvironmentInjector, private readonly changeDetectorRef: ChangeDetectorRef) { }

  #specContainer!: HTMLElement;
  @ViewChild('specContainer') set specContainer(elemRef: ElementRef<HTMLElement>) {
    this.#specContainer = elemRef.nativeElement;
    runInInjectionContext(this.environmentInjector, () => {
      this.#realViewportSize.set(elemBoxSizeSignal(elemRef.nativeElement));
    });
    const bounds = elemRef.nativeElement.getBoundingClientRect();
    // this _should_ be fine since this should only ever be called once
    // but this is also really jank
    this.#canvasWidth.set(bounds.width);
    this.#canvasHeight.set(bounds.height * (PITCH_MAX / 88));
    this.#viewportOffsetY.set(Math.round((PITCH_MAX - 108.5) * this.pxPerPitch()));
    this.changeDetectorRef.detectChanges();
  }

  onAudioLoad(duration: number) {
    this.#audioDuration.set(duration);
    this.#viewportOffsetX.set(0);
    this.#canvasWidth.set(this.#specContainer.getBoundingClientRect().width);
  }

  onWaveformClick(event: MouseEvent) {
    event.preventDefault()
    this.playheadSeek.emit(this.x2time(event.offsetX));
  }

  x2time(x: number) { return x / this.viewportSize().inlineSize * this.timeRange() + this.timeMin() }
  private time2x(t: number) { return (t - this.timeMin()) / this.timeRange() * this.viewportSize().inlineSize }

  onWaveformWheel(event: WheelEvent) {
    event.preventDefault()
    // TODO: scroll pixel/line/page ???
    this.#doWheel(event.deltaX + event.deltaY, event.offsetX, event.ctrlKey);
  }

  #doWheel(delta: number, offsetX: number, zoom: boolean) {
    doScrollZoom(
      this.#viewportOffsetX, this.#canvasWidth,
      this.viewportSize().inlineSize, this.audioDuration() * 1000,
      delta, zoom, offsetX,
    );
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    const bounds = this.#specContainer.getBoundingClientRect();
    this.#visMouseX.set(event.clientX - bounds.x)
    const newMouseY = event.clientY - bounds.y;
    this.#visMouseY.set(newMouseY >= 0 ? newMouseY : undefined)
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    this.#visMouseX.set(undefined)
    this.#visMouseY.set(undefined)
  }

  readonly _offsetDivTransform = computed(() => `translate(${-this.viewportOffsetX()}px,${-this.viewportOffsetY()}px)`);

  private isPanning = false;

  onSpecWheel(event: WheelEvent) {
    if (this.isPanning) return;
    event.preventDefault();
    const bounds = this.#specContainer.getBoundingClientRect();
    const [deltaX, deltaY] = event.shiftKey ? [event.deltaY, event.deltaX] : [event.deltaX, event.deltaY];
    const offsetX = event.clientX - bounds.x;
    const offsetY = event.clientY - bounds.y;

    if (deltaX !== 0) {
      this.#doWheel(deltaX, offsetX, event.ctrlKey);
    }
    if (deltaY !== 0) {
      doScrollZoom(
        this.#viewportOffsetY, this.#canvasHeight,
        this.viewportSize().blockSize, PITCH_MAX / 6,
        deltaY, event.ctrlKey, offsetY,
      );
    }
  }

  async onSpecMouseDown(event: MouseEvent) {
    if (event.button !== 1) return;
    event.preventDefault();
    const downClientX = event.clientX;
    const downClientY = event.clientY;
    const downOffsetX = this.viewportOffsetX();
    const downOffsetY = this.viewportOffsetY();
    const offsetXMax = Math.ceil(this.#canvasWidth() - this.viewportSize().inlineSize);
    const offsetYMax = Math.ceil(this.#canvasHeight() - this.viewportSize().blockSize);

    const onMoveSub = rxjs.fromEvent(document, 'mousemove').subscribe(ev_ => {
      const ev = ev_ as MouseEvent;
      this.#viewportOffsetX.set(lodash.clamp(downOffsetX - ev.clientX + downClientX, 0, offsetXMax));
      this.#viewportOffsetY.set(lodash.clamp(downOffsetY - ev.clientY + downClientY, 0, offsetYMax));
    });
    this.isPanning = true;
    try {
      await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup').pipe(rxjs.filter(ev => (ev as MouseEvent).button === 1)));
    } finally {
      this.isPanning = false;
      onMoveSub.unsubscribe();
    }
  }
}

function doScrollZoom(
  viewportOffset: WritableSignal<number>, canvasSize: WritableSignal<number>,
  viewportSize: number, canvasSizeMaxRatio: number,
  wheelDelta: number, zoom: boolean, mouseOffset: number
) {
  let viewportOffsetVal = viewportOffset();
  let canvasSizeVal = canvasSize();
  if (zoom) {
    const oldCanvasSize = canvasSizeVal;
    canvasSizeVal = lodash.clamp(canvasSizeVal * (2 ** (- wheelDelta / 400)), viewportSize, viewportSize * canvasSizeMaxRatio);
    canvasSize.set(canvasSizeVal);
    viewportOffsetVal = (mouseOffset + viewportOffsetVal) * canvasSizeVal / oldCanvasSize - mouseOffset;
  } else {
    viewportOffsetVal += wheelDelta;
  }
  viewportOffset.set(lodash.clamp(Math.round(viewportOffsetVal), 0, Math.ceil(canvasSizeVal - viewportSize)));
}
