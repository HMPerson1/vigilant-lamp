import { CdkPortal } from '@angular/cdk/portal';
import { Component, Input, TemplateRef, ViewChild, computed, effect, linkedSignal, output, untracked } from '@angular/core';
import { FormField, disabled, form, max, min, required, validate } from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import * as RA from 'fp-ts/ReadonlyArray';
import { flow } from 'fp-ts/function';
import { fromTraversable } from 'monocle-ts';
import { Meter, NoteL, PULSES_PER_BEAT, PartL, ProjectLop, ProjectLp } from '../../model/project';
import { ProjectService } from '../services/project.service';
import { ModalSpectrogramEdit } from '../ui-common';

@Component({
  selector: 'app-meter-settings-panel',
  templateUrl: './meter-settings-panel.component.html',
  styleUrls: ['./meter-settings-panel.component.css'],
  imports: [MatButton, MatIcon, MatFormField, MatLabel, MatInput, MatHint, MatIconButton, MatSuffix, MatTooltip, CdkPortal, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, FormField]
})
export class MeterSettingsPanelComponent {
  @Input({ required: true }) modalEdit!: ModalSpectrogramEdit;

  readonly liveMeter = output<Partial<Meter>>();

  readonly meterFormModel = linkedSignal<{ [P in keyof Meter]: Meter[P] | null }>(() => (
    this.project.currentProjectRaw()?.project().meter
    ?? {
      state: null,
      startOffset: null,
      bpm: null,
      measureLength: null,
      subdivision: null
    }
  ));
  readonly formTree = form(this.meterFormModel, (sp) => {
    required(sp.startOffset);
    disabled(sp.startOffset, { when: ctx => ctx.valueOf(sp.state) !== 'active' });

    required(sp.bpm);
    min(sp.bpm, 0);
    disabled(sp.bpm, { when: ctx => ctx.valueOf(sp.state) !== 'active' });

    required(sp.measureLength);
    min(sp.measureLength, 1);
    validate(sp.measureLength, ({ value }) => (Number.isSafeInteger(value()) ? undefined : { kind: 'integral' }));
    disabled(sp.measureLength, { when: ctx => ctx.valueOf(sp.state) === null });

    required(sp.subdivision);
    min(sp.subdivision, 1);
    max(sp.subdivision, PULSES_PER_BEAT);
    validate(sp.subdivision, ({ value }) => (Number.isSafeInteger(value()) ? undefined : { kind: 'integral' }));
    validate(sp.subdivision, ({ value }) => (PULSES_PER_BEAT % (value() ?? 0) === 0 ? undefined : { kind: 'validSubdivision' }));
    disabled(sp.subdivision, { when: ctx => ctx.valueOf(sp.state) === null });
  });

  @ViewChild("portalHelpOffset", { static: true }) portalHelpOffset!: CdkPortal;
  @ViewChild("portalHelpTempo", { static: true }) portalHelpTempo!: CdkPortal;
  @ViewChild("portalHelpOffsetEdit", { static: true }) portalHelpOffsetEdit!: CdkPortal;
  @ViewChild("portalHelpTempoEdit", { static: true }) portalHelpTempoEdit!: CdkPortal;

  constructor(
    private readonly project: ProjectService,
    private readonly dialog: MatDialog,
    private readonly snackBar: MatSnackBar,
  ) {
    for (const fieldName of ['startOffset', 'bpm', 'measureLength', 'subdivision'] as (keyof Meter)[]) {
      effect(() => {
        if (this.formTree[fieldName]().valid()) {
          const newValue = this.formTree[fieldName]().value();
          if (newValue == null) return;
          untracked(() => {
            const projectHolder = this.project.currentProjectRaw();
            if (projectHolder === undefined) return;
            const meter = projectHolder.project().meter
            if (meter === undefined || meter[fieldName] === newValue) return;
            projectHolder.modify(ProjectLop(['meter', fieldName]).set(newValue), { fusionTag: fieldName === 'startOffset' || fieldName === 'bpm' ? fieldName : undefined });
          });
        }
      });
    }

    effect(() => {
      this.liveMeter.emit(project.currentProjectRaw()?.project().meter ?? {})
    });
  }

  readonly isMeterSet = computed(() => this.project.currentProjectRaw()?.project()?.meter !== undefined)
  // readonly isMeterActive = computed(() => this.project.currentProjectRaw()?.project()?.meter?.state === 'active')
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
        ProjectLop(['meter', 'startOffset']).modify(o => Math.round((o + offsetOffset) * 100000) / 100000),
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
        ProjectLop(['meter', 'bpm']).modify(bpm => Math.round(100 * bpm * Math.exp(tempoScaleLn)) / 100),
      );
    } finally {
      this.liveMeter.emit(projectHolder.project().meter ?? {});
    }
  }

  onOffsetBumpBeat(dir: number) {
    const projectHolder = this.project.currentProjectRaw();
    if (!projectHolder) return;
    const meter = projectHolder.project().meter;
    if (!meter) return;
    const offset = dir * 60 / meter.bpm;
    try {
      projectHolder.modify(
        flow(
          ProjectAllNotes.composeLens(NoteL('start')).modify(s => assertNonnegative(s - dir * PULSES_PER_BEAT)),
          ProjectLop(['meter', 'startOffset']).modify(x => x + offset)
        ),
        { fusionTag: 'startOffsetBump' },
      );
    } catch (e) {
      if (e !== assertNonnegativeThrown) throw e;
      this.snackBar.open("This action could not be performed because it would invalidate some existing notes.");
    }
  }

  onTempoMult(factor: number, dir: 1 | -1) {
    const projectHolder = this.project.currentProjectRaw();
    if (!projectHolder) return;
    if (!projectHolder.project().meter) return;
    try {
      projectHolder.modify(flow(
        ProjectAllNotes.composeLens(NoteL('start')).modify(s => assertIntegral(dir === 1 ? s * factor : s / factor)),
        ProjectAllNotes.composeLens(NoteL('length')).modify(l => assertIntegral(dir === 1 ? l * factor : l / factor)),
        ProjectLop(['meter', 'bpm']).modify(x => dir === 1 ? x * factor : x / factor),
        // try to keep measures the same real length
        ProjectLop(['meter', 'measureLength']).modify(x => dir === 1 ? x * factor : (x % factor === 0 ? x / factor : x)),
        // try to keep subdivisions the same real length
        ProjectLop(['meter', 'subdivision']).modify(x => dir === 1 ? (x % factor === 0 ? x / factor : x) : (PULSES_PER_BEAT % x * factor === 0 ? x * factor : x)),
      ));
    } catch (e) {
      if (e !== assertIntegralThrown) throw e;
      this.snackBar.open("This action could not be performed because it would invalidate some existing notes.");
    }
  }

  @ViewChild('meterUnlockDialog', { static: true }) meterUnlockDialog!: TemplateRef<this>;

  onToggleLockClick() {
    const projectHolder = this.project.currentProjectRaw();
    if (!projectHolder) return;
    const meter = projectHolder.project().meter;
    if (!meter) return;
    if (meter.state === 'locked') {
      this.dialog.open(this.meterUnlockDialog).afterClosed().subscribe(v => {
        if (v) {
          projectHolder.modify(ProjectLop(['meter', 'state']).set('active'));
        }
      });
    } else {
      projectHolder.modify(ProjectLop(['meter', 'state']).set('locked'));
    }
  }
}

const ProjectAllNotes = ProjectLp(["parts"]).composeTraversal(fromTraversable(RA.Traversable)()).composeLens(PartL('notes')).composeTraversal(fromTraversable(RA.Traversable)());

const assertNonnegativeThrown = Symbol();
/// does not throw an `Error`
function assertNonnegative(x: number) {
  if (x < 0) throw assertNonnegativeThrown;
  return x;
}

const assertIntegralThrown = Symbol();
/// does not throw an `Error`
function assertIntegral(x: number) {
  if (!Number.isInteger(x)) throw assertIntegralThrown;
  return x;
}
