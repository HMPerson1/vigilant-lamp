import { ChangeDetectionStrategy, Component, ElementRef, NgZone, Signal, ViewChild, computed, effect, input, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as t from 'io-ts';
import { flatmap, imap, map, max, min, range, some } from 'itertools';
import { clamp, identity, isEqual } from 'lodash-es';
import * as Mousetrap from 'mousetrap';
import * as rxjs from 'rxjs';
import { Meter, Note, PULSES_PER_BEAT, PartL, Project, ProjectLp, pulse2time, time2beat, time2pulse } from '../../model/project';
import { decodeOrThrow } from '../../model/utils';
import { AudioVisualizationComponent } from '../audio-visualization/audio-visualization.component';
import { SpecTileWindow } from '../common';
import { KeyboardStateService } from '../services/keyboard-state.service';
import { ModifyOpts, ProjectService } from '../services/project.service';
import { PITCH_MAX, Viewport, elemBoxSizeSignal, indexReadonlyArray, sortPartsDisplay, } from '../ui-common';
import { PairsSet } from '../utils/pairs-set';

@Component({
    selector: 'app-piano-roll-editor',
    template: '<canvas #canvas [style.transform]="viewport.viewportTransform()"></canvas>',
    styles: ":host { display: block; }",
    host: {
        'class': 'canvas-box',
        '[style.cursor]': 'styleCursor()',
        '(mousedown)': 'onMouseDown($event)',
        '(window:copy)': 'onCopy($event)',
        '(window:cut)': 'onCopy($event)',
        '(window:paste)': 'onPaste($event)',
    },
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class PianoRollEditorComponent {
  readonly activePartIdx = input<number>();

  readonly #selectionState = computed(() => {
    const projectHolder = this.project.currentProjectRaw();
    return projectHolder && [new Selection(projectHolder.noteIdxInvalidated$), projectHolder] as const;
  });

  readonly #editorState = computed(() => {
    const selectionState_ = this.#selectionState();
    if (selectionState_ === undefined) return undefined;
    const [selectionState, projectHolder] = selectionState_;
    const activePartIdx = this.activePartIdx();
    return [
      identity<EditorState>(activePartIdx === undefined ? selectionState : new Notation(activePartIdx)),
      projectHolder,
    ] as const;
  });

  readonly #hover = computed(() => {
    const mousePos = this.#mousePos();
    if (mousePos === undefined) return undefined;
    const editorState_ = this.#editorState();
    if (editorState_ === undefined) return undefined;
    const [editorState, projectHolder] = editorState_;
    return [
      editorState.startDrag(projectHolder.project(), mousePos[0], mousePos[1], this.viewport.pxPerTime(), this.keyboardState.shiftKey(), this.keyboardState.ctrlKey()),
      projectHolder,
      mousePos,
    ] as const;
  });

  readonly #dragState = signal<DragHandlerCooked | undefined>(undefined);

  readonly styleCursor = computed(() =>
    this.#dragState()?.cursor ??
    (() => {
      const hover = this.#hover();
      return hover && (hover[0]?.cursor ?? 'not-allowed');
    })()
  );

  constructor(
    private readonly project: ProjectService,
    readonly viewport: AudioVisualizationComponent,
    private readonly keyboardState: KeyboardStateService,
    private readonly snackBar: MatSnackBar,
    hostElem: ElementRef<HTMLElement>,
    ngZone: NgZone,
  ) {
    const canvasSize = elemBoxSizeSignal(hostElem.nativeElement, 'device-pixel-content-box');
    effect(() => {
      const editorState_ = this.#editorState();
      if (editorState_ === undefined) return;
      const [editorState, projectHolder] = editorState_;

      const canvas = this.canvas.nativeElement;
      canvas.width = canvasSize().inlineSize;
      canvas.height = canvasSize().blockSize;
      const canvasCtx = canvas.getContext('2d')!;

      const dragState = this.#dragState();
      const project = (dragState?.type === "m" ? dragState.next()?.[0] : undefined) ?? projectHolder.project();
      const addDrawable = dragState?.type === 's' ? dragState.next()?.(viewport.viewport()) : undefined;
      editorState.render(canvasCtx, { viewport: viewport.viewport(), project, dragging: dragState !== undefined, mousePos: this.#mousePos, });
      addDrawable?.(canvasCtx);
    });
    effect(() => this.#dragState()?.addEffect?.());

    Mousetrap.bind(["del", "backspace"], () => ngZone.run(() => {
      const editorState_ = this.#editorState();
      if (editorState_ === undefined) return;
      const [editorState, projectHolder] = editorState_;
      const op = editorState.deleteSelection?.();
      if (op) projectHolder.modify(op[0], op[1]);
    }));
  }

  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;

  readonly #mousePos = computed(() => {
    const x = this.viewport.visMouseX();
    const y = this.viewport.visMouseY();
    if (x === undefined || y === undefined) return;
    const viewport = this.viewport.viewport();
    return [viewport.x2time(x), viewport.y2pitch(y)] as const;
  });

  async onMouseDown(event: MouseEvent) {
    if (event.button !== 0 || this.#dragState() !== undefined) return;

    const hover = this.#hover();
    if (hover === undefined) return;
    const [dragHandler, projectHolder, downMousePos] = hover;
    const projectStart = projectHolder.project();
    if (dragHandler === undefined) return;
    if (dragHandler.type === 's') {
      const dragResult = () => dragHandler.next(this.#mousePos());
      try {
        this.#dragState.set({ type: 's', cursor: dragHandler.cursor, next: dragResult });
        await nextMouseUp();
      } finally {
        this.#dragState.set(undefined);
      }
    } else {
      const dragResult = () => {
        const newMousePos = this.#mousePos();
        if (newMousePos === undefined) return;
        // largest movement axis determined by drag amount in current viewport
        const lockAxis = () => !this.keyboardState.shiftKey() ? undefined
          : (Math.abs(newMousePos[0] - downMousePos[0]) * this.viewport.pxPerTime()
            > Math.abs(newMousePos[1] - downMousePos[1]) * this.viewport.pxPerPitch())
            ? "x" : "y";
        return dragHandler.next(newMousePos[0], newMousePos[1], lockAxis);
      };
      let everMoved = false;
      const addEffect = () => {
        const newMousePos = this.#mousePos();
        everMoved ||= newMousePos === undefined || newMousePos[0] !== downMousePos[0] || newMousePos[1] !== downMousePos[1];
      }
      const nextProjectChange = rxjs.firstValueFrom(projectHolder.project$.pipe(rxjs.skip(1)));
      try {
        this.#dragState.set({ type: 'm', cursor: dragHandler.cursor, next: dragResult, addEffect });
        const cancelled = await Promise.race([nextMouseUp().then(() => false), nextProjectChange.then(() => true)]);
        if (cancelled) return;
        if (!everMoved && dragHandler.click) {
          dragHandler.click();
          return;
        }
        const projectNext = dragResult();
        if (projectNext === undefined) return;
        projectHolder.modify(p => {
          if (p !== projectStart) {
            throw new Error("project unexpectedly modified mid-drag");
          }
          return projectNext[0];
        }, projectNext[1]);
      } finally {
        this.#dragState.set(undefined);
      }
    }
  }

  onCopy(event: ClipboardEvent) {
    const editorState_ = this.#editorState();
    if (editorState_ === undefined) return;
    const [editorState, projectHolder] = editorState_;
    if (editorState.copySelection === undefined) return;
    if (event.clipboardData == null) throw new Error("could not copy to clipboard");
    event.preventDefault();
    const isCut = event.type === 'cut';
    const copyData = editorState.copySelection(projectHolder.project(), isCut);
    event.clipboardData.setData("application/json", JSON.stringify(copyData));
    if (isCut) {
      const op = editorState.deleteSelection?.();
      if (op) projectHolder.modify(op[0], op[1]);
    }
  }

  onPaste(event: ClipboardEvent) {
    const editorState_ = this.#editorState();
    if (editorState_ === undefined) return;
    const [editorState, projectHolder] = editorState_;
    if (editorState.paste === undefined) return;
    if (event.clipboardData == null) return;
    event.preventDefault();
    const pasteData = event.clipboardData.getData("application/json");
    if (pasteData.length === 0) return;
    try {
      const op = editorState.paste(JSON.parse(pasteData));
      if (op) projectHolder.modify(op[0], op[1]);
    } catch (e) {
      console.error(e);
      this.snackBar.open("Error pasting from clipboard.");
    }
  }
}

type DragHandlerCooked =
  { type: "m"; cursor: CssCursorValue; next(): [Project, ModifyOpts] | undefined; addEffect(): void; } |
  { type: "s", cursor: CssCursorValue, next(): ((v: Viewport) => Drawable) | undefined; addEffect?: undefined };


type SelectingDrag = {
  type: "s",
  cursor: CssCursorValue,
  next(mousePos: readonly [number, number] | undefined): (viewport: Viewport) => Drawable,
}
type ModifyingDrag = {
  type: "m",
  cursor: CssCursorValue,
  next(endTime: number, endPitch: number, lockAxis: () => 'x' | 'y' | undefined): [Project, ModifyOpts] | undefined;
  click?(): void;
}
type DragHandler = SelectingDrag | ModifyingDrag | undefined;

type RenderParams = {
  readonly viewport: Viewport;
  readonly project: Project;
  readonly dragging: boolean;
  readonly mousePos: Signal<readonly [number, number] | undefined>;
}

interface EditorState {
  render(canvasCtx: CanvasRenderingContext2D, params: RenderParams): void;
  startDrag(project: Project, startTime: number, startPitch: number, pxPerTime: number, shiftKey: boolean, ctrlKey: boolean): DragHandler;
  copySelection?(project: Project, isCut: boolean): any;
  paste?(pasteData: any): [(a: Project) => Project, ModifyOpts] | undefined;
  deleteSelection?(): [(a: Project) => Project, ModifyOpts] | undefined;
}

class Notation implements EditorState {
  constructor(readonly activePartIdx: number) { }

  render(canvasCtx: CanvasRenderingContext2D, { viewport, project: { meter, parts }, dragging, mousePos: mousePos_ }: RenderParams) {
    if (meter === undefined) return;
    for (const part of sortPartsDisplay(parts)) {
      if (!part.visible) continue;
      for (const note of part.notes) {
        drawNoteRect(canvasCtx, note2rect(viewport, meter, note), part.color);
      }
    }
    if (!dragging) {
      const mousePos = mousePos_();
      if (mousePos !== undefined) {
        const subdiv = Math.floor(meter.subdivision * time2beat(meter, mousePos[0]));
        if (subdiv < 0) return;
        const rect = note2rect(viewport, meter, {
          pitch: Math.round(mousePos[1]),
          start: subdiv * PULSES_PER_BEAT / meter.subdivision,
          length: PULSES_PER_BEAT / meter.subdivision,
          notation: undefined,
        });
        if (rect.width === 0 || rect.height === 0) return;
        const newLayer = new OffscreenCanvas(rect.width, rect.height);
        drawNoteRect(newLayer.getContext("2d")!, { ...rect, x: 0, y: 0 }, parts[this.activePartIdx].color);
        canvasCtx.save();
        canvasCtx.globalAlpha = 0.5;
        canvasCtx.drawImage(newLayer, rect.x, rect.y);
        canvasCtx.restore();
      }
    }
  }

  startDrag(project: Project, startTime: number, startPitch: number): DragHandler {
    const meter = project.meter;
    if (meter === undefined) return undefined;
    const startSubdiv = Math.floor(meter.subdivision * time2beat(meter, startTime));
    if (startSubdiv < 0) return undefined;
    // add new note
    return {
      type: 'm',
      cursor: 'pointer',
      next: (endTime, _endPitch) => {
        const endSubdiv = Math.ceil(meter.subdivision * time2beat(meter, endTime));
        const ppsd = PULSES_PER_BEAT / meter.subdivision;
        const length = endSubdiv - startSubdiv;
        if (length <= 0) return undefined;
        const op = ProjectLp(['parts']).compose(indexReadonlyArray(this.activePartIdx)).compose(PartL('notes')).modify(
          notes => [...notes, { pitch: Math.round(startPitch), start: startSubdiv * ppsd, length: length * ppsd, notation: undefined }]
        );
        return [op(project), { preservePartIdx: true }];
      },
    };
  }
}

class Selection implements EditorState {
  #lastPaste?: { data: any, repeatCount: number };
  #currentSelection: NoteSelection = PairsSet.empty();
  constructor(noteIdxInvalidated: rxjs.Observable<void>) {
    noteIdxInvalidated.subscribe(() => this.#currentSelection.clear());
  }

  render(canvasCtx: CanvasRenderingContext2D, { viewport, project: { parts, meter } }: RenderParams) {
    if (meter === undefined) return;
    for (const part of sortPartsDisplay(parts)) {
      if (!part.visible) continue;
      for (const [noteIdx, note] of part.notes.entries()) {
        const isNoteSelected = this.#currentSelection.has([part.idx, noteIdx]);
        drawNoteRect(canvasCtx, note2rect(viewport, meter, note), part.color, isNoteSelected ? SELECTED_BORDER : DEFAULT_BORDER);
      }
    }
    const singleSelection = this.#currentSelection.asSingleton;
    if (singleSelection !== null) {
      // draw resize handles
      const [partIdx, noteIdx] = singleSelection;
      const noteRect = note2rect(viewport, meter, parts[partIdx].notes[noteIdx]);
      canvasCtx.save();
      canvasCtx.beginPath();
      canvasCtx.moveTo(noteRect.x, noteRect.y);
      canvasCtx.lineTo(noteRect.x, noteRect.y + noteRect.height);
      canvasCtx.moveTo(noteRect.x + noteRect.width, noteRect.y);
      canvasCtx.lineTo(noteRect.x + noteRect.width, noteRect.y + noteRect.height);
      canvasCtx.strokeStyle = "#fff";
      canvasCtx.lineWidth = 2;
      canvasCtx.stroke();
      canvasCtx.restore();
    }
  }

  #isOverDragHandle(parts: Project["parts"], meter: Meter, time: number, pitch: number, pxPerTime: number): [0 | 1, readonly [number, number]] | undefined {
    const singleSelection = this.#currentSelection.asSingleton;
    if (singleSelection === null) return undefined;
    const [partIdx, noteIdx] = singleSelection;
    const note = parts[partIdx].notes[noteIdx];
    if (Math.round(pitch) !== note.pitch) {
      return undefined;
    } else if (Math.abs(pulse2time(meter, note.start) - time) * pxPerTime < 8) {
      return [0, singleSelection];
    } else if (Math.abs(pulse2time(meter, note.start + note.length) - time) * pxPerTime < 8) {
      return [1, singleSelection];
    } else {
      return undefined;
    }
  }

  #isOverSelectedNote(parts: Project["parts"], meter: Meter, time: number, pitch: number): boolean {
    const startPulse = time2pulse(meter, time);
    const startPitchInt = Math.round(pitch);
    return some(this.#selectedNotes(parts), note =>
      note.start <= startPulse && startPulse <= note.start + note.length && note.pitch === startPitchInt);
  }

  startDrag(project: Project, startTime: number, startPitch: number, pxPerTime: number, shiftKey: boolean, ctrlKey: boolean): DragHandler {
    const meter = project.meter;
    if (meter === undefined) return { type: 's', cursor: 'auto', next: () => () => () => { } };

    const hoveredDragHandle = this.#isOverDragHandle(project.parts, meter, startTime, startPitch, pxPerTime);
    if (hoveredDragHandle !== undefined) {
      // resize a note
      const [which, [partIdx, noteIdx]] = hoveredDragHandle;
      const origNote = project.parts[partIdx].notes[noteIdx];
      const ppsd = PULSES_PER_BEAT / meter.subdivision;
      const startPulse = time2pulse(meter, startTime);
      return {
        type: 'm',
        cursor: 'ew-resize',
        next: endTime => {
          const deltaPulse = time2pulse(meter, endTime) - startPulse;
          const newNoteT1 = origNote.start + (1 - which) * origNote.length;
          const newNoteT2Raw = origNote.start + which * origNote.length + deltaPulse;
          const newNoteT2_ = Math.round(newNoteT2Raw / ppsd) * ppsd;
          const newNoteT2 = newNoteT2_ !== newNoteT1 ? newNoteT2_
            : newNoteT1 + ppsd * (newNoteT2Raw >= newNoteT1 ? +1 : -1);
          const [start, length] = newNoteT2 >= newNoteT1 ? [newNoteT1, newNoteT2 - newNoteT1] : [newNoteT2, newNoteT1 - newNoteT2];
          const op = ProjectLp(['parts']).compose(indexReadonlyArray(partIdx)).compose(PartL('notes')).compose(indexReadonlyArray(noteIdx)).modify(
            note => ({ ...note, start, length })
          );
          return [op(project), { preserveSelection: true }];
        },
        click() { },
      };
    } else if (this.#isOverSelectedNote(project.parts, meter, startTime, startPitch)) {
      // move notes
      const selection = this.#currentSelection.clone();
      const selPulseMin = min(imap(this.#selectedNotes(project.parts), n => n.start))!;
      // const selPulseMax = max(imap(this.#selectedNotes(project.parts), n => n.start + n.length))!;
      const selPitchMin = min(imap(this.#selectedNotes(project.parts), n => n.pitch))!;
      const selPitchMax = max(imap(this.#selectedNotes(project.parts), n => n.pitch))!;
      const ppsd = PULSES_PER_BEAT / meter.subdivision;
      const startPulse = time2pulse(meter, startTime);
      return {
        type: 'm',
        cursor: 'move',
        next: (endTime, endPitch, lockAxis_) => {
          const lockAxis = lockAxis_();
          const deltaPulse0 = lockAxis === 'y' ? 0 :
            Math.round((time2pulse(meter, endTime) - startPulse) / ppsd) * ppsd;
          const deltaPitch0 = lockAxis === 'x' ? 0 :
            Math.round(endPitch - startPitch);
          const deltaPulse = Math.max(deltaPulse0, -selPulseMin);
          const deltaPitch = clamp(deltaPitch0, -selPitchMin, PITCH_MAX - selPitchMax);
          if (deltaPulse === 0 && deltaPitch === 0) return undefined;
          return [{
            ...project,
            parts: project.parts.map((part, partIdx) => {
              const selPart = selection.withFirst(partIdx);
              return !selPart ? part : {
                ...part,
                notes: part.notes.map((note, noteIdx) =>
                  !selPart.has(noteIdx) ? note : { ...note, start: note.start + deltaPulse, pitch: note.pitch + deltaPitch }),
              };
            }),
          }, { preserveSelection: true }];
        },
        click: () => this.#startSelectionDrag(project.parts, meter, startTime, startPitch, shiftKey, ctrlKey).next([startTime, startPitch]),
      };
    } else {
      return this.#startSelectionDrag(project.parts, meter, startTime, startPitch, shiftKey, ctrlKey);
    }
  }

  #startSelectionDrag(parts: Project["parts"], meter: Meter, startTime: number, startPitch: number, shiftKey: boolean, ctrlKey: boolean): SelectingDrag {
    const prevSelection = this.#currentSelection.clone();
    return {
      type: 's',
      cursor: 'auto',
      next: mousePos => {
        if (mousePos === undefined) {
          this.#currentSelection.clear();
          if (ctrlKey) {
            this.#currentSelection.xorWith(prevSelection);
          } else if (shiftKey) {
            this.#currentSelection.unionWith(prevSelection);
          }
          return () => () => { };
        }
        const [endTime, endPitch] = mousePos;
        const selRect = {
          timeMin: Math.min(startTime, endTime),
          timeMax: Math.max(startTime, endTime),
          pitchMin: Math.min(startPitch, endPitch),
          pitchMax: Math.max(startPitch, endPitch),
        };
        this.#currentSelection.setFromIterable(function* () {
          for (const [partIdx, part] of parts.entries()) {
            if (!part.visible) continue;
            yield [partIdx, function* () {
              for (const [noteIdx, note] of part.notes.entries()) {
                if (isNoteInRect(selRect, note, meter)) yield noteIdx;
              }
            }()];
          }
        }());
        if (ctrlKey) {
          this.#currentSelection.xorWith(prevSelection);
        } else if (shiftKey) {
          this.#currentSelection.unionWith(prevSelection);
        }
        return viewport => canvasCtx => {
          canvasCtx.save();
          canvasCtx.beginPath();
          const x = viewport.time2x(selRect.timeMin);
          const y = viewport.pitch2y(selRect.pitchMin);
          canvasCtx.rect(
            x,
            y,
            viewport.time2x(selRect.timeMax) - x,
            viewport.pitch2y(selRect.pitchMax) - y
          );
          canvasCtx.fillStyle = "#fff3";
          canvasCtx.fill();
          canvasCtx.lineWidth = 1;
          canvasCtx.strokeStyle = "#fff";
          canvasCtx.setLineDash([5, 5]);
          canvasCtx.stroke();
          canvasCtx.restore();
        };
      },
    };
  }

  copySelection(project: Project, isCut: boolean): ClipboardNoteData {
    const currentSelection = this.#currentSelection;
    const ret = Object.fromEntries(function* () {
      for (const [partIdx, part] of project.parts.entries()) {
        const selPart = currentSelection.withFirst(partIdx);
        if (selPart !== undefined) {
          yield [partIdx, part.notes.filter((_note, noteIdx) => selPart.has(noteIdx))];
        }
      }
    }());
    this.#lastPaste = { data: ret, repeatCount: isCut ? 0 : 1 };
    return ret;
  }

  paste(pasteData: any): [(a: Project) => Project, ModifyOpts] | undefined {
    const dataObj = decodeOrThrow(ClipboardNoteData, pasteData, "error parsing pasted data");
    const data = Object.entries(dataObj);
    if (data.length === 0) return undefined;
    const duration = max(flatmap(data, ([, notes]) => map(notes, n => n.start + n.length)))! - min(flatmap(data, ([, notes]) => map(notes, n => n.start)))!;
    let pasteOffset = 0;
    if (this.#lastPaste !== undefined && isEqual(pasteData, this.#lastPaste.data)) {
      pasteOffset = this.#lastPaste.repeatCount++;
    }
    return [project => {
      if (project.meter === undefined) return project;
      const ppmm = project.meter.measureLength * PULSES_PER_BEAT;
      const stride = duration > ppmm ? Math.ceil(duration / ppmm) * ppmm : duration;
      const offset = stride * pasteOffset;
      const newParts = project.parts.map((part, partIdx) => {
        const partData = dataObj[partIdx];
        return partData === undefined ? [part, undefined] as const : [{
          ...part, notes: [
            ...part.notes,
            ...partData.map(note => ({ ...note, start: note.start + offset })),
          ],
        }, [part.notes.length, partData.length]] as const;
      });
      this.#currentSelection.setFromIterable(function* () {
        for (const [partIdx, [, partRange]] of newParts.entries()) {
          if (partRange !== undefined) {
            const [start, length] = partRange;
            yield [partIdx, range(start, start + length)];
          }
        }
      }());
      return {
        ...project, parts: newParts.map(v => v[0]),
      };
    }, { preservePartIdx: true }];
  }

  deleteSelection(): [(a: Project) => Project, ModifyOpts] | undefined {
    if (this.#currentSelection.isEmpty) return undefined;
    const selection = this.#currentSelection.clone();
    return [project => ({
      ...project,
      parts: project.parts.map((part, partIdx) => {
        const selPart = selection.withFirst(partIdx);
        return !selPart ? part : {
          ...part,
          notes: part.notes.filter((_note, noteIdx) => !selPart.has(noteIdx)),
        };
      }),
    }), { preservePartIdx: true }];
  }

  *#selectedNotes(parts: Project["parts"]) {
    for (const [partIdx, noteIdx] of this.#currentSelection) {
      yield parts[partIdx].notes[noteIdx];
    }
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
  borderColor1: "#EEEEEE",
  borderColor2: "#9A9A9A",
  borderOpacity: 12 / 15,
};

function drawNoteRect(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, { x, y, width, height }: Rect, fillStyle: string, { borderColor1, borderColor2, borderOpacity }: OutsetBorderStyle = DEFAULT_BORDER): void {
  // note: chromium does alpha-compositing in the display's color space, not sRGB
  // but canvas drawing always composites in sRGB (or Display P3)
  // so we can't exactly perfectly replicate chromium's outset border rendering

  const borderWidth = Math.min(4, width / 2);
  const borderHeight = Math.min(2, height / 2);
  if (x + width <= 0 || y + height <= 0 || x >= ctx.canvas.width || y >= ctx.canvas.height) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = borderColor1;
  ctx.fillRect(0, 0, width, borderHeight);

  ctx.fillStyle = borderColor2;
  ctx.fillRect(0, height - borderHeight, width, borderHeight);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, height);
  ctx.lineTo(borderWidth, height - borderHeight);
  ctx.lineTo(borderWidth, 0);
  ctx.closePath();
  ctx.fillStyle = borderColor1;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(width, height);
  ctx.lineTo(width, 0);
  ctx.lineTo(width - borderWidth, borderHeight);
  ctx.lineTo(width - borderWidth, height);
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

const nextMouseUp = () => rxjs.firstValueFrom(rxjs.fromEvent(document, 'mouseup').pipe(rxjs.filter(ev => (ev as MouseEvent).button === 0)));

const isNoteInRect = (rect: SpecTileWindow, note: Note, meter: Meter) =>
  (rect.pitchMin <= note.pitch + .5 && note.pitch - .5 <= rect.pitchMax)
  && (rect.timeMin <= pulse2time(meter, note.start + note.length) && pulse2time(meter, note.start) <= rect.timeMax);

type Rect = { x: number; y: number; width: number; height: number; };
type CssCursorValue = "auto" | "pointer" | "move" | "not-allowed" | "ew-resize";
type Drawable = (canvasCtx: CanvasRenderingContext2D) => void;

type NoteSelection = PairsSet<number, number>;

type ClipboardNoteData = t.TypeOf<typeof ClipboardNoteData>;
const ClipboardNoteData = t.record(t.string, t.array(Note));

// code problems:
// - canvas devicepixelsize repeated
// - css pixels vs canvas pixels
