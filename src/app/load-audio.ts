import { AudioSamples } from './common';

/// detaches `arrBuf`
export async function loadAudio(arrBuf: ArrayBuffer, sampleRate: number): Promise<AudioBuffer> {
  return await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(arrBuf);
}

export function downsampleAudio(audioBuffer: AudioBuffer, sampleRate: number): Promise<AudioSamples> {
  return new Promise(async (resolve) => {
    // FIXME: when webcodecs is stable, rewrite to avoid resampling
    const mixOffAudioCtx = new OfflineAudioContext(1, audioBuffer.length, sampleRate);
    const srcNode = new AudioBufferSourceNode(mixOffAudioCtx, { buffer: audioBuffer });
    srcNode.connect(mixOffAudioCtx.destination)
    srcNode.start()
    const monoAudioBuffer = await mixOffAudioCtx.startRendering()
    const dsWorker = new Worker(new URL('./downsample-audio.worker', import.meta.url));
    dsWorker.onmessage = ({ data }) => {
      const [audioDataDs2, audioDataDs4] = data
      resolve(new AudioSamples(monoAudioBuffer.sampleRate, monoAudioBuffer.getChannelData(0), audioDataDs2, audioDataDs4))
    }
    dsWorker.postMessage(monoAudioBuffer.getChannelData(0))
  })

}
