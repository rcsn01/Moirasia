import Testing
@testable import MoirasiaUI

@Test func spacingUsesFourPointFoundation() {
    #expect(MoiraSpace.x1 == 4)
    #expect(MoiraSpace.x2 == 8)
    #expect(MoiraSpace.x3 == 12)
    #expect(MoiraSpace.x4 == 16)
}

@Test func motionDurationsRemainOrdered() {
    #expect(MoiraMotion.fast < MoiraMotion.normal)
    #expect(MoiraMotion.normal < MoiraMotion.deliberate)
}
