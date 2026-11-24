package id.kelompok13.cowcare;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * CowCare untuk Android.
 *
 * Antarmuka dan model AI (MobileNetV2, bobot float16) dibawa di dalam APK (folder assets/www)
 * dan dilayani dari domain virtual https://appassets.androidplatform.net/ sehingga
 * Web Worker dan fetch() berjalan normal. Aplikasi tidak meminta izin INTERNET:
 * semua inferensi dan penyimpanan riwayat terjadi di HP.
 */
public class MainActivity extends Activity {

    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/index.html";
    private static final int REQ_FILE = 41;
    private static final int MAX_FILE_CHARS = 20 * 1024 * 1024;

    private WebView web;
    private ValueCallback<Uri[]> pendingChooser;
    private Uri pendingCameraUri;

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("bin", "application/octet-stream");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage untuk riwayat
        s.setAllowFileAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setAllowContentAccess(true);         // membaca foto dari kamera/galeri
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "CowCareAndroid");
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new ChromeClient());

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ---------- melayani berkas assets/www dari domain virtual ----------
    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            if (path.contains("..")) return notFound();
            String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            try {
                InputStream in = getAssets().open("www" + path);
                WebResourceResponse r = new WebResourceResponse(mime, "utf-8", in);
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "no-cache");
                h.put("Access-Control-Allow-Origin", "https://" + HOST);
                r.setResponseHeaders(h);
                return r;
            } catch (IOException e) {
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8",
                    new java.io.ByteArrayInputStream(new byte[0]));
            r.setStatusCodeAndReasonPhrase(404, "Not Found");
            return r;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return false;
            // hanya tautan telepon yang diteruskan ke aplikasi lain; tautan lain diabaikan
            if (req.isForMainFrame() && "tel".equals(u.getScheme())) safeStart(new Intent(Intent.ACTION_DIAL, u));
            return true;
        }
    }

    // ---------- kamera dan galeri untuk <input type="file"> ----------
    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingChooser != null) pendingChooser.onReceiveValue(null);
            pendingChooser = callback;
            pendingCameraUri = null;

            boolean image = true;
            for (String t : params.getAcceptTypes()) if (t != null && (t.contains("json") || t.equals(".json"))) image = false;

            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType(image ? "image/*" : "application/json");
            if (!image) pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "application/octet-stream", "text/plain"});

            Intent intent;
            if (!image) {
                intent = Intent.createChooser(pick, "Pilih berkas cadangan CowCare");
            } else if (params.isCaptureEnabled()) {
                Intent cam = cameraIntent();
                intent = cam != null ? cam : pick;
            } else {
                intent = Intent.createChooser(pick, "Pilih foto sapi");
            }
            try {
                startActivityForResult(intent, REQ_FILE);
            } catch (ActivityNotFoundException e) {
                pendingChooser = null;
                Toast.makeText(MainActivity.this, "Aplikasi kamera/galeri tidak ditemukan", Toast.LENGTH_LONG).show();
                return false;
            }
            return true;
        }
    }

    private Intent cameraIntent() {
        try {
            File dir = new File(getCacheDir(), SharedFileProvider.DIR);
            if (!dir.exists() && !dir.mkdirs()) return null;
            File f = new File(dir, "foto_" + System.currentTimeMillis() + ".jpg");
            if (!f.exists() && !f.createNewFile()) return null;
            pendingCameraUri = SharedFileProvider.uriFor(f.getName());
            Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            cam.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);
            cam.setClipData(ClipData.newRawUri("foto", pendingCameraUri));
            cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return cam;
        } catch (IOException e) {
            return null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || pendingChooser == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getData() != null) result = new Uri[]{data.getData()};
            else if (pendingCameraUri != null) result = new Uri[]{pendingCameraUri};
        }
        pendingChooser.onReceiveValue(result);
        pendingChooser = null;
        pendingCameraUri = null;
    }

    // ---------- jembatan JavaScript -> Android ----------
    private class Bridge {
        @JavascriptInterface
        public void shareText(String text) {
            if (text == null || text.length() > 4000) return;
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> safeStart(Intent.createChooser(i, "Kirim hasil ke dokter hewan")));
        }

        @JavascriptInterface
        public void dial(String number) {
            String n = number == null ? "" : number.replaceAll("[^0-9+]", "");
            Intent i = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + n));
            runOnUiThread(() -> safeStart(i));
        }

        @JavascriptInterface
        public void saveCsv(String name, String content) {
            saveFile(name, content, "text/csv");
        }

        @JavascriptInterface
        public void saveFile(String name, String content, String mime) {
            boolean csv = "text/csv".equals(mime);
            if (!csv && !"application/json".equals(mime)) return;
            if (content == null || content.length() > MAX_FILE_CHARS) return;
            String safe = name == null ? (csv ? "cowcare.csv" : "cowcare.json") : name.replaceAll("[^A-Za-z0-9._-]", "_");
            try {
                File dir = new File(getCacheDir(), SharedFileProvider.DIR);
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir");
                File f = new File(dir, safe);
                try (FileOutputStream out = new FileOutputStream(f)) {
                    if (csv) out.write(new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF}); // BOM agar Excel membaca UTF-8
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                }
                Uri uri = SharedFileProvider.uriFor(safe);
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_STREAM, uri);
                i.setClipData(ClipData.newRawUri(safe, uri));
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                String judul = csv ? "Simpan atau kirim CSV riwayat" : "Simpan cadangan riwayat";
                runOnUiThread(() -> safeStart(Intent.createChooser(i, judul)));
            } catch (IOException e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Gagal membuat berkas", Toast.LENGTH_LONG).show());
            }
        }
    }

    private void safeStart(Intent i) {
        try { startActivity(i); } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Tidak ada aplikasi yang bisa membuka ini", Toast.LENGTH_LONG).show();
        }
    }
}
