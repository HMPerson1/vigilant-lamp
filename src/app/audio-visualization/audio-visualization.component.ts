import { Component, ElementRef, EventEmitter, HostListener, Input, Output, Signal, computed, signal } from '@angular/core';
import { doScrollZoomTime, elemBoxSizeSignal, mkTranslateX } from '../ui-common';

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

  readonly #visMouseX = signal<number | undefined>(undefined);
  readonly visMouseX = this.#visMouseX.asReadonly();

  @Input({ required: true }) playheadPos!: Signal<number>;
  readonly playheadTransform = mkTranslateX(computed(() => Math.round(this.time2x(this.playheadPos()))));
  readonly crosshairXTransform = mkTranslateX(this.visMouseX);

  @Input() showCrosshair = true;
  @Output() playheadSeek: EventEmitter<number> = new EventEmitter();

  readonly width: Signal<number>;

  constructor(private readonly hostElem: ElementRef<HTMLElement>) {
    const size = elemBoxSizeSignal(hostElem.nativeElement);
    this.width = computed(() => size().inlineSize);
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

  x2time(x: number) { return x / this.width() * this.timeRange() + this.timeMin() }
  time2x(t: number) { return (t - this.timeMin()) / this.timeRange() * this.width() }

  onWheel(event: WheelEvent) {
    event.preventDefault()
    // TODO: scroll pixel/line/page ???
    this.doWheel(event.deltaX + event.deltaY, event.offsetX, event.ctrlKey);
  }

  doWheel(delta: number, offsetX: number, zoom: boolean) {
    doScrollZoomTime(
      this.#timeMin, this.#timeMax, this.#audioDuration(),
      delta, zoom, offsetX / this.width(),
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
}
