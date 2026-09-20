package com.soloappsstudio.pixelator;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;

/**
 * Converts HEIC/HEIF (and any other format Android can decode) to JPEG using the platform decoder.
 * The WebView cannot decode HEIC, and the JavaScript fallback decoder is unreliable on old devices.
 */
@CapacitorPlugin(name = "HeicConverter")
public class HeicConverterPlugin extends Plugin {
    @PluginMethod
    public void toJpeg(final PluginCall call) {
        final String data = call.getString("data");
        if (data == null) {
            call.reject("No data");
            return;
        }
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bmp == null) {
                    call.reject("Android could not decode this image");
                    return;
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.JPEG, 95, out);
                bmp.recycle();
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()));
            }
        }).start();
    }
}
