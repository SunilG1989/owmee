package com.owmee

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SplashControlModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SplashControl"

  @ReactMethod
  fun hide() {
    keepOnScreen = false
  }

  companion object {
    @Volatile
    private var keepOnScreen = true

    fun reset() {
      keepOnScreen = true
    }

    fun shouldKeepOnScreen(): Boolean = keepOnScreen
  }
}
