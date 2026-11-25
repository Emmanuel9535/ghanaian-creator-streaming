package com.momoledger.companion;

import android.app.Notification;
import android.os.Bundle;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class AlertParser {
    static final String[] ALLOWED_PACKAGES = {"com.momoledger.companion"};
    private static final Pattern AMOUNT = Pattern.compile("(?:GHS|GH₵|GH\\s*₵|amount|received|paid|sent)\\s*[:=]?\\s*([0-9]+(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern PHONE = Pattern.compile("(?:\\+233|233|0)(?:2|5)\\d{8}");
    private static final Pattern REFERENCE = Pattern.compile("(?:reference|ref|transaction|txn)[\\s:#-]*([A-Za-z0-9/-]{5,})", Pattern.CASE_INSENSITIVE);

    static Candidate parse(String packageName, String title, String text, long postedAt) {
        String source = ((title == null ? "" : title) + " " + (text == null ? "" : text)).trim();
        if (source.length() < 8) return null;
        String lower = source.toLowerCase(Locale.ROOT);
        String provider = lower.contains("mtn") ? "MTN" : lower.contains("telecel") || lower.contains("vodafone") ? "TELECEL" : lower.contains("at money") || lower.contains("airteltigo") ? "AT" : "UNKNOWN";
        if (provider.equals("UNKNOWN")) return null;
        String type = lower.contains("withdraw") || lower.contains("cash out") ? "WITHDRAWAL" : lower.contains("airtime") ? "AIRTIME" : lower.contains("data") ? "DATA_BUNDLE" : lower.contains("bill") ? "BILL_PAYMENT" : lower.contains("deposit") || lower.contains("received") || lower.contains("credited") ? "DEPOSIT" : null;
        String observedStatus = lower.contains("revers") ? "REVERSED" : lower.contains("fail") || lower.contains("declin") ? "FAILED" : lower.contains("pending") || lower.contains("processing") ? "PENDING" : lower.contains("success") || lower.contains("completed") || lower.contains("approved") || lower.contains("received") || lower.contains("credited") ? "SUCCESSFUL" : "UNKNOWN";
        Matcher amountMatcher = AMOUNT.matcher(source);
        Long amount = amountMatcher.find() ? pesewas(amountMatcher.group(1)) : null;
        Matcher phoneMatcher = PHONE.matcher(source);
        String phone = phoneMatcher.find() ? phoneMatcher.group() : null;
        Matcher refMatcher = REFERENCE.matcher(source);
        String reference = refMatcher.find() ? refMatcher.group(1) : null;
        String confidence = amount != null && type != null && reference != null ? "HIGH" : amount != null && type != null ? "MEDIUM" : "LOW";
        String reason = confidence.equals("HIGH") ? "Parsed provider, amount, type, and reference; human confirmation still required" : "Notification is incomplete or ambiguous; review before recording";
        String eventKey = sha256(packageName + "|" + postedAt + "|" + source);
        return new Candidate(packageName, provider, type, observedStatus, amount, phone, reference, confidence, reason, postedAt, eventKey);
    }

    static String text(Notification notification) {
        Bundle extras = notification.extras;
        CharSequence title = extras == null ? null : extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence body = extras == null ? null : extras.getCharSequence(Notification.EXTRA_TEXT);
        return (title == null ? "" : title) + " " + (body == null ? "" : body);
    }

    private static long pesewas(String value) {
        try { return Math.round(Double.parseDouble(value) * 100); } catch (NumberFormatException ignored) { return 0; }
    }
    private static String sha256(String value) {
        try { byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)); StringBuilder out = new StringBuilder(); for (byte b : bytes) out.append(String.format("%02x", b)); return out.toString(); } catch (Exception e) { return Integer.toHexString(value.hashCode()); }
    }

    static final class Candidate {
        final String sourcePackage, provider, type, observedStatus, phone, reference, confidence, reason, eventKey;
        final Long amount;
        final long postedAt;
        Candidate(String sourcePackage, String provider, String type, String observedStatus, Long amount, String phone, String reference, String confidence, String reason, long postedAt, String eventKey) { this.sourcePackage = sourcePackage; this.provider = provider; this.type = type; this.observedStatus = observedStatus; this.amount = amount; this.phone = phone; this.reference = reference; this.confidence = confidence; this.reason = reason; this.postedAt = postedAt; this.eventKey = eventKey; }
    }
}
