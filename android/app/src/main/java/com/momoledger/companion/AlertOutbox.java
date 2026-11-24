package com.momoledger.companion;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

final class AlertOutbox {
    private static final String PREFS = "momo-alert-outbox";
    private static final String ITEMS = "items";
    private final SharedPreferences prefs;
    AlertOutbox(Context context) { prefs = SecurePrefs.get(context); }
    synchronized void add(AlertParser.Candidate c) {
        try { JSONArray all = new JSONArray(prefs.getString(ITEMS, "[]")); for (int i=0;i<all.length();i++) if (c.eventKey.equals(all.getJSONObject(i).optString("event_key"))) return; JSONObject item = new JSONObject(); item.put("source_package", c.sourcePackage); item.put("provider", c.provider); item.put("transaction_type", JSONObject.NULL.equals(c.type) ? JSONObject.NULL : c.type); item.put("amount_pesewas", c.amount == null ? JSONObject.NULL : c.amount); item.put("customer_phone", c.phone == null ? JSONObject.NULL : c.phone); item.put("provider_reference", c.reference == null ? JSONObject.NULL : c.reference); item.put("confidence", c.confidence); item.put("review_reason", c.reason); item.put("event_at", c.postedAt); item.put("event_key", c.eventKey); all.put(item); prefs.edit().putString(ITEMS, all.toString()).apply(); } catch (Exception ignored) { }
    }
    synchronized JSONArray snapshot() { try { return new JSONArray(prefs.getString(ITEMS, "[]")); } catch (Exception e) { return new JSONArray(); } }
    synchronized void remove(String eventKey) { try { JSONArray all=snapshot(), kept=new JSONArray(); for(int i=0;i<all.length();i++) if(!eventKey.equals(all.getJSONObject(i).optString("event_key"))) kept.put(all.getJSONObject(i)); prefs.edit().putString(ITEMS, kept.toString()).apply(); } catch(Exception ignored){} }
}
