package com.motogear.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlugPagPlugin.class);
        registerPlugin(MotoGearNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
