package com.churchcomms.operator

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.churchcomms.operator.session.SessionController
import com.churchcomms.operator.ui.OperatorActions
import com.churchcomms.operator.ui.OperatorApp
import com.churchcomms.operator.ui.theme.ChurchCommsTheme

/**
 * Thin Activity: it only observes the process-scoped SessionController, forwards
 * user intents, and asks for the notification and microphone permissions in
 * context. Rotating or recreating it never recreates discovery, control, media,
 * or the foreground service.
 */
class MainActivity : ComponentActivity() {
    private lateinit var session: SessionController
    private var pendingJoin: (() -> Unit)? = null

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    private val microphonePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val join = pendingJoin
        pendingJoin = null
        if (granted && join != null) {
            join()
        } else if (!granted) {
            Toast.makeText(
                this,
                "Microphone access is needed for push-to-talk. Allow it in " +
                    "Settings, then join the room again.",
                Toast.LENGTH_LONG,
            ).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        session = (application as ChurchCommsApp).sessionController

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
                        setDisplayName = session::setDisplayName,
                        joinRoom = ::joinRoomWithMicrophone,
                        setCameraNumber = session::setCameraNumber,
                        setParticipantVolume = session::setParticipantVolume,
                        setMasterVolume = session::setMasterVolume,
                        pressPtt = session::pressPtt,
                        releasePtt = session::releasePtt,
                    ),
                    onRequestNotificationPermission = ::requestNotificationPermission,
                )
            }
        }
    }

    /**
     * Microphone access is requested when the Operator joins, where it is
     * obviously needed. A refused prompt is explained once; the join stays in
     * the lobby so the user can allow it from Settings and try again.
     */
    private fun joinRoomWithMicrophone(room: String, camera: Int) {
        val join = { session.joinRoom(room, cameraNumber = camera) }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            join()
            return
        }
        pendingJoin = join
        microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
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
