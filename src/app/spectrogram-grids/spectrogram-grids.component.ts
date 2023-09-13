import { Component, ElementRef, HostListener, Input } from '@angular/core';
import { midiToNoteName } from '@tonaljs/midi';
import * as lodash from 'lodash-es';
import { fromInput } from 'observable-from-input';
import { Subject, animationFrameScheduler, combineLatest, debounceTime } from 'rxjs';
import { GenSpecTile } from '../common';
import { Meter, PITCH_MAX, PitchLabelType, beat2time, time2beat } from '../ui-common';

@Component({
  selector: 'app-spectrogram-grids',
  templateUrl: './spectrogram-grids.component.html',
  styleUrls: ['./spectrogram-grids.component.css']
})
export class SpectrogramGridsComponent {
  @Input() timeMin: number = 0;
  @Input() timeMax: number = 30;
  @Input() pitchMin: number = 12;
  @Input() pitchMax: number = 108;

  @Input() showPitchGrid: boolean = false;
  @Input() pitchLabelType: PitchLabelType = 'sharp';

  @Input() mouseY?: number;
  @Input() showCrosshair: boolean = true;
  @Input() showOvertones: boolean = false;

  pitchGridBorders = Array.from({ length: PITCH_MAX + 1 }, (_x, i) => ({ p: i, y: 0 }))
  pitchGridCenters = Array.from({ length: PITCH_MAX + 1 }, (_x, i) => ({ p: i, y: 0 }))
  showPitchGridCenters = false;
  pitchLabels = Array.from({ length: PITCH_MAX + 1 }, (_x, i) => ({ p: i, y: 0, txt: "" }))
  pitchLabelFontSize = 0;
  overtoneYOffsets = Array.from({ length: 7 }, (_x, ii) => ({ i: ii + 2, y: 0 }))

  beatGrid: Array<{ x: number, m: boolean, s: boolean }> = [];
  @Input() set meter(x: Partial<Meter> | undefined) { this.#meter$.next(x ? x : undefined) }
  #meter$ = new Subject<Partial<Meter> | undefined>();

  constructor(elemRef: ElementRef<HTMLElement>) {
    const toObs = fromInput(this);
    const timeMin$ = toObs('timeMin')
    const timeMax$ = toObs('timeMax')
    const pitchMin$ = toObs('pitchMin')
    const pitchMax$ = toObs('pitchMax')
    const pitchLabelType$ = toObs('pitchLabelType')

    const hostElem = elemRef.nativeElement;

    const renderWinParam$s = {
      timeMin: timeMin$,
      timeMax: timeMax$,
      pitchMin: pitchMin$,
      pitchMax: pitchMax$,
    }

    combineLatest({
      pitchLabelType: pitchLabelType$,
      ...renderWinParam$s
    }).pipe(debounceTime(0, animationFrameScheduler)).subscribe(params => {
      this.updatePitchGrid(new GenSpecTile(params, hostElem.getBoundingClientRect()), params.pitchLabelType);
    })

    combineLatest({
      meter: this.#meter$,
      ...renderWinParam$s
    }).pipe(debounceTime(0, animationFrameScheduler)).subscribe(params => {
      this.updateBeatGrid(new GenSpecTile(params, hostElem.getBoundingClientRect()), params.meter);
    })
  }

  updatePitchGrid(winParams: GenSpecTile<DOMRect>, label: PitchLabelType) {
    for (const o of this.overtoneYOffsets) {
      o.y = Math.round(Math.log2(o.i) * 12 / winParams.pitchPerPixel)
    }
    for (const o of this.pitchGridBorders) {
      o.y = Math.round(winParams.pitch2y(o.p - 0.5))
    }
    for (const o of this.pitchGridCenters) {
      o.y = Math.round(winParams.pitch2y(o.p))
    }
    this.showPitchGridCenters = 1 / winParams.pitchPerPixel > 30
    for (const o of this.pitchLabels) {
      o.y = winParams.pitch2y(o.p)
      o.txt = pitchLabel(label, o.p)
    }
    this.pitchLabelFontSize = lodash.clamp(Math.round(.8 / winParams.pitchPerPixel), 12, 20)
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
    const pixelsPerBeat = secPerBeat / render.timePerPixel;
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
