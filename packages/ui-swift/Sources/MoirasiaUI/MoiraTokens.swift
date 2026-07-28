// Generated from @moirasia/design-tokens. Do not edit directly.
import SwiftUI

#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

public enum MoiraColor {
    public static let canvas = dynamic(light: RGB(247, 247, 248), dark: RGB(28, 29, 32))
    public static let surface = dynamic(light: RGB(248, 249, 250), dark: RGB(36, 38, 42))
    public static let surfaceRaised = dynamic(light: RGB(255, 255, 255), dark: RGB(49, 51, 56))
    public static let textPrimary = dynamic(light: RGB(23, 24, 27), dark: RGB(236, 238, 241))
    public static let textMuted = dynamic(light: RGB(102, 107, 114), dark: RGB(174, 178, 185))
    public static let textSubtle = dynamic(light: RGB(116, 120, 126), dark: RGB(174, 178, 185))
    public static let border = dynamic(light: RGB(200, 204, 209), dark: RGB(76, 80, 87))
    public static let borderStrong = dynamic(light: RGB(116, 120, 126), dark: RGB(174, 178, 185))
    public static let control = dynamic(light: RGB(248, 249, 250), dark: RGB(49, 51, 56))
    public static let controlHover = dynamic(light: RGB(236, 238, 241), dark: RGB(76, 80, 87))
    public static let controlSelected = dynamic(light: RGB(255, 255, 255), dark: RGB(76, 80, 87))
    public static let successSurface = dynamic(light: RGB(223, 243, 231), dark: RGB(23, 59, 40))
    public static let successText = dynamic(light: RGB(23, 98, 55), dark: RGB(139, 216, 169))
    public static let warningSurface = dynamic(light: RGB(255, 246, 213), dark: RGB(75, 58, 8))
    public static let warningBorder = dynamic(light: RGB(230, 193, 90), dark: RGB(114, 92, 29))
    public static let warningText = dynamic(light: RGB(118, 85, 0), dark: RGB(245, 213, 113))
    public static let dangerSurface = dynamic(light: RGB(249, 224, 224), dark: RGB(76, 37, 40))
    public static let dangerText = dynamic(light: RGB(159, 47, 47), dark: RGB(243, 164, 169))
    public static let dangerAction = dynamic(light: RGB(200, 67, 67), dark: RGB(201, 84, 92))
    public static let dangerActionHover = dynamic(light: RGB(179, 58, 58), dark: RGB(219, 102, 112))
    public static let textOnDanger = dynamic(light: RGB(255, 255, 255), dark: RGB(255, 255, 255))
}

public enum MoiraSpace {
    public static let x1: CGFloat = 4
    public static let x2: CGFloat = 8
    public static let x3: CGFloat = 12
    public static let x4: CGFloat = 16
    public static let x5: CGFloat = 20
    public static let x6: CGFloat = 24
    public static let x7: CGFloat = 28
    public static let x8: CGFloat = 32
    public static let x10: CGFloat = 40
}

public enum MoiraRadius {
    public static let control: CGFloat = 8
    public static let card: CGFloat = 12
    public static let panel: CGFloat = 16
    public static let overlay: CGFloat = 20
    public static let pill: CGFloat = 999
}

public enum MoiraControl {
    public static let smallHeight: CGFloat = 34
    public static let mediumHeight: CGFloat = 36
}

public enum MoiraMotion {
    public static let fast: Double = 0.1
    public static let normal: Double = 0.18
    public static let deliberate: Double = 0.28
}

public enum MoiraType {
    public static func caption(
        weight: Font.Weight = .regular,
        design: Font.Design = .default
    ) -> Font {
        .system(
            size: 12,
            weight: weight,
            design: design
        )
    }

    public static func small(
        weight: Font.Weight = .regular,
        design: Font.Design = .default
    ) -> Font {
        .system(
            size: 13,
            weight: weight,
            design: design
        )
    }

    public static func body(
        weight: Font.Weight = .regular,
        design: Font.Design = .default
    ) -> Font {
        .system(
            size: 15,
            weight: weight,
            design: design
        )
    }

    public static func title(
        weight: Font.Weight = .semibold,
        design: Font.Design = .default
    ) -> Font {
        .system(
            size: 20,
            weight: weight,
            design: design
        )
    }
}

public enum MoiraExithibition {
    public static let canvas = color(RGB(0, 0, 0))
    public static let surface = color(RGB(8, 8, 8))
    public static let surfaceRaised = color(RGB(18, 18, 18))
    public static let textPrimary = color(RGB(255, 255, 255))
    public static let textMuted = color(RGB(255, 255, 255, 0.58))
    public static let textSubtle = color(RGB(255, 255, 255, 0.42))
    public static let border = color(RGB(255, 255, 255, 0.15))
    public static let borderStrong = color(RGB(255, 255, 255, 0.24))
    public static let control = color(RGB(255, 255, 255, 0.06))
    public static let controlHover = color(RGB(255, 255, 255, 0.10))
    public static let controlSelected = color(RGB(255, 255, 255, 0.10))
    public static let actionPrimary = color(RGB(255, 255, 255))
    public static let actionPrimaryHover = color(RGB(236, 238, 241))
    public static let actionPrimaryPressed = color(RGB(216, 219, 224))
    public static let actionPrimaryBorder = color(RGB(255, 255, 255, 0.24))
    public static let textOnAction = color(RGB(0, 0, 0))
    public static let focus = color(RGB(255, 255, 255))
    public static let focusSoft = color(RGB(255, 255, 255, 0.28))
}

private struct RGB {
    let red: Double
    let green: Double
    let blue: Double
    let opacity: Double

    init(_ red: Int, _ green: Int, _ blue: Int, _ opacity: Double = 1) {
        self.red = Double(red) / 255
        self.green = Double(green) / 255
        self.blue = Double(blue) / 255
        self.opacity = opacity
    }
}

private func color(_ value: RGB) -> Color {
    Color(
        red: value.red,
        green: value.green,
        blue: value.blue,
        opacity: value.opacity
    )
}

private func dynamic(light: RGB, dark: RGB) -> Color {
    #if canImport(AppKit)
    return Color(
        nsColor: NSColor(name: nil) { appearance in
            let match = appearance.bestMatch(from: [.aqua, .darkAqua])
            let value = match == .darkAqua ? dark : light
            return NSColor(
                red: value.red,
                green: value.green,
                blue: value.blue,
                alpha: value.opacity
            )
        }
    )
    #elseif canImport(UIKit)
    return Color(
        uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: value.red,
                green: value.green,
                blue: value.blue,
                alpha: value.opacity
            )
        }
    )
    #else
    return color(light)
    #endif
}
