import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { Component, Input, computed } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { flow } from 'fp-ts/function';
import { imap, max } from 'itertools';
import * as rxjs from 'rxjs';
import { PartDialogComponent } from '../part-dialog/part-dialog.component';
import { ProjectService } from '../services/project.service';
import { PartLens, ProjectLens, ProjectOptional, StartTranscribing, TranscribeModeState, defaultPart, indexReadonlyArray, sortPartsDisplay } from '../ui-common';

@Component({
  selector: 'app-transcribe-panel',
  templateUrl: './transcribe-panel.component.html',
  styleUrls: ['./transcribe-panel.component.scss']
})
export class TranscribePanelComponent {
  constructor(readonly project: ProjectService, private readonly dialog: MatDialog) { }

  @Input() startTranscribing?: StartTranscribing;
  @Input() transcribeModeState?: TranscribeModeState;

  readonly partsDisplay = computed(() => sortPartsDisplay(this.project.currentProjectRaw()?.project().parts ?? []));

  async onAddPartClick() {
    const projectHolder = this.project.currentProjectRaw();
    if (projectHolder === undefined || projectHolder.project()?.meter === undefined) return;
    const res = await rxjs.firstValueFrom(
      this.dialog.open(PartDialogComponent, { data: { add: true, part: defaultPart } }).afterClosed()
    );
    if (res !== undefined) {
      projectHolder.modify(flow(
        ProjectOptional(['meter', 'state']).set('locked'),
        ProjectLens(['parts']).modify(parts => [...parts, { ...res, displayIndex: 1 + (max(imap(parts, p => p.displayIndex)) ?? -1) }]),
      ));
    }
  }

  onDeletePartClick(idx: number) {
    this.project.currentProjectRaw()?.modify(ProjectLens(['parts']).modify(parts => parts.toSpliced(idx, 1)));
  }

  async onPartEditClick(idx: number) {
    const projectHolder = this.project.currentProjectRaw();
    if (projectHolder === undefined) return;
    const res = await rxjs.firstValueFrom(
      this.dialog.open(PartDialogComponent, { data: { add: false, part: projectHolder.project().parts[idx] } }).afterClosed()
    );
    if (res !== undefined) {
      projectHolder.modify(ProjectLens(['parts']).compose(indexReadonlyArray(idx)).set(res));
    }
  }

  onToggleVisibilityClick(idx: number) {
    this.project.currentProjectRaw()?.modify(
      ProjectLens(['parts']).compose(indexReadonlyArray(idx)).compose(PartLens('visible')).modify(x => !x),
      { preservePartIdx: true },
    );
  }

  onPartButtonClick(idx: number) {
    if (this.transcribeModeState?.partIdx === idx) {
      this.transcribeModeState.cancel();
    } else {
      this.startTranscribing?.(idx);
    }
  }

  drop(event: CdkDragDrop<any>) {
    const idxFrom = event.previousIndex;
    const idxTo = event.currentIndex;
    if (idxTo === idxFrom) return;
    const rotate = idxTo > idxFrom ?
      ((i: number) => i === idxFrom ? idxTo : idxFrom < i && i <= idxTo ? i - 1 : i) :
      ((i: number) => i === idxFrom ? idxTo : idxTo <= i && i < idxFrom ? i + 1 : i);
    const partsDisplay = this.partsDisplay();
    const partsLength = partsDisplay.length;
    const physIdxToNewDispIdx = Array.from({ length: partsLength }, () => NaN);
    for (const [fixedDispIdx, { idx: physIdx }] of partsDisplay.entries()) {
      physIdxToNewDispIdx[physIdx] = partsLength - 1 - rotate(partsLength - 1 - fixedDispIdx);
    }
    this.project.currentProjectRaw()?.modify(ProjectLens(['parts']).modify(parts =>
      parts.map((p, i) => ({ ...p, displayIndex: physIdxToNewDispIdx[i] }))
    ), { preserveSelection: true });
  }

  trackItemIdx(_i: number, { idx }: { idx: number }) { return idx }
}
