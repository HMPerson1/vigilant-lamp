import { Component, ElementRef, EventEmitter, Input, Output, Signal, computed, signal } from '@angular/core';
import { doScrollZoomTime, mkTranslateX, resizeSignal } from '../ui-common';

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

  readonly #visMouseX = signal<number | undefined>(undefined);
  readonly visMouseX = this.#visMouseX.asReadonly();

  @Input({ required: true }) playheadPos!: Signal<number>;
  readonly playheadTransform = mkTranslateX(computed(() => this.time2x(this.playheadPos())));
  readonly crosshairXTransform = mkTranslateX(this.visMouseX);

  @Input() showCrosshair = true;
  @Output() playheadSeek: EventEmitter<number> = new EventEmitter();

  readonly width: Signal<number>;

  constructor(hostElem: ElementRef<HTMLElement>) {
    const size = resizeSignal(hostElem.nativeElement, { box: 'content-box' });
    this.width = computed(() => size()?.contentRect.width ?? NaN);
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

    const delta = event.deltaX + event.deltaY
    if (delta) {
      doScrollZoomTime(
        this.#timeMin, this.#timeMax, this.#audioDuration(),
        delta, event.ctrlKey, event.offsetX / this.width(),
      )
    }
  }
}
