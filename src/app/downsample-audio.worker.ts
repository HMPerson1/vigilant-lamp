onmessage = async function (msg) {
  const wasm_module = await import("../../wasm/pkg")
  const [samplesDs2, samplesDs4] = wasm_module.preprocess_audio(msg.data)
  postMessage([samplesDs2, samplesDs4], { transfer: [samplesDs2.buffer, samplesDs4.buffer] })
}
