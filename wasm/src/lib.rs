mod utils;

use std::fmt::format;

use realfft::{num_complex::Complex32, RealToComplex, RealToComplexEven};
use wasm_bindgen::{prelude::*, Clamped};
// use wasm_mt_pool::prelude::*;

use js_sys::Float32Array;
use web_sys::{console, ImageData};
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

#[wasm_bindgen]
pub struct SpectrogramRenderer {
    audio_samples: Box<[f32]>,
    audio_sample_rate: u32,
    window: Box<[f32]>,
    fft_in: Box<[f32]>,
    fft_scratch: Box<[Complex32]>,
    fft_out: Box<[Complex32]>,
    fft: RealToComplexEven<f32>,
}

#[wasm_bindgen]
impl SpectrogramRenderer {
    #[wasm_bindgen(constructor)]
    pub fn new(
        audio_samples: &[f32],
        audio_sample_rate: u32,
        fft_window_size: usize,
        gaus_window_sigma: f64,
    ) -> Self {
        let fft = realfft::RealToComplexEven::<f32>::new(
            fft_window_size,
            &mut rustfft::FftPlanner::new(),
        );
        Self {
            audio_samples: audio_samples.into(),
            audio_sample_rate,
            window: gen_gaussian_window(fft_window_size, gaus_window_sigma),
            fft_in: fft.make_input_vec().into(),
            fft_scratch: fft.make_scratch_vec().into(),
            fft_out: fft.make_output_vec().into(),
            fft,
        }
    }

    #[wasm_bindgen]
    pub fn render(
        &mut self,
        canvas_width: u32,
        canvas_height: u32,
        freq_min: f64,
        freq_max: f64,
        sample_start: usize,
        sample_end: usize,
        db_min: f64,
        db_max: f64,
    ) -> Result<ImageData, JsValue> {
        utils::set_panic_hook();
        assert!(self.window.len() == self.fft_in.len());

        let freq_min_ln = freq_min.ln();
        let freq_max_ln = freq_max.ln();
        let y_to_freq_ln_mul = (freq_max_ln - freq_min_ln) / (canvas_height as f64);
        let y_to_freq_ln_add =
            freq_min_ln + (self.fft_out.len() as f64 / (self.audio_sample_rate as f64 / 2.)).ln();

        let sample_len = sample_end - sample_start;
        let x_to_sample = sample_len as f64 / canvas_width as f64;

        let db_range = db_max - db_min;

        let mut pixel_data = PixelBuf::new(canvas_width, canvas_height);
        for x in 0..canvas_width {
            let sample = sample_start + (x as f64 * x_to_sample).round() as usize;
            if sample >= self.audio_samples.len() {
                break;
            }
            self.do_fft_at(sample);

            for y in 0..canvas_height {
                let bucket = ((y as f64 * y_to_freq_ln_mul) + y_to_freq_ln_add).exp();
                let t = if let Some(power) = self.power_at_freq_bucket(bucket.round() as usize) {
                    (20. * (power as f64).log10() - db_min) / db_range
                } else {
                    0.
                };
                pixel_data.set_pixel(x, y, colorous::INFERNO.eval_continuous(t).as_array());
            }
        }

        ImageData::new_with_u8_clamped_array_and_sh(
            Clamped(&mut pixel_data.into_buf()),
            canvas_width,
            canvas_height,
        )
    }

    fn do_fft_at(&mut self, sample: usize) {
        copy_centered_window(sample, &self.audio_samples, &mut self.fft_in);

        for (x, w) in self.fft_in.iter_mut().zip(self.window.iter()) {
            *x *= w;
        }

        self.fft
            .process_with_scratch(&mut self.fft_in, &mut self.fft_out, &mut self.fft_scratch)
            .unwrap();
    }

    fn power_at_freq_bucket(&self, bucket: usize) -> Option<f32> {
        Some(self.fft_out.get(bucket)?.norm() / (self.audio_samples.len() as f32).sqrt())
    }
}

struct PixelBuf {
    buf: Box<[u8]>,
    width: u32,
}

impl PixelBuf {
    fn new(width: u32, height: u32) -> Self {
        Self {
            buf: vec![255_u8; (width * height * 4) as usize].into(),
            width,
        }
    }
    fn into_buf(self) -> Box<[u8]> {
        self.buf
    }
    fn set_pixel(&mut self, x: u32, y: u32, color: [u8; 3]) {
        let start = ((y * self.width + x) * 4) as usize;
        self.buf[start + 0] = color[0];
        self.buf[start + 1] = color[1];
        self.buf[start + 2] = color[2];
    }
}
