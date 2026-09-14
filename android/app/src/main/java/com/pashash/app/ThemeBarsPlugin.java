package com.pashash.app;

import android.graphics.Color;
import android.os.Build;
import androidx.core.view.WindowCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ThemeBars")
public class ThemeBarsPlugin extends Plugin {
    @PluginMethod public void apply(PluginCall call) {
        final int color;
        try { color = Color.parseColor(call.getString("color", "#faf9f7")); }
        catch (IllegalArgumentException error) { call.reject("Invalid color"); return; }
        final boolean darkIcons = call.getBoolean("darkIcons", true);
        getActivity().runOnUiThread(() -> {
            android.view.Window window = getActivity().getWindow();
            // Android 15+ draws transparent bars over the native inset container.
            window.getDecorView().setBackgroundColor(color);
            if (getBridge().getWebView().getParent() instanceof android.view.View) {
                ((android.view.View) getBridge().getWebView().getParent()).setBackgroundColor(color);
            }
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
            if (Build.VERSION.SDK_INT >= 29) {
                window.setStatusBarContrastEnforced(false);
                window.setNavigationBarContrastEnforced(false);
            }
            androidx.core.view.WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(darkIcons);
            controller.setAppearanceLightNavigationBars(darkIcons);
            call.resolve();
        });
    }
}
