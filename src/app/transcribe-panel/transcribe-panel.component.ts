import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, Input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { flow } from 'fp-ts/function';
import * as rxjs from 'rxjs';
import { PartDialogComponent } from '../part-dialog/part-dialog.component';
import { ProjectService } from '../services/project.service';
import { ProjectLens, ProjectOptional, StartTranscribing, TranscribeModeState, defaultPart, indexReadonlyArray } from '../ui-common';

@Component({
  selector: 'app-transcribe-panel',
  templateUrl: './transcribe-panel.component.html',
  styleUrls: ['./transcribe-panel.component.scss']
})
export class TranscribePanelComponent {
  constructor(readonly project: ProjectService, private dialog: MatDialog) { }

  @Input() startTranscribing?: StartTranscribing;
  @Input() transcribeModeState?: TranscribeModeState;

  async onAddPartClick() {
    const projectHolder = this.project.currentProjectRaw();
    if (projectHolder === undefined || projectHolder.project()?.meter === undefined) return;
    const res = await rxjs.firstValueFrom(
      this.dialog.open(PartDialogComponent, { data: { add: true, part: defaultPart } }).afterClosed()
    );
    if (res !== undefined) {
      projectHolder.modify(flow(
        ProjectOptional(['meter', 'state']).set('locked'),
        ProjectLens(['parts']).modify(parts => [...parts, res]),
      ));
    }
  }

  onDeletePartClick(idx: number) {
    this.project.currentProjectRaw()?.modify(ProjectLens(['parts']).modify(parts => {
      const ret = [...parts];
      ret.splice(idx, 1);
      return ret;
    }));
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

  onPartButtonClick(idx: number) {
    if (this.transcribeModeState?.partIdx === idx) {
      this.transcribeModeState.cancel();
    } else {
      this.startTranscribing?.(idx);
    }
  }

  drop(event: CdkDragDrop<any>) {
    // TODO: don't "physically" move parts, just change order in UI
    if (event.currentIndex !== event.previousIndex) {
      this.project.currentProjectRaw()?.modify(ProjectLens(['parts']).modify(parts => {
        const ret = [...parts];
        // cdkDropList doesn't handle column-reverse well
        moveItemInArray(ret, ret.length - 1 - event.previousIndex, ret.length - 1 - event.currentIndex);
        return ret;
      }));
    }
  }
}
