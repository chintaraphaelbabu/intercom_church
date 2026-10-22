package com.churchcomms.operator.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import com.churchcomms.operator.ChurchCommsApp
import com.churchcomms.operator.MainActivity
import com.churchcomms.operator.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Keeps the Operator session alive while the phone is pocketed.
 *
 * The service is started and stopped by `SessionController`, not by an Activity,
 * so rotating or recreating the Activity never duplicates it. It holds a partial
 * wake lock only while the control client reports a joined room and is
 * deliberately `START_NOT_STICKY`: a dead session must not resurrect silently.
 */
class OperatorService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var app: ChurchCommsApp
    private var wakeLock: PowerManager.WakeLock? = null
    private var holdingWakeLock = false

    override fun onCreate() {
        super.onCreate()
        app = application as ChurchCommsApp
        createNotificationChannel()
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "ChurchComms:session",
        ).apply {
            setReferenceCounted(false)
        }

        scope.launch {
            app.sessionController.state.collect { state ->
                updateWakeLock(ServicePolicy.shouldHoldWakeLock(state.control))
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_LEAVE) {
            app.sessionController.leave()
            stopSelf()
            return START_NOT_STICKY
        }

        val roomName = intent?.getStringExtra(EXTRA_ROOM)
        startForeground(NOTIFICATION_ID, buildNotification(roomName))
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        updateWakeLock(false)
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun updateWakeLock(hold: Boolean) {
        if (hold == holdingWakeLock) {
            return
        }
        val lock = wakeLock ?: return
        if (hold) {
            if (!lock.isHeld) {
                lock.acquire()
            }
            holdingWakeLock = true
        } else {
            if (lock.isHeld) {
                lock.release()
            }
            holdingWakeLock = false
        }
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Active session",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Keeps the Operator connected during a service"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(roomName: String?): Notification {
        val leaveIntent = Intent(this, OperatorService::class.java).apply {
            action = ACTION_LEAVE
        }
        val leavePendingIntent = PendingIntent.getService(
            this,
            1,
            leaveIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(ServicePolicy.notificationTitle(roomName))
            .setContentText(ServicePolicy.notificationText(roomName))
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(
                Notification.Action.Builder(
                    Icon.createWithResource(this, R.drawable.ic_launcher_foreground),
                    ServicePolicy.leaveActionLabel(),
                    leavePendingIntent,
                ).build(),
            )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        }
        return builder.build()
    }

    companion object {
        const val ACTION_START = "com.churchcomms.operator.action.START_SESSION"
        const val ACTION_LEAVE = "com.churchcomms.operator.action.LEAVE_SESSION"
        const val EXTRA_ROOM = "com.churchcomms.operator.extra.ROOM"
        const val CHANNEL_ID = "church_comms_session"
        const val NOTIFICATION_ID = 1001

        fun startIntent(context: Context, roomName: String): Intent =
            Intent(context, OperatorService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_ROOM, roomName)
            }
    }
}

/** SessionController talks to the service through this seam; tests use a fake. */
interface SessionServiceGateway {
    fun start(roomName: String)
    fun stop()
}

class OperatorForegroundServiceGateway(
    private val context: Context,
) : SessionServiceGateway {
    override fun start(roomName: String) {
        context.startForegroundService(OperatorService.startIntent(context, roomName))
    }

    override fun stop() {
        context.stopService(Intent(context, OperatorService::class.java))
    }
}
