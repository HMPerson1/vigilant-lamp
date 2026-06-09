import { either } from 'fp-ts';
import { identity, pipe } from 'fp-ts/function';
import * as t from 'io-ts';
import { fromRefinement } from 'io-ts-types/fromRefinement';
import { PathReporter } from 'io-ts/PathReporter';

// msgpack always coerces `undefined` to `null`, so coerce it back here
export const t_nullable = <C extends t.Any>(codec: C) => new t.Type<t.TypeOf<C> | undefined>(
  codec.name,
  (u): u is t.TypeOf<C> | undefined => u === undefined || codec.is(u),
  (i, ctx) => i == null ? t.success(undefined) : codec.validate(i, ctx),
  identity,
);

export const t_Uint8Array = fromRefinement("Uint8Array", (u): u is Uint8Array => u instanceof Uint8Array);
export const t_Float32Array = t_Uint8Array.pipe(new t.Type<Float32Array, Uint8Array, Uint8Array>(
  "Float32Array",
  (u): u is Float32Array => u instanceof Float32Array,
  (i, ctx) => t.success(new Float32Array(i.slice().buffer)),
  (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
));

export function decodeOrThrow<IOT extends t.Any>(codec: IOT, value: unknown, consoleMsg: string): t.TypeOf<IOT> {
  return pipe(
    codec.decode(value),
    either.getOrElseW(e => {
      const fullPathError = PathReporter.report(either.left(e)).join("\n");
      console.error(consoleMsg + ":\n" + fullPathError + "\n", e);
      throw new Error("could not decode value")
    }),
  );
}
