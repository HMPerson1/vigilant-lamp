import { Component, ElementRef, EventEmitter, HostListener, Input, Output, Signal, ViewChild, computed, signal } from '@angular/core';
import { GenSpecTile } from '../common';
import { PITCH_MAX, doScrollZoomPitch, doScrollZoomTime, elemBoxSizeSignal, mkTranslateX, mkTranslateY } from '../ui-common';

@Component({
  selector: 'app-audio-visualization',
  templateUrl: './audio-visualization.component.html',
  styleUrls: ['./audio-visualization.component.css'],
})
export class AudioVisualizationComponent {
  readonly #timeMin = signal(0);
  readonly #timeMax = signal(30);
  readonly timeMin = this.#timeMin.asReadonly();
  readonly timeMax = this.#timeMax.asReadonly();
  readonly timeRange = computed(() => this.timeMax() - this.timeMin());

  readonly #audioDuration = signal(30);
  readonly audioDuration = this.#audioDuration.asReadonly();

  readonly #pitchMin = signal(12);
  readonly #pitchMax = signal(108);
  readonly pitchMin = this.#pitchMin.asReadonly();
  readonly pitchMax = this.#pitchMax.asReadonly();
  readonly pitchRange = computed(() => this.pitchMax() - this.pitchMin());

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

  readonly viewportSize: Signal<ResizeObserverSize>;

  constructor(private readonly hostElem: ElementRef<HTMLElement>) {
    this.viewportSize = elemBoxSizeSignal(hostElem.nativeElement);
  }

  onAudioLoad(duration: number) {
    this.#timeMin.set(0);
    this.#timeMax.set(duration);
    this.#audioDuration.set(duration);
  }

  onWaveformClick(event: MouseEvent) {
    event.preventDefault()
    this.playheadSeek.emit(this.x2time(event.offsetX));
  }

  x2time(x: number) { return x / this.viewportSize().inlineSize * this.timeRange() + this.timeMin() }
  time2x(t: number) { return (t - this.timeMin()) / this.timeRange() * this.viewportSize().inlineSize }

  onWaveformWheel(event: WheelEvent) {
    event.preventDefault()
    // TODO: scroll pixel/line/page ???
    this.#doWheel(event.deltaX + event.deltaY, event.offsetX, event.ctrlKey);
  }

  #doWheel(delta: number, offsetX: number, zoom: boolean) {
    doScrollZoomTime(
      this.#timeMin, this.#timeMax, this.#audioDuration(),
      delta, zoom, offsetX / this.viewportSize().inlineSize,
    )
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    this.#visMouseX.set(event.clientX - this.hostElem.nativeElement.getBoundingClientRect().x)
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    this.#visMouseX.set(undefined)
  }

  @ViewChild('specContainer') specContainer?: ElementRef<HTMLElement>;

  onSpecMouseMove(event: MouseEvent) {
    this.#visMouseY.set(event.clientY - this.specContainer!.nativeElement.getBoundingClientRect().y)
  }

  onSpecMouseLeave() {
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
    const bounds = this.hostElem.nativeElement.getBoundingClientRect();
    const [deltaX, deltaY] = event.shiftKey ? [event.deltaY, event.deltaX] : [event.deltaX, event.deltaY];
    const offsetX = event.clientX - bounds.x;
    const offsetY = event.clientY - bounds.y;

    this.#doWheel(deltaX, offsetX, event.ctrlKey);
    doScrollZoomPitch(
      this.#pitchMin, this.#pitchMax, bounds.width / bounds.height,
      deltaY, event.ctrlKey, 1 - offsetY / bounds.height,
    );
  }
}
