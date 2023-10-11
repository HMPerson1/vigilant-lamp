import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EnvironmentInjector, EventEmitter, HostListener, Input, Output, Signal, ViewChild, WritableSignal, computed, runInInjectionContext, signal } from '@angular/core';
import * as lodash from 'lodash-es';
import * as rxjs from 'rxjs';
import { GenSpecTile } from '../common';
import { PITCH_MAX, doScrollZoomPitch, doScrollZoomTime, elemBoxSizeSignal, mkTranslateX, mkTranslateY } from '../ui-common';

@Component({
  selector: 'app-audio-visualization',
  templateUrl: './audio-visualization.component.html',
  styleUrls: ['./audio-visualization.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioVisualizationComponent {
  readonly #viewportWidthFrac = signal(1);
  readonly #viewportHeightFrac = signal(88 / PITCH_MAX);
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

  readonly timeRange = computed(() => this.audioDuration() * this.#viewportWidthFrac());
  readonly pitchRange = computed(() => PITCH_MAX * this.#viewportHeightFrac());
  readonly pxPerTime = computed(() => this.viewportSize().inlineSize / this.timeRange());
  readonly pxPerPitch = computed(() => this.viewportSize().blockSize / this.pitchRange());
  readonly timePerPx = computed(() => this.timeRange() / this.viewportSize().inlineSize);
  readonly pitchPerPx = computed(() => this.pitchRange() / this.viewportSize().blockSize);

  readonly timeMin = computed(() => this.viewportOffsetX() * this.timePerPx());
  readonly timeMax = computed(() => this.timeMin() + this.timeRange());
  readonly pitchMin = computed(() => PITCH_MAX - ((this.viewportOffsetY() + this.viewportSize().blockSize) * this.pitchPerPx()));
  readonly pitchMax = computed(() => this.pitchMin() + this.pitchRange());

  /** equivalent to `(audioDuration - timeRange) * pxPerTime` */
  readonly #viewportOffsetXMax = computed(() => Math.ceil(((1 / this.#viewportWidthFrac()) - 1) * this.viewportSize().inlineSize));
  readonly #viewportOffsetYMax = computed(() => Math.ceil(((1 / this.#viewportHeightFrac()) - 1) * this.viewportSize().blockSize));

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
    // this _should_ be fine since this should only ever be called once
    this.#viewportOffsetY.set(Math.round((PITCH_MAX - 108.5) * elemRef.nativeElement.getBoundingClientRect().height / this.pitchRange()));
    this.changeDetectorRef.detectChanges();
  }

  onAudioLoad(duration: number) {
    this.#audioDuration.set(duration);
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
    // doScrollZoomTime(
    //   this.#timeMin, this.#timeRange, this.#audioDuration(),
    //   delta, zoom, offsetX / this.viewportSize().inlineSize,
    // )
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
      // doScrollZoomPitch(
      //   this.#pitchMin, this.#pitchRange, bounds.width / bounds.height,
      //   deltaY, event.ctrlKey, 1 - offsetY / bounds.height,
      // );
    }
  }

  async onSpecMouseDown(event: MouseEvent) {
    if (event.button !== 1) return;
    event.preventDefault();
    const downClientX = event.clientX;
    const downClientY = event.clientY;
    const downOffsetX = this.viewportOffsetX();
    const downOffsetY = this.viewportOffsetY();
    const offsetXMax = this.#viewportOffsetXMax();
    const offsetYMax = this.#viewportOffsetYMax();

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
