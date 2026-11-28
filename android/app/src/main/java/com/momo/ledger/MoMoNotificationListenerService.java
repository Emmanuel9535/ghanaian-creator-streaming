package com.momo.ledger;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class MoMoNotificationListenerService extends NotificationListenerService {
    private static final String PREFS = "momo_notification_tracking";
    private static final String EVENTS = "events";
    private static final int MAX_EVENTS = 100;

    @Override
    public void onNotificationPosted(StatusBarNotification statusBarNotification) {
        Notification notification = statusBarNotification.getNotification();
        if (notification == null || notification.extras == null) return;

        CharSequence titleValue = notification.extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence textValue = notification.extras.getCharSequence(Notification.EXTRA_TEXT);
        String title = titleValue == null ? "" : titleValue.toString().trim();
        String text = textValue == null ? "" : textValue.toString().trim();
        if (TextUtils.isEmpty(title) && TextUtils.isEmpty(text)) return;

        JSONObject event = new JSONObject();
        try {
            event.put("id", statusBarNotification.getKey());
            event.put("packageName", statusBarNotification.getPackageName());
            event.put("title", title);
            event.put("text", text);
            event.put("postedAt", statusBarNotification.getPostTime());
            event.put("capturedAt", System.currentTimeMillis());

            String raw = getSharedPreferences(PREFS, MODE_PRIVATE).getString(EVENTS, "[]");
            JSONArray existing = new JSONArray(raw);
            JSONArray updated = new JSONArray();
            updated.put(event);
            for (int index = 0; index < existing.length() && index < MAX_EVENTS - 1; index++) {
                updated.put(existing.getJSONObject(index));
            }
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(EVENTS, updated.toString()).apply();
        } catch (JSONException ignored) {
            // A malformed notification must not crash the listener service.
        }
    }
}
