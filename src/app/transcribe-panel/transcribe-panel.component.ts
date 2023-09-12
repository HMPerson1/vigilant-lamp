import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { flow } from 'fp-ts/function';
import * as rxjs from 'rxjs';
import { PartDialogComponent } from '../part-dialog/part-dialog.component';
import { ProjectService } from '../project.service';
import { ProjectLens, defaultPart, indexReadonlyArray } from '../ui-common';

@Component({
  selector: 'app-transcribe-panel',
  templateUrl: './transcribe-panel.component.html',
  styleUrls: ['./transcribe-panel.component.css']
})
export class TranscribePanelComponent {
  constructor(readonly project: ProjectService, private dialog: MatDialog) { }

  async onAddPartClick() {
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

  async onPartEditClick(idx: any) {
    if (!this.project.project) return;
    const res = await rxjs.firstValueFrom(
      this.dialog.open(PartDialogComponent, { data: { add: false, part: this.project.project.parts[idx] } }).afterClosed()
    );
    if (res !== undefined) {
      this.project.modify(ProjectLens(['parts']).compose(indexReadonlyArray(idx)).set(res));
    }
  }
}
