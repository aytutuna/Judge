# kotlinx.serialization and OkHttp ship their own consumer rules.
# Keep the @Serializable wire models' generated serializers.
-keepclassmembers class com.okjudge.judge.core.model.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepattributes *Annotation*, InnerClasses
