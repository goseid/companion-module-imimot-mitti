export function getVariables() {
	const variables = []

	//Standard Variables
	variables.push({
		name: 'Name of the playing cue',
		variableId: 'currentCueName',
	})

	variables.push({
		name: 'Cue ID of the playing cue',
		variableId: 'currentCueID',
	})

	variables.push({
		name: 'Previous cue in playlist',
		variableId: 'previousCueName',
	})

	variables.push({
		name: 'Next cue in playlist',
		variableId: 'nextCueName',
	})

	variables.push({
		name: 'Name of currently selected cue',
		variableId: 'selectedCueName',
	})

	variables.push({
		name: 'Cue ID of the currently selected cue',
		variableId: 'selectedCueID',
	})

	variables.push({
		name: 'Name of the cue before the selected cue (for select-prev navigation)',
		variableId: 'prevSelectedCueName',
	})

	variables.push({
		name: 'Name of the cue after the selected cue (for select-next navigation)',
		variableId: 'nextSelectedCueName',
	})

	// Cached "on deck" attributes for the selected cue. Populated from previous
	// plays of the same cueName, since Mitti only broadcasts these for the
	// currently-playing cue. Show 'None' until the cue has played at least once.
	variables.push({
		name: 'Selected cue total run time (cached, short — drops leading zero hours)',
		variableId: 'selectedCueTRT',
	})

	variables.push({
		name: 'Selected cue total run time (cached, HH:MM:SS)',
		variableId: 'selectedCueTRT_hhmmss',
	})

	variables.push({
		name: 'Selected cue loop state (cached, "On"/"Off"/"None")',
		variableId: 'selectedCueLoop',
	})

	variables.push({
		name: 'Selected cue pause-at-end state (cached, "On"/"Off"/"None")',
		variableId: 'selectedCuePauseAtEnd',
	})

	variables.push({
		name: 'Selected cue audio state (cached, "Unmuted"/"Muted"/"None")',
		variableId: 'selectedCueAudio',
	})

	// Same set for the playlist-position next cue (in case workflow uses next
	// rather than selected for "on deck").
	variables.push({
		name: 'Next cue total run time (cached, short — drops leading zero hours)',
		variableId: 'nextCueTRT',
	})

	variables.push({
		name: 'Next cue total run time (cached, HH:MM:SS)',
		variableId: 'nextCueTRT_hhmmss',
	})

	variables.push({
		name: 'Next cue loop state (cached, "On"/"Off"/"None")',
		variableId: 'nextCueLoop',
	})

	variables.push({
		name: 'Next cue pause-at-end state (cached, "On"/"Off"/"None")',
		variableId: 'nextCuePauseAtEnd',
	})

	variables.push({
		name: 'Next cue audio state (cached, "Unmuted"/"Muted"/"None")',
		variableId: 'nextCueAudio',
	})

	variables.push({
		name: 'Play/ Pause Status',
		variableId: 'playStatus',
	})

	variables.push({
		name: 'Time remaining for current cue, will shorten to -MM:SS if less than 1 hour',
		variableId: 'cueTimeLeft',
	})

	variables.push({
		name: 'Time remaining for current cue, will always show full -HH:MM:SS timecode',
		variableId: 'cueTimeLeft_hhmmss',
	})

	variables.push({
		name: 'Time remaining for current cue, significant digits only, minimum -SS:FF',
		variableId: 'cueTimeLeft_hhmmssff',
	})

	variables.push({
		name: 'Time remaining for current cue (hours)',
		variableId: 'cueTimeLeft_h',
	})

	variables.push({
		name: 'Time remaining for current cue (minutes)',
		variableId: 'cueTimeLeft_m',
	})

	variables.push({
		name: 'Time remaining for current cue (seconds)',
		variableId: 'cueTimeLeft_s',
	})

	variables.push({
		name: 'Time elapsed for current cue, will shorten to -MM:SS if less than 1 hour',
		variableId: 'cueTimeElapsed',
	})

	variables.push({
		name: 'Time elapsed for current cue, will always show full -HH:MM:SS timecode',
		variableId: 'cueTimeElapsed_hhmmss',
	})

	variables.push({
		name: 'Time elapsed for current cue, significant digits only, minimum SS:FF',
		variableId: 'cueTimeElapsed_hhmmssff',
	})

	variables.push({
		name: 'Time elapsed for current cue (hours)',
		variableId: 'cueTimeElapsed_h',
	})

	variables.push({
		name: 'Time elapsed for current cue (minutes)',
		variableId: 'cueTimeElapsed_m',
	})

	variables.push({
		name: 'Time elapsed for current cue (seconds)',
		variableId: 'cueTimeElapsed_s',
	})

	variables.push({
		name: 'Total run time (TRT) for current cue, will shorten to MM:SS if less than 1 hour',
		variableId: 'currentCueTRT',
	})

	variables.push({
		name: 'Total run time (TRT) for current cue, will always show full HH:MM:SS timecode',
		variableId: 'currentCueTRT_hhmmss',
	})

	variables.push({
		name: 'Total run time (TRT) for current cue (hours)',
		variableId: 'currentCueTRT_h',
	})

	variables.push({
		name: 'Total run time (TRT) for current cue (minutes)',
		variableId: 'currentCueTRT_m',
	})

	variables.push({
		name: 'Total run time (TRT) for current cue (seconds)',
		variableId: 'currentCueTRT_s',
	})

	variables.push({
		name: 'Audio mute status for current cue',
		variableId: 'currentCueAudio',
	})

	variables.push({
		name: 'Audio volume for current cue in dB',
		variableId: 'currentCueVolume',
	})

	variables.push({
		name: 'Pause At Beginning status for current cue',
		variableId: 'currentCuePauseAtBeginning',
	})

	variables.push({
		name: 'Pause At End status for current cue',
		variableId: 'currentCuePauseAtEnd',
	})

	variables.push({
		name: 'Fade In status for current cue',
		variableId: 'currentCueFadeIn',
	})

	variables.push({
		name: 'Fade Out status for current cue',
		variableId: 'currentCueFadeOut',
	})

	variables.push({
		name: 'Loop status for current cue',
		variableId: 'currentCueLoop',
	})

	variables.push({
		name: 'Transition status for current cue',
		variableId: 'currentCueTransition',
	})

	variables.push({
		name: 'Goto status for current cue',
		variableId: 'currentCueGoto',
	})

	variables.push({
		name: 'Current playback speed for current cue',
		variableId: 'currentCuePlaybackSpeed',
	})

	variables.push({
		name: 'Current status of video outputs',
		variableId: 'video_outputs',
	})

	variables.push({
		name: 'Current status of audio outputs',
		variableId: 'audio_outputs',
	})

	//Cue Variables
	for (let cueID in this.cues) {
		if (cueID === 'current' || cueID === 'previous' || cueID === 'next' || cueID === '0') {
			continue
		}

		let cue = this.cues[cueID]
		// Mitti broadcasts `cueName` under the position-number path even for
		// cues with a custom ID, so the alias entry (e.g. "FLAG") never
		// receives a cueName event of its own. Borrow it from the paired
		// position entry so the alias's variable populates correctly.
		let displayName = cue?.cueName
		if (displayName === undefined) {
			const paired = this._pairedCueID(cueID)
			if (paired) displayName = this.cues[paired]?.cueName
		}
		variables.push({
			name: `Cue ${cueID} - Name`,
			variableId: `cue_${cueID}_cueName`,
		})
		this.setVariableValues({ [`cue_${cueID}_cueName`]: displayName })
	}

	// Compute prev/next-of-selected names from the now-populated cue cache.
	// Picks up cue add/delete (which call initVariables) as well as the
	// initial state population.
	this._refreshSelectedNavCues()

	return variables
}
