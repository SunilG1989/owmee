package com.owmee

import android.graphics.Color
import android.os.Build
import android.view.View
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SystemBarsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SystemBars"

  @ReactMethod
  fun setNavigationBarColor(hexColor: String, darkIcons: Boolean) {
    val activity = currentActivity ?: return

    activity.runOnUiThread {
      val window = activity.window
      window.navigationBarColor = Color.parseColor(hexColor)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val decor = window.decorView
        val lightNavigationFlag = View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        decor.systemUiVisibility =
            if (darkIcons) {
              decor.systemUiVisibility or lightNavigationFlag
            } else {
              decor.systemUiVisibility and lightNavigationFlag.inv()
            }
      }
    }
  }
}
