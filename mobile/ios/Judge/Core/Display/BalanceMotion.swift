import Foundation

/// The 2D balance's motion, as pure functions of time so it can be tested
/// and driven from a TimelineView: a ±4° rock while waiting, then a damped
/// spring to the verdict angle.
enum BalanceMotion {
    static let rockAmplitude = 4.0
    static let rockPeriod = 2.4
    static let dampingRatio = 0.55
    static let stiffness = 120.0
    /// After this long the spring is visually at rest.
    static let settleDuration = 1.6

    static func rockAngle(at elapsed: TimeInterval) -> Double {
        rockAmplitude * sin(2 * .pi * elapsed / rockPeriod)
    }

    /// Under-damped spring (unit mass, zero start velocity) from `start` to `target`.
    static func springAngle(from start: Double, to target: Double, elapsed: TimeInterval) -> Double {
        guard elapsed > 0 else { return start }
        if elapsed >= settleDuration * 3 { return target }
        let omega = stiffness.squareRoot()
        let zeta = dampingRatio
        let damped = omega * (1 - zeta * zeta).squareRoot()
        let envelope = exp(-zeta * omega * elapsed)
        let shape = cos(damped * elapsed) + (zeta * omega / damped) * sin(damped * elapsed)
        return target + (start - target) * envelope * shape
    }
}
