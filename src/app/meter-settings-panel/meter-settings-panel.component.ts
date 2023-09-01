import { Component } from '@angular/core';
import { FormControl, ValidatorFn, Validators } from '@angular/forms';
import { flow } from 'fp-ts/lib/function';
import { Iso, Lens } from 'monocle-ts';
import * as rxjs from 'rxjs';
import { ProjectService } from '../project.service';
import { Meter, Project, ProjectLens } from '../ui-common';

@Component({
  selector: 'app-meter-settings-panel',
  templateUrl: './meter-settings-panel.component.html',
  styleUrls: ['./meter-settings-panel.component.css']
})
export class MeterSettingsPanelComponent {
  constructor(private project: ProjectService) {
    project.project$.pipe(rxjs.map((prj) => prj.meter.state === 'active'), rxjs.distinctUntilChanged()).forEach((isSet) => {
      if (isSet) {
        this.projectMeterCtrls.bpm.enable()
        this.projectMeterCtrls.startOffset.enable()
      } else {
        this.projectMeterCtrls.bpm.disable()
        this.projectMeterCtrls.startOffset.disable()
      }
    })
  }

  projectMeterCtrls = new ProjectMeterCtrls(this.project);

  get isMeterSet() { return this.project.project?.meter?.state !== 'unset' }

  onPickAllClick() {
    // TODO: implement
    this.project.modify(ProjectLens(['meter', 'state']).set('active'))
  }

  onOffsetPickClick(event: MouseEvent) {
    // TODO: global modal editing
    // if `isSet`, draw beat grid the whole time, otherwise just draw the cursor
    event.stopPropagation()
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
      formCtrl.valueChanges.pipe(rxjs.filter(_v => formCtrl.valid)).forEach(x => this.project.modify(lens.set(x), fusionTag));
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
