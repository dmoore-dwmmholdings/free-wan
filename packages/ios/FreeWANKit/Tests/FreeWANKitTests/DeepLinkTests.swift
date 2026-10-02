import Foundation
import Testing
@testable import FreeWANKit

@Suite struct DeepLinkTests {
    @Test(arguments: [
        ("freewan://media/0191-abc", DeepLink.media("0191-abc")),
        ("freewan:///media/0191-abc", DeepLink.media("0191-abc")),
        ("FREEWAN://Clip/k1", DeepLink.clip("k1")),
        ("freewan://collection/c%201", DeepLink.collection("c 1")),
    ])
    func parses(_ text: String, _ expected: DeepLink) {
        #expect(DeepLink(url: URL(string: text)!) == expected)
    }

    @Test(arguments: ["https://media/x", "freewan://media", "freewan://media/", "freewan://users/x", "freewan://media/a/b"])
    func rejects(_ text: String) {
        #expect(DeepLink(url: URL(string: text)!) == nil)
    }

    @Test func roundTrips() {
        for link in [DeepLink.media("a b"), .clip("k"), .collection("c")] {
            #expect(DeepLink(url: link.url) == link)
        }
    }

    @Test func detailToCard() throws {
        let detail = try JSONDecoder().decode(MediaDetail.self, from: Data(DetailTests.json.utf8))
        #expect(detail.card.id == "m1")
        #expect(detail.card.liked && detail.card.likeCount == 3)
    }
}
