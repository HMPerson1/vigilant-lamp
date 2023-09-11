import { Component } from '@angular/core';
import { flow } from 'fp-ts/lib/function';
import { ProjectService } from '../project.service';
import { ProjectLens, indexReadonlyArray } from '../ui-common';

@Component({
  selector: 'app-transcribe-panel',
  templateUrl: './transcribe-panel.component.html',
  styleUrls: ['./transcribe-panel.component.css']
})
export class TranscribePanelComponent {
  constructor(readonly project: ProjectService) { }

  onAddPartClick() {
    this.project.modify(flow(
      ProjectLens(['meter', 'state']).set('locked'),
      ProjectLens(['parts']).modify(parts => [...parts, { notes: [], name: "New Part", instrument: undefined }]),
    ));
  }

  onDeletePartClick(idx: number) {
    this.project.modify(ProjectLens(['parts']).modify(parts => {
      const ret = [...parts];
      ret.splice(idx, 1);
      return ret;
    }));
  }

  onPartEditClick(idx: any) {
    // TODO: dialog
    this.project.modify(ProjectLens(['parts']).compose(indexReadonlyArray(idx)).modify(x => {
      console.log('edit', idx, x);
      return x;
    }));
  }
}
