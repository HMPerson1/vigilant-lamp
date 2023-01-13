mod utils;

use realfft::{RealToComplex};
use wasm_bindgen::prelude::*;
// use wasm_mt_pool::prelude::*;

use js_sys::Float32Array;
use web_sys::console;
// use wasm_mt::utils::{console_ln, sleep};

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn greet() {
    alert("Hello, wasm!");
}

// #[wasm_bindgen]
// pub async fn mt_test() {
//     let pool = ThreadPool::new(8, "./pkg/wasm.js")
//         .and_init()
//         .await
//         .unwrap();
//     let what = pool_exec!(pool, move || {
//         console_ln!("");
//         Ok(JsValue::UNDEFINED)
//     });
// }

#[wasm_bindgen]
pub fn compute_spectrogram_sync(
    time_step: usize,
    lg_fft_window_size: usize,
    gaus_window_sigma: f64,
    audio_samples: &[f32],
) -> Vec<Float32Array> {
    utils::set_panic_hook();
    assert!(lg_fft_window_size > 1);

    let fft_size = 1 << lg_fft_window_size;
    let fft = realfft::RealToComplexEven::<f32>::new(fft_size, &mut rustfft::FftPlanner::new());
    let mut in_scratch = fft.make_input_vec();
    let mut fft_scratch = fft.make_scratch_vec();
    let mut out_scratch = fft.make_output_vec();
    let mut spec_scratch = vec![0_f32; out_scratch.len()];
    let window = gen_gaussian_window(in_scratch.len(), gaus_window_sigma);
    (0..ceil_div(audio_samples.len(), time_step))
        .map(|i| {
            let start = i * time_step;
            let end = start + fft_size;
            if end >= audio_samples.len() {
                let in_end = audio_samples.len() - start;
                in_scratch[0..in_end].copy_from_slice(&audio_samples[start..]);
                in_scratch[in_end..].fill(0_f32);
            } else {
                in_scratch.copy_from_slice(&audio_samples[start..end]);
            }
            for (x, w) in in_scratch.iter_mut().zip(window.iter()) {
                *x *= w;
            }
            fft.process_with_scratch(&mut in_scratch, &mut out_scratch, &mut fft_scratch).unwrap();
            for (spec, out) in spec_scratch.iter_mut().zip(out_scratch.iter()) {
                *spec = out.norm() / (audio_samples.len() as f32).sqrt()
            }
            Float32Array::from(&*spec_scratch)
        })
        .collect()
}

fn ceil_div(a: usize, b: usize) -> usize {
    (a - 1) / b + 1
}

fn gen_gaussian_window(n: usize, sigma: f64) -> Box<[f32]> {
    (0..n)
        .map(|i| {
            let n = n as f64;
            let i = i as f64;
            (-1. / 2. * ((i - n / 2.) / (sigma * n / 2.)).powi(2)).exp() as f32
        })
        .collect()
}
