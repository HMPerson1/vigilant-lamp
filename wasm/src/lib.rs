mod utils;

use realfft::RealToComplex;
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

    let fft = realfft::RealToComplexEven::<f32>::new(
        1 << lg_fft_window_size,
        &mut rustfft::FftPlanner::new(),
    );
    let mut in_scratch = fft.make_input_vec();
    let mut fft_scratch = fft.make_scratch_vec();
    let mut out_scratch = fft.make_output_vec();
    let mut spec_scratch = vec![0_f32; out_scratch.len()];
    let window = gen_gaussian_window(in_scratch.len(), gaus_window_sigma);
    (0..ceil_div(audio_samples.len(), time_step))
        .map(|i| {
            copy_centered_window(i * time_step, audio_samples, &mut in_scratch);
            for (x, w) in in_scratch.iter_mut().zip(window.iter()) {
                *x *= w;
            }

            fft.process_with_scratch(&mut in_scratch, &mut out_scratch, &mut fft_scratch)
                .unwrap();
            for (spec, out) in spec_scratch.iter_mut().zip(out_scratch.iter()) {
                *spec = out.norm() / (audio_samples.len() as f32).sqrt()
            }
            Float32Array::from(&*spec_scratch)
        })
        .collect()
}

fn copy_centered_window(center: usize, data: &[f32], window_out: &mut [f32]) {
    let wndw_size = window_out.len();
    let data_len = data.len();
    assert!(center < data_len);
    let end = center + wndw_size / 2;
    match (center.checked_sub(wndw_size / 2), end <= data_len) {
        (Some(start), true) => {
            // window fully contained by data
            window_out.copy_from_slice(&data[start..end]);
        }
        (Some(start), false) => {
            // window end past data end
            let in_end = data_len - start;
            window_out[0..in_end].copy_from_slice(&data[start..]);
            window_out[in_end..].fill(0_f32);
        }
        (None, true) => {
            // window start before data start
            let in_start = wndw_size / 2 - center;
            window_out[0..in_start].fill(0_f32);
            window_out[in_start..].copy_from_slice(&data[0..(wndw_size - in_start)]);
        }
        (None, false) => {
            // window surrounds data
            let in_start = wndw_size / 2 - center;
            let in_end = in_start + data_len;
            window_out[0..in_start].fill(0_f32);
            window_out[in_start..in_end].copy_from_slice(data);
            window_out[in_end..].fill(0_f32);
        }
    }
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
