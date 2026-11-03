import Foundation
import Sentry

/// Crash and error reports to Sentry. Off without a DSN, and separate from
/// the usage statistics setting.
enum CrashReporting {
    static func start(_ config: AppConfig) {
        guard !config.sentryDSN.isEmpty else { return }
        SentrySDK.start { options in
            options.dsn = config.sentryDSN
            #if DEBUG
            options.environment = "debug"
            #else
            options.environment = "production"
            #endif
            options.releaseName = "judge-ios@\(config.version)+\(config.build)"
            options.sendDefaultPii = false
            options.tracesSampleRate = 0
            options.enableAutoPerformanceTracing = false
            options.sessionReplay.sessionSampleRate = 0
            options.sessionReplay.onErrorSampleRate = 0
            // The screens show the user's case text.
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            // Request URLs carry case tokens and the RevenueCat account id.
            options.enableNetworkBreadcrumbs = false
            options.enableCaptureFailedRequests = false
        }
    }
}
