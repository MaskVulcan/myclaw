import OpenClawKit
import Testing
@testable import OpenClaw

@Suite(.serialized) struct GatewayConnectionIssueTests {
    @Test func detectsTokenMissing() {
        let issue = GatewayConnectionIssue.detect(from: "unauthorized: gateway token missing")
        #expect(issue == .tokenMissing)
        #expect(issue.needsAuthToken)
    }

    @Test func detectsUnauthorized() {
        let issue = GatewayConnectionIssue.detect(from: "Gateway error: unauthorized role")
        #expect(issue == .unauthorized)
        #expect(issue.needsAuthToken)
    }

    @Test func detectsPairingWithRequestId() {
        let issue = GatewayConnectionIssue.detect(from: "pairing required (requestId: abc123)")
        #expect(issue == .pairingRequired(requestId: "abc123"))
        #expect(issue.needsPairing)
        #expect(issue.requestId == "abc123")
    }

    @Test func detectsNetworkError() {
        let issue = GatewayConnectionIssue.detect(from: "Gateway error: Connection refused")
        #expect(issue == .network)
    }

    @Test func returnsNoneForBenignStatus() {
        let issue = GatewayConnectionIssue.detect(from: "Connected")
        #expect(issue == .none)
    }

    @Test func detectsStructuredPairingProblem() {
        let issue = GatewayConnectionIssue.detect(
            problem: GatewayConnectionProblem(
                kind: .pairingScopeUpgradeRequired,
                owner: .gateway,
                title: "Additional permissions required",
                message: "Approve the new scopes on the gateway.",
                requestId: "req-123",
                retryable: false,
                pauseReconnect: true))

        #expect(issue == .pairingRequired(requestId: "req-123"))
    }

    @Test func detectsStructuredNetworkProblem() {
        let issue = GatewayConnectionIssue.detect(
            problem: GatewayConnectionProblem(
                kind: .timeout,
                owner: .network,
                title: "Connection timed out",
                message: "The gateway did not respond in time.",
                retryable: true,
                pauseReconnect: false))

        #expect(issue == .network)
    }
}
