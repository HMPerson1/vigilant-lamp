import { Component, HostListener, Input, Signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { identity } from 'fp-ts/function';
import * as lodash from 'lodash-es';
import * as rxjs from 'rxjs';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';
import { GenSpecTile, SpecTileWindow } from '../common';
import { KeyboardStateService } from '../services/keyboard-state.service';
import { ProjectService } from '../services/project.service';
import { Meter, Note, PITCH_MAX, PULSES_PER_BEAT, Part, PartLens, ProjectLens, indexReadonlyArray, pulse2time, time2beat, time2pulse } from '../ui-common';
import { PairsSet } from '../utils/pairs-set';

@Component({
  selector: 'app-piano-roll-editor',
  templateUrl: './piano-roll-editor.component.html',
  styleUrls: ['./piano-roll-editor.component.css'],
  // changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PianoRollEditorComponent {
  constructor(
    readonly project: ProjectService,
    private readonly viewport: AudioVisualizationComponent,
    private readonly keyboardState: KeyboardStateService,
  ) {
    this.tile = computed(() => new GenSpecTile(
      { timeMin: 0, timeMax: viewport.audioDuration(), pitchMin: 0, pitchMax: PITCH_MAX },
      { width: viewport.canvasWidth(), height: viewport.canvasHeight() },
    ));
  }

  readonly mouseX = computed(() => { const x = this.viewport.visMouseX(); return x && x + this.viewport.viewportOffsetX() });
  readonly mouseY = computed(() => { const y = this.viewport.visMouseY(); return y && y + this.viewport.viewportOffsetY() });

  readonly #mousePos = computed(() => {
    const x = this.mouseX();
    const y = this.mouseY();
    return x !== undefined && y !== undefined ? [x, y] as const : undefined;
  });
  @Input() activePartIdx?: number;

  private tile: Signal<GenSpecTile<{ width: number, height: number }>>;

  get activePart(): Part | undefined { return this.activePartIdx !== undefined ? this.project.project?.parts?.[this.activePartIdx] : undefined }
  get activePartColor() { return this.activePart?.color }
  get hideSelectedNotes() { return this.resizeNoteState !== undefined || this.draggedNotes !== undefined; }

  hoveredNote(): Note | undefined {
    const meter = this.project.project?.meter;
    if (!meter || this.mouseX() === undefined || this.mouseY() === undefined) return;

    const subdiv = Math.floor(meter.subdivision * time2beat(meter, this.tile().x2time(this.mouseX()!)));
    if (subdiv < 0) return;
    const pitch = Math.round(this.tile().y2pitch(this.mouseY()!));
    return {
      pitch,
      start: subdiv * PULSES_PER_BEAT / meter.subdivision,
      length: PULSES_PER_BEAT / meter.subdivision,
      notation: undefined,
    };
  }

  get notePreviewStyle() {
    if (this.activePartIdx === undefined) return;
    const hoveredNote = this.hoveredNote();
    if (!hoveredNote) return;
    return this.noteStyle(hoveredNote);
  }

  private note2rect(note: Note): Rect | undefined {
    const meter = this.project.project?.meter;
    if (!this.tile || !meter) return;

    const x = Math.round(this.tile().time2x(pulse2time(meter, note.start)));
    const y = Math.round(this.tile().pitch2y(note.pitch + .5));
    return {
      x,
      y,
      width: Math.round(this.tile().time2x(pulse2time(meter, (note.start + note.length)))) - x,
      height: Math.round(this.tile().pitch2y(note.pitch - 0.5)) - y,
    };
  }

  noteStyle(note: Note) {
    const r = this.note2rect(note);
    return r ? rect2style(r) + (r.width < 8 ? `border-inline-width: ${r.width / 2}px` : '') : undefined;
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent) {
    if (event.button !== 0) return;
    if (this.activePartIdx !== undefined) {
      this.startAddNote(event);
    } else {
      this.startSelection(event);
    }
  }

  private clickStartNote?: Note;

  async startAddNote(event: MouseEvent) {
    const activePartIdx = this.activePartIdx;
    if (activePartIdx === undefined) return;
    const hoveredNoteStart = this.hoveredNote();
    if (!hoveredNoteStart) return;

    event.preventDefault();

    this.clickStartNote = hoveredNoteStart;
    try {
      await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
      const hoveredNoteEnd = this.hoveredNote();
      if (!hoveredNoteEnd) return;
      const clickedNote = clickDragNote(hoveredNoteStart, hoveredNoteEnd);
      if (!clickedNote) return;
      this.project.modify(
        ProjectLens(['parts']).compose(indexReadonlyArray(activePartIdx)).compose(PartLens('notes')).modify(
          notes => [...notes, clickedNote]
        )
      )
    } finally {
      this.clickStartNote = undefined;
    }
  }

  get activeNoteStyle() {
    if (!this.clickStartNote) return;
    const hoveredNote = this.hoveredNote();
    if (!hoveredNote) return;
    const activeNote = clickDragNote(this.clickStartNote, hoveredNote);
    return activeNote ? this.noteStyle(activeNote) : undefined;
  }

  selection: PairsSet<number, number> = PairsSet.empty();
  get singleSelection() { return this.selection.asSingleton }

  showResizeHandles = true;

  private selectionStart?: readonly [number, number];

  readonly #mousePos$ = toObservable(this.#mousePos);

  async startSelection(event: MouseEvent) {
    if (this.activePartIdx !== undefined || this.mouseX() === undefined || this.mouseY() === undefined) return;
    const project = this.project.project;
    if (project === undefined) return;

    event.preventDefault();

    const mode =
      event.ctrlKey ? { t: 'xor', p: this.selection } as const
        : event.shiftKey ? { t: 'or', p: this.selection } as const
          : { t: 'new' } as const;

    this.showResizeHandles = false;
    const selStart = [this.mouseX()!, this.mouseY()!] as const;
    this.selectionStart = selStart;
    const onMoveSub = this.#mousePos$.pipe(rxjs.map(mousePos => {
      if (!mousePos) return;
      const time0 = time2pulse(project.meter, this.tile().x2time(selStart[0]));
      const time1 = time2pulse(project.meter, this.tile().x2time(mousePos[0]));
      const pitch0 = this.tile().y2pitch(selStart[1]);
      const pitch1 = this.tile().y2pitch(mousePos[1]);
      const selRect = {
        timeMin: Math.min(time0, time1),
        timeMax: Math.max(time0, time1),
        pitchMin: Math.min(pitch0, pitch1) - .5,
        pitchMax: Math.max(pitch0, pitch1) + .5,
      }
      return PairsSet.fromIterable<number, number>(function* () {
        for (const [partIdx, part] of project.parts.entries()) {
          yield [partIdx, function* () {
            for (const [noteIdx, note] of part.notes.entries()) {
              if (isNoteInRect(selRect, note)) yield noteIdx;
            }
          }()];
        }
      }());
    })).subscribe(curSel => {
      if (!curSel || curSel.isEmpty) {
        this.selection = mode.p ?? PairsSet.empty();
        return;
      }
      switch (mode.t) {
        case 'xor': curSel.xorWith(mode.p); break;
        case 'or': curSel.unionWith(mode.p); break;
      }
      this.selection = curSel;
    });
    try {
      await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
    } finally {
      onMoveSub.unsubscribe();
      this.selectionStart = undefined;
      this.showResizeHandles = true;
    }
  }

  get selectionStartRectStyle() {
    if (this.selectionStart === undefined || this.mouseX() === undefined || this.mouseY() === undefined) return;
    const x = Math.min(this.mouseX()!, this.selectionStart[0]);
    const xMax = Math.max(this.mouseX()!, this.selectionStart[0]);
    const y = Math.min(this.mouseY()!, this.selectionStart[1]);
    const yMax = Math.max(this.mouseY()!, this.selectionStart[1]);
    return rect2style({ x, y, width: xMax - x, height: yMax - y });
  }

  get selectionResizeIndicatorStyle() {
    if (!this.project.project || this.draggedNotes !== undefined) return;
    let note = this.resizeNote;
    if (this.singleSelection && !note) {
      const [partIdx, noteIdx] = this.singleSelection;
      note = this.project.project.parts[partIdx].notes[noteIdx];
    }
    const noteRect = note && this.note2rect(note);
    return noteRect && rect2style(noteRect);
  }

  resizeNoteState?: [number, number, 0 | 1];

  async startNoteResize(which: 0 | 1, event: MouseEvent) {
    if (!this.singleSelection || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const [partIdx, noteIdx] = this.singleSelection;
    this.resizeNoteState = [partIdx, noteIdx, which];
    try {
      await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
      if (!this.mouseX() || !this.project.project) return;
      const origNote = this.project.project.parts[partIdx].notes[noteIdx];
      const newNote = doResizeNote(
        this.project.project.meter,
        origNote,
        which,
        this.tile().x2time(this.mouseX()!),
      );
      // TODO: this may be confusing? maybe don't make undo state only if the drag was always a no-op
      if (lodash.isEqual(origNote, newNote)) return;
      this.project.modify(ProjectLens(['parts']).compose(indexReadonlyArray(partIdx)).compose(PartLens('notes')).compose(indexReadonlyArray(noteIdx)).set(newNote));
    } finally {
      this.resizeNoteState = undefined;
    }
  }

  get resizeNote() {
    if (!this.resizeNoteState || !this.project.project || !this.tile) return;
    const origNote = this.project.project.parts[this.resizeNoteState[0]].notes[this.resizeNoteState[1]];
    return !this.mouseX() ? origNote : doResizeNote(
      this.project.project.meter,
      origNote,
      this.resizeNoteState[2],
      this.tile().x2time(this.mouseX()!),
    );
  }

  get resizeNoteStyle() {
    const n = this.resizeNote;
    return n && this.noteStyle(n);
  }

  draggedNotes?: ReadonlyArray<readonly [number, Note]>;

  private readonly keyboardShiftKey = toObservable(this.keyboardState.shiftKey);

  async onSelectedNoteMouseDown(partIdx: number, noteIdx: number, event: MouseEvent) {
    const project = this.project.project;
    if (!project || event.button !== 0 || this.mouseX() === undefined || this.mouseY() === undefined) return;
    event.preventDefault();
    event.stopPropagation();

    const dragStartX = this.mouseX()!;
    const dragStartY = this.mouseY()!;

    const nextMouseMove = rxjs.firstValueFrom(this.#mousePos$.pipe(rxjs.filter(v => !v || v[0] !== dragStartX || v[1] !== dragStartY)));
    const nextMouseUp = rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
    if (await Promise.race([nextMouseUp.then(() => true), nextMouseMove.then(() => false)])) {
      // single click: just (select/toggle selection of) the note
      if (event.ctrlKey) {
        this.selection.toggle([partIdx, noteIdx]);
      } else if (event.shiftKey) {
        this.selection.add([partIdx, noteIdx]);
      } else {
        this.selection = PairsSet.singleton([partIdx, noteIdx]);
      }
      return;
    }

    const thisMoveNote = moveNote(project.meter, this.tile().x2time(dragStartX), this.tile().y2pitch(dragStartY))

    const onInputSub = rxjs.combineLatest({ pos: this.#mousePos$, shiftKey: this.keyboardShiftKey })
      .pipe(rxjs.map(({ pos, shiftKey }) => {
        if (!pos) return;
        const thisMoveNote2 = thisMoveNote(this.tile(), pos[0], pos[1], shiftKey);
        return Array.from(this.selection, ([partIdx, noteIdx]) =>
          [partIdx, thisMoveNote2(project.parts[partIdx].notes[noteIdx])] as const
        );
      }))
      .subscribe(x => this.draggedNotes = x);
    try {
      await nextMouseUp;
      if (this.mouseX() === undefined || this.mouseY() === undefined) return;
      const thisMoveNote2 = thisMoveNote(this.tile(), this.mouseX()!, this.mouseY()!, this.keyboardState.shiftKey());
      // TODO: this may be confusing? maybe don't make undo state only if the drag was always a no-op
      if (thisMoveNote2 === identity) return;
      this.project.modify(ProjectLens(['parts']).modify(parts => Array.from(parts, (part, partIdx) => {
        const selPart = this.selection.withFirst(partIdx);
        return !selPart ? part : {
          ...part,
          notes: part.notes.map((note, noteIdx) => !selPart.has(noteIdx) ? note : thisMoveNote2(note))
        };
      })));
    } finally {
      this.draggedNotes = undefined;
      onInputSub.unsubscribe();
    }
  }

  readonly _clickHandlerTransform = computed(() => `translate(${this.viewport.viewportOffsetX()}px,${this.viewport.viewportOffsetY()}px)`);
  trackIdx(idx: number, _item: unknown) { return idx }
}

const clickDragNote = (start: Note, end: Note): Note | undefined => {
  const length = end.start + end.length - start.start;
  return length > 0 ? { ...start, length, pitch: end.pitch } : undefined;
};

const doResizeNote = (meter: Meter, origNote: Note, which: 0 | 1, time: number): Note => {
  const ppsd = PULSES_PER_BEAT / meter.subdivision;

  const mousePulseRaw = time2pulse(meter, time);
  const mousePulse = Math.round(mousePulseRaw / ppsd) * ppsd;
  const newNoteT1 = origNote.start + (1 - which) * origNote.length;
  const newNoteT2 = mousePulse !== newNoteT1 ? mousePulse
    : mousePulse + ppsd * (mousePulseRaw >= newNoteT1 ? +1 : -1);

  return newNoteT2 >= newNoteT1
    ? { ...origNote, start: newNoteT1, length: newNoteT2 - newNoteT1 }
    : { ...origNote, start: newNoteT2, length: newNoteT1 - newNoteT2 };
}

const moveNote = (meter: Meter, startTime: number, startPitch: number) => {
  const ppsd = PULSES_PER_BEAT / meter.subdivision;
  const startPulse = time2pulse(meter, startTime);
  return (tile: GenSpecTile<{ width: number, height: number }>, endX: number, endY: number, lockAxis: boolean) => {
    const deltaPulse0 = Math.round((time2pulse(meter, tile.x2time(endX)) - startPulse) / ppsd) * ppsd;
    const deltaPitch0 = Math.round(tile.y2pitch(endY) - startPitch);
    const [deltaPulse, deltaPitch] =
      !lockAxis
        ? [deltaPulse0, deltaPitch0]
        : (Math.abs(endX - tile.time2x(startTime)) > Math.abs(endY - tile.pitch2y(startPitch))
          ? [deltaPulse0, 0]
          : [0, deltaPitch0]);
    return deltaPulse === 0 && deltaPitch === 0 ? identity : (note: Note): Note => ({
      ...note,
      start: note.start + deltaPulse,
      pitch: note.pitch + deltaPitch,
    });
  };
}

type Rect = { x: number; y: number; width: number; height: number; };
const rect2style = ({ x, y, width, height }: Rect) =>
  `transform: translate(${x}px,${y}px); width: ${width}px; height: ${height}px;`;

const isNoteInRect = (rect: SpecTileWindow, note: Note) =>
  (rect.pitchMin <= note.pitch && note.pitch <= rect.pitchMax)
  && (rect.timeMin <= note.start + note.length && note.start <= rect.timeMax)
