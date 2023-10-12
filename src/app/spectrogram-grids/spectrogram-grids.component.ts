import { ChangeDetectionStrategy, Component, Input, Signal, WritableSignal, computed, signal } from '@angular/core';
import { midiToNoteName } from '@tonaljs/midi';
import * as lodash from 'lodash-es';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';
import { Meter, PITCH_MAX, PitchLabelType, beat2time, time2beat } from '../ui-common';

@Component({
  selector: 'app-spectrogram-grids',
  templateUrl: './spectrogram-grids.component.html',
  styleUrls: ['./spectrogram-grids.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpectrogramGridsComponent {
  @Input() showPitchGrid: boolean = false;
  readonly _pitchLabelType$: WritableSignal<PitchLabelType> = signal('sharp');
  @Input() set pitchLabelType(v: PitchLabelType) { this._pitchLabelType$.set(v) }

  @Input() showCrosshair: boolean = true;
  @Input() showOvertones: boolean = false;

  @Input() set meter(x: Partial<Meter> | undefined) { this.#meter$.set(x ?? undefined) }
  readonly #meter$: WritableSignal<Partial<Meter> | undefined> = signal(undefined);

  constructor(private readonly viewport: AudioVisualizationComponent) { }

  overtoneYOffsets = computed(() => {
    const pxPerPitch = this.viewport.pxPerPitch();
    const s = this.viewport.viewportSize();
    return Array.from({ length: 7 }, (_x, i) => `translateY(${s.blockSize - Math.round(Math.log2(i + 2) * 12 * pxPerPitch)}px)`);
  });
  overtoneContainerTransform = computed(() => {
    const ox = this.viewport.viewportOffsetX();
    const oy = this.viewport.viewportOffsetY() + (this.viewport.visMouseY() ?? 0) - this.viewport.viewportSize().blockSize;
    return `translate(${ox}px,${oy}px)`;
  });

  pitchLabels = computed(() => {
    const px = this.#pitchTransform();
    return Array.from({ length: PITCH_MAX + 1 }, (_x, i) => ({
      xfm: px(PITCH_MAX - i),
      txt: pitchLabel(this._pitchLabelType$(), i),
    }));
  });
  pitchLabelFontSize = computed(() => lodash.clamp(Math.round(.8 * this.viewport.pxPerPitch()), 12, 20));

  #pitchTransform: () => (p: number) => string = () => {
    const pxPerPitch = this.viewport.pxPerPitch();
    return p => `translateY(${Math.round(p * pxPerPitch)}px)`
  }

  pitchGridBorders = computed(() => {
    const px = this.#pitchTransform();
    return Array.from({ length: PITCH_MAX + 1 }, (_x, i) => px(PITCH_MAX - i + .5));
  });
  pitchGridCenters = computed(() => {
    const px = this.#pitchTransform();
    return Array.from({ length: PITCH_MAX + 1 }, (_x, i) => px(PITCH_MAX - i));
  });
  showPitchGridCenters = computed(() => this.viewport.pxPerPitch() > 30);

  pitchContainerHeight = this.viewport.canvasHeight;
  pitchContainerTransform = computed(() => `translateX(${this.viewport.viewportOffsetX()}px)`);

  beatGrid: Signal<Array<{ xfm: string, m: boolean, s: boolean }>> = computed(() => {
    const meter = this.#meter$();
    const pxPerTime = this.viewport.pxPerTime()
    const timeTransform = (t: number) => `translateX(${Math.round(t * pxPerTime)}px)`;
    if (meter === undefined || meter.state === 'unset') {
      return [];
    } else if (meter.startOffset !== undefined && meter.bpm === undefined) {
      return [{ xfm: timeTransform(meter.startOffset), m: false, s: false }];
    } else if (!Meter.is(meter)) {
      return [];
    }
    const timeMax = this.viewport.timeMax();
    const secPerBeat = 60 / meter.bpm;
    const pixelsPerBeat = secPerBeat * pxPerTime;
    const windowLeftBeat = time2beat(meter, this.viewport.timeMin());
    if (pixelsPerBeat < 10) {
      const firstMeasure = Math.max(Math.ceil(windowLeftBeat / meter.measureLength), 0);
      const firstMeasureTime = beat2time(meter, firstMeasure * meter.measureLength);
      const secPerMeasure = secPerBeat * meter.measureLength;
      const length = Math.ceil((timeMax - firstMeasureTime) / secPerMeasure);
      if (length > 2000) { console.error("too many beats!", length); return []; }
      return Array.from({ length }, (_x, i) => ({
        xfm: timeTransform(firstMeasureTime + i * secPerMeasure),
        m: true,
        s: false,
      }))
    } else if (pixelsPerBeat < 100) {
      const firstBeat = Math.max(Math.ceil(windowLeftBeat), 0);
      const firstBeatTime = beat2time(meter, firstBeat);
      const length = Math.ceil((timeMax - firstBeatTime) / secPerBeat);
      if (length > 2000) { console.error("too many beats!", length); return []; }
      return Array.from({ length }, (_x, i) => ({
        xfm: timeTransform(firstBeatTime + i * secPerBeat),
        m: (firstBeat + i) % meter.measureLength === 0,
        s: false
      }))
    } else {
      const firstSubdiv = Math.max(Math.ceil(windowLeftBeat * meter.subdivision), 0);
      const firstSubdivTime = beat2time(meter, firstSubdiv / meter.subdivision);
      const secPerSubdiv = secPerBeat / meter.subdivision;
      const subdivsPerMeasure = meter.measureLength * meter.subdivision;
      const length = Math.ceil((timeMax - firstSubdivTime) / secPerSubdiv);
      if (length > 2000) { console.error("too many beats!", length); return []; }
      return Array.from({ length }, (_x, i) => ({
        xfm: timeTransform(firstSubdivTime + i * secPerSubdiv),
        m: (firstSubdiv + i) % subdivsPerMeasure === 0,
        s: (firstSubdiv + i) % meter.subdivision !== 0,
      }))
    }
  })

  beatContainerWidth = this.viewport.canvasWidth;
  beatContainerTransform = computed(() => `translateY(${this.viewport.viewportOffsetY()}px)`);

  trackIdx(idx: number, _item: any) { return idx }
}

function pitchLabel(label: PitchLabelType, pitch: number): string {
  if (label === 'midi') return `${pitch}`;
  return midiToNoteName(pitch, { sharps: label === 'sharp' }).replace('#', '♯').replace('b', '♭');
}
