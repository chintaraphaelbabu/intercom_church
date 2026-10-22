package com.churchcomms.operator

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.churchcomms.operator.ui.OperatorActions
import com.churchcomms.operator.ui.OperatorApp
import com.churchcomms.operator.ui.theme.ChurchCommsTheme

/**
 * Thin Activity: it only observes the process-scoped SessionController, forwards
 * user intents, and asks for the notification permission when a session starts.
 * Rotating or recreating it never recreates discovery, control, media, or the
 * foreground service.
 */
class MainActivity : ComponentActivity() {
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val session = (application as ChurchCommsApp).sessionController

        setContent {
            val state = session.state.collectAsStateWithLifecycle().value
            ChurchCommsTheme {
                OperatorApp(
                    state = state,
                    actions = OperatorActions(
                        connect = session::connect,
                        retryDiscovery = session::retryDiscovery,
                        retryConnection = session::retryConnection,
                        leave = session::leave,
                        joinDirectorAudio = session::joinDirectorAudio,
                        leaveAudio = session::leaveAudio,
                        clearMute = session::clearMute,
                        pressPtt = session::pressPtt,
                        releasePtt = session::releasePtt,
                    ),
                    onRequestNotificationPermission = ::requestNotificationPermission,
                )
            }
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
