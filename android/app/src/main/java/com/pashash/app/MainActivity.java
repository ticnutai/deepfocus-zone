package com.pashash.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ThemeBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
