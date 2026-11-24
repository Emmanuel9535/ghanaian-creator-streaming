package com.momoledger.companion;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.Arrays;
import java.util.HashSet;

public final class MainActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(40, 48, 40, 40);
        TextView title = new TextView(this); title.setText("MoMo Ledger Companion"); title.setTextSize(24); root.addView(title);
        TextView copy = new TextView(this); copy.setText("Reads only notifications after explicit Android consent. It does not read SMS or call logs. Alerts remain review-required evidence and are never posted as successful transactions automatically."); copy.setTextSize(16); root.addView(copy);
        EditText packages = field("Provider app package names, comma-separated"); root.addView(packages);
        EditText supabase = field("Supabase URL"); root.addView(supabase);
        EditText business = field("Business ID"); root.addView(business);
        EditText booth = field("Booth ID"); root.addView(booth);
        EditText token = field("Authenticated access token"); token.setInputType(129); root.addView(token);
        Button save = new Button(this); save.setText("Save sync settings"); save.setOnClickListener(v -> SecurePrefs.get(this).edit().putStringSet("provider_packages", new HashSet<>(Arrays.asList(packages.getText().toString().split(",")))).putString("supabase_url", supabase.getText().toString().trim()).putString("business_id", business.getText().toString().trim()).putString("booth_id", booth.getText().toString().trim()).putString("access_token", token.getText().toString().trim()).putString("device_id", android.provider.Settings.Secure.getString(getContentResolver(), android.provider.Settings.Secure.ANDROID_ID)).apply()); root.addView(save);
        Button access = new Button(this); access.setText("Choose notification access"); access.setOnClickListener(v -> startActivity(new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))); root.addView(access);
        setContentView(root);
    }
    private EditText field(String hint) { EditText field = new EditText(this); field.setHint(hint); field.setSingleLine(true); return field; }
}
