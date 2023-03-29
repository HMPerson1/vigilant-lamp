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
      const dsWorker = new Worker(new URL('./downsample-audio.worker', import.meta.url));
      dsWorker.onmessage = ({ data }) => {
        const [audioDataDs2, audioDataDs4] = data
        resolve({ audioBuffer, audioData: new AudioSamples(monoAudioBuffer.sampleRate, monoAudioBuffer.getChannelData(0), audioDataDs2, audioDataDs4) })
      }
      dsWorker.postMessage(monoAudioBuffer.getChannelData(0))
    }
    reader.readAsArrayBuffer(file)
  })
}
