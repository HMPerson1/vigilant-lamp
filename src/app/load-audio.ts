// @ts-ignore
import * as wav from 'wav-decoder';
import * as lodash from "lodash"
import { AudioSamples } from './common';

export function loadAudio(file: Blob, sampleRate: number): Promise<{ audioBuffer: AudioBuffer, audioData: AudioSamples }> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      // FIXME: when webcodecs is stable, rewrite to avoid resampling
      const audioFile = e.target!.result as ArrayBuffer
      const decodeOffAudioCtx = new OfflineAudioContext(1, 1, sampleRate);
      const audioBuffer = await decodeOffAudioCtx.decodeAudioData(audioFile);
      const mixOffAudioCtx = new OfflineAudioContext(1, audioBuffer.length, sampleRate);
      const srcNode = new AudioBufferSourceNode(mixOffAudioCtx, { buffer: audioBuffer });
      srcNode.connect(mixOffAudioCtx.destination)
      srcNode.start()
      const monoAudioBuffer = await mixOffAudioCtx.startRendering()
      resolve({ audioBuffer, audioData: { sampleRate: monoAudioBuffer.sampleRate, samples: monoAudioBuffer.getChannelData(0) } })
    }
    reader.readAsArrayBuffer(file)
  })
}
