import * as msgpack from '@msgpack/msgpack';
import * as t from 'io-ts';
import { decodeOrThrow } from './utils';
import * as current from './versions/current';
import * as v01 from './versions/v01';
import { absurd } from 'fp-ts/lib/function';

export * from './versions/current';

export async function fromBlob(blob: Blob): Promise<current.Project> {
  return up(decodeOrThrow(BlobType, await msgpack.decodeAsync(blob.stream()), "error parsing project data"));
}

function up(blobData: t.TypeOf<typeof BlobType>): current.Project {
  switch (blobData.v) {
    case 1: return blobData.d;
    // case 1: return up({v:2, d:convert_01_02(blobData.d)});
    // case 2: return up({v:3, d:convert_02_03(blobData.d)});
    // case 3: return blobData.d;
    default: return absurd(blobData.v);
  }
}

export function intoBlob(project: current.Project): Blob {
  return new Blob([msgpack.encode(BlobType.encode({ v: 1, d: project }))]);
}

const BlobType = t.strict({ v: t.literal(1), d: v01.Project });

// const BlobType = t.union([
//   t.strict({ v: t.literal(1), d: v01.Project }),
//   t.strict({ v: t.literal(2), d: v02.Project }),
//   t.strict({ v: t.literal(3), d: v03.Project }),
// ]);
