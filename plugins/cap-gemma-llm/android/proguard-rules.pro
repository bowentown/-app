# MediaPipe / LiteRT 原生库保持完整（模型推理核心），不做混淆裁剪
-keep class com.google.mediapipe.** { *; }
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.mediapipe.**
