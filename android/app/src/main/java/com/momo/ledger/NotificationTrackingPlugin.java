package com.momo.ledger;

import android.content.ComponentName;
import android.content.Intent;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.util.Set;

@CapacitorPlugin(name = "NotificationTracking")
public class NotificationTrackingPlugin extends Plugin {
    private static final String PREFS = "momo_notification_tracking";
    private static final String EVENTS = "events";

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("enabled", isListenerEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void getCapturedNotifications(PluginCall call) {
        String raw = getContext().getSharedPreferences(PREFS, 0).getString(EVENTS, "[]");
        JSObject result = new JSObject();
        try {
            result.put("items", new JSArray(raw));
        } catch (JSONException error) {
            result.put("items", new JSArray());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void clearCapturedNotifications(PluginCall call) {
        getContext().getSharedPreferences(PREFS, 0).edit().remove(EVENTS).apply();
        call.resolve();
    }

    private boolean isListenerEnabled() {
        Set<String> packages = NotificationManagerCompat.getEnabledListenerPackages(getContext());
        return packages.contains(getContext().getPackageName());
    }
}
