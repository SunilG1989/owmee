package com.owmee

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

class MapsConfigModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "MapsConfig"

  override fun getConstants(): MutableMap<String, Any> =
      hashMapOf("googleMapsEnabled" to BuildConfig.GOOGLE_MAPS_ENABLED)
}
