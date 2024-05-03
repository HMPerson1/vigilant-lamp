import { Component, NgZone, computed, output, viewChildren } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { supported as browserFsApiSupported, fileOpen, fileSave } from 'browser-fs-access';
import * as Mousetrap from 'mousetrap';
import { audioFileSampleRate, downsampleAudio, loadAudio } from '../load-audio';
import { AudioContextService } from '../services/audio-context.service';
import { ProjectService } from '../services/project.service';
import { ClickBlockingDirective } from './click-blocking.directive';

@Component({
  selector: 'app-project-toolbar',
  templateUrl: './project-toolbar.component.html',
  styleUrl: './project-toolbar.component.css'
})
export class ProjectToolbarComponent {
  readonly audioBuffer = output<AudioBuffer | undefined>();
  readonly projectFilename = output<string | undefined>();

  constructor(
    readonly project: ProjectService,
    private readonly audioContextSvc: AudioContextService,
    private readonly snackBar: MatSnackBar,
    private readonly ngZone: NgZone,
  ) {
    Mousetrap.bind('mod+s', () => ngZone.run(() => { this.saveProject(); return false }));
    Mousetrap.bind('mod+z', () => ngZone.run(() => { project.currentProjectRaw()?.undo() }));
    Mousetrap.bind('mod+shift+z', () => ngZone.run(() => { project.currentProjectRaw()?.redo() }));
  }

  readonly browserFsApiSupported = browserFsApiSupported;
  readonly anyTaskActive = computed(() => this.blockingButtons().some(cb => cb.taskActive()));

  readonly outputSampleRate = this.audioContextSvc.audioContext.sampleRate;

  readonly blockingButtons = viewChildren(ClickBlockingDirective);

  projectFileHandle?: FileSystemFileHandle;

  readonly newProject = async () => {
    try {
      const fh = await fileOpen({ description: "Audio Files", mimeTypes: ["audio/*"], id: 'project-new-audio' });
      this.audioBuffer.emit(undefined);
      const audioFile = new Uint8Array(await fh.arrayBuffer());
      // neither WebAudio nor WebCodecs allows decoding a whole audio file without resampling
      // so we have to do this whole mess manually
      // also music-metadata uses so much async/await that disabling zone.js here is a 50% speedup
      const detectedSampleRate = await this.ngZone.runOutsideAngular(() => audioFileSampleRate(audioFile, fh.name));
      if (detectedSampleRate === undefined) {
        this.snackBar.open(`Audio file was resampled to ${this.outputSampleRate} because its native sample rate could not be determined`);
      }
      const audioBufferRaw = await loadAudio(audioFile.slice().buffer, detectedSampleRate ?? this.outputSampleRate);
      const audioData = await downsampleAudio(audioBufferRaw);
      this.project.newProject(audioFile, audioData);
      this.projectFileHandle = undefined;
      this.projectFilename.emit(undefined);
      // the AudioBuffer used for playback should use the audio output sample rate
      // in theory we could do SRC manually to avoid decoding the audio file twice,
      // but the browser's built-in decode + resample is probably faster anyway
      const audioBuffer = audioBufferRaw.sampleRate === this.outputSampleRate
        ? audioBufferRaw
        : await loadAudio(audioFile.slice().buffer, this.outputSampleRate);
      this.audioBuffer.emit(audioBuffer);
    } catch (e) {
      console.log("error new project:", e);
      if (!isUserAbortException(e)) {
        this.snackBar.open("Error creating a new project");
      }
    }
  }

  readonly loadProject = async () => {
    try {
      const projectFile = await fileOpen({ description: "Vigilant Lamp files", extensions: [".vtlamp"], id: 'project' });
      this.audioBuffer.emit(undefined);
      const project = await this.project.fromBlob(projectFile);
      project.markSaved(project.project());
      this.projectFileHandle = projectFile.handle;
      this.projectFilename.emit(this.projectFileHandle?.name);
      const audioBuffer = await loadAudio(project.project().audioFile.slice().buffer, this.outputSampleRate);
      this.audioBuffer.emit(audioBuffer);
    } catch (e) {
      console.log("error load project:", e);
      if (!isUserAbortException(e)) {
        this.snackBar.open("Error opening project");
      }
    }
  }

  readonly saveProject = (saveAs = false) => async () => {
    const projectHolder = this.project.currentProjectRaw();
    if (!projectHolder) { console.warn('saveProject called without project'); return; }
    try {
      const project = projectHolder.project();
      this.projectFileHandle = await fileSave(
        ProjectService.intoBlob(project),
        { description: "Vigilant Lamp file", extensions: [".vtlamp"], id: 'project' },
        saveAs ? null : this.projectFileHandle,
        true,
      ) ?? undefined;
      projectHolder.markSaved(project);
      this.projectFilename.emit(this.projectFileHandle?.name);
    } catch (e) {
      console.log("error save project:", e);
      if (!isUserAbortException(e)) {
        this.snackBar.open(`Error saving project: ${e}`);
      }
    }
  }
}

const isUserAbortException = (e: unknown) => (e instanceof DOMException && e.name === "AbortError" && e.message === "The user aborted a request.");
