import { CdkPortal } from '@angular/cdk/portal';
import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormControl, ValidatorFn, Validators } from '@angular/forms';
import { flow } from 'fp-ts/function';
import { Iso, Lens } from 'monocle-ts';
import * as rxjs from 'rxjs';
import { ProjectService } from '../project.service';
import { Meter, ModalSpectrogramEdit, Project, ProjectLens } from '../ui-common';

@Component({
  selector: 'app-meter-settings-panel',
  templateUrl: './meter-settings-panel.component.html',
  styleUrls: ['./meter-settings-panel.component.css']
})
export class MeterSettingsPanelComponent {
  @Input() modalEdit?: ModalSpectrogramEdit;

  @Output() liveMeter = new EventEmitter<Partial<Meter>>();

  @ViewChild("portalHelpOffset") portalHelpOffset!: CdkPortal;
  @ViewChild("portalHelpTempo") portalHelpTempo!: CdkPortal;
  @ViewChild("portalHelpOffsetEdit") portalHelpOffsetEdit!: CdkPortal;
  @ViewChild("portalHelpTempoEdit") portalHelpTempoEdit!: CdkPortal;

  constructor(private project: ProjectService) {
    project.project$.pipe(rxjs.map((prj) => prj.meter.state === 'active'), rxjs.distinctUntilChanged()).forEach((isSet) => {
      if (isSet) {
        this.projectMeterCtrls.bpm.enable({ emitEvent: false })
        this.projectMeterCtrls.startOffset.enable({ emitEvent: false })
      } else {
        this.projectMeterCtrls.bpm.disable({ emitEvent: false })
        this.projectMeterCtrls.startOffset.disable({ emitEvent: false })
      }
    })
    project.project$.forEach(prj => this.liveMeter.emit(prj.meter));
  }

  projectMeterCtrls = new ProjectMeterCtrls(this.project);

  get isMeterSet() { return this.project.project?.meter?.state !== 'unset' }

  async onPickAllClick() {
    const initMeter0 = this.project.project?.meter;
    if (!this.modalEdit || !initMeter0) return;

    try {
      const initMeter1: Partial<Meter> = { ...initMeter0, state: 'active', bpm: undefined, startOffset: undefined };

      const newOffset = await this.modalEdit.click(
        this.portalHelpOffset,
        'mouse',
        () => true,
        v => this.liveMeter.emit({ ...initMeter1, startOffset: v }),
      );
      if (newOffset === undefined) return;
      const initMeter2 = { ...initMeter1, startOffset: newOffset };

      const beat2 = await this.modalEdit.click(
        this.portalHelpTempo,
        'mouse',
        v => v > newOffset,
        v => this.liveMeter.emit(v !== undefined ? { ...initMeter2, bpm: 60 / (v - newOffset) } : initMeter2),
      );
      if (beat2 === undefined) return;

      this.project.modify(flow(
        ProjectLens(['meter', 'state']).set('active'),
        ProjectLens(['meter', 'startOffset']).set(Math.round(newOffset * 100000) / 100000),
        ProjectLens(['meter', 'bpm']).set(Math.round(100 * 60 / (beat2 - newOffset)) / 100),
      ))
    } finally {
      this.liveMeter.emit(this.project.project?.meter);
    }
  }

  async onOffsetEditClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const initMeter = this.project.project?.meter;
    if (!this.modalEdit || !initMeter) return;

    try {
      const offsetOffset = await this.modalEdit.drag(
        this.portalHelpOffsetEdit,
        'mouse',
        'grab',
        (start, end) => end - start,
        v => this.liveMeter.emit({ ...initMeter, startOffset: initMeter.startOffset + v })
      );
      if (offsetOffset === undefined) return;

      this.project.modify(
        ProjectLens(['meter', 'startOffset']).modify(o => Math.round((o + offsetOffset) * 100000) / 100000),
      )
    } finally {
      this.liveMeter.emit(this.project.project?.meter);
    }
  }

  async onTempoEditClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const initMeter = this.project.project?.meter;
    if (!this.modalEdit || !initMeter) return;

    try {
      const tempoScaleLn = await this.modalEdit.drag(
        this.portalHelpTempoEdit,
        'mouse',
        'resize',
        (start, end) => start > initMeter.startOffset && end > initMeter.startOffset ? Math.log((start - initMeter.startOffset) / (end - initMeter.startOffset)) : undefined,
        v => this.liveMeter.emit({ ...initMeter, bpm: initMeter.bpm * Math.exp(v) }),
      );
      if (tempoScaleLn === undefined) return;

      this.project.modify(
        ProjectLens(['meter', 'bpm']).modify(bpm => Math.round(100 * bpm * Math.exp(tempoScaleLn)) / 100),
      )
    } finally {
      this.liveMeter.emit(this.project.project?.meter);
    }
  }

  onOffsetBumpBeat(dir: number) {
    if (!this.isMeterSet) return;
    this.project.modify((prj) => ProjectLens(['meter', 'startOffset']).modify(x => x + dir * 60 / prj.meter.bpm)(prj), 'startOffsetBump')
    // TODO: this should adjust the representation of notes so that the real time stays constant
  }
  onTempoMult(factor: number, dir: 1 | -1) {
    if (!this.isMeterSet) return;
    this.project.modify(flow(
      ProjectLens(['meter', 'bpm']).modify(x => dir === 1 ? x * factor : x / factor),
      ProjectLens(['meter', 'measureLength']).modify(x => dir === 1 ? x * factor : x % factor === 0 ? x / factor : x),
    ))
    // TODO: this should adjust the representation of notes so that the real time stays constant
  }
}

const bindProjectCtrl =
  <U>(lens: Lens<Project, U>, fusionTag?: string): (this: { project: ProjectService; }, formCtrl: FormControl<U>) => FormControl<U> =>
    function (formCtrl: FormControl<U>) {
      this.project.project$.forEach(prj => formCtrl.setValue(lens.get(prj), { emitEvent: false }));
      formCtrl.valueChanges.pipe(rxjs.filter(_v => formCtrl.valid)).forEach(x => {
        if (this.project.project && lens.get(this.project.project) !== x) this.project.modify(lens.set(x), fusionTag);
      });
      return formCtrl;
    }

const bindProjectMeterCtrl = <Name extends keyof Meter>(useFusionTag: boolean = false) => <This extends { project: ProjectService }>(_x: undefined, ctxt: ClassFieldDecoratorContext<This, FormControl<Meter[Name]>> & { name: Name }) => {
  const fieldName: Name = ctxt.name;
  return bindProjectCtrl(ProjectLens(['meter', fieldName]), useFusionTag ? fieldName : undefined)
}
const bindProjectMeterCtrlWithIso = <Name extends keyof Meter, U>(useFusionTag: boolean = false, iso: Iso<Meter[Name], U>) => <This extends { project: ProjectService }>(_x: undefined, ctxt: ClassFieldDecoratorContext<This, FormControl<U>> & { name: Name }) => {
  const fieldName: Name = ctxt.name;
  return bindProjectCtrl(ProjectLens(['meter', fieldName]).composeIso(iso), useFusionTag ? fieldName : undefined)
}

class ProjectMeterCtrls {
  constructor(readonly project: ProjectService) { }

  @bindProjectMeterCtrlWithIso(true, new Iso(x => x * 1000, x => x / 1000))
  startOffset = new FormControl<number>(NaN, { nonNullable: true, validators: [Validators.required] });

  @bindProjectMeterCtrl(true)
  bpm = new FormControl<number>(NaN, { nonNullable: true, validators: [Validators.required] });

  @bindProjectMeterCtrl()
  measureLength = new FormControl<number>(NaN, { nonNullable: true, validators: [Validators.required, integral] });

  @bindProjectMeterCtrl()
  subdivision = new FormControl<number>(NaN, { nonNullable: true, validators: [Validators.required, integral] });
}

const integral: ValidatorFn = (x) => (Number.isSafeInteger(x.value) ? null : { 'integral': x.value });
