import SwiftUI
import Testing
@testable import MoirasiaUI

#if canImport(AppKit)
import AppKit

@MainActor
private func components(_ color: Color, appearance: NSAppearance.Name) -> [CGFloat] {
    var result: [CGFloat] = []
    NSAppearance(named: appearance)?.performAsCurrentDrawingAppearance {
        if let rgb = NSColor(color).usingColorSpace(.sRGB) {
            result = [rgb.redComponent, rgb.greenComponent, rgb.blueComponent, rgb.alphaComponent]
        }
    }
    return result
}

@Test @MainActor func nativeSurfacesAndAlphaFollowAppearance() {
    for appearance in [NSAppearance.Name.aqua, .darkAqua] {
        let canvas = components(MoiraColor.canvas, appearance: appearance)
        let surface = components(MoiraColor.surface, appearance: appearance)
        let border = components(MoiraColor.border, appearance: appearance)
        #expect(canvas.count == 4)
        #expect(canvas != surface)
        #expect(border != surface)
        #expect(canvas[3] == 1)
        #expect(surface[3] == 1)
        #expect(abs(border[3] - (appearance == .darkAqua ? 0.1 : 1)) < 0.000001)
    }
    #expect(components(MoiraColor.canvas, appearance: .aqua) != components(MoiraColor.canvas, appearance: .darkAqua))
}

@Test @MainActor func exithibitionRemainsFixedDark() {
    for color in [MoiraExithibition.canvas, MoiraExithibition.surface, MoiraExithibition.windowBackground, MoiraExithibition.cool, MoiraExithibition.fan] {
        #expect(components(color, appearance: .aqua) == components(color, appearance: .darkAqua))
    }
    // SwiftUI's fixed Color can round through float32; NSColor dynamic providers use Double.
    let fixed = components(MoiraExithibition.canvas, appearance: .aqua)
    let adaptive = components(MoiraColor.canvas, appearance: .darkAqua)
    #expect(zip(fixed, adaptive).allSatisfy { abs($0 - $1) < 0.000001 })
}
#endif

@Test func nativeControlsHaveNamedDesktopAndTouchSizes() {
    #expect(MoiraControl.smallHeight == 32)
    #expect(MoiraControl.mediumHeight == 36)
    #expect(MoiraControl.largeHeight == 40)
    #expect(MoiraControl.touchHeight >= 44)
}

@Test func typographyPreservesEveryNamedMethodAndParameters() {
    let roles = [MoiraType.caption(weight: .bold, design: .monospaced), MoiraType.small(), MoiraType.body(), MoiraType.bodyLarge(), MoiraType.titleSmall(), MoiraType.title(), MoiraType.titleLarge()]
    #expect(roles.count == 7)
}
