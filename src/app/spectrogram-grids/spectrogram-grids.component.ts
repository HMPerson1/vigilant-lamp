import { ChangeDetectionStrategy, Component, Input, WritableSignal, computed, signal } from '@angular/core';
import { midiToNoteName } from '@tonaljs/midi';
import * as lodash from 'lodash-es';
import { Subject } from 'rxjs';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';
import { GenSpecTile } from '../common';
import { Meter, PITCH_MAX, PitchLabelType, beat2time, time2beat } from '../ui-common';

@Component({
  selector: 'app-spectrogram-grids',
  templateUrl: './spectrogram-grids.component.html',
  styleUrls: ['./spectrogram-grids.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpectrogramGridsComponent {
  @Input() showPitchGrid: boolean = false;
  _pitchLabelType$: WritableSignal<PitchLabelType> = signal('sharp');
  @Input() set pitchLabelType(v: PitchLabelType) { this._pitchLabelType$.set(v) }

  @Input() showCrosshair: boolean = true;
  @Input() showOvertones: boolean = false;


  beatGrid: Array<{ x: number, m: boolean, s: boolean }> = [];
  @Input() set meter(x: Partial<Meter> | undefined) { this.#meter$.next(x ? x : undefined) }
  #meter$ = new Subject<Partial<Meter> | undefined>();

  constructor(private readonly viewport: AudioVisualizationComponent) { }

  overtoneYOffsets = computed(() => {
    const pxPerPitch = this.viewport.pxPerPitch();
    const s = this.viewport.viewportSize();
    return Array.from({ length: 7 }, (_x, i) => `translateY(${s.blockSize - Math.round(Math.log2(i + 2) * 12 * pxPerPitch)}px)`);
  });
  overtoneContainerTransform = computed(() => {
    const o = this.viewport.viewportOffset();
    const s = this.viewport.viewportSize();
    return `translate(${-o.inline}px,${(this.viewport.visMouseY() ?? 0) - o.block - s.blockSize}px)`;
  });

  pitchLabels = computed(() => {
    const pxPerPitch = this.viewport.pxPerPitch();
    return Array.from({ length: PITCH_MAX + 1 }, (_x, i) => ({
      xfm: `translateY(${Math.round((PITCH_MAX - i) * pxPerPitch)}px)`,
      txt: pitchLabel(this._pitchLabelType$(), i),
    }));
  });
  pitchLabelFontSize = computed(() => lodash.clamp(Math.round(.8 * this.viewport.pxPerPitch()), 12, 20));

  pitchGridBorders = computed(() => {
    const pxPerPitch = this.viewport.pxPerPitch();
    return Array.from({ length: PITCH_MAX + 1 }, (_x, i) =>
      `translateY(${Math.round((PITCH_MAX - i + .5) * pxPerPitch)}px)`);
  });
  pitchGridCenters = computed(() => {
    const pxPerPitch = this.viewport.pxPerPitch();
    return Array.from({ length: PITCH_MAX + 1 }, (_x, i) =>
      `translateY(${Math.round((PITCH_MAX - i) * pxPerPitch)}px)`);
  });
  showPitchGridCenters = computed(() => this.viewport.pxPerPitch() > 30);

  updateBeatGrid(render: GenSpecTile<DOMRect>, meter?: Partial<Meter>) {
    // TODO: this could be rendered more efficiently because of vertical translational symmetry
    if (meter === undefined || meter.state === 'unset') {
      this.beatGrid = [];
      return;
    } else if (meter.startOffset !== undefined && meter.bpm === undefined) {
      this.beatGrid = [{ x: Math.round(render.time2x(meter.startOffset)), m: false, s: false }];
      return;
    } else if (!Meter.is(meter)) {
      this.beatGrid = [];
      return;
    }
    const secPerBeat = 60 / meter.bpm;
    const pixelsPerBeat = secPerBeat * render.pixelsPerTime;
    const windowLeftBeat = time2beat(meter, render.timeMin);
    if (pixelsPerBeat < 10) {
      const firstMeasure = Math.max(Math.ceil(windowLeftBeat / meter.measureLength), 0);
      const firstMeasureTime = beat2time(meter, firstMeasure * meter.measureLength);
      const secPerMeasure = secPerBeat * meter.measureLength;
      const length = Math.ceil((render.timeMax - firstMeasureTime) / secPerMeasure);
      if (length > 2000) { this.beatGrid = []; throw new Error("too many beats"); }
      this.beatGrid = Array.from({ length }, (_x, i) => ({
        x: Math.round(render.time2x(firstMeasureTime + i * secPerMeasure)),
        m: true,
        s: false,
      }))
    } else if (pixelsPerBeat < 100) {
      const firstBeat = Math.max(Math.ceil(windowLeftBeat), 0);
      const firstBeatTime = beat2time(meter, firstBeat);
      const length = Math.ceil((render.timeMax - firstBeatTime) / secPerBeat);
      if (length > 2000) { this.beatGrid = []; throw new Error("too many beats"); }
      this.beatGrid = Array.from({ length }, (_x, i) => ({
        x: Math.round(render.time2x(firstBeatTime + i * secPerBeat)),
        m: (firstBeat + i) % meter.measureLength === 0,
        s: false
      }))
    } else {
      const firstSubdiv = Math.max(Math.ceil(windowLeftBeat * meter.subdivision), 0);
      const firstSubdivTime = beat2time(meter, firstSubdiv / meter.subdivision);
      const secPerSubdiv = secPerBeat / meter.subdivision;
      const subdivsPerMeasure = meter.measureLength * meter.subdivision;
      const length = Math.ceil((render.timeMax - firstSubdivTime) / secPerSubdiv);
      if (length > 2000) { this.beatGrid = []; throw new Error("too many beats"); }
      this.beatGrid = Array.from({ length }, (_x, i) => ({
        x: Math.round(render.time2x(firstSubdivTime + i * secPerSubdiv)),
        m: (firstSubdiv + i) % subdivsPerMeasure === 0,
        s: (firstSubdiv + i) % meter.subdivision !== 0,
      }))
    }
  }

  trackIdx(idx: number, _item: any) { return idx }
}

function pitchLabel(label: PitchLabelType, pitch: number): string {
  if (label === 'midi') return `${pitch}`;
  return midiToNoteName(pitch, { sharps: label === 'sharp' }).replace('#', '♯').replace('b', '♭');
}
