package com.momoledger.companion;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class AlertSyncWorker extends Worker {
    public AlertSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }
    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        android.content.SharedPreferences settings = SecurePrefs.get(context);
        String url = settings.getString("supabase_url", ""), token = settings.getString("access_token", ""), business = settings.getString("business_id", ""), booth = settings.getString("booth_id", ""), device = settings.getString("device_id", "");
        if (url.isEmpty() || token.isEmpty() || business.isEmpty() || booth.isEmpty() || device.isEmpty()) return Result.failure();
        AlertOutbox outbox = new AlertOutbox(context); JSONArray pending = outbox.snapshot();
        for (int i=0;i<pending.length();i++) {
            try {
                JSONObject item = pending.getJSONObject(i), alert = new JSONObject(item.toString());
                alert.put("business_id", business); alert.put("booth_id", booth); alert.put("device_id", device); alert.put("device_event_id", device + ":" + item.getString("event_key")); alert.put("source_kind", "NOTIFICATION"); alert.put("event_at", new java.util.Date(item.optLong("event_at")).toInstant().toString());
                HttpURLConnection connection = (HttpURLConnection) new URL(url + "/rest/v1/rpc/ingest_momo_alert").openConnection(); connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("apikey", settings.getString("anon_key", "")); connection.setRequestProperty("Authorization", "Bearer " + token); connection.setRequestProperty("Content-Type", "application/json");
                byte[] body = new JSONObject().put("alert", alert).toString().getBytes(StandardCharsets.UTF_8); try (OutputStream output = connection.getOutputStream()) { output.write(body); }
                int code = connection.getResponseCode(); connection.disconnect(); if (code >= 200 && code < 300) outbox.remove(item.getString("event_key")); else if (code == 401 || code == 403) return Result.failure(); else return Result.retry();
            } catch (Exception error) { return Result.retry(); }
        }
        return Result.success();
    }
}
