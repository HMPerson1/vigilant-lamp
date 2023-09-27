mod colormap;
mod utils;

use std::{ops::RangeInclusive, rc::Rc};

use js_sys::Float32Array;
use realfft::{
    num_complex::{Complex32, Complex64},
    RealFftPlanner, RealToComplex, RealToComplexEven,
};
use rustfft::FftPlanner;
use wasm_bindgen::{prelude::*, Clamped};

use itertools::Itertools;
use web_sys::ImageData;

pub struct AudioBufferData {
    samples: Box<[f32]>,
    sample_rate: f32,
}

#[derive(Clone)]
#[wasm_bindgen]
pub struct AudioBuffer(Rc<AudioBufferData>);

#[wasm_bindgen]
impl AudioBuffer {
    #[wasm_bindgen(constructor)]
    pub fn new(samples: Box<[f32]>, sample_rate: f32) -> Self {
        utils::set_panic_hook();
        Self(Rc::new(AudioBufferData {
            samples,
            sample_rate,
        }))
    }
}

const CHUNK_SIZE: usize = 128;
const CHUNK_SIZE_F: f32 = CHUNK_SIZE as f32;

#[wasm_bindgen]
pub struct WaveformRenderer {
    audio: AudioBuffer,
    chuncked: Box<[(f32, f32)]>,
}

#[wasm_bindgen]
impl WaveformRenderer {
    #[wasm_bindgen(constructor)]
    pub fn new(audio: &AudioBuffer) -> Self {
        let audio_samples = &*audio.0.samples;
        let chunk_iter = audio_samples.chunks_exact(CHUNK_SIZE);
        let remainder = chunk_iter.remainder();
        let last = remainder.iter().copied().minmax().into_option();
        let chuncked: Box<[_]> = chunk_iter
            .map(|chunk| chunk.iter().copied().minmax().into_option().unwrap())
            .chain(last)
            .collect();
        Self {
            audio: audio.clone(),
            chuncked,
        }
    }

    #[wasm_bindgen]
    pub fn render(
        &self,
        time_start: f32,
        time_end: f32,
        width: u32,
        height: u32,
    ) -> Result<ImageData, JsValue> {
        assert!(height > 1);
        let mut pixel_data = vec![0_u32; width as usize * height as usize];
        let sample_start = time_start * self.audio.0.sample_rate;
        let hheightf = height as f32 / 2.;
        let x_to_sample = (time_end - time_start) / width as f32 * self.audio.0.sample_rate;
        if x_to_sample > 2. * CHUNK_SIZE_F {
            let chunks = &*self.chuncked;
            assert!(chunks.len() > 1);
            for x in 0..width {
                let pixel_start_chunk =
                    ((x as f32 * x_to_sample + sample_start) / CHUNK_SIZE_F) as usize;
                let pixel_end_chunk =
                    (((x + 1) as f32 * x_to_sample + sample_start) / CHUNK_SIZE_F) as usize;
                let pixel_chunks =
                    &chunks[clamp_range(pixel_start_chunk, pixel_end_chunk, chunks.len())];
                if let Some((min, max)) = aggregate_minmax(pixel_chunks) {
                    let y0 = (min * hheightf + hheightf) as usize;
                    let y1 = (max * hheightf + hheightf) as usize;
                    for y in clamp_range(y0, y1, height as usize) {
                        pixel_data[y * width as usize + x as usize] = 0xffffffff;
                    }
                }
            }
        } else {
            let audio_samples = &*self.audio.0.samples;
            assert!(audio_samples.len() > 1);
            for x in 0..width {
                let pixel_start = (x as f32 * x_to_sample + sample_start) as usize;
                let pixel_end = ((x + 1) as f32 * x_to_sample + sample_start) as usize;
                let pixel_samples =
                    &audio_samples[clamp_range(pixel_start, pixel_end, audio_samples.len())];
                if let Some((min, max)) = pixel_samples.iter().copied().minmax().into_option() {
                    let y0 = (min * hheightf + hheightf) as usize;
                    let y1 = (max * hheightf + hheightf) as usize;
                    for y in clamp_range(y0, y1, height as usize) {
                        pixel_data[y * width as usize + x as usize] = 0xffffffff;
                    }
                }
            }
        }
        ImageData::new_with_u8_clamped_array(Clamped(bytemuck::must_cast_slice(&pixel_data)), width)
    }
}

fn clamp_range(start: usize, end: usize, max: usize) -> RangeInclusive<usize> {
    let start = start.min(max - 1);
    start..=end.clamp(start, max - 1)
}

fn aggregate_minmax(pixel_chunks: &[(f32, f32)]) -> Option<(f32, f32)> {
    if pixel_chunks.len() == 0 {
        return None;
    }
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for &(cmin, cmax) in pixel_chunks {
        min = min.min(cmin);
        max = max.max(cmax);
    }
    Some((min, max))
}

#[wasm_bindgen]
pub fn preprocess_audio(samples: Box<[f32]>) -> Box<[JsValue]> {
    let mut planner = FftPlanner::<f64>::new();
    let (spectrum, norm1): (Vec<Complex64>, f64) = {
        let fft = RealToComplexEven::<f64>::new(samples.len().next_power_of_two(), &mut planner);
        let mut input = fft.make_input_vec();
        let mut output = fft.make_output_vec();
        for (&sample_src, input_dst) in samples.iter().zip(input.iter_mut()) {
            *input_dst = sample_src.into();
        }
        fft.process(&mut *input, &mut *output).unwrap();
        (output, (fft.len() as f64).sqrt().recip())
    };
    let mut real_planner = RealFftPlanner::<f64>::new();
    let samples_d2 = ifft_oneshot(
        &mut real_planner,
        &spectrum[0..(spectrum.len() - 1) / 2],
        norm1,
        (samples.len() + 1) / 2,
    );
    let samples_d4 = ifft_oneshot(
        &mut real_planner,
        &spectrum[0..(spectrum.len() - 1) / 4],
        norm1,
        (samples.len() + 1) / 4,
    );

    vec![
        Float32Array::from(&*samples_d2).into(),
        Float32Array::from(&*samples_d4).into(),
    ]
    .into_boxed_slice()
}

#[derive(Clone)]
#[wasm_bindgen]
pub struct PreprocessedAudio {
    full: AudioBuffer,
    ds2: AudioBuffer,
    ds4: AudioBuffer,
}

#[wasm_bindgen]
impl PreprocessedAudio {
    #[wasm_bindgen(constructor)]
    pub fn new(full: Box<[f32]>, ds2: Box<[f32]>, ds4: Box<[f32]>, sample_rate: f32) -> Self {
        Self {
            full: AudioBuffer::new(full, sample_rate),
            ds2: AudioBuffer::new(ds2, sample_rate / 2.),
            ds4: AudioBuffer::new(ds4, sample_rate / 4.),
        }
    }
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
    full: SpectrogramRendererOne,
    ds2: SpectrogramRendererOne,
    ds4: SpectrogramRendererOne,
}

#[wasm_bindgen]
impl SpectrogramRenderer {
    #[wasm_bindgen(constructor)]
    pub fn new(audio: &PreprocessedAudio, fft_window_size: usize, gaus_window_sigma: f64) -> Self {
        Self {
            full: SpectrogramRendererOne::new(
                audio.full.clone(),
                fft_window_size,
                gaus_window_sigma,
            ),
            ds2: SpectrogramRendererOne::new(
                audio.ds2.clone(),
                fft_window_size / 2,
                gaus_window_sigma,
            ),
            ds4: SpectrogramRendererOne::new(
                audio.ds4.clone(),
                fft_window_size / 4,
                gaus_window_sigma,
            ),
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
        let min_sample_rate = 2. * pitch2freq(pitch_max + 1.) as f32;
        let renderer = if min_sample_rate < self.ds4.audio.0.sample_rate {
            &mut self.ds4
        } else if min_sample_rate < self.ds2.audio.0.sample_rate {
            &mut self.ds2
        } else {
            &mut self.full
        };
        renderer.render(
            canvas_width,
            canvas_height,
            pitch_min,
            pitch_max,
            time_start,
            time_end,
        )
    }
}

fn ifft_oneshot(
    real_planner: &mut RealFftPlanner<f64>,
    spectrum: &[Complex64],
    spec_norm: f64,
    out_len: usize,
) -> Box<[f32]> {
    let ifft = real_planner.plan_fft_inverse(spectrum.len() * 2);
    let mut input = ifft.make_input_vec();
    let mut output = ifft.make_output_vec();
    // strip spectrum >= nyquist
    assert_eq!(input.len() - 1, spectrum.len());
    input[0..spectrum.len()].copy_from_slice(spectrum);
    ifft.process(&mut *input, &mut *output).unwrap();
    let norm2 = (ifft.len() as f64).sqrt().recip();
    // strip trailing zeros & normalize
    let mut samples_d2 = vec![0_f32; out_len];
    for (&spec_src, samples_dst) in output.iter().zip(samples_d2.iter_mut()) {
        *samples_dst = (spec_src * spec_norm * norm2) as f32;
    }

    samples_d2.into_boxed_slice()
}

struct SpectrogramRendererOne {
    audio: AudioBuffer,
    window: Box<[f32]>,
    fft_in: Box<[f32]>,
    fft_scratch: Box<[Complex32]>,
    fft_out: Box<[Complex32]>,
    fft: RealToComplexEven<f32>,
}

impl SpectrogramRendererOne {
    fn new(audio: AudioBuffer, fft_window_size: usize, gaus_window_sigma: f64) -> Self {
        let fft = realfft::RealToComplexEven::<f32>::new(
            fft_window_size,
            &mut rustfft::FftPlanner::new(),
        );
        Self {
            audio,
            window: gen_gaussian_window(fft_window_size, gaus_window_sigma),
            fft_in: fft.make_input_vec().into(),
            fft_scratch: fft.make_scratch_vec().into(),
            fft_out: fft.make_output_vec().into(),
            fft,
        }
    }

    fn render(
        &mut self,
        canvas_width: u32,
        canvas_height: u32,
        pitch_min: f64,
        pitch_max: f64,
        time_start: f64,
        time_end: f64,
    ) -> SpectrogramTile {
        assert!(self.window.len() == self.fft_in.len());
        let audio_sample_rate = self.audio.0.sample_rate as f64;
        let audio_sample_len = self.audio.0.samples.len();

        let freq_min_ln = pitch2freq(pitch_min).ln();
        let freq_max_ln = pitch2freq(pitch_max).ln();
        let y_to_freq_ln_mul = ((freq_min_ln - freq_max_ln) / (canvas_height as f64)) as f32;
        let y_to_freq_ln_add = (freq_max_ln
            + ((self.fft_out.len() - 1) as f64 / (audio_sample_rate / 2.)).ln())
            as f32;
        let sample_len_log10 = (audio_sample_len as f32).log10();

        let time_len = time_end - time_start;
        let x_to_time = time_len / canvas_width as f64;

        let mut tile = SpectrogramTile::new(canvas_width, canvas_height);
        for x in 0..canvas_width {
            let sample = ((time_start + x as f64 * x_to_time) * audio_sample_rate).round() as isize;
            if sample < 0 || sample as usize >= audio_sample_len {
                tile.set_column(x, f32::NEG_INFINITY);
                continue;
            }
            self.do_fft_at(sample as usize);

            for y in 0..canvas_height {
                let power = {
                    // TODO: anti-alias?
                    let bucket = ((y as f32 * y_to_freq_ln_mul) + y_to_freq_ln_add).exp();
                    if let Some(power_raw) = self.fft_out.get(bucket.round() as usize) {
                        // TODO(perf): faster approximation of log10
                        (power_raw.norm_sqr().log10() - sample_len_log10) * 10_f32
                    } else {
                        f32::NEG_INFINITY
                    }
                };
                tile.set_pixel(x, y, power);
            }
        }

        tile
    }

    fn do_fft_at(&mut self, sample: usize) {
        copy_centered_window(sample, &self.audio.0.samples, &mut self.fft_in);

        for (x, &w) in self.fft_in.iter_mut().zip(&*self.window) {
            *x *= w;
        }

        self.fft
            .process_with_scratch(&mut self.fft_in, &mut self.fft_out, &mut self.fft_scratch)
            .unwrap();
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
            pixels: vec![0_f32; width as usize * height as usize].into(),
        }
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        (self.pixels.len() / self.width as usize) as u32
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
        ImageData::new_with_u8_clamped_array(
            Clamped(bytemuck::must_cast_slice(&pixel_data)),
            self.width,
        )
    }
    fn set_pixel(&mut self, x: u32, y: u32, val: f32) {
        let i = y as usize * self.width as usize + x as usize;
        self.pixels[i] = val;
    }
    fn set_column(&mut self, x: u32, val: f32) {
        for y in 0..self.height() {
            self.set_pixel(x, y, val);
        }
    }
}

fn pitch2freq(pitch: f64) -> f64 {
    2_f64.powf((pitch - 69.) / 12.) * 440.
}

fn freq2pitch(freq: f64) -> f64 {
    (freq / 440.).log2() * 12. + 69.
}
