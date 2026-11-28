package com.momo.ledger;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NotificationTrackingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
