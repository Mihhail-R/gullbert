//! Embedded English-oriented models; image and text data never leave this call.
use super::{
    geometry::{Nearest, Rect},
    RawResult,
};
use ocrs::{ImageSource, OcrEngine, OcrEngineParams, TextItem};
use std::sync::OnceLock;

pub(super) fn engine() -> Option<&'static OcrEngine> {
    static ENGINE: OnceLock<Option<OcrEngine>> = OnceLock::new();
    ENGINE
        .get_or_init(|| {
            let detection =
                rten::Model::load(include_bytes!("../../models/text-detection.rten").to_vec())
                    .ok()?;
            let recognition =
                rten::Model::load(include_bytes!("../../models/text-recognition.rten").to_vec())
                    .ok()?;
            OcrEngine::new(OcrEngineParams {
                detection_model: Some(detection),
                recognition_model: Some(recognition),
                ..Default::default()
            })
            .ok()
        })
        .as_ref()
}

pub(super) fn recognize(
    rgb: &[u8],
    crop: Rect,
    pointer: (i32, i32),
    display: u32,
) -> Option<RawResult> {
    let engine = engine()?;
    let source = ImageSource::from_bytes(rgb, (crop.width() as u32, crop.height() as u32)).ok()?;
    let input = engine.prepare_input(source).ok()?;
    let words = engine.detect_words(&input).ok()?;
    let lines = engine.find_text_lines(&input, &words);
    let text = engine.recognize_text(&input, &lines).ok()?;
    let mut nearest = Nearest::new(crop, pointer, display);
    for line in text.iter().flatten() {
        for word in line.words() {
            let rect = word.bounding_rect();
            if let Some(last) = word.chars().last() {
                nearest.word(
                    Rect {
                        left: rect.left(),
                        top: rect.top(),
                        right: rect.right(),
                        bottom: rect.bottom(),
                    },
                    last.char,
                );
            }
        }
    }
    Some(nearest.finish())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn embedded_models_recognize_text_and_map_back_to_negative_screen_origin() {
        // Synthetic Helvetica 32px black-on-white HELLO WORLD, 320x80 RGB.
        // No screenshot or user content is used in this fixture.
        let pixels = include_bytes!("fixtures/hello-world.rgb");
        let result = recognize(
            pixels,
            Rect {
                left: -500,
                top: -200,
                right: -180,
                bottom: -120,
            },
            (-450, -160),
            7,
        )
        .unwrap();
        assert_eq!(result.status, 4);
        assert_eq!(result.display, 7);
        assert_eq!(result.glyph, 'O' as u32); // HELLO, the nearest word
        assert!(result.x > -470.0 && result.x < -350.0);
        assert!(result.y >= -200.0 && result.y < -120.0);
        assert!((15.0..45.0).contains(&result.height));
    }
    #[test]
    fn bundled_models_load_and_blank_crop_has_no_words() {
        let engine = engine().expect("embedded OCR models must load offline");
        let pixels = vec![255; 320 * 180 * 3];
        let input = engine
            .prepare_input(ImageSource::from_bytes(&pixels, (320, 180)).unwrap())
            .unwrap();
        assert!(engine.detect_words(&input).unwrap().is_empty());
    }
}
