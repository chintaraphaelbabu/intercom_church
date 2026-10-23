# Mixer Volume Slider Fix

- File: `android/app/src/main/java/com/churchcomms/operator/ui/MixerScreen.kt`
- Added `actions: OperatorActions` to `RosterVolumeRow`; wired `Slider(onValueChange = { actions.setParticipantVolume(name, it) })`.
- File: `android/app/src/main/java/com/churchcomms/operator/ui/LiveScreen.kt`
- Wired master `Slider(onValueChange = { actions.setMasterVolume(it) })`.
- Build: `gradlew :app:assembleDebug` succeeded.
