import { CdkPortal } from '@angular/cdk/portal';
import { Component, EventEmitter, Input, Output, TemplateRef, ViewChild, computed, effect } from '@angular/core';
import { FormControl, ValidatorFn, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import * as O from 'fp-ts/Option';
import { flow, pipe } from 'fp-ts/function';
import { Optional } from 'monocle-ts';
import * as rxjs from 'rxjs';
import { ProjectService } from '../services/project.service';
import { Meter, MeterLens, ModalSpectrogramEdit, PULSES_PER_BEAT, Project, ProjectOptional } from '../ui-common';
import { isNonnull } from '../utils/ho-signals';

@Component({
  selector: 'app-meter-settings-panel',
  templateUrl: './meter-settings-panel.component.html',
  styleUrls: ['./meter-settings-panel.component.css']
})
export class MeterSettingsPanelComponent {
  @Input({ required: true }) modalEdit!: ModalSpectrogramEdit;

  @Output() readonly liveMeter = new EventEmitter<Partial<Meter>>();

  @ViewChild("portalHelpOffset") portalHelpOffset!: CdkPortal;
  @ViewChild("portalHelpTempo") portalHelpTempo!: CdkPortal;
  @ViewChild("portalHelpOffsetEdit") portalHelpOffsetEdit!: CdkPortal;
  @ViewChild("portalHelpTempoEdit") portalHelpTempoEdit!: CdkPortal;

  constructor(private readonly project: ProjectService, private readonly dialog: MatDialog) {
    effect(() => {
      if (this.isMeterActive()) {
        this.projectMeterCtrls.bpm.enable({ emitEvent: false })
        this.projectMeterCtrls.startOffset.enable({ emitEvent: false })
      } else {
        this.projectMeterCtrls.bpm.disable({ emitEvent: false })
        this.projectMeterCtrls.startOffset.disable({ emitEvent: false })
      }
    });
    effect(() => {
      this.liveMeter.emit(project.currentProjectRaw()?.project().meter ?? {})
    });
  }

  readonly projectMeterCtrls = new ProjectMeterCtrls(this.project);

  readonly isMeterSet = computed(() => this.project.currentProjectRaw()?.project()?.meter !== undefined)
  readonly isMeterActive = computed(() => this.project.currentProjectRaw()?.project()?.meter?.state === 'active')
  readonly isMeterLocked = computed(() => this.project.currentProjectRaw()?.project()?.meter?.state === 'locked')

  async onPickAllClick() {
    const projectHolder = this.project.currentProjectRaw();
    if (projectHolder === undefined) return;

    try {
      const initMeter0 = projectHolder.project().meter;
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

      projectHolder.modify(p => ({
        ...p,
        meter: {
          state: 'active',
          startOffset: Math.round(newOffset * 100000) / 100000, // round to .01 milliseconds
          bpm: Math.round(100 * 60 / (beat2 - newOffset)) / 100, // round to .01 bpm
          measureLength: p.meter?.measureLength ?? 4,
          subdivision: p.meter?.subdivision ?? 2,
        },
      }));
    } finally {
      this.liveMeter.emit(projectHolder.project().meter ?? {});
    }
  }

  async onOffsetEditClick(event: MouseEvent) {
    event.stopPropagation();

    const projectHolder = this.project.currentProjectRaw();
    if (!projectHolder) return;
    const initMeter = projectHolder.project().meter;
    if (!initMeter) return;

    try {
      const offsetOffset = await this.modalEdit.drag(
        this.portalHelpOffsetEdit,
        'mouse',
        'grab',
        (start, end) => end - start,
        v => this.liveMeter.emit({ ...initMeter, startOffset: initMeter.startOffset + v })
      );
      if (offsetOffset === undefined) return;

      projectHolder.modify(
        ProjectOptional(['meter', 'startOffset']).modify(o => Math.round((o + offsetOffset) * 100000) / 100000),
      );
    } finally {
      this.liveMeter.emit(projectHolder.project().meter ?? {});
    }
  }

  async onTempoEditClick(event: MouseEvent) {
    event.stopPropagation();

    const projectHolder = this.project.currentProjectRaw();
    if (!projectHolder) return;
    const initMeter = projectHolder.project().meter;
    if (!initMeter) return;

    try {
      const tempoScaleLn = await this.modalEdit.drag(
        this.portalHelpTempoEdit,
        'mouse',
        'resize',
        (start, end) => start > initMeter.startOffset && end > initMeter.startOffset ? Math.log((start - initMeter.startOffset) / (end - initMeter.startOffset)) : undefined,
        v => this.liveMeter.emit({ ...initMeter, bpm: initMeter.bpm * Math.exp(v) }),
      );
      if (tempoScaleLn === undefined) return;

      projectHolder.modify(
        ProjectOptional(['meter', 'bpm']).modify(bpm => Math.round(100 * bpm * Math.exp(tempoScaleLn)) / 100),
      );
    } finally {
      this.liveMeter.emit(projectHolder.project().meter ?? {});
    }
  }

  onOffsetBumpBeat(dir: number) {
    if (!this.isMeterSet()) return;
    this.project.currentProjectRaw()?.modify(
      ProjectOptional(['meter']).modify(m => MeterLens('startOffset').modify(x => x + dir * 60 / m.bpm)(m)),
      { fusionTag: 'startOffsetBump' },
    );
    // TODO: this should adjust the representation of notes so that the real time stays constant
  }
  onTempoMult(factor: number, dir: 1 | -1) {
    if (!this.isMeterSet()) return;
    this.project.currentProjectRaw()?.modify(flow(
      ProjectOptional(['meter', 'bpm']).modify(x => dir === 1 ? x * factor : x / factor),
      ProjectOptional(['meter', 'measureLength']).modify(x => dir === 1 ? x * factor : x % factor === 0 ? x / factor : x),
    ));
    // TODO: this should adjust the representation of notes so that the real time stays constant
  }

  @ViewChild('meterUnlockDialog') meterUnlockDialog!: TemplateRef<this>;

  onToggleLockClick() {
    const projectHolder = this.project.currentProjectRaw();
    if (!projectHolder) return;
    const meter = projectHolder.project().meter;
    if (!meter) return;
    if (meter.state === 'locked') {
      this.dialog.open(this.meterUnlockDialog).afterClosed().subscribe(v => {
        if (v) {
          projectHolder.modify(ProjectOptional(['meter', 'state']).set('active'));
        }
      });
    } else {
      projectHolder.modify(ProjectOptional(['meter', 'state']).set('locked'));
    }
  }

  readonly PULSES_PER_BEAT = PULSES_PER_BEAT;
}

const bindProjectCtrl =
  <U extends {}>(lens: Optional<Project, U>, fusionTag?: string): (this: { project: ProjectService; }, formCtrl: FormControl<U | null>) => FormControl<U | null> =>
    function (formCtrl: FormControl<U | null>) {
      effect(() => {
        formCtrl.reset(
          pipe(
            O.fromNullable(this.project.currentProjectRaw()?.project()),
            O.flatMap(lens.getOption),
            O.toNullable,
          ),
          { emitEvent: false },
        );
      });
      formCtrl.valueChanges.pipe(rxjs.filter(_v => formCtrl.valid), rxjs.filter(isNonnull)).forEach(x => {
        const projectHolder = this.project.currentProjectRaw();
        if (!projectHolder) return;
        const storedVal = lens.getOption(projectHolder.project());
        // TODO: maybe preserveSelection?
        if (O.match(() => false, v => v !== x)(storedVal)) projectHolder.modify(lens.set(x), { fusionTag });
      });
      return formCtrl;
    }

const bindProjectMeterCtrl = <Name extends keyof Meter>(useFusionTag: boolean = false) => <This extends { project: ProjectService }>(_x: undefined, ctxt: ClassFieldDecoratorContext<This, FormControl<Meter[Name] | null>> & { name: Name }) => {
  const fieldName: Name = ctxt.name;
  return bindProjectCtrl(ProjectOptional(['meter', fieldName]), useFusionTag ? fieldName : undefined)
}

class ProjectMeterCtrls {
  constructor(readonly project: ProjectService) { }

  @bindProjectMeterCtrl(true)
  startOffset = new FormControl<number | null>(null, { validators: [Validators.required] });

  @bindProjectMeterCtrl(true)
  bpm = new FormControl<number | null>(null, { validators: [Validators.required] });

  @bindProjectMeterCtrl()
  measureLength = new FormControl<number | null>(null, { validators: [Validators.required, integral] });

  @bindProjectMeterCtrl()
  subdivision = new FormControl<number | null>(null, { validators: [Validators.required, integral, validSubdivision] });
}

const integral: ValidatorFn = (x) => (Number.isSafeInteger(x.value) ? null : { 'integral': x.value });
const validSubdivision: ValidatorFn = (x) => (96 % x.value == 0 ? null : { 'validSubdivision': x.value });
