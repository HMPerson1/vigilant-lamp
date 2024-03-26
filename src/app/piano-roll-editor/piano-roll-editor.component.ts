import { Component, ElementRef, HostListener, Input, Signal, ViewChild, computed, effect, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { identity } from 'fp-ts/function';
import * as lodash from 'lodash-es';
import * as rxjs from 'rxjs';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';
import { GenSpecTile, SpecTileWindow, SpecTileWindowExt } from '../common';
import { KeyboardStateService } from '../services/keyboard-state.service';
import { NoteSelection, ProjectHolder, ProjectService } from '../services/project.service';
import { Meter, Note, PITCH_MAX, PULSES_PER_BEAT, Part, PartLens, Project, ProjectLens, elemBoxSizeSignal, indexReadonlyArray, pulse2time, time2beat, time2pulse } from '../ui-common';
import { PairsSet } from '../utils/pairs-set';
import { Viewport } from '../ui-common';
import { Monoid as VoidMonoid } from 'fp-ts/void';
import { array, monoid, function as f } from 'fp-ts';

@Component({
  selector: 'app-piano-roll-editor',
  templateUrl: './piano-roll-editor.component.html',
  styleUrls: ['./piano-roll-editor.component.css'],
  // changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PianoRollEditorComponent {
  readonly #activePartIdx$ = new rxjs.BehaviorSubject<number | undefined>(undefined);
  @Input() set activePartIdx(v: number | undefined) { this.#activePartIdx$.next(v) };
  get activePartIdx() { return this.#activePartIdx$.value }

  readonly #editorState = signal<[EditorState, ProjectHolder] | undefined>(undefined);
  readonly #dragState = signal<(() => [Project, boolean] | undefined) | undefined>(undefined);

  readonly styleCursor: Signal<CssCursorValue | undefined>;

  constructor(
    project: ProjectService,
    readonly viewport: AudioVisualizationComponent,
    private readonly keyboardState: KeyboardStateService,
    hostElem: ElementRef<HTMLElement>,
  ) {
    rxjs.combineLatest({
      activePartIdx: this.#activePartIdx$.pipe(rxjs.distinctUntilChanged()),
      projectHolder: project.currentProject$,
    }).subscribe(({ activePartIdx, projectHolder }) => {
      this.#editorState.set([
        activePartIdx === undefined ? new Selection(projectHolder.currentSelection) : new Notation(activePartIdx),
        projectHolder,
      ]);
    });

    const canvasSize = elemBoxSizeSignal(hostElem.nativeElement, 'device-pixel-content-box');
    const renderState = computed(() => {
      const editorState_ = this.#editorState();
      if (editorState_ === undefined) return;
      const [editorState, projectHolder] = editorState_;
      const dragState = this.#dragState();
      const project = dragState?.()?.[0] ?? projectHolder.project();
      return editorState.render({ viewport: viewport.viewport(), project, dragging: dragState !== undefined, mousePos: this.#mousePos, });
    });
    this.styleCursor = computed(() => renderState()?.[0])
    effect(() => {
      const canvas = this.canvas.nativeElement;
      canvas.width = canvasSize().inlineSize;
      canvas.height = canvasSize().blockSize;
      renderState()?.[1]?.(canvas.getContext('2d')!);
    });
  }

  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;

  // readonly mouseX = computed(() => { const x = this.viewport.visMouseX(); return x !== undefined ? x + this.viewport.viewportOffsetX() : undefined });
  // readonly mouseY = computed(() => { const y = this.viewport.visMouseY(); return y !== undefined ? y + this.viewport.viewportOffsetY() : undefined });

  readonly #mousePosPx = computed(() => {
    const x = this.viewport.visMouseX();
    const y = this.viewport.visMouseY();
    return x !== undefined && y !== undefined ? [x, y] as const : undefined;
  });

  readonly #mousePos = computed(() => {
    const mousePosPx = this.#mousePosPx();
    if (mousePosPx === undefined) return;
    const viewport = this.viewport.viewport();
    return [viewport.x2time(mousePosPx[0]), viewport.y2pitch(mousePosPx[1])] as const;
  });

  #nextMouseUp() {
    return rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup').pipe(rxjs.filter(ev => (ev as MouseEvent).button === 0)));
  }

  async onMouseDown(event: MouseEvent) {
    if (event.button !== 0 || this.#dragState() !== undefined) return;
    const downMousePos = this.#mousePos();
    if (downMousePos === undefined) return;
    const editorState_ = this.#editorState();
    if (editorState_ === undefined) return;
    const [editorState, projectHolder] = editorState_;

    const projectStart = projectHolder.project();
    const dragHandler = editorState.startDrag(projectStart, downMousePos[0], downMousePos[1]);
    const dragResult = () => {
      const viewport = this.viewport.viewport();
      const newMousePos = this.#mousePos();
      if (newMousePos === undefined) return;
      // largest movement axis determined by drag amount in current viewport
      const lockAxis = !this.keyboardState.shiftKey() ? undefined :
        (Math.abs(newMousePos[0] - downMousePos[0]) * viewport.pixelsPerTime > Math.abs(newMousePos[1] - downMousePos[1]) * viewport.pixelsPerTime) ? "x" : "y";
      return dragHandler(newMousePos[0], newMousePos[1], lockAxis);
    }
    try {
      this.#dragState.set(dragResult);
      const nextProjectChange = rxjs.firstValueFrom(projectHolder.project$.pipe(rxjs.skip(1)));
      const cancelled = await Promise.race([this.#nextMouseUp().then(() => false), nextProjectChange.then(() => true)]);
      if (cancelled) return;
      const projectNext = dragResult();
      if (projectNext === undefined) return;
      projectHolder.modify(p => {
        if (!Object.is(p, projectStart)) {
          throw new Error("project unexpectedly modified mid-drag");
        }
        return projectNext[0];
      }, { preserveSelection: projectNext[1] })
    } finally {
      this.#dragState.set(undefined);
    }
  }

  // private tile = computed(() => new GenSpecTile(
  //   { timeMin: 0, timeMax: this.viewport.audioDuration(), pitchMin: 0, pitchMax: PITCH_MAX },
  //   { width: this.viewport.canvasWidth(), height: this.viewport.canvasHeight() },
  // ));

  // readonly projectParts: Signal<ReadonlyArray<Part> | undefined> = computed(() => this.project.currentProjectRaw()?.project().parts);
  // readonly activePart: Signal<Part | undefined> = computed(() => this.activePartIdx !== undefined ? this.projectParts()?.[this.activePartIdx] : undefined)
  // readonly activePartColor = computed(() => this.activePart()?.color)
  // get hideSelectedNotes() { return this.resizeNoteState !== undefined || this.draggedNotes !== undefined; }

  // hoveredNote(): Note | undefined {
  //   const meter = this.project.currentProjectRaw()?.project().meter;
  //   if (!meter || this.mouseX() === undefined || this.mouseY() === undefined) return;

  //   const subdiv = Math.floor(meter.subdivision * time2beat(meter, this.tile().x2time(this.mouseX()!)));
  //   if (subdiv < 0) return;
  //   const pitch = Math.round(this.tile().y2pitch(this.mouseY()!));
  //   return {
  //     pitch,
  //     start: subdiv * PULSES_PER_BEAT / meter.subdivision,
  //     length: PULSES_PER_BEAT / meter.subdivision,
  //     notation: undefined,
  //   };
  // }

  // get notePreviewStyle() {
  //   if (this.activePartIdx === undefined) return;
  //   const hoveredNote = this.hoveredNote();
  //   if (!hoveredNote) return;
  //   return this.noteStyle(hoveredNote);
  // }

  // private note2rect(note: Note): Rect | undefined {
  //   const meter = this.project.currentProjectRaw()?.project().meter;
  //   if (!this.tile || !meter) return;

  //   const x = Math.round(this.tile().time2x(pulse2time(meter, note.start)));
  //   const y = Math.round(this.tile().pitch2y(note.pitch + .5));
  //   return {
  //     x,
  //     y,
  //     width: Math.round(this.tile().time2x(pulse2time(meter, (note.start + note.length)))) - x,
  //     height: Math.round(this.tile().pitch2y(note.pitch - 0.5)) - y,
  //   };
  // }

  // noteStyle(note: Note) {
  //   const r = this.note2rect(note);
  //   return r ? rect2style(r) + (r.width < 8 ? `border-inline-width: ${r.width / 2}px` : '') : undefined;
  // }

  // @HostListener('mousedown', ['$event'])
  // onMouseDown(event: MouseEvent) {
  //   if (event.button !== 0) return;
  //   if (this.activePartIdx !== undefined) {
  //     this.startAddNote(event);
  //   } else {
  //     this.startSelection(event);
  //   }
  // }

  // private clickStartNote?: Note;

  // async startAddNote(event: MouseEvent) {
  //   const activePartIdx = this.activePartIdx;
  //   if (activePartIdx === undefined) return;
  //   const hoveredNoteStart = this.hoveredNote();
  //   if (!hoveredNoteStart) return;

  //   event.preventDefault();

  //   this.clickStartNote = hoveredNoteStart;
  //   try {
  //     await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
  //     const hoveredNoteEnd = this.hoveredNote();
  //     if (!hoveredNoteEnd) return;
  //     const clickedNote = clickDragNote(hoveredNoteStart, hoveredNoteEnd);
  //     if (!clickedNote) return;
  //     this.project.currentProjectRaw()?.modify(
  //       ProjectLens(['parts']).compose(indexReadonlyArray(activePartIdx)).compose(PartLens('notes')).modify(
  //         notes => [...notes, clickedNote]
  //       )
  //     )
  //   } finally {
  //     this.clickStartNote = undefined;
  //   }
  // }

  // get activeNoteStyle() {
  //   if (!this.clickStartNote) return;
  //   const hoveredNote = this.hoveredNote();
  //   if (!hoveredNote) return;
  //   const activeNote = clickDragNote(this.clickStartNote, hoveredNote);
  //   return activeNote ? this.noteStyle(activeNote) : undefined;
  // }

  // selection: NoteSelection = PairsSet.empty();
  // get singleSelection() { return this.selection.asSingleton }

  // showResizeHandles = true;

  // private selectionStart?: readonly [number, number];

  // readonly #mousePos$ = toObservable(this.#mousePos);

  // async startSelection(event: MouseEvent) {
  //   if (this.activePartIdx !== undefined || this.mouseX() === undefined || this.mouseY() === undefined) return;
  //   const project = this.project.currentProjectRaw()?.project();
  //   if (project === undefined || project.meter === undefined) return;
  //   const projectMeter = project.meter;

  //   event.preventDefault();

  //   const mode =
  //     event.ctrlKey ? { t: 'xor', p: this.selection } as const
  //       : event.shiftKey ? { t: 'or', p: this.selection } as const
  //         : { t: 'new' } as const;

  //   this.showResizeHandles = false;
  //   const selStart = [this.mouseX()!, this.mouseY()!] as const;
  //   this.selectionStart = selStart;
  //   const onMoveSub = this.#mousePos$.pipe(rxjs.map(mousePos => {
  //     if (!mousePos) return;
  //     const time0 = time2pulse(projectMeter, this.tile().x2time(selStart[0]));
  //     const time1 = time2pulse(projectMeter, this.tile().x2time(mousePos[0]));
  //     const pitch0 = this.tile().y2pitch(selStart[1]);
  //     const pitch1 = this.tile().y2pitch(mousePos[1]);
  //     const selRect = {
  //       timeMin: Math.min(time0, time1),
  //       timeMax: Math.max(time0, time1),
  //       pitchMin: Math.min(pitch0, pitch1) - .5,
  //       pitchMax: Math.max(pitch0, pitch1) + .5,
  //     }
  //     return PairsSet.fromIterable<number, number>(function* () {
  //       for (const [partIdx, part] of project.parts.entries()) {
  //         yield [partIdx, function* () {
  //           for (const [noteIdx, note] of part.notes.entries()) {
  //             if (isNoteInRect(selRect, note)) yield noteIdx;
  //           }
  //         }()];
  //       }
  //     }());
  //   })).subscribe(curSel => {
  //     if (!curSel || curSel.isEmpty) {
  //       this.selection = mode.p ?? PairsSet.empty();
  //       return;
  //     }
  //     switch (mode.t) {
  //       case 'xor': curSel.xorWith(mode.p); break;
  //       case 'or': curSel.unionWith(mode.p); break;
  //     }
  //     this.selection = curSel;
  //   });
  //   try {
  //     await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
  //   } finally {
  //     onMoveSub.unsubscribe();
  //     this.selectionStart = undefined;
  //     this.showResizeHandles = true;
  //   }
  // }

  // get selectionStartRectStyle() {
  //   if (this.selectionStart === undefined || this.mouseX() === undefined || this.mouseY() === undefined) return;
  //   const x = Math.min(this.mouseX()!, this.selectionStart[0]);
  //   const xMax = Math.max(this.mouseX()!, this.selectionStart[0]);
  //   const y = Math.min(this.mouseY()!, this.selectionStart[1]);
  //   const yMax = Math.max(this.mouseY()!, this.selectionStart[1]);
  //   return rect2style({ x, y, width: xMax - x, height: yMax - y });
  // }

  // get selectionResizeIndicatorStyle() {
  //   const project = this.project.currentProjectRaw()?.project();
  //   if (!project || this.draggedNotes !== undefined) return;
  //   let note = this.resizeNote;
  //   if (this.singleSelection && !note) {
  //     const [partIdx, noteIdx] = this.singleSelection;
  //     note = project.parts[partIdx].notes[noteIdx];
  //   }
  //   const noteRect = note && this.note2rect(note);
  //   return noteRect && rect2style(noteRect);
  // }

  // resizeNoteState?: [number, number, 0 | 1];

  // async startNoteResize(which: 0 | 1, event: MouseEvent) {
  //   if (!this.singleSelection || event.button !== 0) return;
  //   event.preventDefault();
  //   event.stopPropagation();
  //   const [partIdx, noteIdx] = this.singleSelection;
  //   this.resizeNoteState = [partIdx, noteIdx, which];
  //   try {
  //     await rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
  //     const projectHolder = this.project.currentProjectRaw();
  //     if (projectHolder === undefined) return;
  //     const project = projectHolder.project();
  //     if (this.mouseX() === undefined || !project || !project.meter) return;
  //     const origNote = project.parts[partIdx].notes[noteIdx];
  //     const newNote = doResizeNote(
  //       project.meter,
  //       origNote,
  //       which,
  //       this.tile().x2time(this.mouseX()!),
  //     );
  //     // TODO: this may be confusing? maybe don't make undo state only if the drag was always a no-op
  //     if (lodash.isEqual(origNote, newNote)) return;
  //     projectHolder.modify(ProjectLens(['parts']).compose(indexReadonlyArray(partIdx)).compose(PartLens('notes')).compose(indexReadonlyArray(noteIdx)).set(newNote));
  //   } finally {
  //     this.resizeNoteState = undefined;
  //   }
  // }

  // get resizeNote() {
  //   const project = this.project.currentProjectRaw()?.project();
  //   if (!this.resizeNoteState || !project || !project.meter) return;
  //   const origNote = project.parts[this.resizeNoteState[0]].notes[this.resizeNoteState[1]];
  //   return !this.mouseX() ? origNote : doResizeNote(
  //     project.meter,
  //     origNote,
  //     this.resizeNoteState[2],
  //     this.tile().x2time(this.mouseX()!),
  //   );
  // }

  // get resizeNoteStyle() {
  //   const n = this.resizeNote;
  //   return n && this.noteStyle(n);
  // }

  // draggedNotes?: ReadonlyArray<readonly [number, Note]>;

  // private readonly keyboardShiftKey = toObservable(this.keyboardState.shiftKey);

  // async onSelectedNoteMouseDown(partIdx: number, noteIdx: number, event: MouseEvent) {
  //   const project = this.project.currentProjectRaw()?.project();
  //   if (!project || !project.meter || event.button !== 0 || this.mouseX() === undefined || this.mouseY() === undefined) return;
  //   event.preventDefault();
  //   event.stopPropagation();

  //   const dragStartX = this.mouseX()!;
  //   const dragStartY = this.mouseY()!;

  //   const nextMouseMove = rxjs.firstValueFrom(this.#mousePos$.pipe(rxjs.filter(v => !v || v[0] !== dragStartX || v[1] !== dragStartY)));
  //   const nextMouseUp = rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup'));
  //   if (await Promise.race([nextMouseUp.then(() => true), nextMouseMove.then(() => false)])) {
  //     // single click: just (select/toggle selection of) the note
  //     if (event.ctrlKey) {
  //       this.selection.toggle([partIdx, noteIdx]);
  //     } else if (event.shiftKey) {
  //       this.selection.add([partIdx, noteIdx]);
  //     } else {
  //       this.selection = PairsSet.singleton([partIdx, noteIdx]);
  //     }
  //     return;
  //   }

  //   const thisMoveNote = moveNote(project.meter, this.tile().x2time(dragStartX), this.tile().y2pitch(dragStartY))

  //   const onInputSub = rxjs.combineLatest({ pos: this.#mousePos$, shiftKey: this.keyboardShiftKey })
  //     .pipe(rxjs.map(({ pos, shiftKey }) => {
  //       if (!pos) return;
  //       const thisMoveNote2 = thisMoveNote(this.tile(), pos[0], pos[1], shiftKey);
  //       return Array.from(this.selection, ([partIdx, noteIdx]) =>
  //         [partIdx, thisMoveNote2(project.parts[partIdx].notes[noteIdx])] as const
  //       );
  //     }))
  //     .subscribe(x => this.draggedNotes = x);
  //   try {
  //     await nextMouseUp;
  //     if (this.mouseX() === undefined || this.mouseY() === undefined) return;
  //     const thisMoveNote2 = thisMoveNote(this.tile(), this.mouseX()!, this.mouseY()!, this.keyboardState.shiftKey());
  //     // TODO: this may be confusing? maybe don't make undo state only if the drag was always a no-op
  //     if (thisMoveNote2 === identity) return;
  //     this.project.currentProjectRaw()?.modify(ProjectLens(['parts']).modify(parts => Array.from(parts, (part, partIdx) => {
  //       const selPart = this.selection.withFirst(partIdx);
  //       return !selPart ? part : {
  //         ...part,
  //         notes: part.notes.map((note, noteIdx) => !selPart.has(noteIdx) ? note : thisMoveNote2(note))
  //       };
  //     })));
  //   } finally {
  //     this.draggedNotes = undefined;
  //     onInputSub.unsubscribe();
  //   }
  // }

  // trackIdx(idx: number, _item: unknown) { return idx }
}

// const clickDragNote = (start: Note, end: Note): Note | undefined => {
//   const length = end.start + end.length - start.start;
//   return length > 0 ? { ...start, length, pitch: end.pitch } : undefined;
// };

// const doResizeNote = (meter: Meter, origNote: Note, which: 0 | 1, time: number): Note => {
//   const ppsd = PULSES_PER_BEAT / meter.subdivision;

//   const mousePulseRaw = time2pulse(meter, time);
//   const mousePulse = Math.round(mousePulseRaw / ppsd) * ppsd;
//   const newNoteT1 = origNote.start + (1 - which) * origNote.length;
//   const newNoteT2 = mousePulse !== newNoteT1 ? mousePulse
//     : mousePulse + ppsd * (mousePulseRaw >= newNoteT1 ? +1 : -1);

//   return newNoteT2 >= newNoteT1
//     ? { ...origNote, start: newNoteT1, length: newNoteT2 - newNoteT1 }
//     : { ...origNote, start: newNoteT2, length: newNoteT1 - newNoteT2 };
// }

// const moveNote = (meter: Meter, startTime: number, startPitch: number) => {
//   const ppsd = PULSES_PER_BEAT / meter.subdivision;
//   const startPulse = time2pulse(meter, startTime);
//   return (tile: GenSpecTile<{ width: number, height: number }>, endX: number, endY: number, lockAxis: boolean) => {
//     const deltaPulse0 = Math.round((time2pulse(meter, tile.x2time(endX)) - startPulse) / ppsd) * ppsd;
//     const deltaPitch0 = Math.round(tile.y2pitch(endY) - startPitch);
//     const [deltaPulse, deltaPitch] =
//       !lockAxis
//         ? [deltaPulse0, deltaPitch0]
//         : (Math.abs(endX - tile.time2x(startTime)) > Math.abs(endY - tile.pitch2y(startPitch))
//           ? [deltaPulse0, 0]
//           : [0, deltaPitch0]);
//     return deltaPulse === 0 && deltaPitch === 0 ? identity : (note: Note): Note => ({
//       ...note,
//       start: note.start + deltaPulse,
//       pitch: note.pitch + deltaPitch,
//     });
//   };
// }

type Rect = { x: number; y: number; width: number; height: number; };
// const rect2style = ({ x, y, width, height }: Rect) =>
//   `transform: translate(${x}px,${y}px); width: ${width}px; height: ${height}px;`;

// const isNoteInRect = (rect: SpecTileWindow, note: Note) =>
//   (rect.pitchMin <= note.pitch && note.pitch <= rect.pitchMax)
//   && (rect.timeMin <= note.start + note.length && note.start <= rect.timeMax)

type DragHandler = (endTime: number, endPitch: number, lockAxis?: 'x' | 'y') => [Project, boolean] | undefined;
type CssCursorValue = "auto" | "pointer" | "move" | "not-allowed" | "ew-resize";

type RenderParams = {
  readonly viewport: Viewport;
  readonly project: Project;
  readonly dragging: boolean;
  readonly mousePos: Signal<readonly [number, number] | undefined>;
}

// if the project changes mid-drag (e.g. by undo), cancel drag
interface EditorState {
  render(params: RenderParams): [CssCursorValue, Drawable];
  startDrag(project: Project, startTime: number, startPitch: number): DragHandler;
}

class Notation implements EditorState {
  constructor(readonly activePartIdx: number) { }

  render({ viewport, project: { meter, parts }, dragging, mousePos: mousePos_ }: RenderParams): [CssCursorValue, Drawable] {
    if (meter === undefined) return ["auto", () => { }];
    const drawNotes: Drawable = canvasCtx => {
      for (const part of parts) {
        for (const note of part.notes) {
          drawNoteRect(canvasCtx, note2rect(viewport, meter, note), part.color);
        }
      }
    };
    if (!dragging) {
      const mousePos = mousePos_();
      if (mousePos !== undefined) {
        const subdiv = Math.floor(meter.subdivision * time2beat(meter, mousePos[0]));
        if (subdiv < 0) return ["not-allowed", drawNotes];
        const rect = note2rect(viewport, meter, {
          pitch : Math.round(mousePos[1]),
          start: subdiv * PULSES_PER_BEAT / meter.subdivision,
          length: PULSES_PER_BEAT / meter.subdivision,
          notation: undefined,
        });
        return ["pointer", canvasCtx => {
          drawNotes(canvasCtx);
          canvasCtx.save();
          drawNoteRect(canvasCtx, rect, parts[this.activePartIdx].color);
          canvasCtx.rect(rect.x, rect.y, rect.width, rect.height);
          canvasCtx.clip();
          canvasCtx.fillStyle = "#000";
          canvasCtx.globalAlpha = 0.5;
          canvasCtx.globalCompositeOperation = "destination-in";
          canvasCtx.fill();
          canvasCtx.restore();
        }];
      }
    }
    return ["auto", drawNotes];
  }

  startDrag(project: Project, startTime: number, startPitch: number): DragHandler {
    const meter = project.meter;
    if (meter === undefined) return () => undefined;
    const startSubdiv = Math.floor(meter.subdivision * time2beat(meter, startTime));
    if (startSubdiv < 0) return () => undefined;
    // add new note
    return (endTime: number, _endPitch: number) => {
      const endSubdiv = Math.ceil(meter.subdivision * time2beat(meter, endTime));
      const ppsd = PULSES_PER_BEAT / meter.subdivision;
      const length = endSubdiv - startSubdiv;
      if (length <= 0) return undefined;
      const op = ProjectLens(['parts']).compose(indexReadonlyArray(this.activePartIdx)).compose(PartLens('notes')).modify(
        notes => [...notes, { pitch: Math.round(startPitch), start: startSubdiv * ppsd, length: length * ppsd, notation: undefined }]
      );
      return [op(project), false];
    };
  }
}

class Selection implements EditorState {
  readonly #selectionRect = signal<SpecTileWindow | undefined>(undefined);
  constructor(private readonly currentSelection: NoteSelection) {
    currentSelection.clear();
  }

  render({ viewport, project: { parts, meter }, dragging }: RenderParams): [CssCursorValue, Drawable] {
    let cursor: CssCursorValue = "auto";
    const drawables: Array<Drawable> = [];
    if (meter === undefined) return [cursor, () => { }];
    for (const [partIdx, part] of parts.entries()) {
      for (const [noteIdx, note] of part.notes.entries()) {
        const isNoteSelected = this.currentSelection.has([partIdx, noteIdx]);
        drawables.push(canvasCtx => drawNoteRect(canvasCtx, note2rect(viewport, meter, note), part.color, isNoteSelected ? SELECTED_BORDER : DEFAULT_BORDER));
        if (false /* is mouse over drag handle */) {
          cursor = "ew-resize";
        }
        if (false /* is mouse over this note */ && isNoteSelected) {
          cursor = "move";
        }
      }
    }
    if (dragging && this.#selectionRect() !== undefined) {
      // draw selection rect
    }
    return [cursor, drawableMergeAll(drawables)];
  }

  startDrag(project: Project, startTime: number, startPitch: number): DragHandler {
    const prevSelection = this.currentSelection.clone();
    // if on drag handle, resize note (click => true no-op)
    // if on selected note, drag notes (click => change selection to the clicked note)
    // otherwise, update selection (click => treat as 0-length drag)
    return (endTime: number, endPitch: number, lockAxis?: 'x' | 'y') => {
      return [project, true];
    };
  }
}

type OutsetBorderStyle = {
  borderColor1: string,
  borderColor2: string,
  borderOpacity: number,
};
const DEFAULT_BORDER: OutsetBorderStyle = {
  borderColor1: "#545454",
  borderColor2: "#000000",
  borderOpacity: 8 / 15,
};
const SELECTED_BORDER: OutsetBorderStyle = {
  borderColor1: "#EEEEEEE",
  borderColor2: "#9A9A9A9",
  borderOpacity: 12 / 15,
};

function drawNoteRect(ctx: CanvasRenderingContext2D, { x, y, width, height }: Rect, fillStyle: string, { borderColor1, borderColor2, borderOpacity }: OutsetBorderStyle = DEFAULT_BORDER): void {
  // note: chromium does alpha-compositing in the display's color space, not sRGB
  // but canvas drawing always composites in sRGB (or Display P3)
  // so we can't exactly perfectly replicate chromium's outset border rendering

  if (width < 8) width = 8;
  if (height < 4) height = 4;
  if (x + width <= 0 || y + height <= 0 || x >= ctx.canvas.width || y >= ctx.canvas.height) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = borderColor1;
  ctx.fillRect(0, 0, width, 2);

  ctx.fillStyle = borderColor2;
  ctx.fillRect(0, height - 2, width, 2);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, height);
  ctx.lineTo(4, height - 2);
  ctx.lineTo(4, 0);
  ctx.closePath();
  ctx.fillStyle = borderColor1;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(width, height);
  ctx.lineTo(width, 0);
  ctx.lineTo(width - 4, 2);
  ctx.lineTo(width - 4, height);
  ctx.closePath();
  ctx.fillStyle = borderColor2;
  ctx.fill();

  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = "#000";
  ctx.globalAlpha = borderOpacity;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = fillStyle;
  ctx.globalAlpha = 1;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}

// TODO: copy-paste

function note2rect(viewport: Viewport, meter: Meter, note: Note): Rect {
  const x = Math.round(viewport.time2x(pulse2time(meter, note.start)));
  const y = Math.round(viewport.pitch2y(note.pitch + .5));
  return {
    x,
    y,
    width: Math.round(viewport.time2x(pulse2time(meter, (note.start + note.length)))) - x,
    height: Math.round(viewport.pitch2y(note.pitch - 0.5)) - y,
  };
}

type Drawable = (canvasCtx: CanvasRenderingContext2D) => void;
const drawableMergeAll = (drawables: Iterable<Drawable>): Drawable => canvasCtx => {
  for (const d of drawables) {
    d(canvasCtx)
  }
}

// problems:
// - hovered note looks bad when overlapping a real note

// code problems:
// - canvas devicepixelsize repeated
// - css pixels vs canvas pixels
