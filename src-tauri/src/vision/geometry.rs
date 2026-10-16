//! Physical screen coordinates throughout; caret::local applies the overlay DPI scale.
use super::RawResult;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}
impl Rect {
    pub fn width(self) -> i32 {
        self.right - self.left
    }
    pub fn height(self) -> i32 {
        self.bottom - self.top
    }
}
pub(super) fn crop(monitor: Rect, pointer: (i32, i32)) -> Option<Rect> {
    let (x, y) = pointer;
    if x < monitor.left || x >= monitor.right {
        return None;
    }
    if y < monitor.top || y >= monitor.bottom {
        return None;
    }
    // A fixed physical-pixel budget bounds allocation and OCR cost at every DPI.
    Some(Rect {
        left: x.saturating_sub(320).max(monitor.left),
        top: y.saturating_sub(180).max(monitor.top),
        right: x.saturating_add(320).min(monitor.right),
        bottom: y.saturating_add(180).min(monitor.bottom),
    })
}

pub(super) struct Nearest {
    crop: Rect,
    pointer: (i32, i32),
    best: f64,
    result: RawResult,
}
impl Nearest {
    pub fn new(crop: Rect, pointer: (i32, i32), display: u32) -> Self {
        Self {
            crop,
            pointer,
            best: f64::INFINITY,
            result: RawResult {
                status: 3,
                display,
                ..RawResult::default()
            },
        }
    }
    pub fn word(&mut self, rect: Rect, glyph: char) {
        if rect.left < 0 || rect.right > self.crop.width() {
            return;
        }
        if rect.top < 0 || rect.bottom > self.crop.height() {
            return;
        }
        if rect.width() <= 0 || !(6..=100).contains(&rect.height()) {
            return;
        }
        let left = f64::from(self.crop.left) + f64::from(rect.left);
        let top = f64::from(self.crop.top) + f64::from(rect.top);
        let right = left + f64::from(rect.width());
        let bottom = top + f64::from(rect.height());
        let dx = (left - f64::from(self.pointer.0))
            .max(0.0)
            .max(f64::from(self.pointer.0) - right);
        let dy = (top - f64::from(self.pointer.1))
            .max(0.0)
            .max(f64::from(self.pointer.1) - bottom);
        let distance = dx.hypot(dy);
        if distance < self.best {
            self.best = distance;
            self.result = RawResult {
                status: 4,
                display: self.result.display,
                x: right - 8.0_f64.min(f64::from(rect.width()) / 2.0),
                y: top,
                height: f64::from(rect.height()),
                glyph: if glyph.is_ascii_graphic() {
                    glyph as u32
                } else {
                    'o' as u32
                },
            };
        }
    }
    pub fn finish(self) -> RawResult {
        self.result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clips_to_negative_monitor_without_crossing_the_seam() {
        let monitor = Rect {
            left: -1920,
            top: -1080,
            right: 0,
            bottom: 0,
        };
        assert_eq!(
            crop(monitor, (-10, -10)),
            Some(Rect {
                left: -330,
                top: -190,
                right: 0,
                bottom: 0
            })
        );
        assert!(crop(monitor, (0, 0)).is_none());
        let centered = crop(monitor, (-1000, -500)).unwrap();
        assert_eq!((centered.width(), centered.height()), (640, 360));
    }
    #[test]
    fn selects_nearest_box_not_reading_order_and_exports_only_last_glyph() {
        let crop = Rect {
            left: -500,
            top: -200,
            right: 140,
            bottom: 160,
        };
        let mut nearest = Nearest::new(crop, (-180, -20), 9);
        nearest.word(
            Rect {
                left: 10,
                top: 10,
                right: 100,
                bottom: 30,
            },
            'x',
        );
        nearest.word(
            Rect {
                left: 300,
                top: 170,
                right: 340,
                bottom: 190,
            },
            'z',
        );
        let result = nearest.finish();
        assert_eq!((result.x, result.y, result.height), (-168.0, -30.0, 20.0));
        assert_eq!(
            (result.status, result.display, result.glyph),
            (4, 9, 'z' as u32)
        );
    }
    #[test]
    fn rejects_invalid_boxes_and_normalizes_non_ascii() {
        let crop = Rect {
            left: 0,
            top: 0,
            right: 640,
            bottom: 360,
        };
        let mut nearest = Nearest::new(crop, (0, 0), 1);
        for rect in [
            Rect {
                left: -1,
                top: 0,
                right: 20,
                bottom: 20,
            },
            Rect {
                left: 20,
                top: 0,
                right: 10,
                bottom: 20,
            },
            Rect {
                left: 0,
                top: 0,
                right: 20,
                bottom: 101,
            },
        ] {
            nearest.word(rect, 'x');
        }
        assert_eq!(nearest.result.status, 3);
        nearest.word(
            Rect {
                left: 0,
                top: 0,
                right: 20,
                bottom: 20,
            },
            'é',
        );
        assert_eq!(nearest.finish().glyph, 'o' as u32);
    }
}
