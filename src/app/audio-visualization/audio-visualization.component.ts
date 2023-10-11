import { ChangeDetectionStrategy, Component, ElementRef, EnvironmentInjector, EventEmitter, HostListener, Input, Output, Signal, ViewChild, computed, runInInjectionContext, signal } from '@angular/core';
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
  readonly #timeMin = signal(0);
  readonly #timeRange = signal(30);
  readonly timeMin = this.#timeMin.asReadonly();
  readonly timeRange = this.#timeRange.asReadonly();
  readonly timeMax = computed(() => this.timeMin() + this.timeRange());

  readonly #audioDuration = signal(30);
  readonly audioDuration = this.#audioDuration.asReadonly();

  readonly #pitchMin = signal(12);
  readonly #pitchRange = signal(96);
  readonly pitchMin = this.#pitchMin.asReadonly();
  readonly pitchRange = this.#pitchRange.asReadonly();
  readonly pitchMax = computed(() => this.pitchMin() + this.pitchRange());

  readonly #visMouseX = signal<number | undefined>(undefined);
  readonly #visMouseY = signal<number | undefined>(undefined);
  readonly visMouseX = this.#visMouseX.asReadonly();
  readonly visMouseY = this.#visMouseY.asReadonly();

  @Input({ required: true }) playheadPos!: Signal<number>;
  readonly playheadTransform = mkTranslateX(computed(() => Math.round(this.time2x(this.playheadPos()))));
  readonly crosshairXTransform = mkTranslateX(this.visMouseX);
  readonly crosshairYTransform = mkTranslateY(this.visMouseY);

  @Input() showCrosshair = true;
  @Output() playheadSeek: EventEmitter<number> = new EventEmitter();

  #viewportSize = computed(() => ({ blockSize: 0, inlineSize: 0 }));
  get viewportSize() { return this.#viewportSize }
  readonly pxPerTime = computed(() => this.viewportSize().inlineSize / this.timeRange());
  readonly pxPerPitch = computed(() => this.viewportSize().blockSize / this.pitchRange());

  constructor(private readonly environmentInjector: EnvironmentInjector) { }

  #specContainerBoundingClientRect!: DOMRect;
  @ViewChild('specContainer') set specContainer(elemRef: ElementRef<HTMLElement>) {
    this.#specContainerBoundingClientRect = elemRef.nativeElement.getBoundingClientRect();
    runInInjectionContext(this.environmentInjector, () => {
      this.#viewportSize = elemBoxSizeSignal(elemRef.nativeElement);
    })
  }

  onAudioLoad(duration: number) {
    this.#timeMin.set(0);
    this.#timeRange.set(duration);
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
    doScrollZoomTime(
      this.#timeMin, this.#timeRange, this.#audioDuration(),
      delta, zoom, offsetX / this.viewportSize().inlineSize,
    )
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    this.#visMouseX.set(event.clientX - this.#specContainerBoundingClientRect.x)
    const newMouseY = event.clientY - this.#specContainerBoundingClientRect.y;
    this.#visMouseY.set(newMouseY >= 0 ? newMouseY : undefined)
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    this.#visMouseX.set(undefined)
    this.#visMouseY.set(undefined)
  }

  readonly viewportOffset: Signal<{ block: number, inline: number }> = computed(() => {
    const { blockSize, inlineSize } = this.viewportSize();
    // TODO: refactor out of tile
    const tile = new GenSpecTile({ pitchMin: this.pitchMin(), pitchMax: this.pitchMax(), timeMin: this.timeMin(), timeMax: this.timeMax() }, { width: inlineSize, height: blockSize });
    const ret = { block: Math.round(tile.pitch2y(PITCH_MAX)), inline: Math.round(tile.time2x(0)) };
    return ret;
  });
  readonly offsetDivTransform = computed(() => `translate(${this.viewportOffset().inline}px,${this.viewportOffset().block}px)`);

  private isPanning = false;

  onSpecWheel(event: WheelEvent) {
    if (this.isPanning) return;
    event.preventDefault();
    const bounds = this.#specContainerBoundingClientRect;
    const [deltaX, deltaY] = event.shiftKey ? [event.deltaY, event.deltaX] : [event.deltaX, event.deltaY];
    const offsetX = event.clientX - bounds.x;
    const offsetY = event.clientY - bounds.y;

    if (deltaX !== 0) {
      this.#doWheel(deltaX, offsetX, event.ctrlKey);
    }
    if (deltaY !== 0) {
      doScrollZoomPitch(
        this.#pitchMin, this.#pitchRange, bounds.width / bounds.height,
        deltaY, event.ctrlKey, 1 - offsetY / bounds.height,
      );
    }
  }

  async onSpecMouseDown(event: MouseEvent) {
    if (event.button !== 1) return;
    event.preventDefault();
    const downClientX = event.clientX;
    const downClientY = event.clientY;
    const downTimeMin = this.timeMin();
    const downPitchMin = this.pitchMin();

    const onMoveSub = rxjs.fromEvent(document, 'mousemove').subscribe(ev_ => {
      const ev = ev_ as MouseEvent;

      const deltaTime = (ev.clientX - downClientX) / this.pxPerTime();
      this.#timeMin.set(lodash.clamp(downTimeMin - deltaTime, 0, this.audioDuration() - this.timeRange()));

      const deltaPitch = (ev.clientY - downClientY) / this.pxPerPitch();
      this.#pitchMin.set(lodash.clamp(downPitchMin + deltaPitch, 0, PITCH_MAX - this.pitchRange()));
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
