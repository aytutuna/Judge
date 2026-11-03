package com.okjudge.judge

import android.app.Application

class JudgeApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        val config = AppConfig.fromBuildConfig()
        CrashReporting.start(this, config)
        container = AppContainer(this, config)
        container.start()
        // The store follows the session from here on; without an SDK key this does nothing.
        if (container.purchaseGateway != null) container.purchases.start()
    }
}
