import Testing
@testable import FreeWANKit

@Suite struct PhotoSizeTests {
    @Test func widths() {
        // A 393 pt phone at 3x wants 1179 px, rounded up to the 1280 step.
        #expect(PhotoSize.width(points: 393, scale: 3, sourceWidth: 4032) == 1280)
        #expect(PhotoSize.width(points: 393, scale: 3, sourceWidth: 1200) == nil, "original is small enough")
        #expect(PhotoSize.width(points: 1366, scale: 2, sourceWidth: 8000) == 2560, "capped")
        #expect(PhotoSize.width(points: 393, scale: 3, sourceWidth: nil) == nil)
        #expect(PhotoSize.width(points: 0, scale: 3, sourceWidth: 4000) == 320)
    }

    @Test func paths() {
        #expect(PhotoSize.path(id: "m1", width: 1280) == "/api/media/m1/raw?w=1280")
        #expect(PhotoSize.path(id: "m1", width: nil) == "/api/media/m1/raw")
    }
}
