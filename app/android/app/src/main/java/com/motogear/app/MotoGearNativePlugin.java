package com.motogear.app;

import android.Manifest;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.Locale;

@CapacitorPlugin(
    name = "MotoGearNative",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class MotoGearNativePlugin extends Plugin {
    private TextToSpeech textToSpeech;
    private boolean textToSpeechReady;
    private PluginCall pendingSpeakCall;
    private String pendingSpeakText;
    private String pendingSpeakLanguage;
    private float pendingSpeakRate;

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long build = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            JSObject result = new JSObject();
            result.put("build", build);
            result.put("version", info.versionName);
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException error) {
            call.reject("Não consegui identificar a versão instalada.", error);
        }
    }

    @PluginMethod
    public void requestMicrophone(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            resolveMicrophone(call, true);
            return;
        }
        requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        resolveMicrophone(call, getPermissionState("microphone") == PermissionState.GRANTED);
    }

    private void resolveMicrophone(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            call.reject("Texto obrigatório.");
            return;
        }

        String language = call.getString("language", "pt-BR");
        float rate = call.getFloat("rate", 1.0f);
        if (textToSpeechReady) {
            speakNow(call, text, language, rate);
            return;
        }

        if (pendingSpeakCall != null) pendingSpeakCall.resolve();
        pendingSpeakCall = call;
        pendingSpeakText = text;
        pendingSpeakLanguage = language;
        pendingSpeakRate = rate;
        if (textToSpeech != null) return;

        textToSpeech = new TextToSpeech(getContext(), status -> {
            if (status != TextToSpeech.SUCCESS) {
                textToSpeech = null;
                textToSpeechReady = false;
                if (pendingSpeakCall != null) pendingSpeakCall.reject("A voz do aparelho não está disponível.");
                clearPendingSpeech();
                return;
            }
            textToSpeechReady = true;
            PluginCall latestCall = pendingSpeakCall;
            String latestText = pendingSpeakText;
            String latestLanguage = pendingSpeakLanguage;
            float latestRate = pendingSpeakRate;
            clearPendingSpeech();
            if (latestCall != null) speakNow(latestCall, latestText, latestLanguage, latestRate);
        });
    }

    private void speakNow(PluginCall call, String text, String languageTag, float rate) {
        Locale language = Locale.forLanguageTag(languageTag);
        int languageResult = textToSpeech.setLanguage(language);
        if (languageResult == TextToSpeech.LANG_MISSING_DATA || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
            languageResult = textToSpeech.setLanguage(new Locale("pt"));
        }
        if (languageResult == TextToSpeech.LANG_MISSING_DATA || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
            call.reject("A voz em português não está instalada neste aparelho.");
            return;
        }
        textToSpeech.setSpeechRate(Math.max(0.5f, Math.min(rate, 1.5f)));
        int result = textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "motogear-assistant");
        if (result == TextToSpeech.ERROR) {
            call.reject("O aparelho não conseguiu reproduzir a resposta.");
            return;
        }
        call.resolve();
    }

    private void clearPendingSpeech() {
        pendingSpeakCall = null;
        pendingSpeakText = null;
        pendingSpeakLanguage = null;
        pendingSpeakRate = 1.0f;
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (pendingSpeakCall != null) pendingSpeakCall.resolve();
        clearPendingSpeech();
        if (textToSpeech != null) textToSpeech.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
            textToSpeechReady = false;
        }
        if (pendingSpeakCall != null) pendingSpeakCall.resolve();
        clearPendingSpeech();
        super.handleOnDestroy();
    }
}
