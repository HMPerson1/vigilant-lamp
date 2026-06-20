import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, Input, computed } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCard, MatCardAvatar, MatCardContent, MatCardHeader, MatCardSubtitle, MatCardTitle } from '@angular/material/card';
import { MatRipple } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { OKLab, sRGB } from 'colorjs.io/fn';
import { flow } from 'fp-ts/function';
import { imap, max } from 'itertools';
import * as rxjs from 'rxjs';
import { PartL, ProjectLop, ProjectLp, defaultPart } from '../../model/project';
import { PartDialogComponent } from '../part-dialog/part-dialog.component';
import { ProjectService } from '../services/project.service';
import { StartTranscribing, TranscribeModeState, indexReadonlyArray, sortPartsDisplay } from '../ui-common';

@Component({
    selector: 'app-transcribe-panel',
    templateUrl: './transcribe-panel.component.html',
    styleUrls: ['./transcribe-panel.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [CdkDropList, MatCard, CdkDrag, MatRipple, MatIcon, CdkDragHandle, MatCardHeader, MatCardAvatar, MatIconButton, MatTooltip, MatCardTitle, MatCardSubtitle, MatMenuTrigger, MatCardContent, MatButton, MatMenu, MatMenuContent, MatMenuItem]
})
export class TranscribePanelComponent {
  constructor(readonly project: ProjectService, private readonly dialog: MatDialog) { }

  @Input() startTranscribing?: StartTranscribing;
  @Input() transcribeModeState?: TranscribeModeState;

  readonly partsDisplay = computed(() => sortPartsDisplay(this.project.currentProjectRaw()?.project().parts ?? []).map(x => ({ ...x, isDark: isDark(x.color) })));

  async onAddPartClick() {
    const projectHolder = this.project.currentProjectRaw();
    if (projectHolder === undefined || projectHolder.project()?.meter === undefined) return;
    const res = await rxjs.firstValueFrom(
      this.dialog.open(PartDialogComponent, { data: { add: true, part: defaultPart } }).afterClosed()
    );
    if (res !== undefined) {
      projectHolder.modify(flow(
        ProjectLop(['meter', 'state']).set('locked'),
        ProjectLp(['parts']).modify(parts => [...parts, { ...res, displayIndex: 1 + (max(imap(parts, p => p.displayIndex)) ?? -1) }]),
      ));
    }
  }

  onDeletePartClick(idx: number) {
    this.project.currentProjectRaw()?.modify(ProjectLp(['parts']).modify(parts => parts.toSpliced(idx, 1)));
  }

  async onPartEditClick(idx: number) {
    const projectHolder = this.project.currentProjectRaw();
    if (projectHolder === undefined) return;
    const res = await rxjs.firstValueFrom(
      this.dialog.open(PartDialogComponent, { data: { add: false, part: projectHolder.project().parts[idx] } }).afterClosed()
    );
    if (res !== undefined) {
      projectHolder.modify(ProjectLp(['parts']).compose(indexReadonlyArray(idx)).set(res));
    }
  }

  onToggleVisibilityClick(idx: number) {
    this.project.currentProjectRaw()?.modify(
      ProjectLp(['parts']).compose(indexReadonlyArray(idx)).compose(PartL('visible')).modify(x => !x),
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
    this.project.currentProjectRaw()?.modify(ProjectLp(['parts']).modify(parts =>
      parts.map((p, i) => ({ ...p, displayIndex: physIdxToNewDispIdx[i] }))
    ), { preserveSelection: true });
  }
}

const isDark = (color: string) => OKLab.from({ ...sRGB.formats['hex'].parse!(color), space: sRGB })[0] < .5;
