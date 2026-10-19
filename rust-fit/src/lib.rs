// Pure numeric fitting rules. The browser calls these exports inside a Web Worker.
// Values are clamped because wardrobe measurements come from user controls.
#[no_mangle]
pub extern "C" fn garment_width(body_width: f32, ease: f32) -> f32 {
    (body_width.clamp(0.75, 1.35) * ease.clamp(1.02, 1.30)).clamp(0.78, 1.76)
}

#[no_mangle]
pub extern "C" fn garment_length(height: f32, garment_factor: f32) -> f32 {
    (height.clamp(0.80, 1.25) * garment_factor.clamp(0.75, 1.35)).clamp(0.60, 1.69)
}

#[no_mangle]
pub extern "C" fn layer_depth(layer: i32) -> f32 {
    match layer {
        0 => 0.018,
        1 => 0.050,
        _ => 0.083,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_measurements_in_safe_range() {
        assert!(garment_width(5.0, 5.0) <= 1.76);
        assert!(garment_length(0.0, 0.0) >= 0.60);
        assert!(layer_depth(2) > layer_depth(0));
    }
}
