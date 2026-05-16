package com.owmee

import android.os.Bundle
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "owmee"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  // Keep LaunchTheme through the native-to-React handoff so Android never
  // shows a blank frame between the native icon and the JS brand splash.
  override fun onCreate(savedInstanceState: Bundle?) {
    SplashControlModule.reset()
    installSplashScreen().setKeepOnScreenCondition {
      SplashControlModule.shouldKeepOnScreen()
    }
    super.onCreate(null)
  }
}
