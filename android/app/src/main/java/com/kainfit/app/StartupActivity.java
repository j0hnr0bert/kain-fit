package com.kainfit.app;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

// Gates the first WebView navigation to server.url behind a native
// connectivity check. Capacitor's default MainActivity/BridgeActivity
// hands the WebView straight to a remote origin — with no network, or the
// server unreachable, that means either a blank white screen or the
// browser-native connection error page. Neither reads as "KainFit" and
// neither offers a way to recover without force-quitting.
//
// Uses ConnectivityManager (built into Android since API 21, the callback
// API used here since API 24) deliberately, rather than a Capacitor plugin
// or a third-party library, per the requirement not to pull in a
// dependency for a trivial reachability check.
public class StartupActivity extends AppCompatActivity {
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean hasNavigated = false;

    private ProgressBar spinner;
    private TextView statusLabel;
    private Button retryButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_startup);

        spinner = findViewById(R.id.kf_spinner);
        statusLabel = findViewById(R.id.kf_status);
        retryButton = findViewById(R.id.kf_retry);
        retryButton.setOnClickListener(v -> checkNow());

        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        startMonitoring();
    }

    private void startMonitoring() {
        showChecking();
        NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(StartupActivity.this::navigateToApp);
            }

            @Override
            public void onLost(Network network) {
                runOnUiThread(() -> {
                    if (!hasNavigated) showOffline();
                });
            }
        };
        connectivityManager.registerNetworkCallback(request, networkCallback);

        // registerNetworkCallback only calls onAvailable for a network that
        // becomes available after registering — check the current state
        // immediately too, so an already-connected device doesn't wait on
        // a callback that may never fire.
        if (isCurrentlyOnline()) {
            navigateToApp();
        } else {
            showOffline();
        }
    }

    private boolean isCurrentlyOnline() {
        Network active = connectivityManager.getActiveNetwork();
        if (active == null) return false;
        NetworkCapabilities caps = connectivityManager.getNetworkCapabilities(active);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void checkNow() {
        showChecking();
        if (isCurrentlyOnline()) {
            navigateToApp();
        } else {
            showOffline();
        }
    }

    private void showChecking() {
        spinner.setVisibility(View.VISIBLE);
        statusLabel.setText("Preparing KainFit…");
        retryButton.setVisibility(View.GONE);
    }

    private void showOffline() {
        spinner.setVisibility(View.GONE);
        // Concise, neutral — matches the copy already used for the web
        // PWA's offline fallback (public/offline.html).
        statusLabel.setText("You're offline\nKainFit needs an internet connection to load your account and food data.");
        retryButton.setVisibility(View.VISIBLE);
    }

    private void navigateToApp() {
        if (hasNavigated) return;
        hasNavigated = true;
        if (networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered — harmless.
            }
        }
        startActivity(new Intent(this, MainActivity.class));
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        finish();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (!hasNavigated && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered — harmless.
            }
        }
    }
}
