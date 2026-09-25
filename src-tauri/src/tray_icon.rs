//! macOS 菜单栏模板图标。
//!
//! 模板图标只有纯黑 + alpha，由系统按浅色/深色菜单栏自动反色，这样才符合
//! 菜单栏其他图标的风格。图标在这里按公式绘制，避免再往仓库里塞一个二进制资源。

use tauri::image::Image;

/// 画布边长。tray-icon 会把图标缩放到 18pt 高，36px 正好对应 Retina 2x。
const SIZE: u32 = 36;
const CENTER: f32 = SIZE as f32 / 2.0;
const RING_RADIUS: f32 = 14.0;
const RING_HALF_STROKE: f32 = 1.6;
const HAND_HALF_WIDTH: f32 = 1.35;
const HOUR_HAND_LENGTH: f32 = 7.0;
const MINUTE_HAND_LENGTH: f32 = 8.8;

/// 点到线段的距离，用来画带圆头的指针。
fn distance_to_segment(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let (abx, aby) = (bx - ax, by - ay);
    let (apx, apy) = (px - ax, py - ay);
    let length_squared = abx * abx + aby * aby;

    let t = if length_squared <= f32::EPSILON {
        0.0
    } else {
        ((apx * abx + apy * aby) / length_squared).clamp(0.0, 1.0)
    };

    let (dx, dy) = (apx - abx * t, apy - aby * t);
    (dx * dx + dy * dy).sqrt()
}

/// 时钟图标：外圈 + 指向 12 点的时针 + 指向 3 点的分针。
pub fn menu_bar_icon() -> Image<'static> {
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);

    for y in 0..SIZE {
        for x in 0..SIZE {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;

            let radius = ((px - CENTER).powi(2) + (py - CENTER).powi(2)).sqrt();
            let ring = (radius - RING_RADIUS).abs() - RING_HALF_STROKE;
            let hour = distance_to_segment(px, py, CENTER, CENTER, CENTER, CENTER - HOUR_HAND_LENGTH)
                - HAND_HALF_WIDTH;
            let minute =
                distance_to_segment(px, py, CENTER, CENTER, CENTER + MINUTE_HAND_LENGTH, CENTER)
                    - HAND_HALF_WIDTH;

            // 三个形状取并集，再把有向距离转成覆盖率，得到 1px 宽的抗锯齿边缘
            let distance = ring.min(hour).min(minute);
            let coverage = (0.5 - distance).clamp(0.0, 1.0);

            rgba.extend_from_slice(&[0, 0, 0, (coverage * 255.0).round() as u8]);
        }
    }

    Image::new_owned(rgba, SIZE, SIZE)
}
