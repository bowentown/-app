package com.somnacare.gemmallm;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.mediapipe.tasks.genai.llminference.LlmInference;
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Future;

/**
 * 原生端侧大模型插件：MediaPipe LLM Inference (Gemma .task)。
 *
 * 与 WebView/WASM 方案的本质区别：
 * - 模型文件经 mmap 直接映射（无 MEMFS 双重驻留），峰值内存约为模型体积 + KV 缓存；
 * - 运行在 App 进程的原生层，不受 WebView 渲染进程的内存限制（此前 WASM 方案闪退的根因）；
 * - 下载支持 Bearer 令牌（Gemma 门控模型需要一次性 HF 授权）。
 *
 * 流式输出：generateResponseAsync 的 ProgressListener 回调逐段通知 llmToken 事件。
 */
@CapacitorPlugin(name = "GemmaLLM")
public class GemmaLLMPlugin extends Plugin {

    private LlmInference llmInference;
    private LlmInferenceSession session;
    private Future<?> activeGeneration;
    private volatile boolean downloadCancelled = false;

    // ==== 能力探测与内存门控 ====

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        ret.put("freeMemoryMb", getFreeMemoryMb());
        ret.put("sdkInt", android.os.Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    private long getFreeMemoryMb() {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return -1;
        ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(info);
        return info.availMem / (1024 * 1024);
    }

    // ==== 模型下载（带进度、Bearer 令牌、原子落盘、可取消） ====

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String url = call.getString("url");
        String filename = call.getString("filename");
        String token = call.getString("token", "");
        if (url == null || filename == null || filename.isEmpty()) {
            call.reject("url 与 filename 必填");
            return;
        }
        downloadCancelled = false;
        final String fToken = (token == null || token.trim().isEmpty()) ? null : token.trim();

        getBridge().execute(() -> {
            File finalFile = new File(getContext().getFilesDir(), filename);
            File tempFile = new File(getContext().getFilesDir(), filename + ".part");
            long existing = tempFile.exists() ? tempFile.length() : 0L;

            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(30000);
                if (fToken != null) conn.setRequestProperty("Authorization", "Bearer " + fToken);
                if (existing > 0) conn.setRequestProperty("Range", "bytes=" + existing + "-");

                int code = conn.getResponseCode();
                if (code == 416) { // 断点续传越界 = 已下完
                    if (!tempFile.renameTo(finalFile)) {
                        throw new IOException("重命名临时文件失败");
                    }
                    resolveDownloaded(call, finalFile);
                    return;
                }
                if (code < 200 || code >= 300) {
                    conn.disconnect();
                    call.reject("下载源响应异常 (HTTP " + code + ")");
                    return;
                }

                long total = conn.getContentLengthLong();
                boolean append = code == 206 && existing > 0;
                long base = append ? existing : 0;
                if (!append && tempFile.exists()) tempFile.delete();

                InputStream in = conn.getInputStream();
                FileOutputStream out = new FileOutputStream(tempFile, append);
                byte[] buf = new byte[64 * 1024];
                long loaded = base;
                int lastPercent = -1;
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (downloadCancelled) {
                        in.close();
                        out.close();
                        conn.disconnect();
                        tempFile.delete();
                        call.reject("下载已取消");
                        return;
                    }
                    loaded += n;
                    out.write(buf, 0, n);
                    if (total > 0) {
                        int percent = (int) Math.min(99, (loaded * 100) / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject p = new JSObject();
                            p.put("loaded", loaded);
                            p.put("total", total);
                            p.put("percent", percent);
                            notifyListeners("downloadProgress", p);
                        }
                    }
                }
                out.flush();
                out.close();
                in.close();
                conn.disconnect();

                if (finalFile.exists()) finalFile.delete();
                if (!tempFile.renameTo(finalFile)) {
                    throw new IOException("下载完成后重命名失败");
                }

                JSObject p = new JSObject();
                p.put("percent", 100);
                p.put("path", finalFile.getAbsolutePath());
                notifyListeners("downloadProgress", p);
                resolveDownloaded(call, finalFile);
            } catch (Exception e) {
                if (!downloadCancelled) tempFile.delete();
                call.reject("下载失败: " + e.getMessage());
            }
        });
    }

    private void resolveDownloaded(PluginCall call, File f) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("path", f.getAbsolutePath());
        ret.put("size", f.length());
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        downloadCancelled = true;
        call.resolve();
    }

    @PluginMethod
    public void isModelDownloaded(PluginCall call) {
        String filename = call.getString("filename");
        File f = new File(getContext().getFilesDir(), filename);
        JSObject ret = new JSObject();
        ret.put("downloaded", f.exists() && f.length() > 0);
        ret.put("size", f.exists() ? f.length() : 0);
        ret.put("path", f.getAbsolutePath());
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        String filename = call.getString("filename");
        File f = new File(getContext().getFilesDir(), filename);
        unloadInternal();
        JSObject ret = new JSObject();
        ret.put("deleted", !f.exists() || f.delete());
        call.resolve(ret);
    }

    // ==== 加载与流式生成 ====

    @PluginMethod
    public void loadModel(PluginCall call) {
        String filename = call.getString("filename");
        int maxTokens = call.getInt("maxTokens", 1024);
        File f = new File(getContext().getFilesDir(), filename);
        if (!f.exists() || f.length() == 0) {
            call.reject("模型文件不存在，请先下载");
            return;
        }
        try {
            unloadInternal();
            Activity activity = getActivity();
            LlmInference.LlmInferenceOptions options = LlmInference.LlmInferenceOptions.builder()
                    .setModelPath(f.getAbsolutePath())
                    .setMaxTokens(maxTokens)
                    .setPreferredBackend(LlmInference.Backend.CPU)
                    .build();
            llmInference = LlmInference.createFromOptions(activity, options);
            session = new LlmInferenceSession(llmInference);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("freeMemoryMb", getFreeMemoryMb());
            call.resolve(ret);
        } catch (Exception e) {
            unloadInternal();
            call.reject("模型加载失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void generate(PluginCall call) {
        JSArray messages = call.getArray("messages");
        int maxTokens = call.getInt("maxTokens", 220);
        if (llmInference == null || session == null) {
            call.reject("模型尚未加载");
            return;
        }
        if (messages == null) {
            call.reject("messages 必填");
            return;
        }
        getBridge().execute(() -> {
            StringBuilder full = new StringBuilder();
            try {
                for (Object o : messages.toList()) {
                    if (o instanceof JSObject) {
                        String content = ((JSObject) o).getString("content", "");
                        if (content != null && !content.isEmpty()) session.addQueryChunk(content);
                    }
                }
                Future<String> future = session.generateResponseAsync(
                        partial -> {
                            JSObject p = new JSObject();
                            p.put("text", partial);
                            notifyListeners("llmToken", p);
                        });
                String result = future.get();
                full.append(result);
                setLlmState("ready");
                JSObject ret = new JSObject();
                ret.put("text", result);
                call.resolve(ret);
            } catch (Exception e) {
                // 会话状态可能已被污染，重建会话以保后续可用
                recreateSession();
                call.reject("生成失败: " + e.getMessage());
            }
        });
    }

    private void recreateSession() {
        try {
            if (llmInference != null) {
                session = new LlmInferenceSession(llmInference);
            }
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void unload(PluginCall call) {
        unloadInternal();
        call.resolve();
    }

    private void unloadInternal() {
        try {
            if (session != null) session.close();
        } catch (Exception ignored) {
        }
        try {
            if (llmInference != null) llmInference.close();
        } catch (Exception ignored) {
        }
        session = null;
        llmInference = null;
    }

    private void setLlmState(String state) {
        try {
            android.content.SharedPreferences sp = getContext()
                    .getSharedPreferences("somnacare_native_llm", Context.MODE_PRIVATE);
            sp.edit().putString("state", state).apply();
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void handleOnDestroy() {
        // 应用销毁时释放原生资源
        unloadInternal();
        super.handleOnDestroy();
    }
}
