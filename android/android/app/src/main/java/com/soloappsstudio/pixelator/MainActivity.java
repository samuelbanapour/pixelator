package com.soloappsstudio.pixelator;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HeicConverterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
