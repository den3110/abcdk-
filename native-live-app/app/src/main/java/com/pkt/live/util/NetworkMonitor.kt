package com.pkt.live.util

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Monitors network connectivity state.
 * Used to show connection indicators and handle offline scenarios gracefully.
 */
class NetworkMonitor(context: Context) {

    companion object {
        private const val TAG = "NetworkMonitor"
    }

    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val _isConnected = MutableStateFlow(true)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _isWifi = MutableStateFlow(false)
    val isWifi: StateFlow<Boolean> = _isWifi.asStateFlow()

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            Log.d(TAG, "Network available")
            _isConnected.value = true
            checkWifi()
        }

        override fun onLost(network: Network) {
            Log.d(TAG, "Network lost")
            _isConnected.value = false
            _isWifi.value = false
        }

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities,
        ) {
            _isWifi.value = networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        }
    }

    init {
        try {
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            connectivityManager.registerNetworkCallback(request, callback)
            checkWifi()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register network callback", e)
        }
    }

    private fun checkWifi() {
        try {
            val active = connectivityManager.activeNetwork
            val caps = connectivityManager.getNetworkCapabilities(active)
            _isWifi.value = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        } catch (e: Exception) {
            Log.e(TAG, "checkWifi error", e)
        }
    }

    fun unregister() {
        try {
            connectivityManager.unregisterNetworkCallback(callback)
        } catch (e: Exception) {
            Log.e(TAG, "unregister error", e)
        }
    }
}
