# Android build toolchain for the Expo app: Node 22 + JDK 17 + Android SDK/NDK.
# Versions match react-native/gradle/libs.versions.toml for RN 0.86 (Expo SDK 57).
# Bump them together with the Expo SDK.
FROM node:26-bookworm

ARG CMDLINE_TOOLS=11076708
ARG ANDROID_PLATFORM=36
ARG BUILD_TOOLS=36.0.0
ARG NDK=27.1.12297006
ARG CMAKE=3.22.1

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip rsync \
 && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

RUN mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS}_latest.zip \
 && unzip -q /tmp/tools.zip -d /tmp/tools \
 && mv /tmp/tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm -rf /tmp/tools /tmp/tools.zip \
 && yes | sdkmanager --licenses > /dev/null \
 && sdkmanager --install \
      "platform-tools" \
      "platforms;android-${ANDROID_PLATFORM}" \
      "build-tools;${BUILD_TOOLS}" \
      "ndk;${NDK}" \
      "cmake;${CMAKE}" > /dev/null

# Gradle reads ~/.gradle/gradle.properties over the project's; build-apk.sh copies this
# in because ~/.gradle is a cache volume.
COPY gradle.properties /opt/gradle-defaults/gradle.properties
COPY build-apk.sh /usr/local/bin/build-apk
RUN chmod +x /usr/local/bin/build-apk

WORKDIR /work
ENTRYPOINT ["build-apk"]
