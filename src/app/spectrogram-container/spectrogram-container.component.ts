import { Component, ElementRef, HostListener, Signal, computed, signal } from '@angular/core';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';
import { GenSpecTile } from '../common';
import { PITCH_MAX, doScrollZoomPitch, elemBoxSizeSignal } from '../ui-common';

@Component({
  selector: 'app-spectrogram-container',
  templateUrl: './spectrogram-container.component.html',
  styleUrls: ['./spectrogram-container.component.css'],
})
export class SpectrogramContainerComponent {
  readonly timeMin = this.audioVizContainer.timeMin;
  readonly timeMax = this.audioVizContainer.timeMax;

  readonly #pitchMin = signal(12);
  readonly #pitchMax = signal(108);
  readonly pitchMin = this.#pitchMin.asReadonly();
  readonly pitchMax = this.#pitchMax.asReadonly();

  readonly #visMouseX = signal<number | undefined>(undefined);
  readonly #visMouseY = signal<number | undefined>(undefined);
  /** offset space of `visElem` */
  readonly visMouseX = this.#visMouseX.asReadonly();
  /** offset space of `visElem` */
  readonly visMouseY = this.#visMouseY.asReadonly();

  readonly viewportSize: Signal<ResizeObserverSize>;

  constructor(private readonly audioVizContainer: AudioVisualizationComponent, private readonly hostElem: ElementRef<HTMLElement>) {
    this.viewportSize = elemBoxSizeSignal(hostElem.nativeElement);
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

  @HostListener('mousewheel', ['$event'])
  onWheel(event: WheelEvent) {
    if (this.isPanning) return;
    event.preventDefault();
    const bounds = this.hostElem.nativeElement.getBoundingClientRect();
    const [deltaX, deltaY] = event.shiftKey ? [event.deltaY, event.deltaX] : [event.deltaX, event.deltaY];
    const offsetX = event.clientX - bounds.x;
    const offsetY = event.clientY - bounds.y;

    this.audioVizContainer.doWheel(deltaX, offsetX, event.ctrlKey);
    doScrollZoomPitch(
      this.#pitchMin, this.#pitchMax, bounds.width / bounds.height,
      deltaY, event.ctrlKey, 1 - offsetY / bounds.height,
    );
  }
}
