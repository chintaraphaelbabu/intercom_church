package com.churchcomms.operator.discovery

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkAddress
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.Executors
import javax.jmdns.JmDNS
import javax.jmdns.ServiceEvent
import javax.jmdns.ServiceInfo
import javax.jmdns.ServiceListener

sealed interface DiscoveryState {
    data object Idle : DiscoveryState
    data object Discovering : DiscoveryState
    data class Found(val servers: List<DiscoveredServer>) : DiscoveryState
    data class Failed(val message: String) : DiscoveryState
}

/** Discovery narrowed for the session controller and JVM tests. */
interface DiscoverySource {
    val state: StateFlow<DiscoveryState>
    fun start()
    fun stop()
    fun retry()
}

/**
 * Finds the Director's laptop over mDNS/DNS-SD.
 *
 * The service contract is `_church-comms._tcp.local` with the TXT records from
 * docs/design.md §12. A multicast lock is held while discovery runs because some
 * Android builds otherwise drop mDNS replies on Wi-Fi.
 *
 * JmDNS is used instead of `NsdManager` because Samsung Android 11 resolves the
 * service inconsistently: discovery succeeds, but `resolveService` can hang and
 * never deliver SRV/TXT/A records. JmDNS owns the query/response cycle, so the
 * TXT records and IPv4 address arrive together.
 */
class DiscoveryService(context: Context) : DiscoverySource {
    private val appContext = context.applicationContext
    private val _state = MutableStateFlow<DiscoveryState>(DiscoveryState.Idle)
    override val state: StateFlow<DiscoveryState> = _state.asStateFlow()

    private val handler = Handler(Looper.getMainLooper())
    private val found = LinkedHashMap<String, DiscoveredServer>()
    private val mdnsExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "church-comms-mdns").apply { isDaemon = true }
    }
    @Volatile private var jmdns: JmDNS? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    @Volatile private var started = false

    private val listener = object : ServiceListener {
        override fun serviceAdded(event: ServiceEvent) {
            if (!started) {
                return
            }
            Log.d(TAG, "mDNS service added: ${event.name}")
            try {
                jmdns?.requestServiceInfo(event.type, event.name, true, RESOLVE_TIMEOUT_MS)
            } catch (error: Exception) {
                Log.w(TAG, "mDNS resolve request failed for ${event.name}", error)
            }
        }

        override fun serviceRemoved(event: ServiceEvent) {
            Log.d(TAG, "mDNS service removed: ${event.name}")
            handler.post {
                if (!started) {
                    return@post
                }
                if (found.remove(event.name) != null) {
                    publishFound()
                }
            }
        }

        override fun serviceResolved(event: ServiceEvent) {
            val info = event.info ?: return
            val server = toServer(info) ?: return
            Log.d(
                TAG,
                "mDNS resolved ${server.serviceName} to ${server.host}:${server.port}",
            )
            handler.post {
                if (!started) {
                    return@post
                }
                found[server.serviceName] = server
                publishFound()
            }
        }
    }

    override fun start() {
        if (started) {
            return
        }
        started = true
        acquireMulticastLock()
        startJmDns()
    }

    override fun stop() {
        started = false
        found.clear()
        _state.value = DiscoveryState.Idle
        mdnsExecutor.execute { closeJmDns() }
        releaseMulticastLock()
    }

    override fun retry() {
        if (!started) {
            start()
            return
        }
        found.clear()
        _state.value = DiscoveryState.Discovering
        mdnsExecutor.execute {
            closeJmDns()
            if (!started) {
                return@execute
            }
            try {
                Thread.sleep(300)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return@execute
            }
            openJmDns()
        }
    }

    private fun startJmDns() {
        if (!started) {
            return
        }
        _state.value = DiscoveryState.Discovering
        mdnsExecutor.execute { openJmDns() }
    }

    private fun openJmDns() {
        if (!started) {
            return
        }
        val address = activeAddress()
        if (address == null) {
            _state.value = DiscoveryState.Failed(
                "No network connection. Join the church Wi-Fi, then retry discovery.",
            )
            return
        }

        try {
            // JmDNS reverse-resolves the local address while starting. It must not
            // run on the main thread, or Android throws NetworkOnMainThreadException.
            val instance = JmDNS.create(address)
            if (!started) {
                runCatching { instance.close() }
                return
            }
            jmdns = instance
            instance.addServiceListener(SERVICE_TYPE, listener)
            Log.d(TAG, "JmDNS discovery started on ${address.hostAddress}")
        } catch (error: Exception) {
            Log.w(TAG, "JmDNS could not start", error)
            if (started) {
                _state.value = DiscoveryState.Failed(
                    "mDNS discovery could not start: ${error.message ?: "unknown error"}. " +
                        "Check that Wi-Fi is on, then retry.",
                )
            }
        }
    }

    private fun closeJmDns() {
        val instance = jmdns
        jmdns = null
        if (instance == null) {
            return
        }
        try {
            instance.removeServiceListener(SERVICE_TYPE, listener)
        } catch (_: Exception) {
            // The listener may already be gone with the instance.
        }
        try {
            instance.close()
        } catch (error: Exception) {
            Log.w(TAG, "JmDNS did not close cleanly", error)
        }
    }

    private fun toServer(info: ServiceInfo): DiscoveredServer? {
        if (!info.hasData()) {
            return null
        }

        val txt = LinkedHashMap<String, String>()
        val names = info.propertyNames
        while (names.hasMoreElements()) {
            val key = names.nextElement()
            info.getPropertyString(key)?.let { value -> txt[key] = value }
        }

        val local = activeLinkAddress()?.let { link ->
            LocalLink(address = link.address, prefixLength = link.prefixLength)
        }
        return ResolvedMdnsService(
            serviceName = info.name,
            addresses = info.inetAddresses.toList(),
            port = info.port,
            txt = txt,
        ).toDiscoveredServer(local)
    }

    @Suppress("DEPRECATION")
    private fun discoveryNetwork(): Network? {
        val connectivity = appContext.getSystemService(ConnectivityManager::class.java)
            ?: return null
        // Church Wi-Fi may have no internet, so Android can keep cellular as the
        // default network. Discovery still has to run on the Wi-Fi link.
        val wifi = connectivity.allNetworks.firstOrNull { network ->
            connectivity.getNetworkCapabilities(network)
                ?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        }
        return wifi ?: connectivity.activeNetwork
    }

    private fun activeLinkAddress(): LinkAddress? {
        val connectivity = appContext.getSystemService(ConnectivityManager::class.java)
            ?: return null
        val network = discoveryNetwork() ?: return null
        val link = connectivity.getLinkProperties(network) ?: return null
        return link.linkAddresses.firstOrNull {
            it.address is Inet4Address && !it.address.isLoopbackAddress
        }
    }

    private fun activeAddress(): InetAddress? {
        activeLinkAddress()?.let { return it.address }
        val connectivity = appContext.getSystemService(ConnectivityManager::class.java)
            ?: return null
        val network = discoveryNetwork() ?: return null
        val link = connectivity.getLinkProperties(network) ?: return null
        return link.linkAddresses
            .map { it.address }
            .firstOrNull { !it.isLoopbackAddress }
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
        const val TAG = "ChurchCommsDiscovery"
        const val SERVICE_TYPE = "_church-comms._tcp.local."
        const val RESOLVE_TIMEOUT_MS = 5000L
    }
}
