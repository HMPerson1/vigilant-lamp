mod colormap;
mod utils;

use realfft::{num_complex::Complex32, RealToComplex, RealToComplexEven};
use wasm_bindgen::{prelude::*, Clamped};

use web_sys::ImageData;

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
        utils::set_panic_hook();
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
        pitch_min: f64,
        pitch_max: f64,
        time_start: f64,
        time_end: f64,
    ) -> SpectrogramTile {
        assert!(self.window.len() == self.fft_in.len());
        let audio_sample_rate = self.audio_sample_rate as f64;

        let freq_min_ln = pitch2freq(pitch_min).ln();
        let freq_max_ln = pitch2freq(pitch_max).ln();
        let y_to_freq_ln_mul = ((freq_max_ln - freq_min_ln) / (canvas_height as f64)) as f32;
        let y_to_freq_ln_add =
            (freq_min_ln + (self.fft_out.len() as f64 / (audio_sample_rate / 2.)).ln()) as f32;

        let time_len = time_end - time_start;
        let x_to_time = time_len / canvas_width as f64;

        let mut tile = SpectrogramTile::new(canvas_width, canvas_height);
        for x in 0..canvas_width {
            let sample = ((time_start + x as f64 * x_to_time) * audio_sample_rate).round() as isize;
            if sample < 0 {
                continue;
            }
            let sample = sample as usize;
            if sample >= self.audio_samples.len() {
                break;
            }
            self.do_fft_at(sample);

            for y in 0..canvas_height {
                // TODO: anti-alias?
                let bucket = ((y as f32 * y_to_freq_ln_mul) + y_to_freq_ln_add).exp();
                if let Some(db) = self.db_at_freq_bucket(bucket.round() as usize) {
                    tile.set_pixel(x, y, db as f32);
                }
            }
        }

        tile
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

    fn db_at_freq_bucket(&self, bucket: usize) -> Option<f32> {
        let power =
            self.fft_out.get(bucket)?.norm() as f32 / (self.audio_samples.len() as f32).sqrt();
        // TODO(perf): faster approximation of log10
        Some(power.log10() * 20.)
    }
}

#[wasm_bindgen]
pub struct SpectrogramTile {
    #[wasm_bindgen(readonly)]
    pub width: u32,
    pixels: Box<[f32]>,
}

#[wasm_bindgen]
impl SpectrogramTile {
    fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            pixels: vec![f32::NAN; width as usize * height as usize].into(),
        }
    }
    pub fn into_inner(self) -> Box<[f32]> {
        self.pixels
    }
    pub fn from_inner(width: u32, pixels: Box<[f32]>) -> Self {
        Self { width, pixels }
    }
    pub fn render(&self, db_min: f32, db_max: f32) -> Result<ImageData, JsValue> {
        let db_range = db_max - db_min;
        let pixel_data: Vec<u32> = self
            .pixels
            .iter()
            .map(|db| colormap::eval((db - db_min) / db_range))
            .collect();
        ImageData::new_with_u8_clamped_array(Clamped(bytemuck::cast_slice(&pixel_data)), self.width)
    }
    fn set_pixel(&mut self, x: u32, y: u32, val: f32) {
        let i = y as usize * self.width as usize + x as usize;
        self.pixels[i] = val;
    }
}

fn pitch2freq(pitch: f64) -> f64 {
    2_f64.powf((pitch - 69.) / 12.) * 440.
}

fn freq2pitch(freq: f64) -> f64 {
    (freq / 440.).log2() * 12. + 69.
}
