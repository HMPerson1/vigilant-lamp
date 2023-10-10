import { ChangeDetectionStrategy, Component, ElementRef, Input, computed } from '@angular/core';
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
  @Input() pitchLabelType: PitchLabelType = 'sharp';

  @Input() showCrosshair: boolean = true;
  @Input() showOvertones: boolean = false;

  pitchGridBorders = Array.from({ length: PITCH_MAX + 1 }, (_x, i) => ({ p: i, y: 0 }))
  pitchGridCenters = Array.from({ length: PITCH_MAX + 1 }, (_x, i) => ({ p: i, y: 0 }))
  showPitchGridCenters = false;
  pitchLabels = Array.from({ length: PITCH_MAX + 1 }, (_x, i) => ({ p: i, y: 0, txt: "" }))
  pitchLabelFontSize = 0;
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

  gridYOffset = 0;

  beatGrid: Array<{ x: number, m: boolean, s: boolean }> = [];
  @Input() set meter(x: Partial<Meter> | undefined) { this.#meter$.next(x ? x : undefined) }
  #meter$ = new Subject<Partial<Meter> | undefined>();

  constructor(elemRef: ElementRef<HTMLElement>, private readonly viewport: AudioVisualizationComponent) {
  }

  updatePitchGrid(winParams: GenSpecTile<DOMRect>, label: PitchLabelType) {
    this.gridYOffset = Math.round(winParams.pitch2y(0))
    // for (const o of this.overtoneYOffsets) {
    //   o.y = Math.round(Math.log2(o.i) * 12 * winParams.pixelsPerPitch) - this.gridYOffset
    // }
    for (const o of this.pitchGridBorders) {
      o.y = Math.round(winParams.pitch2y(o.p - 0.5)) - this.gridYOffset
    }
    for (const o of this.pitchGridCenters) {
      o.y = Math.round(winParams.pitch2y(o.p)) - this.gridYOffset
    }
    this.showPitchGridCenters = winParams.pixelsPerPitch > 30
    for (const o of this.pitchLabels) {
      o.y = Math.round(winParams.pitch2y(o.p)) - this.gridYOffset
      o.txt = pitchLabel(label, o.p)
    }
    this.pitchLabelFontSize = lodash.clamp(Math.round(.8 * winParams.pixelsPerPitch), 12, 20)
  }

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
