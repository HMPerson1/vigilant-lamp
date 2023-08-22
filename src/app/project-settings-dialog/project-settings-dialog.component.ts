import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { ProjectService } from '../project.service';
import { Lens } from 'monocle-ts';
import { Project } from '../ui-common';

@Component({
  selector: 'app-project-settings-dialog',
  templateUrl: './project-settings-dialog.component.html',
  styleUrls: ['./project-settings-dialog.component.css']
})
export class ProjectSettingsDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<ProjectSettingsDialogComponent>,
    private project: ProjectService,
  ) { }

  bpm: number = this.project.project?.bpm || 0;

  onOkClick(): void {
    this.project.modify(Lens.fromProp<Project>()('bpm').set(this.bpm))
    this.dialogRef.close()
  }
}
