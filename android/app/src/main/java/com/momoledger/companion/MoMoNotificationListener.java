package com.momoledger.companion;

import android.content.SharedPreferences;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import java.util.HashSet;
import java.util.Set;

public final class MoMoNotificationListener extends NotificationListenerService {
    private AlertOutbox outbox;
    @Override public void onCreate() { super.onCreate(); outbox = new AlertOutbox(this); }
    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        SharedPreferences prefs = getSharedPreferences("momo-settings", MODE_PRIVATE);
        Set<String> packages = prefs.getStringSet("provider_packages", new HashSet<>());
        if (!packages.contains(sbn.getPackageName())) return;
        AlertParser.Candidate candidate = AlertParser.parse(sbn.getPackageName(), AlertParser.text(sbn.getNotification()), null, sbn.getPostTime());
        if (candidate == null) return;
        outbox.add(candidate);
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(AlertSyncWorker.class).setConstraints(constraints).build();
        WorkManager.getInstance(this).enqueueUniqueWork("momo-alert-sync", ExistingWorkPolicy.REPLACE, request);
    }
}
