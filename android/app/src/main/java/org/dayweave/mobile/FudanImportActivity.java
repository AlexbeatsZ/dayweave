package org.dayweave.mobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/** Dedicated school browser, with no Capacitor bridge exposed to the school. */
public class FudanImportActivity extends AppCompatActivity {
    private FudanBrowser browser;
    private TextView status;
    private Button read;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(Activity.RESULT_CANCELED);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(24, 24, 24));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            var bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setPadding(dp(8), dp(6), dp(8), dp(6));
        toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        Button close = new Button(this);
        close.setText("关闭"); close.setTextColor(Color.WHITE);
        close.setOnClickListener(view -> finish());
        toolbar.addView(close, new LinearLayout.LayoutParams(dp(72), dp(48)));
        status = new TextView(this);
        status.setTextColor(Color.rgb(244, 244, 245)); status.setTextSize(12);
        status.setPadding(dp(8), 0, dp(8), 0);
        status.setText("请自行登录并选择学期；登录信息不会传回时织。");
        toolbar.addView(status, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        read = new Button(this);
        read.setText("读取课表"); read.setTextColor(Color.rgb(118, 185, 237));
        read.setOnClickListener(view -> {
            read.setEnabled(false); status.setText("正在读取所选学期的课表…");
            browser.capture((content, error) -> {
                read.setEnabled(true);
                if (error != null) return;
                setResult(Activity.RESULT_OK, new Intent().putExtra("content", content));
                finish();
            });
        });
        toolbar.addView(read, new LinearLayout.LayoutParams(dp(108), dp(48)));
        root.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        browser = new FudanBrowser(this, message -> status.setText(message));
        root.addView(browser.web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { finish(); }
        });
        browser.web.loadUrl(FudanBrowser.LOGIN);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override public void finish() {
        if (browser != null) { browser.destroy(); browser = null; }
        super.finish();
    }
    @Override protected void onDestroy() {
        if (browser != null) {
            browser.destroy(); browser = null;
        }
        super.onDestroy();
    }
}
