import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import FreeWANKit

@Suite struct ErrorTextTests {
    @Test func networkFailuresAreOffline() {
        let timeout = ErrorText(APIError(status: 0, code: "timeout", message: "x"))
        #expect(timeout.title == "Your server is not answering" && timeout.offline)
        #expect(timeout.message.hasPrefix("It did not reply within 20 seconds."))

        #expect(ErrorText(APIError(status: 0, code: "unreachable", message: "x")).title == "Cannot reach your server")
        #expect(ErrorText(URLError(.notConnectedToInternet)).offline)
        #expect(ErrorText(URLError(.timedOut)).title == "Your server is not answering")
    }

    @Test func serverAnswers() {
        #expect(ErrorText(APIError(status: 401, code: "unauthorized", message: "")).title == "Signed out")
        #expect(ErrorText(APIError(status: 403, code: "forbidden", message: "Read-only")).message == "Read-only")
        #expect(ErrorText(APIError(status: 404, code: "not_found", message: "")).title == "Not found")
        let broken = ErrorText(APIError(status: 502, code: "internal", message: "Bad Gateway"))
        #expect(broken.title == "Your server had a problem" && !broken.offline)
        #expect(ErrorText(APIError(status: 200, code: "bad_response", message: "m")).title == "Unexpected answer")
    }

    @Test func otherErrors() {
        struct Odd: Error {}
        #expect(ErrorText(Odd()).title == "Something went wrong")
    }
}
