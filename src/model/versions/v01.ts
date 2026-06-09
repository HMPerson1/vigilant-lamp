import * as t from 'io-ts';
import { Lens, Optional } from 'monocle-ts';
import { t_Float32Array, t_Uint8Array, t_nullable } from '../utils';

export const PULSES_PER_BEAT = 24;
// in 4/4, allows 32nd notes and 16th note triplets

export interface Note extends t.TypeOf<typeof Note> { }
export const Note = t.readonly(t.type({
  /** in pulses */
  start: t.Integer,
  /** in pulses */
  length: t.Integer,
  /** in MIDI pitch */
  pitch: t.Integer,
  notation: t_nullable(t.type({})), // TODO
}), "Note");
export const NoteL = Lens.fromProp<Note>();

export enum Instruments {
  DEFAULT = 'default_synth',
}

export interface Part extends t.TypeOf<typeof Part> { }
export const Part = t.readonly(t.type({
  notes: t.readonlyArray(Note),
  name: t.string,
  instrument: t.literal(Instruments.DEFAULT), // TODO: instruments?
  /// #ff0000
  color: t.refinement(t.string, s => /^#[0-9a-fA-F]{6}$/.test(s)),
  displayIndex: t.Integer,
  // displayIndex: t_nullable(t.Integer).pipe(new t.Type<number, number, number | undefined>("", (x): x is number => true, x => t.success(x ?? 0), identity)),
  /// 0...1
  gain: t.number,
  visible: t.boolean,
}), "Part");
export const PartL = Lens.fromProp<Part>();
export const defaultPart: Omit<Part, 'displayIndex'> = {
  notes: [],
  name: 'New Part',
  instrument: Instruments.DEFAULT,
  color: '#0000ff',
  gain: 1,
  visible: true,
};

export interface Meter extends t.TypeOf<typeof Meter> { }
export const Meter = t.readonly(t.type({
  state: t.union([t.literal('active'), t.literal('locked')]),
  startOffset: t.number,
  bpm: t.number,
  measureLength: t.Integer,
  subdivision: t.Integer,
}), "Meter");
export const MeterL = Lens.fromProp<Meter>();

export type MinMeter = Pick<Meter, "bpm" | "startOffset">;
export const isMinMeter = (meter: Partial<Meter>): meter is Partial<Meter> & MinMeter => meter.bpm !== undefined && meter.startOffset !== undefined;

export const time2beat = (meter: MinMeter, t: number): number => (t - meter.startOffset) * meter.bpm / 60;
export const beat2time = (meter: MinMeter, b: number): number => b * 60 / meter.bpm + meter.startOffset;
export const time2pulse = (meter: MinMeter, t: number): number => time2beat(meter, t) * PULSES_PER_BEAT;
export const pulse2time = (meter: MinMeter, p: number): number => beat2time(meter, p / PULSES_PER_BEAT);


export interface AudioSamples extends t.TypeOf<typeof AudioSamples> { }
export const AudioSamples = t.readonly(t.type({
  sampleRate: t.number,
  samples: t_Float32Array,
  samples_ds2: t_Float32Array,
  samples_ds4: t_Float32Array,
}));

export const audioSamplesDuration = (a: AudioSamples): number => a.samples.length / a.sampleRate;

export interface Project extends t.TypeOf<typeof Project> { }
export const Project = t.readonly(t.type({
  audioFile: t_Uint8Array,
  audio: AudioSamples,
  meter: t_nullable(Meter),
  parts: t.readonlyArray(Part),
}), "Project");
export const ProjectLp = Lens.fromPath<Project>();
export const ProjectLop = Optional.fromPath<Project>();
