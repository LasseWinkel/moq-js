const RESOLUTIONS = [1080, 720, 480, 360]
const resolution = RESOLUTIONS[0]

const FRAME_RATES = [30, 20, 10]
const frameRate = FRAME_RATES[0]

const BITRATES = [6_000_000, 4_500_000, 3_000_000, 1_500_000]
const bitrate = BITRATES[0]

const GOP_DEFAULTS = [2, 1, 0.5]
const gopDefault = GOP_DEFAULTS[0]

const GOP_THRESHOLDS = [
	[0.99, 0.95],
	[0.95, 0.9],
	[0.9, 0.85],
]
const gopThresholds = GOP_THRESHOLDS[0]

const PACKET_LOSS_SERVER_LINK = [0, 10, 20, 30]
const packetLossServerLink = PACKET_LOSS_SERVER_LINK[0]

const DELAYS_SERVER_LINK = [0, 50, 200, 500]
const delayServerLink = DELAYS_SERVER_LINK[1]

const BANDWIDTH_CONSTRAINTS_SERVER_LINK = [100_000_000, 50_000_000, 10_000_000]
const bandwidthConstraintServerLink = BANDWIDTH_CONSTRAINTS_SERVER_LINK[0]

// Total number of experiments: 1 + 4 + 2 + 3 + 2 + 9 + 3 + 2 = 26. Each experiment 3 times -> 3 * 26 = 78.

interface EvaluationSceanrio {
	resolution: number
	frameRate: number
	bitrate: number
	gopDefault: number
	gopThresholds: number[]
	packetLossServerLink: number
	delayServerLink: number
	bandwidthConstraintServerLink: number
}

export const EVALUATION_SCENARIO: EvaluationSceanrio = {
	resolution,
	frameRate,
	bitrate,
	gopDefault,
	gopThresholds,
	packetLossServerLink,
	delayServerLink,
	bandwidthConstraintServerLink,
}
