package com.churchcomms.operator

import android.app.Application
import android.os.Build
import com.churchcomms.operator.control.ControlClient
import com.churchcomms.operator.control.SharedPreferencesSessionTokenStore
import com.churchcomms.operator.discovery.DiscoveryService
import com.churchcomms.operator.media.HttpMediaTokenClient
import com.churchcomms.operator.media.LiveKitOperatorRoom
import com.churchcomms.operator.media.OperatorMedia
import com.churchcomms.operator.service.OperatorForegroundServiceGateway
import com.churchcomms.operator.session.SessionController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Owns the one session for the process.
 *
 * Activities may be destroyed and recreated freely; the control socket, LiveKit
 * room, discovery service, selected join details, and foreground service all
 * live here.
 */
class ChurchCommsApp : Application() {
    lateinit var sessionController: SessionController
        private set

    override fun onCreate() {
        super.onCreate()
        val deviceName = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Operator"
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        sessionController = SessionController(
            discovery = DiscoveryService(this),
            control = ControlClient(
                appVersion = BuildConfig.VERSION_NAME,
                clientName = deviceName,
                tokenStore = SharedPreferencesSessionTokenStore(this),
            ),
            media = OperatorMedia(
                tokenClient = HttpMediaTokenClient(),
                createRoom = { LiveKitOperatorRoom(applicationContext) },
            ),
            service = OperatorForegroundServiceGateway(this),
            defaultDisplayName = deviceName,
            scope = scope,
        )
        sessionController.start()
    }
}
