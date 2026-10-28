package org.dayweave.mobile;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DayweaveFilesPlugin.class);
        super.onCreate(savedInstanceState);
        UsageWorker.schedule(this);
    }
}
