
const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withFirebaseNotificationChannel(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    manifest.$["xmlns:tools"] =
      "http://schemas.android.com/tools";

    const application = manifest.application?.[0];

    if (!application) {
      throw new Error("Android application manifest not found");
    }

    application["meta-data"] ??= [];

    const channelId =
      "com.google.firebase.messaging.default_notification_channel_id";

    let metadata = application["meta-data"].find(
      (item) => item.$?.["android:name"] === channelId
    );

    if (!metadata) {
      metadata = { $: { "android:name": channelId } };
      application["meta-data"].push(metadata);
    }

    metadata.$["android:value"] = "fuji-alerts";
    metadata.$["tools:replace"] = "android:value";

    return config;
  });
};
