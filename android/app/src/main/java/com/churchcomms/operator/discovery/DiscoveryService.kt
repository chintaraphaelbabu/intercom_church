package com.churchcomms.operator.discovery

import android.content.Context
import android.net.ConnectivityManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed interface DiscoveryState {
    data object Idle : DiscoveryState
    data object Discovering : DiscoveryState
    data class Found(val servers: List<DiscoveredServer>) : DiscoveryState
    data class Failed(val message: String) : DiscoveryState
}

/**
 * Finds the Director's laptop over mDNS/DNS-SD.
 *
 * The service contract is `_church-comms._tcp.local` with the TXT records from
 * docs/design.md §12. A multicast lock is held while discovery runs because some
 * Android builds otherwise drop mDNS replies on Wi-Fi.
 */
class DiscoveryService(context: Context) {
    private val appContext = context.applicationContext
    private val _state = MutableStateFlow<DiscoveryState>(DiscoveryState.Idle)
    val state: StateFlow<DiscoveryState> = _state.asStateFlow()

    private val handler = Handler(Looper.getMainLooper())
    private val found = LinkedHashMap<String, DiscoveredServer>()
    private val resolveQueue = ArrayDeque<NsdServiceInfo>()
    private val pending = mutableSetOf<String>()

    private var nsdManager: NsdManager? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var resolving = false
    private var started = false

    fun start() {
        if (started) {
            return
        }
        started = true
        acquireMulticastLock()
        beginDiscovery()
    }

    fun stop() {
        started = false
        stopDiscovery()
        found.clear()
        pending.clear()
        resolveQueue.clear()
        resolving = false
        releaseMulticastLock()
        _state.value = DiscoveryState.Idle
    }

    fun retry() {
        if (!started) {
            start()
            return
        }
        stopDiscovery()
        found.clear()
        pending.clear()
        resolveQueue.clear()
        resolving = false
        _state.value = DiscoveryState.Discovering
        handler.postDelayed(
            {
                if (started) {
                    beginDiscovery()
                }
            },
            300,
        )
    }

    private fun beginDiscovery() {
        val connectivity = appContext.getSystemService(ConnectivityManager::class.java)
        if (connectivity?.activeNetwork == null) {
            _state.value = DiscoveryState.Failed(
                "No network connection. Join the church Wi-Fi, then retry discovery.",
            )
            return
        }

        val nsd = appContext.getSystemService(Context.NSD_SERVICE) as? NsdManager
        if (nsd == null) {
            _state.value = DiscoveryState.Failed(
                "mDNS is not available on this device. Use a device with network service discovery.",
            )
            return
        }
        nsdManager = nsd

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                if (started) {
                    _state.value = DiscoveryState.Discovering
                }
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (!started) {
                    return
                }
                if (pending.add(serviceInfo.serviceName)) {
                    resolveQueue.addLast(serviceInfo)
                    resolveNext()
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                if (!started) {
                    return
                }
                pending.remove(serviceInfo.serviceName)
                if (found.remove(serviceInfo.serviceName) != null) {
                    publishFound()
                }
            }

            override fun onDiscoveryStopped(serviceType: String) {
                // The service list is already published; a retry starts a new pass.
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                if (!started) {
                    return
                }
                _state.value = DiscoveryState.Failed(
                    "mDNS discovery could not start (error $errorCode). " +
                        "Check that Wi-Fi is on, then retry.",
                )
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                // Stopping is best effort; the next start replaces this listener.
            }
        }

        discoveryListener = listener
        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: IllegalArgumentException) {
            discoveryListener = null
            _state.value = DiscoveryState.Failed(
                "mDNS discovery could not start. Check that Wi-Fi is on, then retry.",
            )
        }
    }

    private fun stopDiscovery() {
        val nsd = nsdManager
        val listener = discoveryListener
        discoveryListener = null
        if (nsd != null && listener != null) {
            try {
                nsd.stopServiceDiscovery(listener)
            } catch (_: IllegalArgumentException) {
                // The listener was already stopped; nothing to do.
            }
        }
    }

    private fun resolveNext() {
        if (resolving) {
            return
        }
        val nsd = nsdManager ?: return
        if (resolveQueue.isEmpty()) {
            return
        }
        val serviceInfo = resolveQueue.removeFirst()
        resolving = true

        try {
            nsd.resolveService(
                serviceInfo,
                object : NsdManager.ResolveListener {
                    override fun onResolveFailed(failedInfo: NsdServiceInfo, errorCode: Int) {
                        pending.remove(failedInfo.serviceName)
                        resolving = false
                        resolveNext()
                    }

                    override fun onServiceResolved(resolvedInfo: NsdServiceInfo) {
                        if (started) {
                            addServer(resolvedInfo)
                        }
                        pending.remove(resolvedInfo.serviceName)
                        resolving = false
                        resolveNext()
                    }
                },
            )
        } catch (_: IllegalArgumentException) {
            pending.remove(serviceInfo.serviceName)
            resolving = false
            resolveNext()
        }
    }

    @Suppress("DEPRECATION")
    private fun addServer(info: NsdServiceInfo) {
        val host = hostOf(info) ?: run {
            pending.remove(info.serviceName)
            return
        }
        val txt = info.attributes.mapValues { (_, value) ->
            value.toString(Charsets.UTF_8)
        }
        val displayName = txt["name"]
            ?.takeIf { it.isNotBlank() }
            ?: info.serviceName.substringBefore("._").ifBlank { info.serviceName }

        found[info.serviceName] = DiscoveredServer(
            serviceName = info.serviceName,
            displayName = displayName,
            host = host,
            port = info.port,
            txt = txt,
        )
        publishFound()
    }

    @Suppress("DEPRECATION")
    private fun hostOf(info: NsdServiceInfo): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            info.hostAddresses
                .firstOrNull()
                ?.hostAddress
                ?.takeIf { it.isNotBlank() }
                ?.let { return it }
            info.hostname
                ?.takeIf { it.isNotBlank() }
                ?.let { return it }
        }
        return info.host
            ?.hostAddress
            ?.takeIf { it.isNotBlank() }
    }

    private fun publishFound() {
        if (!started) {
            return
        }
        _state.value = DiscoveryState.Found(
            found.values.sortedBy { it.displayName.lowercase() },
        )
    }

    private fun acquireMulticastLock() {
        if (multicastLock != null) {
            return
        }
        val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            ?: return
        multicastLock = wifi.createMulticastLock("church-comms-discovery").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseMulticastLock() {
        multicastLock?.let { lock ->
            if (lock.isHeld) {
                lock.release()
            }
        }
        multicastLock = null
    }

    private companion object {
        const val SERVICE_TYPE = "_church-comms._tcp."
    }
}
