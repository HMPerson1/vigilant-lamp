import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, Input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { flow } from 'fp-ts/function';
import * as rxjs from 'rxjs';
import { PartDialogComponent } from '../part-dialog/part-dialog.component';
import { ProjectService } from '../project.service';
import { ProjectLens, StartTranscribing, defaultPart, indexReadonlyArray } from '../ui-common';

@Component({
  selector: 'app-transcribe-panel',
  templateUrl: './transcribe-panel.component.html',
  styleUrls: ['./transcribe-panel.component.scss']
})
export class TranscribePanelComponent {
  constructor(readonly project: ProjectService, private dialog: MatDialog) { }

  @Input() startTranscribing?: StartTranscribing;

  async onAddPartClick() {
    if (this.project.project?.meter.state === 'unset') return;
    const res = await rxjs.firstValueFrom(
      this.dialog.open(PartDialogComponent, { data: { add: true, part: defaultPart } }).afterClosed()
    );
    if (res !== undefined) {
      this.project.modify(flow(
        ProjectLens(['meter', 'state']).set('locked'),
        ProjectLens(['parts']).modify(parts => [...parts, res]),
      ));
    }
  }

  onDeletePartClick(idx: number) {
    this.project.modify(ProjectLens(['parts']).modify(parts => {
      const ret = [...parts];
      ret.splice(idx, 1);
      return ret;
    }));
  }

  async onPartEditClick(idx: number) {
    if (!this.project.project) return;
    const res = await rxjs.firstValueFrom(
      this.dialog.open(PartDialogComponent, { data: { add: false, part: this.project.project.parts[idx] } }).afterClosed()
    );
    if (res !== undefined) {
      this.project.modify(ProjectLens(['parts']).compose(indexReadonlyArray(idx)).set(res));
    }
  }

  drop(event: CdkDragDrop<any>) {
    if (event.currentIndex !== event.previousIndex) {
      this.project.modify(ProjectLens(['parts']).modify(parts => {
        const ret = [...parts];
        moveItemInArray(ret, event.previousIndex, event.currentIndex);
        return ret;
      }));
    }
  }
}
