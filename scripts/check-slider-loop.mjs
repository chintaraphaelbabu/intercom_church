#!/usr/bin/env node
// Feedback loop: verify slider is interactive (not hardcoded value, onValueChange wired, value dynamic)
import fs from 'fs';
const mixer = fs.readFileSync('android/app/src/main/java/com/churchcomms/operator/ui/MixerScreen.kt', 'utf8');
const live = fs.readFileSync('android/app/src/main/java/com/churchcomms/operator/ui/LiveScreen.kt', 'utf8');
const actionsDef = fs.readFileSync('android/app/src/main/java/com/churchcomms/operator/ui/OperatorApp.kt', 'utf8');

let red = false;

// Check MixerScreen slider is not hardcoded to 0.75f
if (mixer.includes('Slider(value = 0.75f')) {
  console.log('RED: MixerScreen slider value is hardcoded 0.75f');
  red = true;
} else {
  console.log('GREEN: MixerScreen slider value is dynamic');
}

// Check LiveScreen slider is not hardcoded to 1f
if (live.includes('Slider(value = 1f')) {
  console.log('RED: LiveScreen slider value is hardcoded 1f');
  red = true;
} else {
  console.log('GREEN: LiveScreen slider value is dynamic');
}

// Check onValueChange is wired (not empty lambda)
if (mixer.includes('onValueChange = {}')) {
  console.log('RED: MixerScreen onValueChange is empty');
  red = true;
} else {
  console.log('GREEN: MixerScreen onValueChange wired');
}

if (live.includes('onValueChange = {}')) {
  console.log('RED: LiveScreen onValueChange is empty');
  red = true;
} else {
  console.log('GREEN: LiveScreen onValueChange wired');
}

// Check actions have volume methods
if (actionsDef.includes('setParticipantVolume') && actionsDef.includes('setMasterVolume')) {
  console.log('GREEN: OperatorActions has volume methods');
} else {
  console.log('RED: OperatorActions missing volume methods');
  red = true;
}

process.exit(red ? 1 : 0);
