package com.sydstudio.tguploader;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TgSyncPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
